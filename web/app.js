const DEFAULT_REPO_OWNER = 'z2vn7g8nhp-beep';
const DEFAULT_REPO_NAME = 'dg-cinema-radar';

const CINEMAS = [
  { id: 1485, shortName: '华南MALL IMAX GT', name: '万达影城（华南MALL-IMAXGT激光店）', badge: 'IMAX GT 1.43:1' },
  { id: 10418, shortName: '东城万达 IMAX', name: '万达影城（东城万达广场IMAX店）', badge: 'IMAX' },
  { id: 26100, shortName: '民盈国贸城 CGV', name: 'CGV影城（民盈·国贸城店）', badge: 'IMAX / 4DX / ScreenX' }
];

const STORAGE_KEYS = {
  config: 'dg_radar_config_v1',
  sentinel: 'dg_radar_sentinel_v1',
  lastSeenAlertId: 'dg_radar_last_alert_id'
};

const appState = {
  tab: 'radar',
  activeCinemaId: 1485,
  activeDateFilter: 'all',
  specialHallOnly: false,
  catalogTab: 'coming',
  catalogSearch: '',
  dynamicsFilter: 'all',
  publicState: null,
  privateState: {
    watchlist: [],
    subscriptions: [],
    webhooks: {},
    settings: { rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', notifyAllDynamics: true, paused: false },
    alerts: []
  },
  config: loadConfig(),
  sentinel: loadSentinelConfig(),
  swReg: null,
  pushSub: null,
  wakeLock: null,
  sentinelTimer: null,
  generatedVapid: null,
  pairingFeedback: null,
  busy: false
};

function detectRepoFromLocation() {
  const host = window.location.hostname;
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    return {
      owner: host.replace(/\.github\.io$/, ''),
      repo: parts[0] || DEFAULT_REPO_NAME
    };
  }
  return { owner: DEFAULT_REPO_OWNER, repo: DEFAULT_REPO_NAME };
}

function loadConfig() {
  const detected = detectRepoFromLocation();
  const base = {
    owner: detected.owner,
    repo: detected.repo,
    gistId: '',
    token: '',
    vapidPublicKeyOverride: ''
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.config) || '{}');
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

function saveConfig(next) {
  appState.config = { ...appState.config, ...next };
  localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(appState.config));
}

function loadSentinelConfig() {
  const base = {
    enabled: false,
    sound: true,
    vibrate: true,
    keepAwake: false
  };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.sentinel) || '{}') };
  } catch {
    return base;
  }
}

function saveSentinelConfig(next) {
  appState.sentinel = { ...appState.sentinel, ...next };
  localStorage.setItem(STORAGE_KEYS.sentinel, JSON.stringify(appState.sentinel));
}

function detectPlatform() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isHuawei = /HUAWEI|HONOR|HarmonyOS|HuaweiBrowser|ArkWeb/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { isIOS, isHuawei, isAndroid, isStandalone, supportsPush };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, duration = 2800) {
  const el = document.getElementById('toastRoot');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add('hidden'), duration);
}

async function copyText(text, label = '内容') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制${label}`);
  } catch {
    showToast(`请手动全选复制${label}`);
  }
}

function formatRelTime(iso) {
  if (!iso) return '尚未同步';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}秒前`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
  return `${Math.floor(diffSec / 86400)}天前`;
}

function formatWishCount(n) {
  const num = Number(n || 0);
  if (num <= 0) return '0';
  if (num >= 10000) return `${(num / 10000).toFixed(2)}万`;
  return num.toLocaleString('zh-CN');
}

function getAllCatalogMovies() {
  const cat = appState.publicState?.catalog || { onInfo: [], coming: [] };
  const byId = new Map();
  for (const m of [...(cat.onInfo || []), ...(cat.coming || [])]) {
    if (m && m.id && !byId.has(Number(m.id))) {
      byId.set(Number(m.id), m);
    }
  }
  return Array.from(byId.values());
}

function openMovieDetailModal({ movieId = null, title = '', poster = '' }) {
  const catalogList = getAllCatalogMovies();
  const catMovie = catalogList.find(
    (m) =>
      (movieId && Number(m.id) === Number(movieId)) ||
      (!movieId && title && String(m.nm || '').toLowerCase() === title.toLowerCase())
  );
  const resolvedId = movieId || catMovie?.id || null;
  const resolvedTitle = title || catMovie?.nm || '电影详情';
  const resolvedPoster = poster || catMovie?.img || '';
  const intel = resolvedId ? (appState.publicState?.intel?.[String(resolvedId)] || {}) : {};
  const wishSnapshots = appState.publicState?.wishSnapshots || {};
  const wishVal = Number(catMovie?.wish || (resolvedId ? wishSnapshots.latestWish?.[String(resolvedId)] : 0) || 0);
  const baseWish = resolvedId && wishSnapshots.todayBase?.[String(resolvedId)] !== undefined
    ? Number(wishSnapshots.todayBase[String(resolvedId)])
    : wishVal;
  const wishDailyGain = Number(catMovie?.wishDailyGain ?? Math.max(0, wishVal - baseWish));
  const wishYesterdayGain = Number(catMovie?.wishYesterdayGain ?? (resolvedId ? wishSnapshots.yesterdayGain?.[String(resolvedId)] || 0 : 0));

  const maoyanScore = Number(intel.maoyanScore || catMovie?.sc || 0);
  const cinemaMatches = findCurrentMovieMatchesAcrossCinemas({ movieId: resolvedId, title: resolvedTitle });
  const isStarred = getEffectiveWatchlist().some(
    (w) =>
      w.active !== false &&
      ((resolvedId && Number(w.movieId) === Number(resolvedId)) ||
        (!resolvedId && resolvedTitle && String(w.keyword || '').toLowerCase() === resolvedTitle.toLowerCase()))
  );

  const root = document.getElementById('modalRoot');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal-sheet">
      <div class="row-between" style="margin-bottom:10px">
        <div class="card-title">🎬 电影全维详情</div>
        <button class="btn btn-sm" id="closeDetailModalBtn" type="button">关闭</button>
      </div>

      <div class="movie-card" style="margin-bottom:10px">
        ${
          resolvedPoster
            ? `<img class="poster" src="${escapeHtml(resolvedPoster)}" alt="" />`
            : `<div class="poster-placeholder">🎬</div>`
        }
        <div class="movie-body">
          <div class="movie-name" style="font-size:16px">${escapeHtml(resolvedTitle)}</div>
          ${intel.enm ? `<div class="muted">${escapeHtml(intel.enm)}</div>` : ''}
          <div class="row" style="margin:6px 0">
            ${catMovie?.statusLabel ? `<span class="badge badge-imax">${escapeHtml(catMovie.statusLabel)}</span>` : ''}
            ${catMovie?.rt ? `<span class="badge badge-normal">${escapeHtml(catMovie.rt)}</span>` : ''}
            ${intel.cat ? `<span class="muted">${escapeHtml(intel.cat)}${intel.dur ? ` · ${intel.dur}分钟` : ''}</span>` : ''}
          </div>
          ${intel.dir || catMovie?.star ? `<div class="muted">${escapeHtml([intel.dir ? `导演：${intel.dir}` : '', catMovie?.star ? `主演：${catMovie.star}` : ''].filter(Boolean).join(' · '))}</div>` : ''}
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-top:8px">想看指数对比（猫眼 & 淘票票）</div>
      <div class="wish-compare-grid">
        <div class="metric-box">
          <div class="metric-label"><span>🐱 猫眼想看</span><span style="color:var(--green)">今日 +${wishDailyGain.toLocaleString('zh-CN')}</span></div>
          <div class="metric-val" style="color:var(--gold)">${formatWishCount(wishVal)}</div>
          <div class="metric-sub">${wishYesterdayGain > 0 ? `昨日增长 +${wishYesterdayGain.toLocaleString('zh-CN')}` : '以猫眼实时想看为准'}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label"><span>🎫 淘票票想看</span></div>
          <div class="metric-val" style="font-size:${intel.tppWish ? '18px' : '13px'};color:${intel.tppWish ? 'var(--cyan)' : 'var(--text-dim)'}">
            ${intel.tppWish ? formatWishCount(intel.tppWish) : '受阿里MTOP风控限制'}
          </div>
          <div class="metric-sub">
            <a href="https://m.taopiaopiao.com/" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:none">打开淘票票手动查看 →</a>
          </div>
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-top:10px">四平台开分看板</div>
      <div class="score-grid">
        <div class="metric-box">
          <div class="metric-label"><span>猫眼评分</span></div>
          <div class="metric-val" style="color:var(--gold)">${maoyanScore > 0 ? maoyanScore : '未开分'}</div>
          <div class="metric-sub">${intel.maoyanVotes ? `${formatWishCount(intel.maoyanVotes)}人评` : '官方评分'}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label"><span>豆瓣评分</span>${intel.doubanUrl ? `<a href="${escapeHtml(intel.doubanUrl)}" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:none">详情↗</a>` : ''}</div>
          <div class="metric-val" style="color:var(--green)">${intel.doubanScore > 0 ? intel.doubanScore : '未开分'}</div>
          <div class="metric-sub">${intel.doubanVotes ? `${formatWishCount(intel.doubanVotes)}人评` : '待抓取或未开分'}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label"><span>IMDb 评分</span>${intel.imdbUrl ? `<a href="${escapeHtml(intel.imdbUrl)}" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:none">详情↗</a>` : ''}</div>
          <div class="metric-val" style="color:var(--cyan)">${intel.imdbScore > 0 ? `${intel.imdbScore}` : '未开分'}</div>
          <div class="metric-sub">${intel.imdbVotes ? `${formatWishCount(intel.imdbVotes)} votes` : (intel.enm ? '待抓取或未开分' : '需英文片名匹配')}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label"><span>烂番茄</span>${intel.rtUrl ? `<a href="${escapeHtml(intel.rtUrl)}" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:none">详情↗</a>` : ''}</div>
          <div class="metric-val" style="color:var(--red)">${intel.rtCriticsScore !== null && intel.rtCriticsScore !== undefined ? `🍅 ${intel.rtCriticsScore}%` : '未开分'}</div>
          <div class="metric-sub">${intel.rtAudienceScore !== null && intel.rtAudienceScore !== undefined ? `爆米花 ${intel.rtAudienceScore}%` : '媒体新鲜度'}</div>
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-top:10px">东莞三家影院当前排片</div>
      ${
        cinemaMatches.length === 0
          ? `<div class="muted" style="margin-top:4px">暂未在华南MALL / 东城万达 / 民盈国贸城查到开售排片。</div>`
          : cinemaMatches
              .map(
                ({ cinema, movie }) =>
                  `<div class="muted" style="margin-top:4px">• <strong>${escapeHtml(cinema.shortName)}</strong>：${movie.showCount} 场（${(movie.shows || []).slice(0, 3).map((s) => `${s.dt.slice(5)} ${s.tm}${s.tags?.length ? `[${s.tags[0]}]` : ''}`).join('、')}）</div>`
              )
              .join('')
      }

      <div class="row" style="margin-top:14px">
        <button class="btn ${isStarred ? 'btn-gold' : 'btn-primary'}" style="flex:1" id="detailStarActionBtn" type="button">
          ${isStarred ? '★ 调整星标 / 停止提醒' : '★ 星标盯每轮开票'}
        </button>
      </div>
    </div>
  `;

  document.getElementById('closeDetailModalBtn').onclick = () => root.classList.add('hidden');
  root.onclick = (e) => {
    if (e.target === root) root.classList.add('hidden');
  };
  document.getElementById('detailStarActionBtn').onclick = () => {
    openStarModal({ movieId: resolvedId, title: resolvedTitle, poster: resolvedPoster });
  };
}

