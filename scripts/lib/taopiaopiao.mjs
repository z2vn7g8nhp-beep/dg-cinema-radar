/**
 * Taopiaopiao (淘票票) MTOP public city catalog fetcher for Dongguan (citycode: 441900).
 * Fetches both currently showing (`getshowsbycitycode` v4.0) and upcoming (`getsoonshowsbycitycode` v5.0)
 * movies to provide `tppWish` (`wantCount`), `tppScore` (`remark`), `tppId`, and `showNameEn`.
 */

import crypto from 'node:crypto';
import { normalizeTitle } from './intel.mjs';

const TPP_CITY_CODE = '441900'; // 东莞
const TPP_APP_KEY = '12574478';
const TPP_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export function buildMtopSign(token, t, appKey, dataStr) {
  return crypto.createHash('md5').update(`${token}&${t}&${appKey}&${dataStr}`).digest('hex');
}

async function callTaopiaopiaoMtop(api, v, dataObj, { cookieState = null, fetchImpl = fetch } = {}) {
  const dataStr = JSON.stringify(dataObj);
  const baseUrl = `https://acs.m.taopiaopiao.com/h5/${api}/${v}/`;
  const reqHeaders = {
    'User-Agent': TPP_UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Origin': 'https://m.taopiaopiao.com',
    'Referer': 'https://m.taopiaopiao.com/'
  };

  async function refreshMtopCookie() {
    const t1 = Date.now();
    const qs1 = new URLSearchParams({
      jsv: '2.7.2',
      appKey: TPP_APP_KEY,
      t: String(t1),
      sign: '00000000000000000000000000000000',
      api,
      v,
      type: 'originaljson',
      dataType: 'json',
      data: dataStr
    });
    const r1 = await fetchImpl(`${baseUrl}?${qs1}`, {
      headers: reqHeaders,
      signal: AbortSignal.timeout(10000)
    });
    const setCookies = r1.headers?.getSetCookie
      ? r1.headers.getSetCookie()
      : (r1.headers?.get?.('set-cookie') ? [r1.headers.get('set-cookie')] : []);
    const cookiePair = setCookies.map((c) => c.split(';')[0]).join('; ');
    const token = (cookiePair.match(/_m_h5_tk=([^_;]+)/) || [])[1] || '';
    if (!token) {
      const bodyPreview = await r1.text().catch(() => '');
      throw new Error(`Taopiaopiao MTOP r1 HTTP ${r1.status} 未返回 _m_h5_tk (${bodyPreview.slice(0, 120)})`);
    }
    if (cookieState) {
      cookieState.cookiePair = cookiePair;
      cookieState.token = token;
    }
    return { cookiePair, token };
  }

  let cookiePair = cookieState?.cookiePair || '';
  let token = cookieState?.token || '';
  if (!token || !cookiePair) {
    ({ cookiePair, token } = await refreshMtopCookie());
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const t2 = Date.now();
    const sign = buildMtopSign(token, t2, TPP_APP_KEY, dataStr);
    const qs2 = new URLSearchParams({
      jsv: '2.7.2',
      appKey: TPP_APP_KEY,
      t: String(t2),
      sign,
      api,
      v,
      type: 'originaljson',
      dataType: 'json',
      data: dataStr
    });

    const r2 = await fetchImpl(`${baseUrl}?${qs2}`, {
      headers: {
        ...reqHeaders,
        'Cookie': cookiePair
      },
      signal: AbortSignal.timeout(10000)
    });

    const rawText = await r2.text();
    let json = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new Error(`Taopiaopiao MTOP HTTP ${r2.status} 非 JSON: ${rawText.slice(0, 140)}`);
    }
    const retStr = (json?.ret || []).join(',');
    if (/SUCCESS/i.test(retStr)) {
      const rv = json?.data?.returnValue;
      return Array.isArray(rv) ? rv : [];
    }
    if (attempt === 0 && /TOKEN_EXPIRED|TOKEN_EMPTY|ILLEGAL_ACCESS/i.test(retStr)) {
      ({ cookiePair, token } = await refreshMtopCookie());
      continue;
    }
    throw new Error(`Taopiaopiao MTOP HTTP ${r2.status} 返回异常: ${retStr || rawText.slice(0, 140)}`);
  }

  return [];
}

/**
 * Fetches hot + coming movies from Taopiaopiao and indexes them by normalized title.
 */
export async function fetchTaopiaopiaoCatalog({ fetchImpl = fetch } = {}) {
  const cookieState = { cookiePair: '', token: '' };
  const byNormTitle = new Map();

  const normalizeEntry = (item) => ({
    tppId: Number(item.id),
    showName: item.showName || '',
    showNameEn: item.showNameEn || '',
    tppWish: Number(item.wantCount || 0),
    tppScore: Number(item.remark || 0) > 0 ? Number(item.remark) : null,
    openTime: item.openTime || ''
  });

  const hot = await callTaopiaopiaoMtop(
    'mtop.film.mtopshowapi.getshowsbycitycode',
    '4.0',
    { citycode: TPP_CITY_CODE, platform: '8', pageIndex: 1, pageSize: 100 },
    { cookieState, fetchImpl }
  ).catch((err) => {
    console.warn('Taopiaopiao hot fetch failed:', err?.message || err);
    return [];
  });

  const soon = await callTaopiaopiaoMtop(
    'mtop.film.mtopshowapi.getsoonshowsbycitycode',
    '5.0',
    { citycode: TPP_CITY_CODE, platform: '8', pageIndex: 1, pageSize: 100 },
    { cookieState, fetchImpl }
  ).catch((err) => {
    console.warn('Taopiaopiao soon fetch failed:', err?.message || err);
    return [];
  });

  for (const raw of [...hot, ...soon]) {
    const entry = normalizeEntry(raw);
    const key = normalizeTitle(entry.showName);
    if (key && !byNormTitle.has(key)) {
      byNormTitle.set(key, entry);
    }
  }

  return {
    ok: byNormTitle.size > 0,
    count: byNormTitle.size,
    byNormTitle
  };
}

/**
 * Matches a Maoyan movie (`nm`, `enm`) against the Taopiaopiao index.
 */
export function matchTaopiaopiaoMovie(maoyanMovie, tppCatalog) {
  if (!tppCatalog?.byNormTitle || !maoyanMovie?.nm) return null;
  const exactKey = normalizeTitle(maoyanMovie.nm);
  if (tppCatalog.byNormTitle.has(exactKey)) {
    return tppCatalog.byNormTitle.get(exactKey);
  }
  for (const [k, val] of tppCatalog.byNormTitle.entries()) {
    if (k.length >= 2 && exactKey.length >= 2 && (k.includes(exactKey) || exactKey.includes(k))) {
      return val;
    }
  }
  return null;
}
