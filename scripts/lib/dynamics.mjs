/**
 * Wish ranking (daily growth) + All-movie dynamic events detection:
 * - 定档 (scheduled)
 * - 改档 (rescheduled)
 * - 开票 (presale_opened)
 * - 开分 (scored: Maoyan / Douban / IMDb / Rotten Tomatoes)
 */

import { shiftDateStr } from './config.mjs';

const CONCRETE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PARTIAL_DATE_RE = /^\d{4}(?:-\d{2})?$/;

export function isConcreteDate(rt = '') {
  return CONCRETE_DATE_RE.test(String(rt || '').trim());
}

export function isPartialDate(rt = '') {
  return PARTIAL_DATE_RE.test(String(rt || '').trim());
}

export function resolveEffectiveIntelDate(intel = {}) {
  const pub = String(intel?.pubDesc || '');
  const pubMatch = pub.match(/(\d{4}-\d{2}-\d{2})/);
  if (pubMatch) return pubMatch[1];
  const orig = String(intel?.origRt || '').trim();
  if (isConcreteDate(orig) && !/重映/.test(pub)) return orig;
  return '';
}

/**
 * Updates daily Maoyan wish snapshots across Asia/Shanghai day rollovers.
 */
export function updateWishSnapshots(prevSnapshots = {}, catalogMovies = [], todayStr) {
  const prevToday = prevSnapshots.todayDate || todayStr;
  let todayBase = { ...(prevSnapshots.todayBase || {}) };
  let yesterdayGain = { ...(prevSnapshots.yesterdayGain || {}) };
  const latestWish = { ...(prevSnapshots.latestWish || {}) };

  if (prevToday !== todayStr) {
    const nextYesterdayGain = {};
    for (const [id, baseVal] of Object.entries(todayBase)) {
      const cur = latestWish[id] ?? baseVal;
      nextYesterdayGain[id] = Math.max(0, Number(cur) - Number(baseVal));
    }
    yesterdayGain = nextYesterdayGain;
    todayBase = { ...latestWish };
  }

  for (const m of catalogMovies) {
    const key = String(m.id);
    const wish = Number(m.wish || 0);
    if (todayBase[key] === undefined) {
      todayBase[key] = wish;
    }
    latestWish[key] = wish;
  }

  return {
    todayDate: todayStr,
    yesterdayDate: shiftDateStr(todayStr, -1),
    todayBase,
    yesterdayGain,
    latestWish
  };
}

export function attachWishGrowth(movies = [], wishSnapshots = {}) {
  const base = wishSnapshots.todayBase || {};
  const yGain = wishSnapshots.yesterdayGain || {};
  return movies.map((m) => {
    const key = String(m.id);
    const wish = Number(m.wish || 0);
    const baseWish = base[key] !== undefined ? Number(base[key]) : wish;
    const wishDailyGain = Math.max(0, wish - baseWish);
    const wishYesterdayGain = Number(yGain[key] || 0);
    return {
      ...m,
      wishDailyGain,
      wishYesterdayGain
    };
  });
}

function isOldMovieBeyondWindow(rt, todayStr) {
  if (!isConcreteDate(rt)) return false;
  return rt < shiftDateStr(todayStr, -14);
}

function isPastPresaleWindow(rt, todayStr) {
  if (!isConcreteDate(rt)) return false;
  return rt < shiftDateStr(todayStr, -2);
}

function matchesComingTitleMonthDay(concreteRt, comingTitle) {
  if (!isConcreteDate(concreteRt)) return false;
  const m = String(comingTitle || '').match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return false;
  return Number(concreteRt.slice(5, 7)) === Number(m[1]) && Number(concreteRt.slice(8, 10)) === Number(m[2]);
}

function statusRank(label = '') {
  if (/购票/.test(label)) return 3;
  if (/预售/.test(label)) return 2;
  if (/想看/.test(label)) return 1;
  return 0;
}

