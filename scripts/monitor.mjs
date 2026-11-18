/**
 * Main GitHub Actions runner for Dongguan Cinema Radar.
 * - Every tick (1-2 min via cron-job.org): checks 3 Dongguan cinemas when starred movies exist.
 * - Every 15 min (or refresh_catalog): syncs expanded Maoyan catalog (~100+ movies),
 *   tracks daily Maoyan wish growth, enriches Douban/IMDb/Rotten Tomatoes scores,
 *   and pushes consolidated dynamic alerts (定档/开票/改档/开分).
 */

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CINEMAS, CINEMA_MAP, getBeijingDateStr, shiftDateStr } from './lib/config.mjs';
import { fetchCinemaDetail, fetchMovieCatalog, jitterDelay, sleep } from './lib/maoyan.mjs';
import { fetchTaopiaopiaoCatalog, matchTaopiaopiaoMovie } from './lib/taopiaopiao.mjs';
import { buildConsolidatedAlert, computeBackoffMinutes, diffWatchlistRound } from './lib/radar.mjs';
import { INTEL_MATCH_VERSION, enrichMovieIntel } from './lib/intel.mjs';
import { attachWishGrowth, buildDynamicsAlert, detectDynamicEvents, updateWishSnapshots } from './lib/dynamics.mjs';
import { readPrivateGist, updatePrivateGist } from './lib/gist.mjs';
import { dispatchAlerts } from './lib/notifier.mjs';

const STATE_OUT_PATH = process.env.STATE_OUT_PATH || path.resolve('data/state.json');
const CATALOG_REFRESH_INTERVAL_MIN = 4.8;

