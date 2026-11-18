/**
 * Private GitHub Gist state adapter with safe merge-on-write to avoid clobbering
 * concurrent Watchlist / Subscription changes made from mobile PWA clients.
 */

const GIST_API_BASE = 'https://api.github.com/gists';

export const DEFAULT_SETTINGS = {
  rotateMode: 'all', // 'all' | 'round_robin'
  staggerMinMs: 850,
  staggerMaxMs: 1850,
  maoyanCookie: '',
  notifyAllDynamics: true,
  paused: false
};

export const DEFAULT_RUNTIME = {
  consecutiveRiskHits: 0,
  cooldownUntil: '',
  lastRiskAlertAt: '',
  lastCatalogSyncAt: '',
  tickCounter: 0
};

function parseJsonSafe(content, fallback) {
  if (!content || typeof content !== 'string') return fallback;
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

export async function readPrivateGist({ gistId, token, fetchImpl = fetch }) {
  if (!gistId || !token) {
    throw new Error('缺少 RADAR_GIST_ID 或 RADAR_GH_TOKEN');
  }
  const res = await fetchImpl(`${GIST_API_BASE}/${encodeURIComponent(gistId)}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dg-cinema-radar-monitor'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`读取 Gist 失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const gist = await res.json();
  const files = gist.files || {};

  return {
    watchlist: parseJsonSafe(files['watchlist.json']?.content, []),
    subscriptions: parseJsonSafe(files['subscriptions.json']?.content, []),
    webhooks: parseJsonSafe(files['webhooks.json']?.content, {}),
    settings: { ...DEFAULT_SETTINGS, ...parseJsonSafe(files['settings.json']?.content, {}) },
    seen: parseJsonSafe(files['seen.json']?.content, {}),
    runtime: { ...DEFAULT_RUNTIME, ...parseJsonSafe(files['runtime.json']?.content, {}) },
    alerts: parseJsonSafe(files['alerts.json']?.content, [])
  };
}

/**
 * Patches only specified files in the Private Gist. If `watchUpdates` are present,
 * re-reads `watchlist.json` immediately before writing so user stars/unstars mid-run are never lost.
 */
export async function updatePrivateGist({
  gistId,
  token,
  watchUpdates = {},
  seen,
  runtime,
  alerts,
  subscriptions,
  fetchImpl = fetch
}) {
  const filesPayload = {};

  if (watchUpdates && Object.keys(watchUpdates).length > 0) {
    const fresh = await readPrivateGist({ gistId, token, fetchImpl });
    let changed = false;
    const mergedWatchlist = fresh.watchlist.map((item) => {
      const upd = watchUpdates[item.id];
      if (!upd) return item;
      changed = true;
      return {
        ...item,
        ...(upd.roundCount !== undefined ? { roundCount: upd.roundCount } : {}),
        ...(upd.lastAlertAt !== undefined ? { lastAlertAt: upd.lastAlertAt } : {}),
        ...(upd.pendingBaselineInit !== undefined ? { pendingBaselineInit: upd.pendingBaselineInit } : {}),
        ...(upd.resolvedMovieId ? { movieId: upd.resolvedMovieId } : {}),
        ...(upd.resolvedPoster ? { poster: upd.resolvedPoster } : {})
      };
    });
    if (changed) {
      filesPayload['watchlist.json'] = { content: JSON.stringify(mergedWatchlist, null, 2) };
    }
  }

  if (seen !== undefined) {
    filesPayload['seen.json'] = { content: JSON.stringify(seen) };
  }
  if (runtime !== undefined) {
    filesPayload['runtime.json'] = { content: JSON.stringify(runtime, null, 2) };
  }
  if (alerts !== undefined) {
    filesPayload['alerts.json'] = { content: JSON.stringify(alerts.slice(0, 40), null, 2) };
  }
  if (subscriptions !== undefined) {
    filesPayload['subscriptions.json'] = { content: JSON.stringify(subscriptions, null, 2) };
  }

  if (Object.keys(filesPayload).length === 0) return { skipped: true };

  const res = await fetchImpl(`${GIST_API_BASE}/${encodeURIComponent(gistId)}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'dg-cinema-radar-monitor'
    },
    body: JSON.stringify({ files: filesPayload }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`写入 Gist 失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  return { skipped: false };
}