function mergeCatalogMoviePair(a, b) {
  if (!a) return b;
  if (!b) return a;
  const rtA = String(a.rt || '').trim();
  const rtB = String(b.rt || '').trim();
  const bestRt = isConcreteDate(rtA) && !isConcreteDate(rtB) ? rtA : (isConcreteDate(rtB) ? rtB : rtA || rtB);
  const bestStatus = statusRank(b.statusLabel) > statusRank(a.statusLabel) ? b.statusLabel : (a.statusLabel || b.statusLabel || '');
  const pickLonger = (x, y) => (String(x || '').trim().length >= String(y || '').trim().length ? (x || y || '') : y);
  return {
    ...a,
    ...b,
    nm: a.nm || b.nm || '',
    img: a.img || b.img || '',
    rt: bestRt,
    comingTitle: pickLonger(a.comingTitle, b.comingTitle),
    showInfo: pickLonger(a.showInfo, b.showInfo),
    star: pickLonger(a.star, b.star),
    version: pickLonger(a.version, b.version),
    statusLabel: bestStatus,
    sc: Math.max(Number(a.sc || 0), Number(b.sc || 0)) || 0,
    wish: Math.max(Number(a.wish || 0), Number(b.wish || 0)) || 0,
    source: a.source === 'onInfo' || b.source === 'onInfo' ? 'onInfo' : (a.source || b.source || '')
  };
}

/**
 * Merges duplicate movie entries across Maoyan `onInfo` and `coming` lists without
 * letting sparse `coming` stubs clobber concrete `onInfo` release dates or presale flags.
 */
export function dedupeCatalogMovies(movies = []) {
  const byKey = new Map();
  for (const item of movies) {
    if (!item || !item.id) continue;
    const key = String(item.id);
    byKey.set(key, mergeCatalogMoviePair(byKey.get(key), item));
  }
  return {
    list: [...byKey.values()],
    map: Object.fromEntries(byKey)
  };
}

/**
 * Only emit "开分" when a fresh/upcoming release newly receives a score —
 * never for >14d historical backfill, classic re-releases, or intel matchVersion upgrades.
 */
function isEligibleForScoreOpening(curr, currRt, prevInt, currInt, todayStr) {
  if (isOldMovieBeyondWindow(currRt, todayStr)) return false;
  if (/重映|4k/i.test(`${curr?.nm || ''} ${curr?.showInfo || ''}`)) return false;

  const curYear = Number(String(todayStr || '').slice(0, 4)) || new Date().getFullYear();
  const doubanYear = Number(currInt?.doubanYear || 0);
  const imdbYear = Number(currInt?.imdbYear || 0);
  if (doubanYear > 0 && doubanYear < curYear - 1) return false;
  if (imdbYear > 0 && imdbYear < curYear - 1) return false;

  if (prevInt?.matchVersion && currInt?.matchVersion && prevInt.matchVersion !== currInt.matchVersion) {
    return false;
  }
  return true;
}

/**
 * Detects 定档 / 改档 / 开票 / 开分 events across all movies in the catalog & intel cache.
 */
