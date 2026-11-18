/**
 * Pure wave-detection, multi-round diffing, and consolidated alert formatting logic.
 */

import { CINEMA_MAP, shiftDateStr } from './config.mjs';

export function computeBackoffMinutes(consecutiveRiskHits) {
  const hits = Math.max(1, Number(consecutiveRiskHits || 1));
  if (hits === 1) return 5;
  if (hits === 2) return 15;
  if (hits === 3) return 30;
  return 60;
}

export function matchWatchItem(watchItem, movie) {
  if (!watchItem || !movie) return false;
  if (watchItem.movieId && Number(watchItem.movieId) === Number(movie.id)) {
    return true;
  }
  const kw = (watchItem.keyword || watchItem.title || '').trim().toLowerCase();
  if (!kw) return false;
  return String(movie.nm || '').toLowerCase().includes(kw);
}

export function passesHallFilter(hallFilter = 'all', show) {
  switch (hallFilter) {
    case 'imax_gt':
      return Boolean(show.isImaxGt);
    case 'imax':
      return Boolean(show.isImax || show.isImaxGt);
    case 'special':
      return Boolean(show.isSpecial);
    case 'all':
    default:
      return true;
  }
}

export function makeShowKey(cinemaId, movieId, show) {
  return `${cinemaId}:${movieId}:${show.seqNo}:${show.state}`;
}

/**
 * Prunes seen show keys older than yesterday (Asia/Shanghai) to keep Gist state compact.
 */
export function pruneSeenEntry(seenEntry, todayStr) {
  const cutoff = shiftDateStr(todayStr, -1);
  const items = seenEntry?.items || {};
  const nextItems = {};
  for (const [key, dt] of Object.entries(items)) {
    if (!dt || dt >= cutoff) {
      nextItems[key] = dt;
    }
  }
  return {
    items: nextItems,
    roundCount: Number(seenEntry?.roundCount || 0),
    lastAlertAt: seenEntry?.lastAlertAt || ''
  };
}

/**
 * Evaluates all active watchlist items against scraped cinema details and returns:
 * - `findings`: array of per-movie new-wave findings for this tick
 * - `nextSeenMap`: updated seen map (with stale entries pruned)
 * - `watchUpdates`: map of watchItemId -> { roundCount, lastAlertAt, pendingBaselineInit, resolvedMovieId, resolvedPoster }
 */
export function diffWatchlistRound({ watchlist = [], cinemaResults = [], seenMap = {}, todayStr, nowIso }) {
  const nextSeenMap = {};
  for (const [id, entry] of Object.entries(seenMap)) {
    nextSeenMap[id] = pruneSeenEntry(entry, todayStr);
  }

  const findings = [];
  const watchUpdates = {};

  for (const item of watchlist) {
    if (!item || item.active === false) continue;

    const entry = nextSeenMap[item.id] || { items: {}, roundCount: Number(item.roundCount || 0), lastAlertAt: item.lastAlertAt || '' };
    const newlyFound = [];
    let resolvedMovieId = item.movieId || null;
    let resolvedPoster = item.poster || '';
    let resolvedTitle = item.title || item.keyword || '';

    for (const cinemaRes of cinemaResults) {
      if (!cinemaRes?.ok) continue;
      const cinemaMeta = CINEMA_MAP.get(Number(cinemaRes.cinemaId)) || {
        id: Number(cinemaRes.cinemaId),
        shortName: cinemaRes.cinemaName || `影院${cinemaRes.cinemaId}`,
        name: cinemaRes.cinemaName || `影院${cinemaRes.cinemaId}`
      };

      for (const movie of cinemaRes.movies || []) {
        if (!matchWatchItem(item, movie)) continue;
        if (!resolvedMovieId && movie.id) resolvedMovieId = movie.id;
        if (!resolvedPoster && movie.img) resolvedPoster = movie.img;
        if (!resolvedTitle && movie.nm) resolvedTitle = movie.nm;

        for (const show of movie.shows || []) {
          if (!show.alertable) continue;
          if (!passesHallFilter(item.hallFilter || 'all', show)) continue;

          const key = makeShowKey(cinemaMeta.id, movie.id, show);
          if (!entry.items[key]) {
            entry.items[key] = show.dt || todayStr;
            newlyFound.push({
              cinemaId: cinemaMeta.id,
              cinemaShortName: cinemaMeta.shortName,
              cinemaName: cinemaMeta.name,
              movieId: movie.id,
              movieName: movie.nm,
              seqNo: show.seqNo,
              dt: show.dt,
              dateShow: show.dateShow,
              tm: show.tm,
              th: show.th,
              tp: show.tp,
              lang: show.lang,
              state: show.state,
              saleHint: show.saleHint || '',
              tags: show.tags || [],
              priority: show.priority || 0,
              isImaxGt: Boolean(show.isImaxGt),
              isImax: Boolean(show.isImax),
              isSpecial: Boolean(show.isSpecial),
              vipPrice: show.vipPrice || ''
            });
          }
        }
      }
    }

    if (item.pendingBaselineInit) {
      nextSeenMap[item.id] = entry;
      watchUpdates[item.id] = {
        pendingBaselineInit: false,
        resolvedMovieId,
        resolvedPoster
      };
      continue;
    }

    if (newlyFound.length > 0) {
      entry.roundCount += 1;
      entry.lastAlertAt = nowIso;
      nextSeenMap[item.id] = entry;

      // Sort special halls first, then chronological date/time
      newlyFound.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const da = `${a.dt} ${a.tm}`;
        const db = `${b.dt} ${b.tm}`;
        return da.localeCompare(db);
      });

      watchUpdates[item.id] = {
        roundCount: entry.roundCount,
        lastAlertAt: nowIso,
        resolvedMovieId,
        resolvedPoster
      };

      findings.push({
        watchId: item.id,
        movieId: resolvedMovieId,
        title: resolvedTitle || item.keyword || '星标电影',
        poster: resolvedPoster,
        round: entry.roundCount,
        totalNew: newlyFound.length,
        shows: newlyFound
      });
    } else {
      nextSeenMap[item.id] = entry;
      if ((resolvedMovieId && resolvedMovieId !== item.movieId) || (resolvedPoster && resolvedPoster !== item.poster)) {
        watchUpdates[item.id] = { resolvedMovieId, resolvedPoster };
      }
    }
  }

  return { findings, nextSeenMap, watchUpdates };
}