function base64UrlToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function uint8ArrayToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function generateBrowserVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const xBytes = base64UrlToUint8Array(jwk.x);
  const yBytes = base64UrlToUint8Array(jwk.y);
  const pubBytes = new Uint8Array(65);
  pubBytes[0] = 0x04;
  pubBytes.set(xBytes, 1);
  pubBytes.set(yBytes, 33);
  return {
    publicKey: uint8ArrayToBase64Url(pubBytes),
    privateKey: jwk.d
  };
}

function applyPairingPayload(rawValue) {
  const text = String(rawValue || '').trim();
  const hashIdx = text.indexOf('#pair=');
  const encoded = hashIdx >= 0 ? text.slice(hashIdx + '#pair='.length) : text;
  const jsonStr = new TextDecoder().decode(base64UrlToUint8Array(encoded));
  const parsed = JSON.parse(jsonStr);
  if (!parsed.token || !parsed.gistId) {
    throw new Error('配对链接缺少 token 或 gistId');
  }
  saveConfig({
    owner: parsed.owner || appState.config.owner,
    repo: parsed.repo || appState.config.repo,
    gistId: parsed.gistId,
    token: parsed.token,
    vapidPublicKeyOverride: parsed.vapidPublicKey || appState.config.vapidPublicKeyOverride || ''
  });
  return parsed;
}

function checkIncomingPairingHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#pair=')) return;
  try {
    applyPairingPayload(hash);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    showToast('已导入朋友配对配置！请点击「提醒与设置」开启本机通知', 4200);
  } catch (err) {
    console.warn('Pairing hash parse failed:', err);
  }
}

function getEffectiveVapidPublicKey() {
  return (
    appState.publicState?.vapidPublicKey ||
    appState.config.vapidPublicKeyOverride ||
    appState.generatedVapid?.publicKey ||
    ''
  ).trim();
}

