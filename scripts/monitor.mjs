/**
 * Main GitHub Actions runner for Dongguan Cinema Radar.
 * Reads private config from Gist, applies anti-risk-control pacing & circuit breaker,
 * diffs multi-round showtimes, dispatches 1 consolidated notification per wave,
 * and writes non-sensitive public snapshot `state.json` for the GitHub Pages Web App.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CINEMAS, getBeijingDateStr } from './lib/config.mjs';
import { fetchCinemaDetail, fetchMovieCatalog, jitterDelay, sleep } from './lib/maoyan.mjs';
import { buildConsolidatedAlert, computeBackoffMinutes, diffWatchlistRound } from './lib/radar.mjs';
import { readPrivateGist, updatePrivateGist } from './lib/gist.mjs';
import { dispatchAlerts } from './lib/notifier.mjs';

const STATE_OUT_PATH = process.env.STATE_OUT_PATH || path.resolve('data/state.json');

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

async function main() {
  const mode = process.env.RUN_MODE || 'tick'; // 'tick' | 'refresh_catalog' | 'test_push'
  const gistId = process.env.RADAR_GIST_ID || '';
  const ghToken = process.env.RADAR_GH_TOKEN || '';
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:dg-cinema-radar@example.com';
  const pageUrl = process.env.PAGE_URL || '';

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStr = getBeijingDateStr(now);

  const prevPublic = (await readExistingPublicState()) || {
    cinemas: {},
    catalog: { onInfo: [], coming: [] },
    alerts: []
  };

  // Load private Gist state when configured; allow catalog-only seed run before Gist setup
  let privateState = null;
  if (gistId && ghToken) {
    privateState = await readPrivateGist({ gistId, token: ghToken });
  } else {
    console.log('RADAR_GIST_ID or RADAR_GH_TOKEN missing; running in catalog-seed mode.');
  }

  const watchlist = privateState?.watchlist || [];
  const subscriptions = privateState?.subscriptions || [];
  const webhooks = privateState?.webhooks || {};
  const settings = privateState?.settings || { rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, paused: false };
  const seen = privateState?.seen || {};
  const runtime = privateState?.runtime || { consecutiveRiskHits: 0, cooldownUntil: '', lastRiskAlertAt: '', lastCatalogSyncAt: '', tickCounter: 0 };
  const alertsHistory = privateState?.alerts || prevPublic.alerts || [];

  const activeWatchItems = watchlist.filter((w) => w && w.active !== false);
  const vapid = { publicKey: vapidPublicKey, privateKey: vapidPrivateKey, subject: vapidSubject };

  if (mode === 'test_push') {
    const testResult = await dispatchAlerts({
      alertPayload: {
        title: '🔔 测试提醒｜东莞三影院雷达通道正常',
        body: `当前监控：华南MALL IMAX GT / 东城万达 IMAX / 民盈国贸城 CGV\n当前星标：${activeWatchItems.length} 部电影\n时间：${nowIso}`,
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

  // Cooldown guard if Maoyan risk control previously triggered
  if (mode === 'tick' && runtime.cooldownUntil && new Date(runtime.cooldownUntil) > now) {
    console.log(`Risk-control cooldown active until ${runtime.cooldownUntil}; skipping Maoyan requests.`);
    await writePublicState({
      updatedAt: prevPublic.updatedAt || nowIso,
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
      },
      cinemas: prevPublic.cinemas || {},
      catalog: prevPublic.catalog || { onInfo: [], coming: [] },
      alerts: alertsHistory.slice(0, 30)
    });
    return;
  }

  const cookie = process.env.MAOYAN_COOKIE || settings.maoyanCookie || '';

  // Idle protection ("注意猫眼风控"): when nothing is starred and not forced, only sync catalog every 30 min
  const catalogAgeMin = minutesBetween(runtime.lastCatalogSyncAt || prevPublic.updatedAt, nowIso);
  const shouldScrapeCinemas =
    mode === 'refresh_catalog' ||
    activeWatchItems.length > 0 ||
    catalogAgeMin >= 30 ||
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
    console.log(`Idle mode (0 active stars, catalog age ${catalogAgeMin.toFixed(1)}m < 30m); 0 Maoyan requests made.`);
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

  // Determine which cinemas to fetch this tick
  const needsBaselineAll = activeWatchItems.some((w) => w.pendingBaselineInit);
  const tickCounter = Number(runtime.tickCounter || 0);
  const cinemasToFetch =
    settings.rotateMode === 'round_robin' && mode === 'tick' && !needsBaselineAll
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

  // Handle risk-control circuit breaker
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

    // Send at most 1 risk alert per cooldown streak (or after > 60 min)
    const shouldWarnUser = !runtime.lastRiskAlertAt || minutesBetween(runtime.lastRiskAlertAt, nowIso) >= 60;
    if (privateState && shouldWarnUser) {
      nextRuntime.lastRiskAlertAt = nowIso;
      await dispatchAlerts({
        alertPayload: {
          title: `⚠️ 猫眼触发风控，已自动暂停 ${backoffMin} 分钟`,
          body: `触发节点：${riskEvent.cinemaName}\n原因：${riskEvent.reason}\n将在 ${backoffMin} 分钟后自动恢复；你也可以在 Web App 设置中切为「轮转抓1家」或补充 Cookie。`,
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

  // Merge newly fetched cinemas into snapshot
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

  // Refresh coming/onInfo catalog periodically (or when manually triggered)
  let nextCatalog = prevPublic.catalog || { onInfo: [], coming: [] };
  let lastCatalogSyncAt = runtime.lastCatalogSyncAt || '';
  if (mode === 'refresh_catalog' || catalogAgeMin >= 30 || (nextCatalog.coming?.length || 0) === 0) {
    await sleep(jitterDelay(600, 1200));
    const cat = await fetchMovieCatalog({ cookie });
    if (cat.ok) {
      nextCatalog = { onInfo: cat.onInfo, coming: cat.coming };
      lastCatalogSyncAt = nowIso;
    } else if (cat.riskTriggered) {
      console.warn('Catalog fetch hit risk control:', cat.reason);
    }
  }

  // Diff wave rounds for all active starred movies
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

  // Reflect updated round counts in public summary immediately
  const updatedWatchlistPublic = summarizeWatchlistForPublic(
    watchlist.map((item) => (watchUpdates[item.id] ? { ...item, ...watchUpdates[item.id] } : item))
  );

  await writePublicState({
    updatedAt: nowIso,
    lastTickAt: nowIso,
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
    alerts: nextAlerts
  });

  console.log(
    `Tick complete. Mode=${mode}, Cinemas=${cinemaResults.length}, ActiveStars=${activeWatchItems.length}, WavesTriggered=${findings.length}`
  );
}

main().catch((err) => {
  console.error('Fatal monitor error:', err);
  process.exitCode = 1;
});