function formatShortDate(dt) {
  if (!dt) return '';
  const parts = dt.split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : dt;
}

function summarizeCinemaShows(shows, maxPerCinema = 4) {
  const byCinema = new Map();
  for (const s of shows) {
    if (!byCinema.has(s.cinemaShortName)) byCinema.set(s.cinemaShortName, []);
    byCinema.get(s.cinemaShortName).push(s);
  }

  const lines = [];
  for (const [cinemaName, list] of byCinema.entries()) {
    const snippets = list.slice(0, maxPerCinema).map((s) => {
      const badge = s.tags.length > 0 ? `[${s.tags.join('/')}]` : (s.tp ? `[${s.tp}]` : '');
      const pending = s.state === 'pending' ? `(待开售${s.saleHint ? ` ${s.saleHint}` : ''})` : '';
      return `${formatShortDate(s.dt)} ${s.tm}${badge}${pending}`;
    });
    const extra = list.length > maxPerCinema ? ` 等${list.length}场` : '';
    lines.push(`• ${cinemaName}：${snippets.join('、')}${extra}`);
  }
  return lines;
}

/**
 * Formats ONE consolidated notification payload for the entire round/tick ("一轮做一次推送").
 */
export function buildConsolidatedAlert(findings, pageUrl = '') {
  if (!findings || findings.length === 0) return null;

  const allShows = findings.flatMap((f) => f.shows);
  const hasImaxGt = allShows.some((s) => s.isImaxGt);
  const hasImax = allShows.some((s) => s.isImax);
  const hasSpecial = allShows.some((s) => s.isSpecial);

  const highlightTag = hasImaxGt ? '｜含IMAX GT' : hasImax ? '｜含IMAX' : hasSpecial ? '｜含特殊厅' : '';

  if (findings.length === 1) {
    const f = findings[0];
    const title = `🎬 第${f.round}轮开票｜《${f.title}》+${f.totalNew}场${highlightTag}`;
    const lines = summarizeCinemaShows(f.shows, 4);
    lines.push('提示：将继续盯下一轮，直到你手动停止。');
    return {
      title,
      body: lines.join('\n'),
      url: pageUrl,
      tag: `wave-${f.watchId}-r${f.round}`,
      roundSummary: {
        id: `${Date.now()}-${f.watchId}-r${f.round}`,
        title,
        lines: summarizeCinemaShows(f.shows, 6),
        totalNew: f.totalNew,
        movieTitle: f.title,
        round: f.round,
        hasImaxGt,
        hasSpecial
      }
    };
  }

  const totalAll = findings.reduce((sum, f) => sum + f.totalNew, 0);
  const title = `🎬 新一轮开票｜${findings.length}部星标电影共+${totalAll}场${highlightTag}`;
  const lines = [];
  for (const f of findings) {
    lines.push(`【《${f.title}》第${f.round}轮 +${f.totalNew}场】`);
    lines.push(...summarizeCinemaShows(f.shows, 2));
  }
  return {
    title,
    body: lines.join('\n'),
    url: pageUrl,
    tag: `wave-batch-${Date.now()}`,
    roundSummary: {
      id: `${Date.now()}-batch`,
      title,
      lines,
      totalNew: totalAll,
      movieTitle: findings.map((f) => f.title).join(' / '),
      round: findings[0].round,
      hasImaxGt,
      hasSpecial
    }
  };
}