function isPaired() {
  return Boolean(appState.config.token && appState.config.gistId);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('请求超时（国内直连 GitHub 较慢时可稍后再试或切换网络）');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function ghFetch(url, options = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(appState.config.token ? { Authorization: `Bearer ${appState.config.token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetchWithTimeout(url, { ...options, headers, cache: 'no-store' }, 12000);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 140)}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function loadPublicState() {
  const { owner, repo } = appState.config;
  const urls = [
    `https://api.github.com/repos/${owner}/${repo}/contents/state.json?ref=data&t=${Date.now()}`,
    `https://raw.githubusercontent.com/${owner}/${repo}/data/state.json?t=${Date.now()}`,
    `./data/seed-state.json?t=${Date.now()}`
  ];

  for (let i = 0; i < urls.length; i++) {
    try {
      const headers = i === 0
        ? {
            Accept: 'application/vnd.github.raw+json',
            ...(appState.config.token ? { Authorization: `Bearer ${appState.config.token}` } : {})
          }
        : {};
      const res = await fetchWithTimeout(urls[i], { headers, cache: 'no-store' }, i === 2 ? 4000 : 7000);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === 'object') {
        appState.publicState = data;
        return data;
      }
    } catch {
      // try next fallback source
    }
  }
  return appState.publicState;
}

async function loadPrivateGist() {
  if (!isPaired()) return null;
  const gist = await ghFetch(`https://api.github.com/gists/${encodeURIComponent(appState.config.gistId)}`);
  const files = gist.files || {};
  const safeParse = (name, fb) => {
    try {
      return files[name]?.content ? JSON.parse(files[name].content) : fb;
    } catch {
      return fb;
    }
  };
  appState.privateState = {
    watchlist: safeParse('watchlist.json', []),
    subscriptions: safeParse('subscriptions.json', []),
    webhooks: safeParse('webhooks.json', {}),
    settings: { rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', notifyAllDynamics: true, paused: false, ...safeParse('settings.json', {}) },
    alerts: safeParse('alerts.json', [])
  };
  return appState.privateState;
}

async function patchGistFiles(filesObj) {
  if (!isPaired()) {
    throw new Error('请先在「提醒与设置」完成 GitHub Token 与私有 Gist 配对');
  }
  const files = {};
  for (const [k, v] of Object.entries(filesObj)) {
    files[k] = { content: JSON.stringify(v, null, 2) };
  }
  await ghFetch(`https://api.github.com/gists/${encodeURIComponent(appState.config.gistId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files })
  });
}

async function createPrivateGistWithToken(token) {
  if (!token) throw new Error('请先填入 GitHub Fine-Grained Token');
  const initialFiles = {
    'watchlist.json': { content: '[]' },
    'subscriptions.json': { content: '[]' },
    'webhooks.json': { content: '{}' },
    'settings.json': { content: JSON.stringify({ rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', paused: false }, null, 2) },
    'seen.json': { content: '{}' },
    'runtime.json': { content: '{}' },
    'alerts.json': { content: '[]' }
  };
  const res = await fetchWithTimeout('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: 'dg-cinema-radar private state (watchlist, push subscriptions, webhooks)',
      public: false,
      files: initialFiles
    })
  }, 12000);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`创建 Gist 失败 (${res.status}): ${txt.slice(0, 140)}`);
  }
  return res.json();
}

async function triggerWorkflow(mode = 'tick') {
  if (!appState.config.token) {
    throw new Error('需要填入具有 Actions 写入权限的 GitHub Token');
  }
  const { owner, repo } = appState.config;
  await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/monitor.yml/dispatches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { mode } })
    }
  );
}

async function syncAllData({ silent = false } = {}) {
  try {
    await Promise.all([
      loadPublicState(),
      isPaired() ? loadPrivateGist() : Promise.resolve(null)
    ]);
    checkNewAlertForSentinel();
    render({ preserveFocusedSettings: silent });
    return { ok: true };
  } catch (err) {
    if (!silent) showToast(`同步失败: ${err.message}`, 4200);
    return { ok: false, error: err.message };
  }
}

function getEffectiveWatchlist() {
  if (isPaired()) {
    return appState.privateState.watchlist || [];
  }
  return appState.publicState?.watchlist || [];
}

function getEffectiveAlerts() {
  const priv = appState.privateState?.alerts || [];
  const pub = appState.publicState?.alerts || [];
  return priv.length >= pub.length ? priv : pub;
}

function findCurrentMovieMatchesAcrossCinemas(movieOrWatchItem) {
  const cinemas = appState.publicState?.cinemas || {};
  const results = [];
  for (const cMeta of CINEMAS) {
    const cData = cinemas[String(cMeta.id)];
    if (!cData) continue;
    const kw = (movieOrWatchItem.keyword || movieOrWatchItem.title || movieOrWatchItem.nm || '').trim().toLowerCase();
    for (const m of cData.movies || []) {
      const idMatch = movieOrWatchItem.movieId && Number(movieOrWatchItem.movieId) === Number(m.id);
      const nameMatch = kw && String(m.nm || '').toLowerCase().includes(kw);
      if (idMatch || nameMatch) {
        results.push({ cinema: cMeta, movie: m });
      }
    }
  }
  return results;
}

function playSentinelChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.14);
      osc.stop(ctx.currentTime + idx * 0.14 + 0.26);
    });
  } catch {
    // Audio playback may require user gesture first
  }
}

async function fireLocalNotification(title, body) {
  if (appState.sentinel.sound) playSentinelChime();
  if (appState.sentinel.vibrate && navigator.vibrate) {
    navigator.vibrate([240, 100, 240, 100, 320]);
  }
  if ('Notification' in window && Notification.permission === 'granted' && appState.swReg) {
    await appState.swReg.showNotification(title, {
      body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: `local-${Date.now()}`,
      renotify: true,
      vibrate: [240, 100, 240]
    });
  }
}

function checkNewAlertForSentinel() {
  const alerts = getEffectiveAlerts();
  if (!alerts.length) return;
  const newest = alerts[0];
  const prevId = localStorage.getItem(STORAGE_KEYS.lastSeenAlertId);
  if (!prevId) {
    localStorage.setItem(STORAGE_KEYS.lastSeenAlertId, newest.id);
    return;
  }
  if (newest.id !== prevId) {
    localStorage.setItem(STORAGE_KEYS.lastSeenAlertId, newest.id);
    if (appState.sentinel.enabled) {
      fireLocalNotification(newest.title, (newest.lines || []).join('\n'));
    }
    showToast(newest.title, 4500);
  }
}

function startOrStopSentinelTimer() {
  clearInterval(appState.sentinelTimer);
  if (appState.sentinel.enabled) {
    appState.sentinelTimer = setInterval(() => {
      syncAllData({ silent: true });
    }, 45000);
  }
}

async function toggleWakeLock(enable) {
  if (!('wakeLock' in navigator)) return;
  if (enable) {
    try {
      appState.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      // Ignored if browser denies wake lock
    }
  } else if (appState.wakeLock) {
    await appState.wakeLock.release().catch(() => undefined);
    appState.wakeLock = null;
  }
}

async function subscribeDeviceWebPush() {
  const plat = detectPlatform();
  if (plat.isIOS && !plat.isStandalone) {
    showToast('iPhone 请先点击 Safari 底部「分享」→「添加到主屏幕」，再从桌面打开开启推送！', 4500);
    return;
  }
  if (!plat.supportsPush) {
    showToast('当前浏览器不支持标准 PushManager，请使用下方「华为哨兵模式」或微信 PushPlus 兜底', 4000);
    return;
  }
  if (!isPaired()) {
    showToast('请先在下方完成 GitHub Token 与私有 Gist 配对');
    return;
  }
  const vapidPub = getEffectiveVapidPublicKey();
  if (!vapidPub) {
    showToast('尚未配置 VAPID 公钥！请先在下方生成密钥并填入 GitHub Secrets');
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    showToast('通知权限被拒绝，请在系统设置中允许通知');
    return;
  }

  const reg = appState.swReg || (await navigator.serviceWorker.ready);
  appState.swReg = reg;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(vapidPub)
  });
  appState.pushSub = sub;

  const subJson = sub.toJSON();
  const deviceLabel = plat.isIOS
    ? 'iPhone PWA'
    : plat.isHuawei
      ? '华为设备'
      : plat.isAndroid
        ? 'Android 浏览器'
        : '桌面浏览器';

  await loadPrivateGist();
  const existing = (appState.privateState.subscriptions || []).filter(
    (s) => s?.subscription?.endpoint !== subJson.endpoint
  );
  existing.push({
    id: `sub_${Date.now()}`,
    deviceLabel,
    platform: plat.isIOS ? 'ios' : plat.isHuawei ? 'huawei' : 'web',
    subscription: subJson,
    createdAt: new Date().toISOString()
  });

  await patchGistFiles({ 'subscriptions.json': existing });
  appState.privateState.subscriptions = existing;
  showToast(`${deviceLabel} Web App 提醒已开启！`);
  render();
}

function openStarModal({ movieId = null, title = '', poster = '', keyword = '' }) {
  const matches = findCurrentMovieMatchesAcrossCinemas({ movieId, title, keyword: keyword || title });
  const totalOpenShows = matches.reduce((sum, m) => sum + (m.movie.showCount || 0), 0);
  const existingWatch = getEffectiveWatchlist().find(
    (w) =>
      w.active !== false &&
      ((movieId && Number(w.movieId) === Number(movieId)) ||
        (!movieId && keyword && w.keyword === keyword))
  );

  const root = document.getElementById('modalRoot');
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal-sheet">
      <div class="row-between" style="margin-bottom:10px">
        <div class="card-title">★ 星标盯票：《${escapeHtml(title || keyword)}》</div>
        <button class="btn btn-sm" id="closeModalBtn" type="button">关闭</button>
      </div>
      <p class="muted" style="margin:0 0 12px">
        星标后，只要你未手动停止，三家东莞影院（华南MALL IMAX GT / 东城万达 IMAX / 民盈国贸城 CGV）每一轮新放票都会合并推一条提醒。
      </p>
      <div class="field">
        <label>要盯的影厅范围</label>
        <select id="modalHallFilter" class="select">
          <option value="all" ${existingWatch?.hallFilter === 'all' ? 'selected' : ''}>全部影厅（默认，特殊厅自动高亮）</option>
          <option value="special" ${existingWatch?.hallFilter === 'special' ? 'selected' : ''}>仅特殊厅（IMAX GT / IMAX / 4DX / ScreenX / 杜比）</option>
          <option value="imax" ${existingWatch?.hallFilter === 'imax' ? 'selected' : ''}>仅 IMAX（含 IMAX GT）</option>
          <option value="imax_gt" ${existingWatch?.hallFilter === 'imax_gt' ? 'selected' : ''}>只盯 华南MALL IMAX GT 厅</option>
        </select>
      </div>
      ${
        totalOpenShows > 0
          ? `<div class="field">
              <label>当前三家影院已有 ${totalOpenShows} 场排片</label>
              <select id="modalBaseline" class="select">
                <option value="skip">跳过当前已有场次，仅提醒后续新一轮开票（推荐）</option>
                <option value="include">连同当前已有场次也立即推一次</option>
              </select>
            </div>`
          : ''
      }
      <div class="row" style="margin-top:14px">
        <button class="btn btn-gold" style="flex:1" id="confirmStarBtn" type="button">${existingWatch ? '更新盯票设置' : '确认星标盯票'}</button>
        ${existingWatch ? `<button class="btn btn-danger" id="modalStopBtn" type="button">停止提醒</button>` : ''}
      </div>
    </div>
  `;

  document.getElementById('closeModalBtn').onclick = () => root.classList.add('hidden');
  root.onclick = (e) => {
    if (e.target === root) root.classList.add('hidden');
  };

  document.getElementById('modalStopBtn')?.addEventListener('click', async () => {
    await toggleWatchActive(existingWatch.id, false);
    root.classList.add('hidden');
  });

  document.getElementById('confirmStarBtn').onclick = async () => {
    if (!isPaired()) {
      root.classList.add('hidden');
      appState.tab = 'settings';
      render();
      showToast('请先在「提醒与设置」配对 GitHub Token 与私有 Gist');
      return;
    }
    const hallFilter = document.getElementById('modalHallFilter').value;
    const baselineEl = document.getElementById('modalBaseline');
    const skipExisting = baselineEl ? baselineEl.value === 'skip' : false;

    try {
      await loadPrivateGist();
      const list = [...(appState.privateState.watchlist || [])];
      const dup = list.find(
        (w) =>
          (movieId && Number(w.movieId) === Number(movieId)) ||
          (!movieId && keyword && w.keyword === keyword)
      );
      if (dup) {
        dup.active = true;
        dup.hallFilter = hallFilter;
        dup.pendingBaselineInit = skipExisting;
      } else {
        list.unshift({
          id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          movieId: movieId ? Number(movieId) : null,
          title: title || keyword,
          keyword: keyword || title,
          poster: poster || '',
          active: true,
          hallFilter,
          pendingBaselineInit: skipExisting,
          roundCount: 0,
          createdAt: new Date().toISOString(),
          lastAlertAt: ''
        });
      }
      await patchGistFiles({ 'watchlist.json': list });
      appState.privateState.watchlist = list;
      root.classList.add('hidden');
      showToast(`已星标《${title || keyword}》，正在触发首次检查...`);
      triggerWorkflow('tick').catch(() => undefined);
      render();
    } catch (err) {
      showToast(`星标失败: ${err.message}`);
    }
  };
}

async function toggleWatchActive(watchId, nextActive) {
  if (!isPaired()) {
    showToast('请先完成 GitHub 配对');
    return;
  }
  await loadPrivateGist();
  const list = (appState.privateState.watchlist || []).map((w) =>
    w.id === watchId ? { ...w, active: nextActive } : w
  );
  await patchGistFiles({ 'watchlist.json': list });
  appState.privateState.watchlist = list;
  showToast(nextActive ? '已恢复持续盯票' : '已手动停止该电影提醒');
  render();
}

async function removeWatchItem(watchId) {
  if (!isPaired()) return;
  await loadPrivateGist();
  const list = (appState.privateState.watchlist || []).filter((w) => w.id !== watchId);
  await patchGistFiles({ 'watchlist.json': list });
  appState.privateState.watchlist = list;
  showToast('已移出星标清单');
  render();
}

function hallFilterLabel(hf) {
  return (
    {
      all: '全部厅',
      special: '仅特殊厅',
      imax: '仅 IMAX',
      imax_gt: '仅 IMAX GT'
    }[hf] || '全部厅'
  );
}

function renderDeviceBanner() {
  const el = document.getElementById('deviceBanner');
  const plat = detectPlatform();

  if (plat.isIOS && !plat.isStandalone) {
    el.className = 'banner';
    el.innerHTML = `
      <div class="banner-title">
        <span>📱 iPhone 锁屏直接提醒指引</span>
      </div>
      <div>Safari 网页直接打开无法推送，请点底部 <strong>分享按钮 ⬆️ →「添加到主屏幕」</strong>，再从桌面图标打开即可开启 <strong>iPhone 原生锁屏 Web Push</strong>。</div>
    `;
    return;
  }

  if (plat.isIOS && plat.isStandalone && !appState.pushSub) {
    el.className = 'banner';
    el.innerHTML = `
      <div class="banner-title">
        <span>📲 iPhone PWA 已就绪</span>
        <button class="btn btn-primary btn-sm" id="bannerSubscribeBtn" type="button">开启锁屏提醒</button>
      </div>
      <div class="muted">点击开启后，每一轮开票都会通过苹果 APNs 推送到锁屏（需先完成「提醒与设置」里的 Gist 配对）。</div>
    `;
    document.getElementById('bannerSubscribeBtn').onclick = () => {
      if (!isPaired()) {
        appState.tab = 'settings';
        render();
        showToast('请先填入 Token 和 Gist ID 完成配对');
      } else {
        subscribeDeviceWebPush();
      }
    };
    return;
  }

  if (plat.isHuawei && !appState.sentinel.enabled && !(appState.privateState.webhooks?.pushplusToken)) {
    el.className = 'banner warn';
    el.innerHTML = `
      <div class="banner-title">
        <span>📱 华为设备提醒适配提示</span>
        <button class="btn btn-gold btn-sm" id="bannerGoHuaweiBtn" type="button">去开启适配</button>
      </div>
      <div class="muted">国行华为无 Google GMS，杀后台后纯网页标准 Push 易丢包。建议开启「华为网页哨兵模式」或填写微信 PushPlus 兜底，确保开票必达。</div>
    `;
    document.getElementById('bannerGoHuaweiBtn').onclick = () => {
      appState.tab = 'settings';
      render();
    };
    return;
  }

  el.className = 'banner hidden';
  el.innerHTML = '';
}

function renderTopStatus() {
  const pub = appState.publicState;
  const dot = document.getElementById('brandDot');
  const sub = document.getElementById('subMeta');
  const pill = document.getElementById('statusPill');
  const riskEl = document.getElementById('riskBanner');

  const activeCount = getEffectiveWatchlist().filter((w) => w.active !== false).length;
  const lastTick = pub?.lastTickAt ? formatRelTime(pub.lastTickAt) : '尚未触发';

  sub.textContent = `3家东莞影院 · 最近巡检 ${lastTick} · 星标 ${activeCount} 部`;

  if (pub?.riskControl?.active) {
    dot.className = 'brand-dot cooldown';
    pill.className = 'status-pill danger';
    pill.textContent = '风控冷却中';
    riskEl.className = 'banner danger';
    riskEl.innerHTML = `
      <div class="banner-title">⚠️ 猫眼风控自动熔断冷却中</div>
      <div>原因：${escapeHtml(pub.riskControl.lastReason || '疑似滑块拦截')} · 预计恢复：${escapeHtml(formatRelTime(pub.riskControl.cooldownUntil))}（可在设置里切换「轮转抓1家」降低请求密度）</div>
    `;
  } else {
    riskEl.className = 'banner hidden';
    if (appState.privateState?.settings?.paused) {
      dot.className = 'brand-dot';
      pill.className = 'status-pill warn';
      pill.textContent = '已手动暂停';
    } else if (activeCount > 0) {
      dot.className = 'brand-dot watching';
      pill.className = 'status-pill ok';
      pill.textContent = `盯票中 (${activeCount})`;
    } else {
      dot.className = 'brand-dot';
      pill.className = 'status-pill';
      pill.textContent = pub ? '待机省流' : '待初始化';
    }
  }
}

function renderRadarTab(root) {
  const watchlist = getEffectiveWatchlist();
  const activeItems = watchlist.filter((w) => w.active !== false);
  const stoppedItems = watchlist.filter((w) => w.active === false);
  const alerts = getEffectiveAlerts();

  const totalShows = Object.values(appState.publicState?.cinemas || {}).reduce(
    (acc, c) => acc + (c.movies || []).reduce((mSum, m) => mSum + (m.showCount || 0), 0),
    0
  );

  root.innerHTML = `
    <div class="stats-grid">
      <div class="stat-tile">
        <div class="stat-val">${activeItems.length}</div>
        <div class="stat-lbl">星标盯票中</div>
      </div>
      <div class="stat-tile">
        <div class="stat-val">${totalShows}</div>
        <div class="stat-lbl">三影院在售场次</div>
      </div>
      <div class="stat-tile">
        <div class="stat-val">${alerts.length}</div>
        <div class="stat-lbl">已捕获开票波次</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">快速星标电影（支持未定档片名）</div>
          <div class="muted">输入片名关键词（如「阿凡达」「星际穿越」）即可开始每轮追踪</div>
        </div>
        <button class="btn btn-primary btn-sm" id="manualTickBtn" type="button">立即抓一次</button>
      </div>
      <div class="row">
        <input id="quickKeywordInput" class="input" style="flex:1" placeholder="输入电影名关键词，或从「新片片单」一键星标" />
        <button class="btn btn-gold" id="quickStarBtn" type="button">★ 星标</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">★ 正在持续盯票（${activeItems.length}）</div>
        <button class="btn btn-sm" id="refreshBtn" type="button">刷新状态</button>
      </div>
      ${
        activeItems.length === 0
          ? `<div class="muted" style="padding:10px 0">当前没有星标电影。请去「三家影院」或「新片片单」点击 ★ 星标，或在上方直接输入片名。无星标时后台自动进入 0 风控休眠模式。</div>`
          : activeItems
              .map((w) => {
                const matches = findCurrentMovieMatchesAcrossCinemas(w);
                const summaryHtml =
                  matches.length === 0
                    ? `<div class="muted" style="margin-top:6px">暂未在三家影院发现排片，后台每轮 Cron 持续盯梢中...</div>`
                    : matches
                        .map(({ cinema, movie }) => {
                          const specialCount = (movie.shows || []).filter((s) => s.isSpecial).length;
                          return `<div class="muted" style="margin-top:4px">• <strong>${escapeHtml(cinema.shortName)}</strong>：当前 ${movie.showCount} 场${specialCount > 0 ? `（含 ${specialCount} 场特殊厅）` : ''}</div>`;
                        })
                        .join('');
                return `
                  <div class="card" style="background:rgba(255,255,255,0.03);margin-bottom:10px">
                    <div class="movie-card">
                      ${
                        w.poster
                          ? `<img class="poster" src="${escapeHtml(w.poster)}" alt="" loading="lazy" />`
                          : `<div class="poster-placeholder">🎞️</div>`
                      }
                      <div class="movie-body">
                        <div class="row-between">
                          <div class="movie-name clickable-title open-detail-trigger" data-mid="${w.movieId || ''}" data-title="${escapeHtml(w.title || w.keyword)}" data-poster="${escapeHtml(w.poster || '')}">${escapeHtml(w.title || w.keyword)}</div>
                          <span class="badge badge-imax">已推 ${w.roundCount || 0} 轮</span>
                        </div>
                        <div class="row" style="margin-bottom:4px">
                          <span class="badge badge-gt">${escapeHtml(hallFilterLabel(w.hallFilter))}</span>
                          ${w.lastAlertAt ? `<span class="muted">上次提醒 ${formatRelTime(w.lastAlertAt)}</span>` : ''}
                        </div>
                        ${summaryHtml}
                        <div class="row" style="margin-top:10px">
                          <button class="btn btn-danger btn-sm stop-watch-btn" data-id="${escapeHtml(w.id)}" type="button">手动停止提醒</button>
                        </div>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')
      }
    </div>

    ${
      stoppedItems.length > 0
        ? `<div class="card">
            <div class="card-header"><div class="card-title">已手动停止（${stoppedItems.length}）</div></div>
            ${stoppedItems
              .map(
                (w) => `
              <div class="row-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
                <div>
                  <div style="font-weight:600">${escapeHtml(w.title || w.keyword)}</div>
                  <div class="muted">历史提醒 ${w.roundCount || 0} 轮 · ${escapeHtml(hallFilterLabel(w.hallFilter))}</div>
                </div>
                <div class="row">
                  <button class="btn btn-sm resume-watch-btn" data-id="${escapeHtml(w.id)}" type="button">恢复盯票</button>
                  <button class="btn btn-danger btn-sm del-watch-btn" data-id="${escapeHtml(w.id)}" type="button">删除</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>`
        : ''
    }

    <div class="card">
      <div class="card-header">
        <div class="card-title">📣 每一轮开票播报历史</div>
        <span class="muted">一轮合并一条</span>
      </div>
      ${
        alerts.length === 0
          ? `<div class="muted" style="padding:8px 0">暂无播报记录。当星标电影新开售场次时，这里会完整记录每一轮详情。</div>`
          : alerts
              .slice(0, 15)
              .map(
                (a) => `
              <div style="padding:10px 0;border-bottom:1px solid var(--border)">
                <div class="row-between">
                  <strong style="font-size:13px">${escapeHtml(a.title)}</strong>
                  <span class="muted">${formatRelTime(a.createdAt)}</span>
                </div>
                <div class="muted" style="white-space:pre-line;margin-top:4px">${escapeHtml((a.lines || []).join('\n'))}</div>
              </div>
            `
              )
              .join('')
      }
    </div>
  `;

  document.getElementById('refreshBtn').onclick = () => syncAllData();
  document.getElementById('manualTickBtn').onclick = async () => {
    try {
      await triggerWorkflow('tick');
      showToast('已派发 GitHub Actions 立即抓取一次，约 15-25 秒后自动刷新');
      setTimeout(() => syncAllData({ silent: true }), 22000);
    } catch (err) {
      showToast(err.message);
    }
  };

  document.getElementById('quickStarBtn').onclick = () => {
    const kw = document.getElementById('quickKeywordInput').value.trim();
    if (!kw) {
      showToast('请输入电影名称关键词');
      return;
    }
    openStarModal({ keyword: kw, title: kw });
  };

  root.querySelectorAll('.stop-watch-btn').forEach((btn) => {
    btn.onclick = () => toggleWatchActive(btn.dataset.id, false);
  });
  root.querySelectorAll('.resume-watch-btn').forEach((btn) => {
    btn.onclick = () => toggleWatchActive(btn.dataset.id, true);
  });
  root.querySelectorAll('.del-watch-btn').forEach((btn) => {
    btn.onclick = () => removeWatchItem(btn.dataset.id);
  });
  root.querySelectorAll('.open-detail-trigger').forEach((el) => {
    el.onclick = () =>
      openMovieDetailModal({
        movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
        title: el.dataset.title,
        poster: el.dataset.poster
      });
  });
}

function renderCinemasTab(root) {
  const cinemaData = appState.publicState?.cinemas?.[String(appState.activeCinemaId)];
  const movies = cinemaData?.movies || [];

  const allDates = Array.from(
    new Set(movies.flatMap((m) => (m.shows || []).map((s) => s.dt)).filter(Boolean))
  ).sort();

  if (appState.activeDateFilter !== 'all' && !allDates.includes(appState.activeDateFilter)) {
    appState.activeDateFilter = 'all';
  }

  const watchlist = getEffectiveWatchlist();

  root.innerHTML = `
    <div class="pill-group">
      ${CINEMAS.map(
        (c) => `
        <button class="chip ${appState.activeCinemaId === c.id ? 'active' : ''}" data-cid="${c.id}" type="button">
          ${escapeHtml(c.shortName)}
        </button>
      `
      ).join('')}
    </div>

    <div class="card" style="padding:10px 14px">
      <div class="row-between">
        <div>
          <div style="font-weight:700;font-size:14px">${escapeHtml(CINEMAS.find((c) => c.id === appState.activeCinemaId)?.name)}</div>
          <div class="muted">更新于 ${escapeHtml(formatRelTime(cinemaData?.fetchedAt))} · 在售影片 ${movies.length} 部</div>
        </div>
        <button class="btn btn-sm" id="specialToggleBtn" type="button">
          ${appState.specialHallOnly ? '✨ 仅看特殊厅' : '全部影厅'}
        </button>
      </div>
      ${
        allDates.length > 0
          ? `<div class="pill-group" style="margin-top:10px;margin-bottom:0">
              <button class="chip ${appState.activeDateFilter === 'all' ? 'active' : ''}" data-dt="all" type="button">全部日期</button>
              ${allDates
                .map(
                  (dt) => `<button class="chip ${appState.activeDateFilter === dt ? 'active' : ''}" data-dt="${escapeHtml(dt)}" type="button">${escapeHtml(dt.slice(5))}</button>`
                )
                .join('')}
            </div>`
          : ''
      }
    </div>

    ${
      movies.length === 0
        ? `<div class="card"><div class="muted">暂无排片缓存，请前往「提醒与设置」配置后点「立即抓一次」，或稍等 Cron 首轮抓取完成。</div></div>`
        : movies
            .map((m) => {
              const filteredShows = (m.shows || []).filter((s) => {
                if (appState.activeDateFilter !== 'all' && s.dt !== appState.activeDateFilter) return false;
                if (appState.specialHallOnly && !s.isSpecial) return false;
                return true;
              });
              if (appState.specialHallOnly && filteredShows.length === 0) return '';

              const isStarred = watchlist.some(
                (w) =>
                  w.active !== false &&
                  ((w.movieId && Number(w.movieId) === Number(m.id)) ||
                    (w.keyword && m.nm.toLowerCase().includes(w.keyword.toLowerCase())))
              );

              return `
                <div class="card">
                  <div class="movie-card">
                    ${
                      m.img
                        ? `<img class="poster" src="${escapeHtml(m.img)}" alt="" loading="lazy" />`
                        : `<div class="poster-placeholder">🎬</div>`
                    }
                    <div class="movie-body">
                      <div class="row-between">
                        <div class="movie-name clickable-title open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">${escapeHtml(m.nm)}</div>
                        <button class="btn btn-sm ${isStarred ? 'btn-gold' : ''} star-movie-btn"
                          data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}" type="button">
                          ${isStarred ? '★ 已星标' : '☆ 星标'}
                        </button>
                      </div>
                      <div class="muted">${escapeHtml(m.desc || '')}</div>
                      <div class="showtime-grid">
                        ${filteredShows
                          .slice(0, 18)
                          .map(
                            (s) => `
                          <div class="showtime-box ${s.isImaxGt ? 'gt' : s.isSpecial ? 'special' : ''}">
                            <div class="row-between">
                              <span class="showtime-tm">${escapeHtml(s.tm)}</span>
                              ${s.tags?.length ? `<span class="badge ${s.isImaxGt ? 'badge-gt' : 'badge-imax'}">${escapeHtml(s.tags[0])}</span>` : `<span class="muted">${escapeHtml(s.tp)}</span>`}
                            </div>
                            <div class="showtime-hall">${escapeHtml(s.dt.slice(5))} · ${escapeHtml(s.th)}</div>
                          </div>
                        `
                          )
                          .join('')}
                      </div>
                      ${filteredShows.length > 18 ? `<div class="muted" style="margin-top:6px">仅展示前 18 场，共 ${filteredShows.length} 场</div>` : ''}
                    </div>
                  </div>
                </div>
              `;
            })
            .join('')
    }
  `;

  root.querySelectorAll('[data-cid]').forEach((btn) => {
    btn.onclick = () => {
      appState.activeCinemaId = Number(btn.dataset.cid);
      render();
    };
  });
  root.querySelectorAll('[data-dt]').forEach((btn) => {
    btn.onclick = () => {
      appState.activeDateFilter = btn.dataset.dt;
      render();
    };
  });
  document.getElementById('specialToggleBtn').onclick = () => {
    appState.specialHallOnly = !appState.specialHallOnly;
    render();
  };
  root.querySelectorAll('.star-movie-btn').forEach((btn) => {
    btn.onclick = () =>
      openStarModal({
        movieId: Number(btn.dataset.mid),
        title: btn.dataset.title,
        poster: btn.dataset.poster
      });
  });
  root.querySelectorAll('.open-detail-trigger').forEach((el) => {
    el.onclick = () =>
      openMovieDetailModal({
        movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
        title: el.dataset.title,
        poster: el.dataset.poster
      });
  });
}

function renderDynamicsTab(root) {
  const dynamics = appState.publicState?.dynamics || [];
  const filtered =
    appState.dynamicsFilter === 'all'
      ? dynamics
      : dynamics.filter((d) => d.type === appState.dynamicsFilter);
  const watchlist = getEffectiveWatchlist();
  const lastCatSync = appState.publicState?.lastCatalogSyncAt ? formatRelTime(appState.publicState.lastCatalogSyncAt) : '尚未同步';

  root.innerHTML = `
    <div class="card">
      <div class="row-between" style="margin-bottom:8px">
        <div>
          <div class="card-title">🔥 新片全网动态（定档 / 开票 / 改档 / 开分）</div>
          <div class="muted">每 15 分钟自动巡检全量新片与豆瓣/IMDb/烂番茄开分 · 上次同步 ${escapeHtml(lastCatSync)}</div>
        </div>
        <button class="btn btn-primary btn-sm" id="dynSyncBtn" type="button">立即全量刷新</button>
      </div>
      <div class="pill-group" style="margin-bottom:0">
        <button class="chip ${appState.dynamicsFilter === 'all' ? 'active' : ''}" data-df="all" type="button">全部 (${dynamics.length})</button>
        <button class="chip ${appState.dynamicsFilter === 'scheduled' ? 'active' : ''}" data-df="scheduled" type="button">定档</button>
        <button class="chip ${appState.dynamicsFilter === 'presale_opened' ? 'active' : ''}" data-df="presale_opened" type="button">开票</button>
        <button class="chip ${appState.dynamicsFilter === 'rescheduled' ? 'active' : ''}" data-df="rescheduled" type="button">改档</button>
        <button class="chip ${appState.dynamicsFilter === 'scored' ? 'active' : ''}" data-df="scored" type="button">开分</button>
      </div>
    </div>

    ${
      filtered.length === 0
        ? `<div class="card"><div class="muted" style="padding:10px 0">暂无新动态记录。全量片单建立基线后，每当任何新电影出现定档、开票、改档或猫眼/豆瓣/IMDb/烂番茄开分时，这里会立即记录并推送提醒！可点右上角「立即全量刷新」触发一次同步。</div></div>`
        : filtered
            .map((d) => {
              const isStarred = watchlist.some(
                (w) => w.active !== false && Number(w.movieId) === Number(d.movieId)
              );
              return `
                <div class="card">
                  <div class="movie-card">
                    ${
                      d.poster
                        ? `<img class="poster open-detail-trigger" data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster)}" src="${escapeHtml(d.poster)}" alt="" loading="lazy" />`
                        : `<div class="poster-placeholder">🔥</div>`
                    }
                    <div class="movie-body">
                      <div class="row-between">
                        <div class="row" style="gap:6px">
                          <span class="badge dyn-${escapeHtml(d.type)}">${escapeHtml(d.typeLabel)}</span>
                          <span class="movie-name clickable-title open-detail-trigger" style="margin:0" data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster || '')}">${escapeHtml(d.title)}</span>
                        </div>
                        <button class="btn btn-sm ${isStarred ? 'btn-gold' : ''} star-dyn-btn"
                          data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster || '')}" type="button">
                          ${isStarred ? '★ 已星标' : '☆ 星标'}
                        </button>
                      </div>
                      <div style="margin-top:6px;font-size:13px;font-weight:600">${escapeHtml(d.summary)}</div>
                      <div class="row-between" style="margin-top:4px">
                        <span class="muted">${escapeHtml(d.detail || '')}</span>
                        <span class="muted">${escapeHtml(formatRelTime(d.createdAt))}</span>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            })
            .join('')
    }
  `;

  root.querySelectorAll('[data-df]').forEach((btn) => {
    btn.onclick = () => {
      appState.dynamicsFilter = btn.dataset.df;
      render();
    };
  });
  document.getElementById('dynSyncBtn').onclick = async () => {
    try {
      await triggerWorkflow('refresh_catalog');
      showToast('已派发全量片单与开分巡检，约 25 秒后同步');
      setTimeout(() => syncAllData({ silent: true }), 26000);
    } catch (err) {
      showToast(err.message);
    }
  };
  root.querySelectorAll('.star-dyn-btn').forEach((btn) => {
    btn.onclick = () =>
      openStarModal({
        movieId: btn.dataset.mid ? Number(btn.dataset.mid) : null,
        title: btn.dataset.title,
        poster: btn.dataset.poster
      });
  });
  root.querySelectorAll('.open-detail-trigger').forEach((el) => {
    el.onclick = () =>
      openMovieDetailModal({
        movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
        title: el.dataset.title,
        poster: el.dataset.poster
      });
  });
}

function renderCatalogTab(root) {
  const cat = appState.publicState?.catalog || { onInfo: [], coming: [] };
  const intelMap = appState.publicState?.intel || {};
  const comingList = cat.coming || [];
  const onInfoList = cat.onInfo || [];

  let list = [];
  if (appState.catalogTab === 'coming') {
    list = comingList;
  } else if (appState.catalogTab === 'onInfo') {
    list = onInfoList;
  } else if (appState.catalogTab === 'wish_total') {
    list = [...getAllCatalogMovies()].sort((a, b) => Number(b.wish || 0) - Number(a.wish || 0));
  } else {
    list = [...getAllCatalogMovies()].sort((a, b) => {
      const diff = Number(b.wishDailyGain || 0) - Number(a.wishDailyGain || 0);
      return diff !== 0 ? diff : Number(b.wish || 0) - Number(a.wish || 0);
    });
  }

  const kw = appState.catalogSearch.trim().toLowerCase();
  const filtered = kw ? list.filter((m) => String(m.nm || '').toLowerCase().includes(kw)) : list;
  const watchlist = getEffectiveWatchlist();
  const isRankMode = appState.catalogTab === 'wish_total' || appState.catalogTab === 'wish_daily';

  root.innerHTML = `
    <div class="card">
      <div class="row-between" style="margin-bottom:8px">
        <div class="muted">全量片单共 ${comingList.length + onInfoList.length} 部（每15分钟自动更新；点片名看四平台评分与淘票票对比）</div>
        <button class="btn btn-sm" id="syncCatalogBtn" type="button">刷新片单</button>
      </div>
      <div class="pill-group" style="margin-bottom:10px">
        <button class="chip ${appState.catalogTab === 'coming' ? 'active' : ''}" data-ctab="coming" type="button">即将上映 (${comingList.length})</button>
        <button class="chip ${appState.catalogTab === 'onInfo' ? 'active' : ''}" data-ctab="onInfo" type="button">正在热映 (${onInfoList.length})</button>
        <button class="chip ${appState.catalogTab === 'wish_total' ? 'active' : ''}" data-ctab="wish_total" type="button">📈 想看总榜</button>
        <button class="chip ${appState.catalogTab === 'wish_daily' ? 'active' : ''}" data-ctab="wish_daily" type="button">🚀 日增排名</button>
      </div>
      <input id="catalogSearchInput" class="input" value="${escapeHtml(appState.catalogSearch)}" placeholder="筛选片名（没找到可在「盯票」页输关键词）" />
    </div>

    ${
      filtered.length === 0
        ? `<div class="card"><div class="muted">暂无匹配片单。你可以直接切换到「盯票」页用关键词手动星标，或点击「刷新片单」。</div></div>`
        : filtered
            .map((m, idx) => {
              const isStarred = watchlist.some(
                (w) => w.active !== false && Number(w.movieId) === Number(m.id)
              );
              const hasImax = /imax/i.test(m.version || '');
              const intel = intelMap[String(m.id)] || {};
              const maoyanSc = Number(intel.maoyanScore || m.sc || 0);
              const scorePills = [
                maoyanSc > 0 ? `猫眼 ${maoyanSc}` : '',
                intel.doubanScore > 0 ? `豆瓣 ${intel.doubanScore}` : '',
                intel.imdbScore > 0 ? `IMDb ${intel.imdbScore}` : '',
                intel.rtCriticsScore !== null && intel.rtCriticsScore !== undefined ? `烂番茄 ${intel.rtCriticsScore}%` : ''
              ].filter(Boolean);

              return `
                <div class="card">
                  <div class="movie-card">
                    ${
                      m.img
                        ? `<img class="poster open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img)}" src="${escapeHtml(m.img)}" alt="" loading="lazy" />`
                        : `<div class="poster-placeholder">🍿</div>`
                    }
                    <div class="movie-body">
                      <div class="row-between">
                        <div class="row" style="gap:6px;min-width:0;flex:1">
                          ${isRankMode ? `<span class="rank-num ${idx < 3 ? 'top3' : ''}">#${idx + 1}</span>` : ''}
                          <div class="movie-name clickable-title open-detail-trigger" style="margin:0" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">${escapeHtml(m.nm)}</div>
                        </div>
                        <button class="btn btn-sm ${isStarred ? 'btn-gold' : 'btn-primary'} star-cat-btn"
                          data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}" type="button">
                          ${isStarred ? '★ 已星标' : '★ 星标'}
                        </button>
                      </div>
                      <div class="row" style="margin:5px 0">
                        <span class="badge badge-normal">${escapeHtml(m.statusLabel || '')}</span>
                        ${hasImax ? `<span class="badge badge-imax">IMAX</span>` : ''}
                        <span class="badge badge-gt">想看 ${formatWishCount(m.wish)}</span>
                        ${Number(m.wishDailyGain || 0) > 0 ? `<span class="badge dyn-presale_opened">今日 +${Number(m.wishDailyGain).toLocaleString('zh-CN')}</span>` : ''}
                        ${m.rt ? `<span class="muted">${escapeHtml(m.rt)}</span>` : ''}
                      </div>
                      ${scorePills.length > 0 ? `<div class="muted" style="color:#ddd6fe;margin-bottom:2px">⭐ ${escapeHtml(scorePills.join(' · '))}</div>` : ''}
                      <div class="muted">${escapeHtml(m.star || '')}</div>
                    </div>
                  </div>
                </div>
              `;
            })
            .join('')
    }
  `;

  root.querySelectorAll('[data-ctab]').forEach((btn) => {
    btn.onclick = () => {
      appState.catalogTab = btn.dataset.ctab;
      render();
    };
  });
  document.getElementById('catalogSearchInput').oninput = (e) => {
    appState.catalogSearch = e.target.value;
    render();
    const inp = document.getElementById('catalogSearchInput');
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  };
  document.getElementById('syncCatalogBtn').onclick = async () => {
    try {
      await triggerWorkflow('refresh_catalog');
      showToast('已派发全量刷新片单与想看排行，约 25 秒后同步');
      setTimeout(() => syncAllData({ silent: true }), 26000);
    } catch (err) {
      showToast(err.message);
    }
  };
  root.querySelectorAll('.star-cat-btn').forEach((btn) => {
    btn.onclick = () =>
      openStarModal({
        movieId: Number(btn.dataset.mid),
        title: btn.dataset.title,
        poster: btn.dataset.poster
      });
  });
  root.querySelectorAll('.open-detail-trigger').forEach((el) => {
    el.onclick = () =>
      openMovieDetailModal({
        movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
        title: el.dataset.title,
        poster: el.dataset.poster
      });
  });
}

function renderSettingsTab(root) {
  const plat = detectPlatform();
  const cfg = appState.config;
  const wh = appState.privateState?.webhooks || {};
  const st = appState.privateState?.settings || {};
  const subs = appState.privateState?.subscriptions || [];
  const vapidPub = getEffectiveVapidPublicKey();
  const workflowDispatchUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/actions/workflows/monitor.yml/dispatches`;

  root.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">1. 本机 Web App 推送（iPhone & 华为）</div>
          <div class="muted">当前环境：${
            plat.isIOS
              ? plat.isStandalone
                ? 'iPhone PWA 主屏幕模式 (支持 APNs 锁屏直推)'
                : 'iPhone Safari 浏览器（请先添加到主屏幕）'
              : plat.isHuawei
                ? '华为 / 鸿蒙浏览器（建议配合下方哨兵或微信兜底）'
                : '桌面 / 其他移动浏览器'
          } · 已绑定设备数：${subs.length}</div>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary" id="subWebPushBtn" type="button">
          ${appState.pushSub ? '🔄 重新订阅本机 Web Push' : '🔔 开启本机 Web App 推送'}
        </button>
        <button class="btn" id="testSoundBtn" type="button">🔊 测试提示音</button>
        <button class="btn" id="testRemotePushBtn" type="button">🚀 全通道测试推送</button>
      </div>
      ${
        subs.length > 0
          ? `<div class="muted" style="margin-top:8px">已订阅设备：${subs.map((s) => `${escapeHtml(s.deviceLabel)}`).join('、')}</div>`
          : ''
      }
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">2. 华为适配：网页哨兵保活 & 微信/飞书兜底</div>
          <div class="muted">国行华为无 Google GMS，浏览器被杀后台时标准 Web Push 无法唤醒；开启下面任意一项即可 100% 不漏票</div>
        </div>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn ${appState.sentinel.enabled ? 'btn-gold' : ''}" id="toggleSentinelBtn" type="button">
          ${appState.sentinel.enabled ? '✅ 网页哨兵巡检中 (45s)' : '🛡️ 开启华为网页哨兵模式'}
        </button>
        <button class="btn ${appState.sentinel.keepAwake ? 'btn-primary' : ''}" id="toggleWakeLockBtn" type="button">
          ${appState.sentinel.keepAwake ? '☀️ 防息屏已开启' : '防息屏常亮'}
        </button>
      </div>
      <div class="muted" style="margin-bottom:12px">
        华为手机设置建议：在华为浏览器点右上角菜单「添加到桌面」，并在手机「设置 → 应用 → 耗电管理」改为手动管理（允许后台活动），开着页面放后台也不易被清。
      </div>

      <div class="field">
        <label>PushPlus Token（强烈推荐给华为朋友：微信扫码即收，完全免翻墙/不杀后台）</label>
        <input id="whPushplus" class="input" value="${escapeHtml(wh.pushplusToken || '')}" placeholder="在 pushplus.plus 微信扫码获取 token" />
      </div>
      <div class="field">
        <label>企业微信群机器人 Webhook（可选）</label>
        <input id="whWecom" class="input" value="${escapeHtml(wh.wecomWebhook || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
      </div>
      <div class="field">
        <label>飞书 / 钉钉群机器人 Webhook（可选）</label>
        <input id="whFeishu" class="input" value="${escapeHtml(wh.feishuWebhook || '')}" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
      </div>
      <div class="field">
        <label>钉钉 Webhook（可选）</label>
        <input id="whDingtalk" class="input" value="${escapeHtml(wh.dingtalkWebhook || '')}" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
      </div>
      <div class="field">
        <label>Bark 推送链接（可选，iPhone 备用强响铃）</label>
        <input id="whBark" class="input" value="${escapeHtml(wh.barkUrl || '')}" placeholder="https://api.day.app/你的Key/" />
      </div>
      <button class="btn btn-primary" id="saveWebhooksBtn" type="button">保存国内兜底推送通道</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">3. 猫眼抓取频率、风控与动态推送范围</div>
          <div class="muted">盯票场次：随 cron-job.org 每 1~2 分钟抓 3 家影院（无星标自动降频）；全量片单/想看/豆瓣/IMDb/烂番茄开分：每 15 分钟自动更新</div>
        </div>
      </div>
      <div class="field">
        <label>新电影动态推送（定档 / 开票 / 改档 / 开分）</label>
        <select id="settingNotifyDynamics" class="select">
          <option value="true" ${st.notifyAllDynamics !== false ? 'selected' : ''}>全部新电影都推送动态（同时包含星标电影的每轮开票）</option>
          <option value="false" ${st.notifyAllDynamics === false ? 'selected' : ''}>仅推送我星标电影的动态与开票</option>
        </select>
      </div>
      <div class="field">
        <label>影院抓取节奏模式（无星标电影时均自动休眠 0 请求）</label>
        <select id="settingRotateMode" class="select">
          <option value="all" ${st.rotateMode !== 'round_robin' ? 'selected' : ''}>标准错峰：每次 Cron 随机间隔依次抓 3 家影院</option>
          <option value="round_robin" ${st.rotateMode === 'round_robin' ? 'selected' : ''}>极限防风控轮转：每次 Cron 只抓 1 家（单 IP 密度降为 1/3）</option>
        </select>
      </div>
      <div class="field">
        <label>全局总开关</label>
        <select id="settingPaused" class="select">
          <option value="false" ${!st.paused ? 'selected' : ''}>正常监听（有星标电影时执行 Cron 抓取）</option>
          <option value="true" ${st.paused ? 'selected' : ''}>手动暂停所有抓取（零请求猫眼）</option>
        </select>
      </div>
      <div class="field">
        <label>可选自定义猫眼 Cookie（仅在触发风控且自动冷却仍不过时才需补充）</label>
        <textarea id="settingCookie" class="textarea" placeholder="留空即可；如需填入则仅保存在你的私有 Gist">${escapeHtml(st.maoyanCookie || '')}</textarea>
      </div>
      <button class="btn btn-primary" id="saveSettingsBtn" type="button">保存防风控策略</button>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">4. GitHub 配对 & 朋友一键分享</div>
          <div class="muted">支持直接粘贴配对链接，或手动填写 Token 与私有 Gist ID</div>
        </div>
      </div>
      <div class="field">
        <label>快速导入（把 PAIR_URL.txt 里的 #pair= 链接整条贴进来即可）</label>
        <div class="row">
          <input id="quickPairUrlInput" class="input" style="flex:1" placeholder="https://...#pair=..." />
          <button class="btn btn-gold btn-sm" id="importPairUrlBtn" type="button">一键导入</button>
        </div>
      </div>
      <div class="row" style="gap:8px">
        <div class="field" style="flex:1;min-width:130px">
          <label>GitHub 用户名</label>
          <input id="cfgOwner" class="input" value="${escapeHtml(cfg.owner)}" />
        </div>
        <div class="field" style="flex:1;min-width:140px">
          <label>仓库名</label>
          <input id="cfgRepo" class="input" value="${escapeHtml(cfg.repo)}" />
        </div>
      </div>
      <div class="field">
        <label>GitHub PAT（ghp_... 或 github_pat_...，仅存本机浏览器）</label>
        <input id="cfgToken" type="password" class="input" value="${escapeHtml(cfg.token)}" placeholder="ghp_... 或 github_pat_..." />
      </div>
      <div class="field">
        <label>私有 Gist ID（填入已有 ID，或填好上方 Token 后点一键创建）</label>
        <div class="row">
          <input id="cfgGistId" class="input" style="flex:1" value="${escapeHtml(cfg.gistId)}" placeholder="32位私有 Gist ID" />
          <button class="btn btn-gold btn-sm" id="autoCreateGistBtn" type="button">一键创建私有 Gist</button>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-primary" id="savePairingBtn" type="button">保存配对并同步</button>
        <button class="btn" id="sharePairLinkBtn" type="button">🔗 生成朋友专属配对链接</button>
      </div>
      ${
        appState.pairingFeedback
          ? `<div class="muted" style="margin-top:8px;color:${appState.pairingFeedback.ok ? 'var(--green)' : 'var(--red)'}">${escapeHtml(appState.pairingFeedback.text)}</div>`
          : isPaired()
            ? `<div class="muted" style="margin-top:8px;color:var(--green)">已填写配对信息（Gist: ${escapeHtml(cfg.gistId.slice(0, 8))}...，当前已订阅设备 ${subs.length} 台）</div>`
            : `<div class="muted" style="margin-top:8px">尚未完成配对：请先粘贴上方配对链接，或填写 Token 与 Gist ID。</div>`
      }
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">5. VAPID 密钥 & cron-job.org 每分钟配置</div>
          <div class="muted">把下方 4 个 Secrets 填到 GitHub 仓库 Settings → Secrets and variables → Actions</div>
        </div>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn-sm btn-primary" id="genVapidBtn" type="button">🔑 在本机生成一对 VAPID 密钥</button>
        ${vapidPub ? `<button class="btn btn-sm" id="copyVapidPubBtn" type="button">复制公钥</button>` : ''}
        ${appState.generatedVapid?.privateKey ? `<button class="btn btn-sm" id="copyVapidPrivBtn" type="button">复制私钥</button>` : ''}
      </div>
      ${
        vapidPub
          ? `<div class="code-box" style="margin-bottom:10px">VAPID_PUBLIC_KEY = ${escapeHtml(vapidPub)}${
              appState.generatedVapid?.privateKey
                ? `\nVAPID_PRIVATE_KEY = ${escapeHtml(appState.generatedVapid.privateKey)}`
                : '\n(私钥已配置在 GitHub Secrets 中)'
            }\nRADAR_GIST_ID = ${escapeHtml(cfg.gistId || '请先创建私有 Gist')}\nRADAR_GH_TOKEN = 你的 Fine-Grained PAT</div>`
          : ''
      }
      <div class="muted" style="margin-bottom:6px"><strong>cron-job.org 配置参数（建议设每 1 分钟或每 2 分钟）：</strong></div>
      <div class="code-box">URL: ${escapeHtml(workflowDispatchUrl)}
Method: POST
Schedule: * * * * *  (每1分钟) 或 */2 * * * * (每2分钟)
Headers:
  Accept: application/vnd.github+json
  Authorization: Bearer 你的_GITHUB_PAT
  X-GitHub-Api-Version: 2022-11-28
  Content-Type: application/json
Body (Raw JSON):
  {"ref":"main","inputs":{"mode":"tick"}}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-sm" id="copyCronUrlBtn" type="button">复制 URL</button>
        <button class="btn btn-sm" id="copyCronBodyBtn" type="button">复制 JSON Body</button>
      </div>
    </div>
  `;

  document.getElementById('subWebPushBtn').onclick = subscribeDeviceWebPush;
  document.getElementById('testSoundBtn').onclick = () => {
    playSentinelChime();
    fireLocalNotification('🎬 测试本地提醒', '如果你能看到弹窗并听到提示音，说明华为/本机哨兵提示正常！');
  };
  document.getElementById('testRemotePushBtn').onclick = async () => {
    try {
      await triggerWorkflow('test_push');
      showToast('已触发全通道测试推送，请留意手机通知约 15 秒内送达');
    } catch (err) {
      showToast(err.message);
    }
  };

  document.getElementById('toggleSentinelBtn').onclick = () => {
    const next = !appState.sentinel.enabled;
    saveSentinelConfig({ enabled: next });
    startOrStopSentinelTimer();
    if (next) {
      playSentinelChime();
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      showToast('华为网页哨兵模式已开启（每45秒巡检并响铃通知）');
    } else {
      showToast('已关闭网页哨兵');
    }
    render();
  };

  document.getElementById('toggleWakeLockBtn').onclick = async () => {
    const next = !appState.sentinel.keepAwake;
    saveSentinelConfig({ keepAwake: next });
    await toggleWakeLock(next);
    showToast(next ? '已请求屏幕防息屏常亮' : '已关闭防息屏');
    render();
  };

  document.getElementById('saveWebhooksBtn').onclick = async () => {
    try {
      const nextWh = {
        pushplusToken: document.getElementById('whPushplus').value.trim(),
        wecomWebhook: document.getElementById('whWecom').value.trim(),
        feishuWebhook: document.getElementById('whFeishu').value.trim(),
        dingtalkWebhook: document.getElementById('whDingtalk').value.trim(),
        barkUrl: document.getElementById('whBark').value.trim()
      };
      await patchGistFiles({ 'webhooks.json': nextWh });
      appState.privateState.webhooks = nextWh;
      showToast('国内兜底推送通道已保存');
    } catch (err) {
      showToast(err.message);
    }
  };

  document.getElementById('saveSettingsBtn').onclick = async () => {
    try {
      const nextSt = {
        ...appState.privateState.settings,
        notifyAllDynamics: document.getElementById('settingNotifyDynamics').value === 'true',
        rotateMode: document.getElementById('settingRotateMode').value,
        paused: document.getElementById('settingPaused').value === 'true',
        maoyanCookie: document.getElementById('settingCookie').value.trim()
      };
      await patchGistFiles({ 'settings.json': nextSt });
      appState.privateState.settings = nextSt;
      showToast('抓取与动态推送策略已保存到私有 Gist');
      render();
    } catch (err) {
      showToast(err.message);
    }
  };

  document.getElementById('autoCreateGistBtn').onclick = async () => {
    const token = document.getElementById('cfgToken').value.trim();
    try {
      const gist = await createPrivateGistWithToken(token);
      document.getElementById('cfgGistId').value = gist.id;
      saveConfig({
        owner: document.getElementById('cfgOwner').value.trim(),
        repo: document.getElementById('cfgRepo').value.trim(),
        token,
        gistId: gist.id
      });
      await syncAllData({ silent: true });
      showToast(`私有 Gist 创建成功: ${gist.id}`);
      render();
    } catch (err) {
      showToast(err.message);
    }
  };

  document.getElementById('importPairUrlBtn').onclick = async () => {
    const raw = document.getElementById('quickPairUrlInput').value.trim();
    if (!raw) {
      showToast('请先粘贴包含 #pair= 的配对链接');
      return;
    }
    const btn = document.getElementById('importPairUrlBtn');
    btn.disabled = true;
    btn.textContent = '导入中...';
    try {
      applyPairingPayload(raw);
      const res = await syncAllData();
      if (res.ok) {
        appState.pairingFeedback = {
          ok: true,
          text: `✅ 导入并同步成功！已连接私有 Gist（星标 ${appState.privateState.watchlist.length} 部，设备 ${appState.privateState.subscriptions.length} 台）`
        };
        showToast('配对链接导入成功！现在可以点顶部开启推送');
        render();
      } else {
        appState.pairingFeedback = { ok: false, text: `❌ 链接已导入但连接 Gist 失败：${res.error}` };
        render();
      }
    } catch (err) {
      appState.pairingFeedback = { ok: false, text: `❌ 链接解析失败：${err.message}` };
      showToast(`导入失败: ${err.message}`);
      render();
    }
  };

  document.getElementById('savePairingBtn').onclick = async () => {
    const owner = document.getElementById('cfgOwner').value.trim() || DEFAULT_REPO_OWNER;
    const repo = document.getElementById('cfgRepo').value.trim() || DEFAULT_REPO_NAME;
    const token = document.getElementById('cfgToken').value.trim();
    const gistId = document.getElementById('cfgGistId').value.trim();

    saveConfig({ owner, repo, token, gistId });

    if (!token || !gistId) {
      appState.pairingFeedback = {
        ok: false,
        text: '❌ 请先填写 GitHub Token 和 私有 Gist ID（或点「一键导入」直接粘贴配对链接）'
      };
      showToast('请先填写 Token 和 私有 Gist ID');
      render();
      return;
    }

    const btn = document.getElementById('savePairingBtn');
    btn.disabled = true;
    btn.textContent = '验证并同步中...';

    const res = await syncAllData();
    if (res.ok) {
      appState.pairingFeedback = {
        ok: true,
        text: `✅ 配对并同步成功！已连接私有 Gist（星标 ${appState.privateState.watchlist.length} 部，设备 ${appState.privateState.subscriptions.length} 台）`
      };
      showToast('配对信息已保存并同步成功');
    } else {
      appState.pairingFeedback = {
        ok: false,
        text: `❌ 已保存到本机，但连接 GitHub Gist 失败：${res.error}`
      };
    }
    render();
  };

  document.getElementById('sharePairLinkBtn').onclick = () => {
    const c = appState.config;
    if (!c.token || !c.gistId) {
      showToast('请先保存 Token 和 Gist ID 再生成配对链接');
      return;
    }
    const payload = {
      owner: c.owner,
      repo: c.repo,
      gistId: c.gistId,
      token: c.token,
      vapidPublicKey: getEffectiveVapidPublicKey()
    };
    const encoded = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const link = `${window.location.origin}${window.location.pathname}#pair=${encoded}`;
    copyText(link, '朋友专属配对链接（请勿公开转发）');
  };

  document.getElementById('genVapidBtn').onclick = async () => {
    appState.generatedVapid = await generateBrowserVapidKeys();
    saveConfig({ vapidPublicKeyOverride: appState.generatedVapid.publicKey });
    showToast('已生成 VAPID 密钥对，请复制到 GitHub Secrets');
    render();
  };

  document.getElementById('copyVapidPubBtn')?.addEventListener('click', () => copyText(vapidPub, 'VAPID 公钥'));
  document.getElementById('copyVapidPrivBtn')?.addEventListener('click', () => copyText(appState.generatedVapid.privateKey, 'VAPID 私钥'));
  document.getElementById('copyCronUrlBtn').onclick = () => copyText(workflowDispatchUrl, 'Cron URL');
  document.getElementById('copyCronBodyBtn').onclick = () => copyText('{"ref":"main","inputs":{"mode":"tick"}}', 'Cron JSON Body');
}

function render({ preserveFocusedSettings = false } = {}) {
  renderTopStatus();
  renderDeviceBanner();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === appState.tab);
  });

  const main = document.getElementById('mainContent');
  if (
    preserveFocusedSettings &&
    appState.tab === 'settings' &&
    document.activeElement &&
    main.contains(document.activeElement) &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
  ) {
    return;
  }

  if (appState.tab === 'radar') renderRadarTab(main);
  else if (appState.tab === 'dynamics') renderDynamicsTab(main);
  else if (appState.tab === 'cinemas') renderCinemasTab(main);
  else if (appState.tab === 'catalog') renderCatalogTab(main);
  else renderSettingsTab(main);
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    appState.swReg = reg;
    if ('pushManager' in reg) {
      appState.pushSub = await reg.pushManager.getSubscription();
    }
  } catch (err) {
    console.warn('ServiceWorker registration failed:', err);
  }
}

function bindNavigation() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.onclick = () => {
      appState.tab = btn.dataset.tab;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
}

async function bootstrap() {
  checkIncomingPairingHash();
  bindNavigation();
  await initServiceWorker();
  render();
  await syncAllData({ silent: true });
  startOrStopSentinelTimer();
  if (appState.sentinel.keepAwake) {
    toggleWakeLock(true);
  }
}

bootstrap();
