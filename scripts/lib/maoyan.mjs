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

function normalizeCatalogItem(m, source) {
  const showst = Number(m.showst || 0);
  const fallbackStatus =
    showst === 4 ? '预售' : showst === 3 ? '购票' : showst === 1 ? '想看' : (m.globalReleased ? '热映' : '想看');
  return {
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
    statusLabel: m.showStateButton?.content || fallbackStatus,
    source
  };
}

/**
 * Queries Maoyan `moreComingList` in chunks of 12 (Maoyan's hard server-side cap per call).
 * Retries transient network errors once and fails closed if risk control or errors occur mid-pagination.
 */
export async function fetchMoreComingByIds(ids = [], opts = {}) {
  const { source = 'coming', maxBatches = 16, delayRange = [240, 460], ...maoyanOpts } = opts;
  const cleanIds = Array.from(new Set((ids || []).map(Number).filter((id) => Number.isFinite(id) && id > 0)));
  const chunkSize = 12;
  const movies = [];

  for (let b = 0; b < maxBatches; b++) {
    const batch = cleanIds.slice(b * chunkSize, (b + 1) * chunkSize);
    if (batch.length === 0) break;
    const d = jitterDelay(delayRange[0], delayRange[1]);
    if (d > 0) await sleep(d);

    const url = `https://m.maoyan.com/ajax/moreComingList?ci=${CITY_ID}&token=&movieIds=${batch.join(',')}`;
    let moreRes = await fetchMaoyanJson(url, maoyanOpts);
    if (!moreRes.ok && moreRes.networkError) {
      const retryDelay = jitterDelay(
        Math.min(600, Math.max(0, delayRange[1] * 2)),
        Math.min(1000, Math.max(0, delayRange[1] * 3))
      );
      if (retryDelay > 0) await sleep(retryDelay);
      moreRes = await fetchMaoyanJson(url, maoyanOpts);
    }

    if (!moreRes.ok) {
      return {
        ok: false,
        riskTriggered: Boolean(moreRes.riskTriggered),
        partial: true,
        reason: moreRes.reason || 'moreComingList 请求失败',
        movies
      };
    }

    for (const m of moreRes.data?.coming || []) {
      movies.push(normalizeCatalogItem(m, source));
    }
  }

  return { ok: true, riskTriggered: false, partial: false, reason: '', movies };
}

/**
 * Fetches full showing and upcoming movie catalogs from Maoyan (Dongguan cityId=91),
 * paginating all `movieIds` via `moreComingList` in chunks of 12 before enriching extra `mostExpected` items.
 */