async function readExistingPublicState() {
  try {
    const raw = await fs.readFile(STATE_OUT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writePublicState(stateObj) {
  await fs.mkdir(path.dirname(STATE_OUT_PATH), { recursive: true });
  await fs.writeFile(STATE_OUT_PATH, JSON.stringify(stateObj), 'utf8');
}

function summarizeWatchlistForPublic(watchlist) {
  return (watchlist || []).map((item) => ({
    id: item.id,
    movieId: item.movieId || null,
    title: item.title || item.keyword || '',
    keyword: item.keyword || '',
    poster: item.poster || '',
    active: item.active !== false,
    hallFilter: item.hallFilter || 'all',
    roundCount: Number(item.roundCount || 0),
    createdAt: item.createdAt || '',
    lastAlertAt: item.lastAlertAt || ''
  }));
}

function minutesBetween(isoA, isoB) {
  if (!isoA || !isoB) return Infinity;
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / 60000;
}

function collectCinemaMovieIds(cinemasObj = {}) {
  const ids = new Set();
  for (const c of Object.values(cinemasObj)) {
    for (const m of c?.movies || []) {
      const hasAlertable = (m.shows || []).some((s) => s.alertable);
      if (hasAlertable && m.id) ids.add(Number(m.id));
    }
  }
  return ids;
}

function collectCinemaDetailMap(cinemasObj = {}) {
  const perMovie = new Map();
  for (const c of Object.values(cinemasObj)) {
    const cMeta = CINEMA_MAP.get(Number(c?.cinemaId));
    const cLabel = cMeta?.shortName || c?.cinemaName || '';
    if (!cLabel) continue;
    for (const m of c?.movies || []) {
      const alertableCount = (m.shows || []).filter((s) => s.alertable).length;
      if (alertableCount > 0 && m.id) {
        const id = Number(m.id);
        if (!perMovie.has(id)) perMovie.set(id, []);
        perMovie.get(id).push(`${cLabel} ${alertableCount}场`);
      }
    }
  }
  const detailMap = new Map();
  for (const [id, parts] of perMovie.entries()) {
    detailMap.set(id, parts.join(' · '));
  }
  return detailMap;
}

export function selectMoviesForIntelEnrichment({ catalogMovies, intelMap, activeWatchItems, nowIso, todayStr = '', maxBudget = 16 }) {
  const starredIds = new Set(activeWatchItems.map((w) => Number(w.movieId)).filter(Boolean));
  const windowStart = todayStr ? shiftDateStr(todayStr, -14) : '';
  const windowEnd = todayStr ? shiftDateStr(todayStr, 14) : '';
  const candidates = [];

  for (const m of catalogMovies) {
    const prev = intelMap[String(m.id)];
    const needsV2Upgrade = !prev || prev.matchVersion !== INTEL_MATCH_VERSION;
    const ageMin = prev?.checkedAt ? minutesBetween(prev.checkedAt, nowIso) : Infinity;
    const isStarred = starredIds.has(Number(m.id));
    const rt = String(m.rt || '').trim();
    const isNearRelease = Boolean(
      windowStart &&
      windowEnd &&
      /^\d{4}-\d{2}-\d{2}$/.test(rt) &&
      rt >= windowStart &&
      rt <= windowEnd
    );
    const isHotOrSoon = isStarred || m.source === 'onInfo' || isNearRelease;
    const missingAnyScore =
      needsV2Upgrade ||
      prev.doubanScore === null ||
      prev.imdbScore === null ||
      prev.rtCriticsScore === null ||
      !prev.enm;

    const eligible =
      needsV2Upgrade ||
      (isHotOrSoon && ((missingAnyScore && ageMin >= 4.5) || ageMin >= 60)) ||
      (!isHotOrSoon && ((missingAnyScore && ageMin >= 240) || ageMin >= 1440));

    if (eligible) {
      const priorityScore =
        (isStarred ? 1_000_000 : 0) +
        (needsV2Upgrade ? 200_000 : 0) +
        (isNearRelease ? 80_000 : 0) +
        (m.source === 'onInfo' ? 50_000 : 0) +
        (missingAnyScore ? 20_000 : 0) +
        Math.min(40_000, Math.floor((m.wish || 0) / 10));
      candidates.push({ movie: m, priorityScore });
    }
  }

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  return candidates.slice(0, maxBudget).map((c) => c.movie);
}

async function main() {
  const mode = process.env.RUN_MODE || 'tick'; // 'tick' | 'refresh_catalog' | 'test_push'
  const gistId = process.env.RADAR_GIST_ID || '';
  const ghToken = process.env.RADAR_GH_TOKEN || '';
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:dg-cinema-radar@example.com';
  const omdbApiKey = process.env.OMDB_API_KEY || '';
  const pageUrl = process.env.PAGE_URL || '';

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = getBeijingDateStr(now);

  const prevPublic = (await readExistingPublicState()) || {
    cinemas: {},
    catalog: { onInfo: [], coming: [] },
    intel: {},
    wishSnapshots: {},
    dynamics: [],
    alerts: [],
    catalogBaselineReady: false
  };

  let privateState = null;
  if (gistId && ghToken) {
    privateState = await readPrivateGist({ gistId, token: ghToken });
  } else {
    console.log('RADAR_GIST_ID or RADAR_GH_TOKEN missing; running in catalog-seed mode.');
  }

  const watchlist = privateState?.watchlist || [];
  const subscriptions = privateState?.subscriptions || [];
  const webhooks = privateState?.webhooks || {};
  const settings = {
    rotateMode: 'all',
    staggerMinMs: 850,
    staggerMaxMs: 1850,
    notifyAllDynamics: false,
    paused: false,
    ...(privateState?.settings || {})
  };
  const seen = privateState?.seen || {};
  const runtime = privateState?.runtime || {
    consecutiveRiskHits: 0,
    cooldownUntil: '',
    lastRiskAlertAt: '',
    lastCatalogSyncAt: '',
    tickCounter: 0
  };
  const alertsHistory = privateState?.alerts || prevPublic.alerts || [];
  const prevDynamics = Array.isArray(prevPublic.dynamics) ? prevPublic.dynamics : [];
  const prevIntelMap = prevPublic.intel || {};

  const activeWatchItems = watchlist.filter((w) => w && w.active !== false);
  const vapid = { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject };

  if (mode === 'test_push') {
    const testResult = await dispatchAlerts({
      alertPayload: {
        title: '🔔 测试提醒｜东莞三影院雷达通道正常',
        body: `监控影院：华南MALL IMAX GT / 东城万达 IMAX / 民盈国贸城 CGV\n当前星标：${activeWatchItems.length} 部\n动态推送：${settings.notifyAllDynamics === true ? '全量新片(定档/开票/改档/开分)' : '仅星标电影(非星标仅在动态页展示)'}\n时间：${nowIso}`,
        url: pageUrl,
        tag: `test-${Date.now()}`
      },
      subscriptions,
      webhooks,
      vapid
    });
    console.log('Test push result:', JSON.stringify(testResult));
    if (privateState && testResult.expiredRemoved > 0) {
      await updatePrivateGist({
        gistId,
        token: ghToken,
        subscriptions: testResult.aliveSubscriptions
      });
    }
    return;
  }

  if (mode === 'tick' && runtime.cooldownUntil && new Date(runtime.cooldownUntil) > now) {
    console.log(`Risk-control cooldown active until ${runtime.cooldownUntil}; skipping Maoyan requests.`);
    await writePublicState({
      ...prevPublic,
      lastTickAt: nowIso,
      vapidPublicKey,
      status: 'cooldown',
      activeWatchCount: activeWatchItems.length,
      watchlist: summarizeWatchlistForPublic(watchlist),
      riskControl: {
        active: true,
        cooldownUntil: runtime.cooldownUntil,
        consecutiveRiskHits: runtime.consecutiveRiskHits,
        lastReason: prevPublic.riskControl?.lastReason || '风控自动冷却中'
      }
    });
    return;
  }

  const cookie = process.env.MAOYAN_COOKIE || settings.maoyanCookie || '';
  const catalogAgeMin = minutesBetween(runtime.lastCatalogSyncAt || prevPublic.lastCatalogSyncAt || prevPublic.updatedAt, nowIso);
  const prevCatalogCount = (prevPublic.catalog?.onInfo?.length || 0) + (prevPublic.catalog?.coming?.length || 0);
  const needsCatalogRefresh =
    mode === 'refresh_catalog' ||
    catalogAgeMin >= CATALOG_REFRESH_INTERVAL_MIN ||
    prevCatalogCount < 25;

  const shouldScrapeCinemas =
    mode === 'refresh_catalog' ||
    activeWatchItems.length > 0 ||
    needsCatalogRefresh ||
    Object.keys(prevPublic.cinemas || {}).length === 0;

  if (settings.paused && mode === 'tick') {
    console.log('Monitoring paused by user settings; skipping Maoyan requests.');
    await writePublicState({
      ...prevPublic,
      lastTickAt: nowIso,
      vapidPublicKey,
      status: 'paused',
      activeWatchCount: activeWatchItems.length,
      watchlist: summarizeWatchlistForPublic(watchlist)
    });
    return;
  }

  if (!shouldScrapeCinemas) {
    console.log(`Idle mode (0 active stars, catalog age ${catalogAgeMin.toFixed(1)}m < ${CATALOG_REFRESH_INTERVAL_MIN}m); 0 Maoyan requests made.`);
    await writePublicState({
      ...prevPublic,
      lastTickAt: nowIso,
      vapidPublicKey,
      status: 'idle',
      activeWatchCount: 0,
      watchlist: summarizeWatchlistForPublic(watchlist)
    });
    return;
  }

  // 1. Fetch cinema details
  const needsBaselineAll = activeWatchItems.some((w) => w.pendingBaselineInit);
  const tickCounter = Number(runtime.tickCounter || 0);
  const cinemasToFetch =
    settings.rotateMode === 'round_robin' && mode === 'tick' && !needsBaselineAll && !needsCatalogRefresh
      ? [CINEMAS[tickCounter % CINEMAS.length]]
      : CINEMAS;

  const cinemaResults = [];
  let riskEvent = null;

  for (let i = 0; i < cinemasToFetch.length; i++) {
    if (i > 0) {
      await sleep(jitterDelay(settings.staggerMinMs || 850, settings.staggerMaxMs || 1850));
    }
    const c = cinemasToFetch[i];
    const res = await fetchCinemaDetail(c.id, { cookie });
    if (res.riskTriggered) {
      riskEvent = { cinemaId: c.id, cinemaName: c.shortName, reason: res.reason };
      console.warn(`Risk control detected at ${c.shortName}: ${res.reason}`);
      break;
    }
    cinemaResults.push(res);
  }

  if (riskEvent) {
    const nextHits = Number(runtime.consecutiveRiskHits || 0) + 1;
    const backoffMin = computeBackoffMinutes(nextHits);
    const cooldownUntil = new Date(now.getTime() + backoffMin * 60000).toISOString();
    const nextRuntime = {
      ...runtime,
      consecutiveRiskHits: nextHits,
      cooldownUntil,
      tickCounter: tickCounter + 1
    };

    const shouldWarnUser = !runtime.lastRiskAlertAt || minutesBetween(runtime.lastRiskAlertAt, nowIso) >= 60;
    if (privateState && shouldWarnUser) {
      nextRuntime.lastRiskAlertAt = nowIso;
      await dispatchAlerts({
        alertPayload: {
          title: `⚠️ 猫眼触发风控，已自动暂停 ${backoffMin} 分钟`,
          body: `触发节点：${riskEvent.cinemaName}\n原因：${riskEvent.reason}\n将在 ${backoffMin} 分钟后自动恢复。`,
          url: pageUrl,
          tag: 'risk-warning'
        },
        subscriptions,
        webhooks,
        vapid
      });
    }

    if (privateState) {
      await updatePrivateGist({ gistId, token: ghToken, runtime: nextRuntime });
    }

    await writePublicState({
      ...prevPublic,
      lastTickAt: nowIso,
      vapidPublicKey,
      status: 'cooldown',
      activeWatchCount: activeWatchItems.length,
      watchlist: summarizeWatchlistForPublic(watchlist),
      riskControl: {
        active: true,
        cooldownUntil,
        consecutiveRiskHits: nextHits,
        lastReason: riskEvent.reason
      }
    });
    return;
  }

  const prevCinemaMovieIds = collectCinemaMovieIds(prevPublic.cinemas || {});
  const mergedCinemas = { ...(prevPublic.cinemas || {}) };
  for (const r of cinemaResults) {
    if (r.ok) {
      mergedCinemas[String(r.cinemaId)] = {
        cinemaId: r.cinemaId,
        cinemaName: r.cinemaName,
        fetchedAt: nowIso,
        movies: r.movies
      };
    }
  }
  const currCinemaMovieIds = collectCinemaMovieIds(mergedCinemas);
  const currCinemaDetailMap = collectCinemaDetailMap(mergedCinemas);

  // 2. Fetch expanded catalog, wish growth, cross-platform scores & dynamic events
  let nextCatalog = prevPublic.catalog || { onInfo: [], coming: [] };
  let lastCatalogSyncAt = runtime.lastCatalogSyncAt || prevPublic.lastCatalogSyncAt || '';
  let nextWishSnapshots = prevPublic.wishSnapshots || {};
  let nextIntelMap = { ...prevIntelMap };
  let nextDynamics = prevDynamics;
  let catalogBaselineReady = Boolean(prevPublic.catalogBaselineReady && prevCatalogCount >= 25);

  if (needsCatalogRefresh) {
    await sleep(jitterDelay(450, 900));
    const cat = await fetchMovieCatalog({ cookie });
    if (cat.ok) {
      const prevCatalogAll = [...(prevPublic.catalog?.onInfo || []), ...(prevPublic.catalog?.coming || [])];
      const prevCatalogMap = Object.fromEntries(prevCatalogAll.map((m) => [String(m.id), m]));

      const allRawCatalog = [...cat.onInfo, ...cat.coming];
      nextWishSnapshots = updateWishSnapshots(nextWishSnapshots, allRawCatalog, todayStr);
      const enrichedOnInfo = attachWishGrowth(cat.onInfo, nextWishSnapshots);
      const enrichedComing = attachWishGrowth(cat.coming, nextWishSnapshots);
      const allEnriched = [...enrichedOnInfo, ...enrichedComing];

      // Prune intel cache to active catalog + starred movies & upgrade legacy entries safely
      const upgradeCount = Object.values(nextIntelMap).filter(
        (v) => v && v.matchVersion !== INTEL_MATCH_VERSION
      ).length;
      const hadLegacyV1Intel = Object.values(nextIntelMap).some(
        (v) => v && Number(v.matchVersion || 1) < 2 && (v.imdbUrl || v.rtUrl || v.doubanId)
      );
      if (hadLegacyV1Intel) {
        nextDynamics = nextDynamics.filter((d) => d.type !== 'scored');
      }
      const keepIds = new Set([
        ...allEnriched.map((m) => String(m.id)),
        ...activeWatchItems.map((w) => String(w.movieId)).filter(Boolean)
      ]);
      const prunedIntel = {};
      for (const [k, v] of Object.entries(nextIntelMap)) {
        if (!keepIds.has(k) || !v) continue;
        if (v.matchVersion === INTEL_MATCH_VERSION) {
          prunedIntel[k] = v;
        } else {
          // Keep verified Maoyan & Douban metadata while re-verifying IMDb/RT under strict v3 bilingual Pinyin rules
          prunedIntel[k] = {
            matchVersion: Number(v.matchVersion || 1),
            movieId: v.movieId || Number(k),
            enm: v.enm || '',
            cat: v.cat || '',
            dur: v.dur || 0,
            dir: v.dir || '',
            origRt: v.origRt || '',
            pubDesc: v.pubDesc || '',
            maoyanScore: v.maoyanScore ?? null,
            maoyanVotes: v.maoyanVotes || 0,
            doubanId: Number(v.matchVersion || 1) >= 2 ? (v.doubanId || '') : '',
            doubanUrl: Number(v.matchVersion || 1) >= 2 ? (v.doubanUrl || '') : '',
            doubanScore: Number(v.matchVersion || 1) >= 2 ? (v.doubanScore ?? null) : null,
            doubanVotes: Number(v.matchVersion || 1) >= 2 ? (v.doubanVotes || 0) : 0,
            doubanYear: Number(v.matchVersion || 1) >= 2 ? (v.doubanYear ?? null) : null,
            tppId: v.tppId ?? null,
            tppWish: v.tppWish ?? null,
            tppScore: v.tppScore ?? null
          };
        }
      }
      nextIntelMap = prunedIntel;

      // Sync Taopiaopiao catalog once (hot + 2~3 coming pages -> all 160+ movies' wantCount & score)
      let tppCatalog = null;
      try {
        tppCatalog = await fetchTaopiaopiaoCatalog();
      } catch (err) {
        console.warn('Taopiaopiao catalog fetch warning:', err?.message || err);
      }

      const tppMatchedMap = new Map();
      if (tppCatalog?.ok) {
        for (const m of allEnriched) {
          const matched = matchTaopiaopiaoMovie(m, tppCatalog);
          if (matched) {
            tppMatchedMap.set(Number(m.id), matched);
            const k = String(m.id);
            const curInt = nextIntelMap[k] || { movieId: Number(m.id) };
            const tppEnm = matched.showNameEn && /[a-zA-Z]/.test(matched.showNameEn) ? matched.showNameEn : '';
            nextIntelMap[k] = {
              ...curInt,
              movieId: Number(m.id),
              enm: curInt.enm || tppEnm || '',
              tppId: matched.tppId,
              tppWish: matched.tppWish,
              tppScore: matched.tppScore ?? curInt.tppScore ?? null
            };
          }
        }
      }

      // Incrementally enrich scores (Douban, IMDb, RT, Maoyan detailmovie) within 5-min cadence
      const budget = upgradeCount > 10 ? 24 : (mode === 'refresh_catalog' ? 24 : 18);
      const toEnrich = selectMoviesForIntelEnrichment({
        catalogMovies: allEnriched,
        intelMap: nextIntelMap,
        activeWatchItems,
        nowIso,
        todayStr,
        maxBudget: budget
      });

      const recheckedIds = new Set();
      for (const targetMovie of toEnrich) {
        const key = String(targetMovie.id);
        recheckedIds.add(Number(targetMovie.id));
        nextIntelMap[key] = await enrichMovieIntel(targetMovie, nextIntelMap[key] || {}, {
          cookie,
          omdbApiKey,
          tppMatch: tppMatchedMap.get(Number(targetMovie.id)) || null
        });
      }

      // Scrub stale historical `scored` dynamics whose score was invalidated during legacy upgrade
      if (recheckedIds.size > 0 || upgradeCount > 0) {
        nextDynamics = nextDynamics.filter((d) => {
          if (d.type !== 'scored') return true;
          const midStr = String(d.movieId);
          const ci = nextIntelMap[midStr];
          const pi = prevIntelMap[midStr];
          const touchedLegacy = recheckedIds.has(Number(d.movieId)) || Boolean(pi && pi.matchVersion !== INTEL_MATCH_VERSION);
          if (!touchedLegacy) return true;
          if (!ci) return false;
          const sum = String(d.summary || '');
          if (/\bIMDb\b/.test(sum) && !(ci.imdbScore > 0)) return false;
          if (/烂番茄/.test(sum) && (ci.rtCriticsScore === null || ci.rtCriticsScore === undefined)) return false;
          if (/豆瓣/.test(sum) && !(ci.doubanScore > 0) && recheckedIds.has(Number(d.movieId))) return false;
          return true;
        });
      }

      // Detect 定档 / 改档 / 开票 / 开分
      const newDynamicEvents = detectDynamicEvents({
        prevCatalogMap,
        currMovies: allEnriched,
        prevIntelMap,
        currIntelMap: nextIntelMap,
        prevCinemaMovieIds,
        currCinemaMovieIds,
        currCinemaDetailMap,
        todayStr,
        nowIso,
        baselineReady: catalogBaselineReady
      });

      if (newDynamicEvents.length > 0) {
        const existingDynIds = new Set(prevDynamics.map((d) => d.id));
        const uniqueNewEvents = newDynamicEvents.filter((e) => !existingDynIds.has(e.id));
        if (uniqueNewEvents.length > 0) {
          nextDynamics = [...uniqueNewEvents, ...prevDynamics].slice(0, 60);
          if (privateState) {
            const dynAlert = buildDynamicsAlert({
              events: uniqueNewEvents,
              watchlist,
              notifyAllDynamics: settings.notifyAllDynamics === true,
              pageUrl
            });
            if (dynAlert) {
              await dispatchAlerts({
                alertPayload: dynAlert,
                subscriptions,
                webhooks,
                vapid
              });
            }
          }
        }
      }

      nextCatalog = { onInfo: enrichedOnInfo, coming: enrichedComing };
      lastCatalogSyncAt = nowIso;
      catalogBaselineReady = true;
    } else if (cat.riskTriggered) {
      console.warn('Catalog fetch hit risk control:', cat.reason);
    }
  }

  // 3. Diff per-round Dongguan 3-cinema ticket waves for starred movies
  const { findings, nextSeenMap, watchUpdates } = diffWatchlistRound({
    watchlist: activeWatchItems,
    cinemaResults,
    seenMap: seen,
    todayStr,
    nowIso
  });

  const alertPayload = buildConsolidatedAlert(findings, pageUrl);
  let nextAlerts = alertsHistory;
  let updatedSubs;

  if (alertPayload && privateState) {
    const pushRes = await dispatchAlerts({
      alertPayload,
      subscriptions,
      webhooks,
      vapid
    });
    console.log('Wave alert dispatched:', alertPayload.title, JSON.stringify({
      webPushSent: pushRes.webPushSent,
      webhooksSent: pushRes.webhooksSent,
      expiredRemoved: pushRes.expiredRemoved
    }));

    if (pushRes.expiredRemoved > 0) {
      updatedSubs = pushRes.aliveSubscriptions;
    }

    nextAlerts = [
      {
        ...alertPayload.roundSummary,
        createdAt: nowIso,
        channels: {
          webPushSent: pushRes.webPushSent,
          webhooksSent: pushRes.webhooksSent
        }
      },
      ...alertsHistory
    ].slice(0, 30);
  }

  const nextRuntime = {
    consecutiveRiskHits: 0,
    cooldownUntil: '',
    lastRiskAlertAt: runtime.lastRiskAlertAt || '',
    lastCatalogSyncAt: lastCatalogSyncAt || nowIso,
    tickCounter: tickCounter + 1
  };

  if (privateState) {
    await updatePrivateGist({
      gistId,
      token: ghToken,
      watchUpdates,
      seen: nextSeenMap,
      runtime: nextRuntime,
      ...(alertPayload ? { alerts: nextAlerts } : {}),
      ...(updatedSubs !== undefined ? { subscriptions: updatedSubs } : {})
    });
  }

  const updatedWatchlistPublic = summarizeWatchlistForPublic(
    watchlist.map((item) => (watchUpdates[item.id] ? { ...item, ...watchUpdates[item.id] } : item))
  );

  await writePublicState({
    updatedAt: nowIso,
    lastTickAt: nowIso,
    lastCatalogSyncAt: lastCatalogSyncAt || nowIso,
    catalogBaselineReady,
    vapidPublicKey,
    status: activeWatchItems.length > 0 ? 'watching' : 'idle',
    activeWatchCount: activeWatchItems.length,
    watchlist: updatedWatchlistPublic,
    riskControl: {
      active: false,
      cooldownUntil: '',
      consecutiveRiskHits: 0,
      lastReason: ''
    },
    cinemas: mergedCinemas,
    catalog: nextCatalog,
    wishSnapshots: nextWishSnapshots,
    intel: nextIntelMap,
    dynamics: nextDynamics,
    alerts: nextAlerts
  });

  console.log(
    `Tick complete. Mode=${mode}, Cinemas=${cinemaResults.length}, Catalog=${(nextCatalog.onInfo?.length || 0) + (nextCatalog.coming?.length || 0)}, ActiveStars=${activeWatchItems.length}, WavesTriggered=${findings.length}`
  );
}

const isMain =
  Boolean(process.argv[1]) &&
  realpathSync(path.resolve(process.argv[1])) === realpathSync(path.resolve(fileURLToPath(import.meta.url)));
if (isMain) {
  main().catch((err) => {
    console.error('Fatal monitor error:', err);
    process.exitCode = 1;
  });
}