export function detectDynamicEvents({
  prevCatalogMap = {},
  currMovies = [],
  prevIntelMap = {},
  currIntelMap = {},
  prevCinemaMovieIds = new Set(),
  currCinemaMovieIds = new Set(),
  currCinemaDetailMap = new Map(),
  todayStr,
  nowIso,
  baselineReady = false,
  suppressNewAdditions = false
}) {
  const events = [];
  if (!baselineReady) {
    return events;
  }

  const uniqueCurrMovies = dedupeCatalogMovies(currMovies).list;
  for (const curr of uniqueCurrMovies) {
    const id = Number(curr.id);
    const key = String(id);
    const prev = prevCatalogMap[key];
    const prevInt = prevIntelMap[key] || {};
    const prevIntelDate = resolveEffectiveIntelDate(prevInt);
    const prevRtRaw = (prev?.rt || '').trim();
    const prevRt = isConcreteDate(prevRtRaw) ? prevRtRaw : (prevIntelDate || prevRtRaw);
    const currRt = (curr.rt || '').trim();
    const prevStatus = prev?.statusLabel || '';
    const currStatus = curr.statusLabel || '';
    const hadKnownBaseline = Boolean(prev || prevIntelDate);

    // 1. 定档 (scheduled) & 2. 改档 / 撤档 (rescheduled)
    if (!hadKnownBaseline) {
      if (!suppressNewAdditions && isConcreteDate(currRt) && currRt >= todayStr) {
        events.push({
          id: `dyn_sch_${id}_${currRt}`,
          type: 'scheduled',
          typeLabel: '定档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `新片定档 ${currRt} 上映`,
          detail: curr.comingTitle || curr.showInfo || currRt,
          createdAt: nowIso
        });
      }
    } else {
      if (!isConcreteDate(prevRt) && isConcreteDate(currRt) && !matchesComingTitleMonthDay(currRt, prev?.comingTitle)) {
        events.push({
          id: `dyn_sch_${id}_${currRt}`,
          type: 'scheduled',
          typeLabel: '定档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `正式定档 ${currRt}`,
          detail: curr.comingTitle || currRt,
          createdAt: nowIso
        });
      } else if (isConcreteDate(prevRt) && isConcreteDate(currRt) && prevRt !== currRt) {
        events.push({
          id: `dyn_resch_${id}_${prevRt}_${currRt}`,
          type: 'rescheduled',
          typeLabel: '改档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `档期变更：${prevRt} → ${currRt}`,
          detail: `原定 ${prevRt}，调整为 ${currRt}`,
          createdAt: nowIso
        });
      } else if (isConcreteDate(prevRt) && !isConcreteDate(currRt) && prevRt >= todayStr && !matchesComingTitleMonthDay(prevRt, curr.comingTitle)) {
        const nextLabel = curr.comingTitle || currRt || '待定';
        const idSuffix = currRt || 'tbd';
        events.push({
          id: `dyn_resch_${id}_${prevRt}_${idSuffix}`,
          type: 'rescheduled',
          typeLabel: '改档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `档期变更：原 ${prevRt} 调整为 ${nextLabel}`,
          detail: `原定 ${prevRt}，现为 ${nextLabel}`,
          createdAt: nowIso
        });
      } else if (isPartialDate(prevRt) && isPartialDate(currRt) && prevRt !== currRt) {
        events.push({
          id: `dyn_resch_${id}_${prevRt}_${currRt}`,
          type: 'rescheduled',
          typeLabel: '改档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `档期变更：${prevRt} → ${currRt}`,
          detail: `原定 ${prevRt}，调整为 ${currRt}`,
          createdAt: nowIso
        });
      }
    }

    // 3. 开票 (presale_opened — only upcoming or within 2 days of release, not >2d-old catalog tails)
    const isBuyableNow = /预售|购票/.test(currStatus) || currCinemaMovieIds.has(id);
    const wasBuyableBefore = Boolean(prev && (/预售|购票/.test(prevStatus) || prevCinemaMovieIds.has(id)));
    const skipBackfillOpen = Boolean(suppressNewAdditions && !hadKnownBaseline);
    if (!skipBackfillOpen && isBuyableNow && !wasBuyableBefore && !isPastPresaleWindow(currRt, todayStr)) {
      const monitoredDetail = currCinemaDetailMap.get(id) || '';
      const fallbackCityDetail = curr.showInfo ? `全市：${curr.showInfo}` : '';
      events.push({
        id: `dyn_open_${id}_${todayStr}`,
        type: 'presale_opened',
        typeLabel: '开票',
        movieId: id,
        title: curr.nm,
        poster: curr.img || '',
        summary: currCinemaMovieIds.has(id) ? '东莞监控影院已开启预售/购票' : `猫眼状态已开启「${currStatus || '预售'}」`,
        detail: monitoredDetail || fallbackCityDetail || currRt || '已开启预售购票',
        createdAt: nowIso
      });
    }

    // 4. 开分 (scored across 猫眼 / 豆瓣 / IMDb / 烂番茄 — strictly fresh/upcoming transitions after baseline, never backfill)
    const currInt = currIntelMap[key] || {};
    const canEmitScore = isEligibleForScoreOpening(curr, currRt, prevInt, currInt, todayStr);
    const hadIntelBefore = Boolean(prevIntelMap[key]);
    const openedScores = [];

    const prevMaoyan = Number(prev?.sc || prevInt.maoyanScore || 0);
    const currMaoyan = Number(curr.sc || currInt.maoyanScore || 0);
    if (canEmitScore && prev && prevMaoyan <= 0 && currMaoyan > 0) {
      openedScores.push(`猫眼 ${currMaoyan}`);
    }

    if (canEmitScore && hadIntelBefore && !(prevInt.doubanScore > 0) && currInt.doubanScore > 0) {
      openedScores.push(`豆瓣 ${currInt.doubanScore}`);
    }
    if (canEmitScore && hadIntelBefore && !(prevInt.imdbScore > 0) && currInt.imdbScore > 0) {
      openedScores.push(`IMDb ${currInt.imdbScore}`);
    }
    if (
      canEmitScore &&
      hadIntelBefore &&
      (prevInt.rtCriticsScore === null || prevInt.rtCriticsScore === undefined) &&
      currInt.rtCriticsScore !== null &&
      currInt.rtCriticsScore !== undefined
    ) {
      openedScores.push(`烂番茄 ${currInt.rtCriticsScore}%`);
    }

    if (openedScores.length > 0) {
      events.push({
        id: `dyn_score_${id}_${openedScores.join('_')}`,
        type: 'scored',
        typeLabel: '开分',
        movieId: id,
        title: curr.nm,
        poster: curr.img || '',
        summary: `开分出炉：${openedScores.join(' · ')}`,
        detail: openedScores.join(' | '),
        createdAt: nowIso
      });
    }
  }

  return events;
}