export async function fetchMovieCatalog(opts = {}) {
  const delayRange = opts.delayRange || [240, 460];
  const onInfoUrl = 'https://m.maoyan.com/ajax/movieOnInfoList?token=';
  const comingUrl = `https://m.maoyan.com/ajax/comingList?ci=${CITY_ID}&token=&limit=20`;
  const expectedUrl = `https://m.maoyan.com/ajax/mostExpected?ci=${CITY_ID}&limit=30&offset=0&token=`;

  const onInfoRes = await fetchMaoyanJson(onInfoUrl, opts);
  if (!onInfoRes.ok) {
    return {
      ok: false,
      riskTriggered: Boolean(onInfoRes.riskTriggered),
      partial: false,
      reason: onInfoRes.reason || 'movieOnInfoList 请求失败',
      onInfo: [],
      coming: []
    };
  }

  const d1 = jitterDelay(delayRange[0], delayRange[1]);
  if (d1 > 0) await sleep(d1);
  const comingRes = await fetchMaoyanJson(comingUrl, opts);
  if (!comingRes.ok) {
    return {
      ok: false,
      riskTriggered: Boolean(comingRes.riskTriggered),
      partial: false,
      reason: comingRes.reason || 'comingList 请求失败',
      onInfo: [],
      coming: []
    };
  }

  const onInfoMap = new Map();
  for (const m of onInfoRes.data?.movieList || []) {
    onInfoMap.set(Number(m.id), normalizeCatalogItem(m, 'onInfo'));
  }

  const comingMap = new Map();
  for (const m of comingRes.data?.coming || []) {
    comingMap.set(Number(m.id), normalizeCatalogItem(m, 'coming'));
  }

  // Paginate ALL remaining IDs in chunks of 12 before consulting sparse `mostExpected` stubs
  const missingOnInfoIds = (onInfoRes.data?.movieIds || [])
    .map(Number)
    .filter((id) => !onInfoMap.has(id));
  const onMore = await fetchMoreComingByIds(missingOnInfoIds, {
    ...opts,
    source: 'onInfo',
    maxBatches: 10,
    delayRange
  });
  if (!onMore.ok) {
    return {
      ok: false,
      riskTriggered: Boolean(onMore.riskTriggered),
      partial: true,
      reason: onMore.reason,
      onInfo: [],
      coming: []
    };
  }
  for (const m of onMore.movies) {
    if (!onInfoMap.has(m.id)) {
      onInfoMap.set(m.id, m);
    }
  }

  const missingComingIds = (comingRes.data?.movieIds || [])
    .map(Number)
    .filter((id) => !comingMap.has(id));
  const comingMore = await fetchMoreComingByIds(missingComingIds, {
    ...opts,
    source: 'coming',
    maxBatches: 16,
    delayRange
  });
  if (!comingMore.ok) {
    return {
      ok: false,
      riskTriggered: Boolean(comingMore.riskTriggered),
      partial: true,
      reason: comingMore.reason,
      onInfo: [],
      coming: []
    };
  }
  for (const m of comingMore.movies) {
    if (!comingMap.has(m.id)) {
      comingMap.set(m.id, m);
    }
  }

  // Process `mostExpected` LAST only for movies missing from both paginated lists, enriching via moreComingList first
  const d2 = jitterDelay(delayRange[0], delayRange[1]);
  if (d2 > 0) await sleep(d2);
  const expectedRes = await fetchMaoyanJson(expectedUrl, opts);
  if (expectedRes.ok && Array.isArray(expectedRes.data?.coming)) {
    const extraExpected = expectedRes.data.coming.filter((m) => {
      const id = Number(m.id);
      return !comingMap.has(id) && !onInfoMap.has(id);
    });
    if (extraExpected.length > 0) {
      const extraMore = await fetchMoreComingByIds(
        extraExpected.map((m) => Number(m.id)),
        { ...opts, source: 'coming', maxBatches: 3, delayRange }
      ).catch(() => ({ ok: false, movies: [] }));
      for (const m of extraMore.movies || []) {
        if (!comingMap.has(m.id)) {
          comingMap.set(m.id, m);
        }
      }
      for (const m of extraExpected) {
        const id = Number(m.id);
        if (!comingMap.has(id)) {
          comingMap.set(id, normalizeCatalogItem(m, 'coming'));
        }
      }
    }
  }

  return {
    ok: true,
    riskTriggered: false,
    reason: '',
    onInfo: Array.from(onInfoMap.values()),
    coming: Array.from(comingMap.values())
  };
}

/**
 * Fetches rich Maoyan movie detail (`enm`, `sc`, `snum`, `wish`, `rt`, `pubDesc`, `cat`, `dur`, `dra`).
 */
export async function fetchMaoyanMovieDetail(movieId, opts = {}) {
  const url = `https://m.maoyan.com/ajax/detailmovie?movieId=${encodeURIComponent(movieId)}`;
  const res = await fetchMaoyanJson(url, {
    ...opts,
    referer: `https://m.maoyan.com/movie/${movieId}`
  });
  if (!res.ok || !res.data?.detailMovie) {
    return { ok: false, riskTriggered: res.riskTriggered, data: null };
  }
  const dm = res.data.detailMovie;
  return {
    ok: true,
    riskTriggered: false,
    data: {
      id: Number(dm.id || movieId),
      nm: dm.nm || '',
      enm: dm.enm || '',
      sc: Number(dm.sc || 0),
      snum: Number(dm.snum || 0),
      wish: Number(dm.wish || 0),
      rt: dm.rt || '',
      pubDesc: dm.pubDesc || '',
      cat: dm.cat || '',
      dur: Number(dm.dur || 0),
      dir: dm.dir || '',
      star: dm.star || '',
      dra: dm.dra || '',
      img: normalizePosterUrl(dm.img || '')
    }
  };
}
