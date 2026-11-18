/**
 * Wish ranking (daily growth) + All-movie dynamic events detection:
 * - 定档 (scheduled)
 * - 改档 (rescheduled)
 * - 开票 (presale_opened)
 * - 开分 (scored: Maoyan / Douban / IMDb / Rotten Tomatoes)
 */

import { shiftDateStr } from './config.mjs';

const CONCRETE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isConcreteDate(rt = '') {
  return CONCRETE_DATE_RE.test(String(rt || '').trim());
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
  todayStr,
  nowIso,
  baselineReady = false
}) {
  const events = [];
  if (!baselineReady) {
    return events;
  }

  for (const curr of currMovies) {
    const id = Number(curr.id);
    const key = String(id);
    const prev = prevCatalogMap[key];
    const prevRt = (prev?.rt || '').trim();
    const currRt = (curr.rt || '').trim();
    const prevStatus = prev?.statusLabel || '';
    const currStatus = curr.statusLabel || '';

    // 1. 定档 (scheduled) & 2. 改档 (rescheduled)
    if (!prev) {
      if (isConcreteDate(currRt) && currRt >= todayStr) {
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
      if (!isConcreteDate(prevRt) && isConcreteDate(currRt)) {
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
      } else if (isConcreteDate(prevRt) && !currRt) {
        events.push({
          id: `dyn_resch_${id}_${prevRt}_tbd`,
          type: 'rescheduled',
          typeLabel: '改档',
          movieId: id,
          title: curr.nm,
          poster: curr.img || '',
          summary: `档期变更：原 ${prevRt} 调整为待定`,
          detail: `原定 ${prevRt}`,
          createdAt: nowIso
        });
      }
    }

    // 3. 开票 (presale_opened)
    const isBuyableNow = /预售|购票/.test(currStatus) || currCinemaMovieIds.has(id);
    const wasBuyableBefore = Boolean(prev && (/预售|购票/.test(prevStatus) || prevCinemaMovieIds.has(id)));
    if (isBuyableNow && !wasBuyableBefore && !isOldMovieBeyondWindow(currRt, todayStr)) {
      events.push({
        id: `dyn_open_${id}_${todayStr}`,
        type: 'presale_opened',
        typeLabel: '开票',
        movieId: id,
        title: curr.nm,
        poster: curr.img || '',
        summary: currCinemaMovieIds.has(id) ? '东莞监控影院已开启预售/购票' : `猫眼状态已开启「${currStatus || '预售'}」`,
        detail: curr.showInfo || currRt || '已开启预售购票',
        createdAt: nowIso
      });
    }

    // 4. 开分 (scored across 猫眼 / 豆瓣 / IMDb / 烂番茄)
    const prevInt = prevIntelMap[key] || {};
    const currInt = currIntelMap[key] || {};
    const isFreshRelease = !isOldMovieBeyondWindow(currRt, todayStr);
    const openedScores = [];

    const prevMaoyan = Number(prev?.sc || prevInt.maoyanScore || 0);
    const currMaoyan = Number(curr.sc || currInt.maoyanScore || 0);
    if (prev && prevMaoyan <= 0 && currMaoyan > 0) {
      openedScores.push(`猫眼 ${currMaoyan}`);
    }

    const hadIntelBefore = Boolean(prevIntelMap[key]);
    if ((hadIntelBefore || isFreshRelease) && !(prevInt.doubanScore > 0) && currInt.doubanScore > 0) {
      openedScores.push(`豆瓣 ${currInt.doubanScore}`);
    }
    if ((hadIntelBefore || isFreshRelease) && !(prevInt.imdbScore > 0) && currInt.imdbScore > 0) {
      openedScores.push(`IMDb ${currInt.imdbScore}`);
    }
    if (
      (hadIntelBefore || isFreshRelease) &&
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