/**
 * Formats 1 consolidated push notification for dynamic events (定档/开票/改档/开分).
 */
export function buildDynamicsAlert({ events = [], watchlist = [], notifyAllDynamics = false, pageUrl = '' }) {
  if (!events.length) return null;

  const starredIds = new Set(
    (watchlist || [])
      .filter((w) => w.active !== false && w.movieId)
      .map((w) => Number(w.movieId))
  );
  const starredKws = (watchlist || [])
    .filter((w) => w.active !== false && !w.movieId && w.keyword)
    .map((w) => w.keyword.toLowerCase());

  const isStarredEvent = (ev) =>
    starredIds.has(Number(ev.movieId)) ||
    starredKws.some((kw) => String(ev.title || '').toLowerCase().includes(kw));

  const targetEvents = notifyAllDynamics ? events : events.filter(isStarredEvent);
  if (!targetEvents.length) return null;

  const typeTags = Array.from(new Set(targetEvents.map((e) => e.typeLabel))).join('/');
  const title =
    targetEvents.length === 1
      ? `🔥 ${targetEvents[0].typeLabel}提醒｜《${targetEvents[0].title}》`
      : `🔥 ${notifyAllDynamics ? '新片动态' : '星标动态'} (${targetEvents.length}条)｜${typeTags}`;

  const lines = targetEvents.slice(0, 6).map((e) => {
    const starBadge = isStarredEvent(e) ? '★ ' : '';
    return `• ${starBadge}[${e.typeLabel}]《${e.title}》：${e.summary}`;
  });
  if (targetEvents.length > 6) {
    lines.push(`...另有 ${targetEvents.length - 6} 条新片动态，请打开雷达查看`);
  }

  return {
    title,
    body: lines.join('\n'),
    url: pageUrl,
    tag: `dynamics-${Date.now()}`
  };
}
