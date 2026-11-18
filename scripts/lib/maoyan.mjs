/**
 * Maoyan M-site scraper with risk-control detection, header rotation, and jittered pacing.
 */

import { CITY_ID, USER_AGENTS, normalizePosterUrl, classifyHall } from './config.mjs';

const RISK_PATTERNS = [
  /verify\.meituan\.com/i,
  /spiderindefence/i,
  /验证中心/,
  /访问过于频繁/,
  /滑块/,
  /^\s*<!doctype/i,
  /^\s*<html/i
];

export function pickRandomUserAgent(rng = Math.random) {
  const idx = Math.floor(rng() * USER_AGENTS.length);
  return USER_AGENTS[idx] || USER_AGENTS[0];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterDelay(minMs = 900, maxMs = 2100, rng = Math.random) {
  return Math.floor(minMs + rng() * Math.max(0, maxMs - minMs));
}

/**
 * Inspects an HTTP response from Maoyan to detect anti-bot / risk-control blocks.
 */
export function detectRiskControl({ status, location = '', body = '' }) {
  if (status === 403 || status === 429) {
    return { triggered: true, reason: `HTTP ${status} 拦截` };
  }
  if (status >= 300 && status < 400) {
    if (/verify\.meituan|spiderindefence|passport/i.test(location)) {
      return { triggered: true, reason: `重定向风控验证 (${location.slice(0, 80)})` };
    }
    return { triggered: true, reason: `异常重定向 HTTP ${status}` };
  }
  if (status !== 200) {
    return { triggered: true, reason: `异常状态码 HTTP ${status}` };
  }
  if (!body || !body.trim()) {
    return { triggered: true, reason: '返回空响应体' };
  }
  for (const pat of RISK_PATTERNS) {
    if (pat.test(body)) {
      return { triggered: true, reason: `命中风控特征 (${pat.source})` };
    }
  }
  return { triggered: false, reason: '' };
}

export async function fetchMaoyanJson(url, { referer = 'https://m.maoyan.com/', cookie = '', userAgent, fetchImpl = fetch } = {}) {
  const ua = userAgent || pickRandomUserAgent();
  const headers = {
    'User-Agent': ua,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': referer,
    'Origin': 'https://m.maoyan.com',
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (cookie && cookie.trim()) {
    headers.Cookie = cookie.trim();
  }

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000)
    });
  } catch (err) {
    return {
      ok: false,
      riskTriggered: false,
      networkError: true,
      reason: `网络超时或失败: ${err?.message || err}`,
      data: null
    };
  }

  const location = res.headers?.get?.('location') || '';
  const body = await res.text();
  const risk = detectRiskControl({ status: res.status, location, body });
  if (risk.triggered) {
    return { ok: false, riskTriggered: true, networkError: false, reason: risk.reason, data: null };
  }

  try {
    const parsed = JSON.parse(body);
    return { ok: true, riskTriggered: false, networkError: false, reason: '', data: parsed };
  } catch {
    return {
      ok: false,
      riskTriggered: true,
      networkError: false,
      reason: '响应非合法 JSON（疑似风控拦截页）',
      data: null
    };
  }
}

/**
 * Determines whether a Maoyan plist showtime entry is bookable or a scheduled pre-sale slot.
 */
export function evaluateShowStatus(p) {
  const forbiddenTip = (p.forbiddenTip || '').trim();
  const saleTimeText = (p.saleTimeText || '').trim();
  const saleDate = (p.saleDate || '').trim();
  const enterShowSeat = Number(p.enterShowSeat ?? 1);
  const ticketStatus = Number(p.ticketStatus ?? 0);

  const isOpen = enterShowSeat === 1 && ticketStatus === 0 && !forbiddenTip;
  if (isOpen) {
    return { alertable: true, state: 'open', saleHint: '' };
  }

  const hasFutureSaleNotice = Boolean(saleTimeText || saleDate);
  if (hasFutureSaleNotice) {
    const hint = [saleDate, saleTimeText].filter(Boolean).join(' ');
    return { alertable: true, state: 'pending', saleHint: hint };
  }

  return { alertable: false, state: 'closed', saleHint: forbiddenTip };
}

