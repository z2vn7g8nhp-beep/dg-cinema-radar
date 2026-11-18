/**
 * Core configuration and domain helpers for Dongguan Cinema Radar.
 */

export const CITY_ID = 91; // 东莞

export const CINEMAS = [
  {
    id: 1485,
    name: '万达影城（华南MALL-IMAXGT激光店）',
    shortName: '华南MALL IMAX GT',
    brand: '万达影城',
    district: '万江',
    highlight: 'IMAX GT 1.43:1',
    maoyanUrl: 'https://m.maoyan.com/shows/1485'
  },
  {
    id: 10418,
    name: '万达影城（东城万达广场IMAX店）',
    shortName: '东城万达 IMAX',
    brand: '万达影城',
    district: '东城',
    highlight: 'IMAX',
    maoyanUrl: 'https://m.maoyan.com/shows/10418'
  },
  {
    id: 26100,
    name: 'CGV影城（民盈·国贸城店）',
    shortName: '民盈国贸城 CGV',
    brand: 'CGV影城',
    district: '东城',
    highlight: 'IMAX / 4DX / ScreenX',
    maoyanUrl: 'https://m.maoyan.com/shows/26100'
  }
];

export const CINEMA_MAP = new Map(CINEMAS.map((c) => [c.id, c]));

export const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; HUAWEI Mate 60 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; HarmonyOS; ALN-AL00) AppleWebKit/537.36 (KHTML, like Gecko) HuaweiBrowser/15.0.0.301 Mobile Safari/537.36'
];

/**
 * Classifies a Maoyan hall string (`th`) and format type (`tp`) into structured tags.
 * Priority is used to surface IMAX GT and special formats first in alert summaries.
 */
export function classifyHall(th = '', tp = '') {
  const combined = `${th} ${tp}`.trim();
  const tags = [];

  const isImaxGt = /IMAX\s*GT|GT厅/i.test(combined);
  const isImax = isImaxGt || /IMAX/i.test(combined);
  const is4dx = /4DX/i.test(combined);
  const isScreenX = /SCREEN\s*X/i.test(combined);
  const isDolby = /DOLBY|杜比/i.test(combined);
  const isCinity = /CINITY/i.test(combined);
  const isVip = /GOLD\s*CLASS|VIP|PRIME|LUXE/i.test(combined);

  if (isImaxGt) tags.push('IMAX GT');
  else if (isImax) tags.push('IMAX');
  if (is4dx) tags.push('4DX');
  if (isScreenX) tags.push('ScreenX');
  if (isDolby) tags.push('杜比');
  if (isCinity) tags.push('CINITY');
  if (isVip) tags.push('VIP/PRIME');

  const isSpecial = tags.length > 0;
  let priority = 0;
  if (isImaxGt) priority = 100;
  else if (isImax) priority = 80;
  else if (isDolby || isCinity) priority = 70;
  else if (is4dx || isScreenX) priority = 60;
  else if (isVip) priority = 40;

  return { tags, isImaxGt, isImax, isSpecial, priority };
}

/**
 * Normalizes Maoyan poster URLs (`http://`, `/w.h/` templates) to load reliably over HTTPS.
 */
export function normalizePosterUrl(url = '') {
  if (!url) return '';
  let normalized = String(url).trim().replace(/^http:\/\//i, 'https://');
  normalized = normalized.replace(/\/w\.h\//g, '/300.420/');
  return normalized;
}

/**
 * Returns `YYYY-MM-DD` in Asia/Shanghai (UTC+8), preventing UTC day-boundary drift on CI runners.
 */
export function getBeijingDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Shifts a `YYYY-MM-DD` string by `deltaDays` days.
 */
export function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}