/**
 * Fetches and normalizes a cinema's current movies & showtimes from Maoyan.
 */
export async function fetchCinemaDetail(cinemaId, opts = {}) {
  const url = `https://m.maoyan.com/ajax/cinemaDetail?cinemaId=${encodeURIComponent(cinemaId)}`;
  const resp = await fetchMaoyanJson(url, {
    ...opts,
    referer: `https://m.maoyan.com/shows/${cinemaId}`
  });

  if (!resp.ok) {
    return { ...resp, cinemaId, movies: [] };
  }

  const showData = resp.data?.showData;
  if (!showData || !Array.isArray(showData.movies)) {
    return {
      ok: false,
      riskTriggered: true,
      networkError: false,
      reason: 'cinemaDetail 缺少 showData.movies 字段',
      cinemaId,
      movies: []
    };
  }

  const movies = showData.movies.map((m) => {
    const shows = [];
    for (const dayBlock of m.shows || []) {
      const showDate = dayBlock.showDate || '';
      const dateShow = dayBlock.dateShow || showDate;
      for (const p of dayBlock.plist || []) {
        const status = evaluateShowStatus(p);
        const hallInfo = classifyHall(p.th || '', p.tp || '');
        shows.push({
          seqNo: String(p.seqNo || `${showDate}_${p.tm}_${p.th}`),
          dt: p.dt || showDate,
          dateShow,
          tm: p.tm || '',
          th: p.th || '',
          tp: p.tp || '',
          lang: p.lang || '',
          vipPrice: p.vipPrice ? String(p.vipPrice) : '',
          vipPriceName: p.vipPriceName || '',
          preShowTag: p.preShowTag || '',
          ...status,
          ...hallInfo
        });
      }
    }

    return {
      id: Number(m.id),
      nm: m.nm || '',
      img: normalizePosterUrl(m.img || ''),
      dur: Number(m.dur || 0),
      sc: m.sc || '0',
      wish: Number(m.wish || 0),
      desc: m.desc || '',
      globalReleased: Boolean(m.globalReleased),
      showCount: shows.length,
      shows
    };
  });

  return {
    ok: true,
    riskTriggered: false,
    networkError: false,
    reason: '',
    cinemaId: Number(cinemaId),
    cinemaName: showData.cinemaName || '',
    movies
  };
}

/**
 * Fetches currently showing and upcoming movie catalogs from Maoyan (Dongguan cityId=91).
 */
export async function fetchMovieCatalog(opts = {}) {
  const onInfoUrl = 'https://m.maoyan.com/ajax/movieOnInfoList?token=';
  const comingUrl = `https://m.maoyan.com/ajax/comingList?ci=${CITY_ID}&token=&limit=40`;

  const onInfoRes = await fetchMaoyanJson(onInfoUrl, opts);
  if (onInfoRes.riskTriggered) {
    return { ok: false, riskTriggered: true, reason: onInfoRes.reason, onInfo: [], coming: [] };
  }

  await sleep(jitterDelay(500, 1100));
  const comingRes = await fetchMaoyanJson(comingUrl, opts);
  if (comingRes.riskTriggered) {
    return { ok: false, riskTriggered: true, reason: comingRes.reason, onInfo: [], coming: [] };
  }

  const mapItem = (m, source) => ({
    id: Number(m.id),
    nm: m.nm || '',
    img: normalizePosterUrl(m.img || ''),
    rt: m.rt || '',
    comingTitle: m.comingTitle || '',
    showInfo: m.showInfo || '',
    star: m.star || '',
    sc: Number(m.sc || 0),
    wish: Number(m.wish || 0),
    version: m.version || '',
    globalReleased: Boolean(m.globalReleased),
    statusLabel: m.showStateButton?.content || (source === 'coming' ? '想看' : '热映'),
    source
  });

  const onInfo = Array.isArray(onInfoRes.data?.movieList)
    ? onInfoRes.data.movieList.map((m) => mapItem(m, 'onInfo'))
    : [];
  const coming = Array.isArray(comingRes.data?.coming)
    ? comingRes.data.coming.map((m) => mapItem(m, 'coming'))
    : [];

  return { ok: true, riskTriggered: false, reason: '', onInfo, coming };
}
