const DEFAULT_REPO_OWNER = 'z2vn7g8nhp-beep';
const DEFAULT_REPO_NAME = 'dg-cinema-radar';

const CINEMAS = [
  { id: 1485, shortName: '华南MALL IMAX GT', segName: '华南MALL', segSub: 'IMAX GT', name: '万达影城 · 华南MALL IMAX GT 激光店', badge: 'IMAX GT 1.43:1' },
  { id: 10418, shortName: '东城万达 IMAX', segName: '东城万达', segSub: 'IMAX', name: '万达影城 · 东城万达广场 IMAX 店', badge: 'IMAX' },
  { id: 26100, shortName: '民盈国贸城 CGV', segName: '民盈国贸城', segSub: 'CGV 特效厅', name: 'CGV 影城 · 民盈国贸城店', badge: 'IMAX / 4DX / ScreenX' }
];

const DEFAULT_COUNTDOWN_MOVIE_ID = 1474442; // 复仇者联盟5

const STORAGE_KEYS = {
  config: 'dg_radar_config_v1',
  sentinel: 'dg_radar_sentinel_v1',
  countdown: 'dg_radar_countdown_v1',
  lastSeenAlertId: 'dg_radar_last_alert_id'
};

const appState = {
  tab: 'catalog',
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
    settings: { rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', notifyAllDynamics: false, paused: false },
    alerts: []
  },
  config: loadConfig(),
  sentinel: loadSentinelConfig(),
  countdown: loadCountdownConfig(),
  swReg: null,
  pushSub: null,
  wakeLock: null,
  sentinelTimer: null,
  countdownTimer: null,
  generatedVapid: null,
  pairingFeedback: null,
  incomingWeChatPairLink: '',
  busy: false
};

const SVG_ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16"/><path d="M17 4v16"/><path d="M3 9h4"/><path d="M3 15h4"/><path d="M17 9h4"/><path d="M17 15h4"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>'
};

function icon(name) {
  return `<span class="inline-icon" aria-hidden="true">${SVG_ICONS[name] || ''}</span>`;
}

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
  const isWeChat = /MicroMessenger/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const supportsPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { isIOS, isHuawei, isWeChat, isAndroid, isStandalone, supportsPush };
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

function formatFutureRelTime(iso) {
  if (!iso) return '稍后';
  const diffSec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diffSec <= 15) return '即将恢复';
  if (diffSec < 60) return `约 ${diffSec} 秒后`;
  if (diffSec < 3600) return `约 ${Math.ceil(diffSec / 60)} 分钟后`;
  return `约 ${Math.ceil(diffSec / 3600)} 小时后`;
}

function formatWishCount(n) {
  const num = Number(n || 0);
  if (num <= 0) return '0';
  if (num >= 10000) return `${(num / 10000).toFixed(2)}万`;
  return num.toLocaleString('zh-CN');
}

function pickCountdownMovieMeta(m, intel = {}) {
  if (!m) return null;
  return {
    id: Number(m.id),
    nm: m.nm || '',
    enm: intel.enm || m.enm || '',
    img: m.img || '',
    rt: m.rt || '',
    comingTitle: m.comingTitle || '',
    wish: Number(m.wish || 0),
    wishDailyGain: Number(m.wishDailyGain || 0),
    source: m.source || 'coming'
  };
}

function loadCountdownConfig() {
  const base = { movieId: DEFAULT_COUNTDOWN_MOVIE_ID, customDates: {}, movieMeta: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.countdown) || '{}');
    return {
      movieId: saved.movieId || DEFAULT_COUNTDOWN_MOVIE_ID,
      customDates: saved.customDates && typeof saved.customDates === 'object' ? saved.customDates : {},
      movieMeta: saved.movieMeta && typeof saved.movieMeta === 'object' ? saved.movieMeta : null
    };
  } catch {
    return base;
  }
}

function saveCountdownConfig(next) {
  appState.countdown = {
    ...appState.countdown,
    ...next,
    customDates: { ...(appState.countdown.customDates || {}), ...(next.customDates || {}) },
    movieMeta: next.movieMeta !== undefined ? next.movieMeta : appState.countdown?.movieMeta || null
  };
  localStorage.setItem(STORAGE_KEYS.countdown, JSON.stringify(appState.countdown));
}

function getBeijingTodayStr() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function resolveMovieReleaseDate(movie, intel = {}) {
  if (!movie) return '';
  const custom = appState.countdown?.customDates?.[String(movie.id)];
  if (custom && /^\d{4}-\d{2}-\d{2}$/.test(custom)) return custom;

  const rt = String(movie.rt || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rt)) return rt;

  const origRt = String(intel.origRt || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(origRt) && !/重映/.test(intel.pubDesc || movie.nm || '')) return origRt;

  const pubMatch = String(intel.pubDesc || '').match(/(\d{4}-\d{2}-\d{2})/);
  if (pubMatch) return pubMatch[1];

  const mdMatch = `${movie.comingTitle || ''} ${movie.showInfo || ''}`.match(/(\d{1,2})月(\d{1,2})日/);
  if (mdMatch) {
    const today = getBeijingTodayStr();
    const curYear = Number(today.slice(0, 4));
    const curMmDd = today.slice(5);
    const mm = String(Number(mdMatch[1])).padStart(2, '0');
    const dd = String(Number(mdMatch[2])).padStart(2, '0');
    const year = `${mm}-${dd}` < curMmDd && movie.source === 'coming' ? curYear + 1 : curYear;
    return `${year}-${mm}-${dd}`;
  }

  if (Number(movie.id) === DEFAULT_COUNTDOWN_MOVIE_ID) {
    return '2026-12-16';
  }
  return '';
}

function resolveHeroMovie() {
  const all = getAllCatalogMovies();
  const targetId = Number(appState.countdown?.movieId || DEFAULT_COUNTDOWN_MOVIE_ID);
  const cachedMeta = appState.countdown?.movieMeta;
  let movie = all.find((m) => Number(m.id) === targetId);
  if (!movie && targetId === DEFAULT_COUNTDOWN_MOVIE_ID) {
    movie = all.find((m) => String(m.nm || '').includes('复仇者联盟5'));
  }
  if (!movie && cachedMeta && Number(cachedMeta.id) === targetId) {
    movie = cachedMeta;
  }
  if (!movie && all.length > 0 && appState.countdown?.movieId) {
    movie = all.find((m) => m.source === 'coming') || all[0];
  }
  if (!movie) {
    movie = {
      id: DEFAULT_COUNTDOWN_MOVIE_ID,
      nm: '复仇者联盟5',
      img: 'https://p0.pipi.cn/mediaplus/friday_image_fe/e429586e14d5c24ea925cec2b1ddc37b5d1b1.jpg?imageMogr2/quality/80',
      rt: '2026-12-16',
      comingTitle: '12月16日 周三',
      wish: 0,
      source: 'coming'
    };
  }
  const intel = appState.publicState?.intel?.[String(movie.id)] || (movie.enm ? { enm: movie.enm } : {});
  const releaseDateStr = resolveMovieReleaseDate(movie, intel);
  return { movie, intel, releaseDateStr };
}

function computeCountdownParts(releaseDateStr) {
  if (!releaseDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDateStr)) {
    return { status: 'tbd', days: 0, hours: 0, mins: 0, secs: 0, elapsedDays: 0 };
  }
  const targetMs = new Date(`${releaseDateStr}T00:00:00+08:00`).getTime();
  const diffMs = targetMs - Date.now();
  if (diffMs > 0) {
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return { status: 'future', days, hours, mins, secs, elapsedDays: 0 };
  }
  const todayStr = getBeijingTodayStr();
  if (releaseDateStr === todayStr) {
    return { status: 'today', days: 0, hours: 0, mins: 0, secs: 0, elapsedDays: 0 };
  }
  const elapsedDays = Math.max(1, Math.floor((Date.now() - targetMs) / 86400000));
  return { status: 'released', days: 0, hours: 0, mins: 0, secs: 0, elapsedDays };
}

function updateCountdownDom() {
  const clockEl = document.getElementById('heroCountdownClock');
  if (!clockEl) return;
  const ds = clockEl.dataset.targetDate || '';
  const parts = computeCountdownParts(ds);
  if (parts.status !== 'future') {
    render();
    return;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const dEl = document.getElementById('heroCdDays');
  const hEl = document.getElementById('heroCdHours');
  const mEl = document.getElementById('heroCdMins');
  const sEl = document.getElementById('heroCdSecs');
  if (dEl) dEl.textContent = String(parts.days);
  if (hEl) hEl.textContent = pad(parts.hours);
  if (mEl) mEl.textContent = pad(parts.mins);
  if (sEl) sEl.textContent = pad(parts.secs);
}

function startCountdownTicker() {
  clearInterval(appState.countdownTimer);
  appState.countdownTimer = setInterval(updateCountdownDom, 1000);
}

function openCountdownPickerModal() {
  const root = document.getElementById('modalRoot');
  const { movie: currentMovie } = resolveHeroMovie();
  const intelMap = appState.publicState?.intel || {};
  const all = [...getAllCatalogMovies()].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'coming' ? -1 : 1;
    return Number(b.wish || 0) - Number(a.wish || 0);
  });

  let selectedMovie = currentMovie;
  let searchKw = '';

  const renderListOnly = () => {
    const listBox = document.getElementById('pickerListContainer');
    if (!listBox) return;
    const kwLower = searchKw.trim().toLowerCase();
    const filtered = kwLower
      ? all.filter((m) => {
          const mEnm = String(intelMap[String(m.id)]?.enm || '').toLowerCase();
          return String(m.nm || '').toLowerCase().includes(kwLower) || mEnm.includes(kwLower);
        })
      : all;

    if (filtered.length === 0) {
      listBox.innerHTML = `<div class="muted" style="padding:20px 8px;text-align:center">暂无匹配影片</div>`;
      return;
    }

    listBox.innerHTML = filtered
      .slice(0, 60)
      .map((m) => {
        const isSel = Number(m.id) === Number(selectedMovie.id);
        const mDate = resolveMovieReleaseDate(m, intelMap[String(m.id)] || {});
        return `
          <div class="picker-row ${isSel ? 'selected' : ''}" data-pick-id="${m.id}">
            ${m.img ? `<img class="picker-thumb" src="${escapeHtml(m.img)}" alt="" loading="lazy" />` : `<div class="picker-thumb"></div>`}
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(m.nm)}</div>
              <div class="muted">${mDate ? escapeHtml(mDate) : escapeHtml(m.comingTitle || '待定档')} · 猫眼想看 ${formatWishCount(m.wish)}</div>
            </div>
            ${isSel ? `<span style="font-size:12px;font-weight:700;color:var(--crimson)">当前</span>` : ''}
          </div>
        `;
      })
      .join('');

    listBox.querySelectorAll('[data-pick-id]').forEach((row) => {
      row.onclick = () => {
        const picked = all.find((x) => Number(x.id) === Number(row.dataset.pickId));
        if (!picked) return;
        selectedMovie = picked;
        saveCountdownConfig({
          movieId: Number(picked.id),
          movieMeta: pickCountdownMovieMeta(picked, intelMap[String(picked.id)] || {})
        });
        showToast(`首页倒计时已切换为《${picked.nm}》`);
        updateSelectedHeader();
        renderListOnly();
        render();
      };
    });
  };

  const updateSelectedHeader = () => {
    const selIntel = intelMap[String(selectedMovie.id)] || {};
    const resolvedSelDate = resolveMovieReleaseDate(selectedMovie, selIntel);
    const titleEl = document.getElementById('pickerSelectedTitle');
    const dateInput = document.getElementById('customCountdownDateInput');
    const resetBtn = document.getElementById('resetDefaultCountdownBtn');
    if (titleEl) titleEl.textContent = `当前选中：《${selectedMovie.nm}》`;
    if (dateInput) dateInput.value = resolvedSelDate;
    if (resetBtn) {
      const isDefault = Number(selectedMovie.id) === DEFAULT_COUNTDOWN_MOVIE_ID;
      resetBtn.textContent = isDefault ? '默认已选中' : '恢复默认复联5';
      resetBtn.disabled = isDefault;
    }
  };

  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal-sheet modal-sheet-flex">
      <div class="modal-sheet-pad" style="padding-bottom:10px;border-bottom:1px solid var(--hairline)">
        <div class="row-between" style="margin-bottom:10px">
          <div class="sheet-title">${icon('calendar')} 选择首页倒计时影片</div>
          <button class="btn btn-soft btn-sm" id="closePickerBtn" type="button">完成</button>
        </div>

        <div style="background:var(--bg);border-radius:14px;padding:12px 14px;margin-bottom:10px">
          <div class="row-between" style="margin-bottom:8px">
            <strong id="pickerSelectedTitle" style="font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">当前选中：《${escapeHtml(selectedMovie.nm)}》</strong>
            <button class="btn btn-sm" id="resetDefaultCountdownBtn" type="button" style="flex-shrink:0">恢复默认复联5</button>
          </div>
          <div class="row" style="gap:8px">
            <div style="flex:1">
              <label class="muted" style="display:block;margin-bottom:4px">目标上映日期（可手动修正或自定）</label>
              <input id="customCountdownDateInput" type="date" class="input" value="${escapeHtml(resolveMovieReleaseDate(selectedMovie, intelMap[String(selectedMovie.id)] || {}))}" style="min-height:38px;background:#fff" />
            </div>
            <button class="btn btn-primary btn-sm" id="applyCustomDateBtn" style="align-self:flex-end;min-height:38px" type="button">保存日期</button>
          </div>
        </div>

        <div class="search-wrap" style="margin-bottom:0">
          <span class="search-ico">${icon('search')}</span>
          <input id="pickerSearchInput" class="input" value="${escapeHtml(searchKw)}" placeholder="搜索中英文片名切换倒计时..." />
        </div>
      </div>

      <div id="pickerListContainer" class="picker-scroll-body" style="padding:8px 18px calc(16px + var(--safe-bottom))"></div>
    </div>
  `;

  document.getElementById('closePickerBtn').onclick = () => {
    root.classList.add('hidden');
    render();
  };
  root.onclick = (e) => {
    if (e.target === root) {
      root.classList.add('hidden');
      render();
    }
  };
  document.getElementById('pickerSearchInput').oninput = (e) => {
    searchKw = e.target.value;
    renderListOnly();
  };
  document.getElementById('resetDefaultCountdownBtn').onclick = () => {
    saveCountdownConfig({ movieId: DEFAULT_COUNTDOWN_MOVIE_ID, movieMeta: null });
    selectedMovie = resolveHeroMovie().movie;
    showToast('已恢复默认倒计时：复仇者联盟5');
    updateSelectedHeader();
    renderListOnly();
    render();
  };
  document.getElementById('applyCustomDateBtn').onclick = () => {
    const val = document.getElementById('customCountdownDateInput').value.trim();
    saveCountdownConfig({
      movieId: Number(selectedMovie.id),
      customDates: val ? { [String(selectedMovie.id)]: val } : {},
      movieMeta: pickCountdownMovieMeta(selectedMovie, intelMap[String(selectedMovie.id)] || {})
    });
    showToast(val ? `已设定《${selectedMovie.nm}》倒计时目标：${val}` : '已更新倒计时影片');
    root.classList.add('hidden');
    render();
  };

  updateSelectedHeader();
  renderListOnly();
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
      <div class="detail-hero">
        ${resolvedPoster ? `<div class="detail-hero-bg" style="background-image:url('${escapeHtml(resolvedPoster)}')"></div>` : ''}
        <div class="detail-hero-scrim"></div>
        <div class="detail-hero-content">
          <div class="row-between" style="margin-bottom:12px">
            <div class="muted" style="font-weight:700;letter-spacing:0.02em">影片详情与四平台评分</div>
            <button class="btn btn-soft btn-sm" id="closeDetailModalBtn" type="button">关闭</button>
          </div>
          <div class="movie-card">
            ${
              resolvedPoster
                ? `<img class="hero-poster" src="${escapeHtml(resolvedPoster)}" alt="" />`
                : `<div class="poster-placeholder" style="width:84px;height:118px">${icon('film')}</div>`
            }
            <div class="movie-body">
              <div class="movie-name" style="font-size:18px;line-height:1.25">${escapeHtml(resolvedTitle)}</div>
              ${intel.enm ? `<div class="muted" style="margin-bottom:4px">${escapeHtml(intel.enm)}</div>` : ''}
              <div class="row" style="margin:6px 0;gap:5px">
                ${catMovie?.statusLabel ? `<span class="badge badge-coral">${escapeHtml(catMovie.statusLabel)}</span>` : ''}
                ${catMovie?.rt ? `<span class="badge badge-normal">${escapeHtml(catMovie.rt)}</span>` : ''}
                ${intel.cat ? `<span class="muted">${escapeHtml(intel.cat)}${intel.dur ? ` · ${intel.dur}分钟` : ''}</span>` : ''}
              </div>
              ${intel.dir || catMovie?.star ? `<div class="muted" style="line-height:1.45">${escapeHtml([intel.dir ? `导演：${intel.dir}` : '', catMovie?.star ? `主演：${catMovie.star}` : ''].filter(Boolean).join('\n'))}</div>` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-sheet-pad" style="padding-top:10px">
        <div class="section-label" style="margin-top:0">想看人数对比</div>
        <div class="wish-compare-grid">
          <div class="metric-box">
            <div class="metric-label"><span>猫眼想看</span><span style="color:var(--green)">今日 +${wishDailyGain.toLocaleString('zh-CN')}</span></div>
            <div class="metric-val" style="color:var(--accent)">${formatWishCount(wishVal)}</div>
            <div class="metric-sub">${wishYesterdayGain > 0 ? `昨日 +${wishYesterdayGain.toLocaleString('zh-CN')}` : '想看排行榜基准'}</div>
          </div>
          <div class="metric-box">
            <div class="metric-label"><span>淘票票想看</span>${intel.tppScore ? `<span style="color:var(--blue)">${intel.tppScore}分</span>` : ''}</div>
            <div class="metric-val" style="font-size:${intel.tppWish ? '19px' : '14px'};color:${intel.tppWish ? 'var(--blue)' : 'var(--text-muted)'}">
              ${intel.tppWish ? formatWishCount(intel.tppWish) : '暂未匹配'}
            </div>
            <div class="metric-sub">
              <a class="link-clean" href="https://m.taopiaopiao.com/" target="_blank" rel="noopener">淘票票查看 →</a>
            </div>
          </div>
        </div>

        <div class="section-label">四平台开分</div>
        <div class="score-strip">
          <div class="score-cell">
            <div class="score-cell-lbl">猫眼</div>
            <div class="score-cell-val" style="color:${maoyanScore > 0 ? 'var(--amber)' : 'var(--ink-muted)'}">${maoyanScore > 0 ? maoyanScore : '—'}</div>
            <div class="score-cell-sub">${maoyanScore > 0 && intel.maoyanVotes ? `${formatWishCount(intel.maoyanVotes)}人` : '未开分'}</div>
          </div>
          <div class="score-cell">
            <div class="score-cell-lbl">${intel.doubanUrl ? `<a class="link-clean" href="${escapeHtml(intel.doubanUrl)}" target="_blank" rel="noopener">豆瓣↗</a>` : '豆瓣'}</div>
            <div class="score-cell-val" style="color:${intel.doubanScore > 0 ? 'var(--green)' : 'var(--ink-muted)'}">${intel.doubanScore > 0 ? intel.doubanScore : '—'}</div>
            <div class="score-cell-sub">${intel.doubanScore > 0 && intel.doubanVotes ? `${formatWishCount(intel.doubanVotes)}人` : '未开分'}</div>
          </div>
          <div class="score-cell">
            <div class="score-cell-lbl">${intel.imdbUrl ? `<a class="link-clean" href="${escapeHtml(intel.imdbUrl)}" target="_blank" rel="noopener">IMDb↗</a>` : 'IMDb'}</div>
            <div class="score-cell-val" style="color:${intel.imdbScore > 0 ? 'var(--blue)' : 'var(--ink-muted)'}">${intel.imdbScore > 0 ? intel.imdbScore : '—'}</div>
            <div class="score-cell-sub">${intel.imdbScore > 0 && intel.imdbVotes ? formatWishCount(intel.imdbVotes) : '未开分'}</div>
          </div>
          <div class="score-cell">
            <div class="score-cell-lbl">${intel.rtUrl ? `<a class="link-clean" href="${escapeHtml(intel.rtUrl)}" target="_blank" rel="noopener">烂番茄↗</a>` : '烂番茄'}</div>
            <div class="score-cell-val" style="color:${intel.rtCriticsScore !== null && intel.rtCriticsScore !== undefined ? 'var(--crimson)' : 'var(--ink-muted)'}">${intel.rtCriticsScore !== null && intel.rtCriticsScore !== undefined ? `${intel.rtCriticsScore}%` : '—'}</div>
            <div class="score-cell-sub">${intel.rtAudienceScore !== null && intel.rtAudienceScore !== undefined ? `爆米花${intel.rtAudienceScore}%` : '新鲜度'}</div>
          </div>
        </div>

        <div class="section-label">东莞三家影院当前排片</div>
        <div style="background:var(--bg);border-radius:14px;padding:12px;margin-top:6px">
          ${
            cinemaMatches.length === 0
              ? `<div class="muted">暂未在华南MALL / 东城万达 / 民盈国贸城查到开售排片。</div>`
              : cinemaMatches
                  .map(
                    ({ cinema, movie }) =>
                      `<div class="muted" style="margin:3px 0;color:var(--ink)"><strong>${escapeHtml(cinema.shortName)}</strong>：${movie.showCount} 场（${(movie.shows || []).slice(0, 3).map((s) => `${s.dt.slice(5)} ${s.tm}${s.tags?.length ? `[${s.tags[0]}]` : ''}`).join('、')}）</div>`
                  )
                  .join('')
          }
        </div>

        <div class="row" style="margin-top:14px">
          ${
            resolvedId
              ? `<button class="btn btn-soft" style="min-height:44px" id="detailPinCountdownBtn" type="button">${icon('calendar')} 设为倒计时</button>`
              : ''
          }
          <button class="btn ${isStarred ? 'btn-gold' : 'btn-crimson'}" style="flex:1;min-height:44px" id="detailStarActionBtn" type="button">
            ${icon(isStarred ? 'starFill' : 'star')} ${isStarred ? '调整星标 / 停止提醒' : '星标盯每轮开票'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('closeDetailModalBtn').onclick = () => root.classList.add('hidden');
  root.onclick = (e) => {
    if (e.target === root) root.classList.add('hidden');
  };
  document.getElementById('detailPinCountdownBtn')?.addEventListener('click', () => {
    saveCountdownConfig({
      movieId: Number(resolvedId),
      movieMeta: pickCountdownMovieMeta(
        catMovie || { id: resolvedId, nm: resolvedTitle, img: resolvedPoster },
        intel
      )
    });
    root.classList.add('hidden');
    showToast(`已将首页倒计时设为《${resolvedTitle}》`);
    render();
  });
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
    if (detectPlatform().isWeChat) {
      // Preserve #pair= inside WeChat so tapping "在默认浏览器打开" carries the full pairing URL
      appState.incomingWeChatPairLink = window.location.href;
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      showToast('已导入朋友配对配置！请点下方开启本机通知', 4200);
    }
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
  const { owner, repo, token } = appState.config;
  const sources = [];
  if (token) {
    sources.push({
      url: `https://api.github.com/repos/${owner}/${repo}/contents/state.json?ref=data&t=${Date.now()}`,
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${token}`
      },
      timeoutMs: 7000
    });
  }
  sources.push(
    {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/data/state.json?t=${Date.now()}`,
      headers: {},
      timeoutMs: 7000
    },
    {
      url: `./data/seed-state.json?t=${Date.now()}`,
      headers: {},
      timeoutMs: 4000
    }
  );

  for (const src of sources) {
    try {
      const res = await fetchWithTimeout(src.url, { headers: src.headers, cache: 'no-store' }, src.timeoutMs);
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
    settings: { rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', notifyAllDynamics: false, paused: false, ...safeParse('settings.json', {}) },
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
    'settings.json': { content: JSON.stringify({ rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', notifyAllDynamics: false, paused: false }, null, 2) },
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
      <div class="modal-sheet-pad">
        <div class="row-between" style="margin-bottom:10px">
          <div class="card-title">${icon('starFill')} 星标盯票：《${escapeHtml(title || keyword)}》</div>
          <button class="btn btn-soft btn-sm" id="closeModalBtn" type="button">关闭</button>
        </div>
        <p class="muted" style="margin:0 0 14px">
          星标后，只要你未手动停止，华南MALL IMAX GT / 东城万达 IMAX / 民盈国贸城 CGV 每一轮新放票及该片的定档/开票/改档/开分都会推送提醒。
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
        <div class="row" style="margin-top:16px">
          <button class="btn btn-primary" style="flex:1;min-height:44px" id="confirmStarBtn" type="button">${existingWatch ? '更新盯票设置' : '确认星标盯票'}</button>
          ${existingWatch ? `<button class="btn btn-danger" style="min-height:44px" id="modalStopBtn" type="button">停止提醒</button>` : ''}
        </div>
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

  if (plat.isWeChat) {
    const shareUrl = appState.incomingWeChatPairLink || window.location.href;
    el.className = 'banner warn';
    el.innerHTML = `
      <div class="banner-title">
        <span>微信内无法添加桌面与推送提醒</span>
        ${appState.incomingWeChatPairLink ? `<button class="btn btn-sm btn-primary" id="bannerCopyWechatPairBtn" type="button">${icon('link')} 复制链接</button>` : ''}
      </div>
      <div>请点右上角 <strong>··· →「在默认浏览器打开」</strong>（如华为浏览器或 Safari），已保留你的配对参数；若从浏览器打开后未自动配对，可先复制链接到「设置 → 一键导入」。</div>
    `;
    document.getElementById('bannerCopyWechatPairBtn')?.addEventListener('click', () => {
      copyText(shareUrl, '完整配对链接');
    });
    return;
  }

  if (plat.isIOS && !plat.isStandalone) {
    el.className = 'banner';
    el.innerHTML = `
      <div class="banner-title">
        <span>添加到 iPhone 主屏幕以开启提醒</span>
      </div>
      <div class="muted">Safari 网页直接打开无法推送，请点底部 <strong>分享按钮 →「添加到主屏幕」</strong>，再从桌面图标打开即可开启原生锁屏推送。</div>
    `;
    return;
  }

  if (plat.isIOS && plat.isStandalone && !appState.pushSub) {
    el.className = 'banner';
    el.innerHTML = `
      <div class="banner-title">
        <span>iPhone 锁屏提醒未开启</span>
        <button class="btn btn-primary btn-sm" id="bannerSubscribeBtn" type="button">${icon('bell')} 立即开启</button>
      </div>
      <div class="muted">开启后，星标电影每轮放票及定档/开分都会直接推到锁屏。</div>
    `;
    document.getElementById('bannerSubscribeBtn').onclick = () => {
      if (!isPaired()) {
        appState.tab = 'settings';
        render();
        showToast('请先在设置完成配对或粘贴导入链接');
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
        <span>华为设备建议开启防漏提醒</span>
        <button class="btn btn-gold btn-sm" id="bannerGoHuaweiBtn" type="button">${icon('shield')} 去开启</button>
      </div>
      <div class="muted">国行华为建议开启「网页哨兵模式」或填写 PushPlus 微信提醒，避免切后台后漏收开票通知。</div>
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
  const heading = document.getElementById('pageHeading');
  const subText = document.getElementById('subMetaText');
  const pill = document.getElementById('statusPill');
  const riskEl = document.getElementById('riskBanner');

  const headingMap = {
    catalog: {
      coming: '新片待映',
      onInfo: '正在热映',
      wish_total: '想看总榜',
      wish_daily: '今日飙升'
    }[appState.catalogTab] || '新片待映',
    cinemas: '东莞三影院',
    radar: '我的盯票',
    dynamics: '全网动态',
    settings: '设置与推送'
  };
  if (heading) heading.textContent = headingMap[appState.tab] || '影院雷达';

  const activeCount = getEffectiveWatchlist().filter((w) => w.active !== false).length;
  const lastTick = pub?.lastTickAt ? formatRelTime(pub.lastTickAt) : '尚未触发';

  if (subText) subText.textContent = `东莞三影院 · ${lastTick}更新`;

  if (pub?.riskControl?.active) {
    dot.className = 'brand-dot cooldown';
    pill.className = 'status-pill danger';
    pill.textContent = '风控冷却';
    riskEl.className = 'banner danger';
    riskEl.innerHTML = `
      <div class="banner-title">猫眼风控自动熔断冷却中</div>
      <div>原因：${escapeHtml(pub.riskControl.lastReason || '疑似滑块拦截')} · 预计恢复：${escapeHtml(formatFutureRelTime(pub.riskControl.cooldownUntil))}（可在设置切换轮转节奏）</div>
    `;
  } else {
    riskEl.className = 'banner hidden';
    if (appState.privateState?.settings?.paused) {
      dot.className = 'brand-dot';
      pill.className = 'status-pill warn';
      pill.textContent = '已暂停';
    } else if (activeCount > 0) {
      dot.className = 'brand-dot watching';
      pill.className = 'status-pill ok';
      pill.textContent = `盯票 ${activeCount} 部`;
    } else {
      dot.className = 'brand-dot';
      pill.className = 'status-pill';
      pill.textContent = pub ? '待机' : '加载中';
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
    <div class="stats-strip">
      <div class="stat-tile">
        <div class="stat-val accent">${activeItems.length}</div>
        <div class="stat-lbl">星标盯票中</div>
      </div>
      <div class="stat-tile">
        <div class="stat-val">${totalShows}</div>
        <div class="stat-lbl">三影院在售</div>
      </div>
      <div class="stat-tile">
        <div class="stat-val">${alerts.length}</div>
        <div class="stat-lbl">开票波次</div>
      </div>
    </div>

    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div>
          <div class="sheet-title">快速星标追踪</div>
          <div class="muted">输入未定档片名也能持续追踪定档、开分与开票</div>
        </div>
        <button class="btn btn-soft btn-sm" id="manualTickBtn" type="button">${icon('refresh')} 抓一次</button>
      </div>
      <div class="row">
        <div class="search-wrap" style="flex:1;margin-bottom:0">
          <span class="search-ico">${icon('search')}</span>
          <input id="quickKeywordInput" class="input" style="background:var(--bg)" placeholder="输入电影名称关键词..." />
        </div>
        <button class="btn btn-crimson" id="quickStarBtn" type="button">${icon('star')} 星标</button>
      </div>
    </div>

    <div class="sheet">
      <div class="sheet-pad" style="padding-bottom:6px">
        <div class="sheet-header" style="margin-bottom:0">
          <div class="sheet-title">正在盯票（${activeItems.length}）</div>
          <button class="btn btn-soft btn-sm" id="refreshBtn" type="button">${icon('refresh')} 刷新</button>
        </div>
      </div>
      ${
        activeItems.length === 0
          ? `<div class="sheet-pad"><div class="muted">当前没有星标电影。可在「新片」页点星标，或在上方直接添加关键词。</div></div>`
          : activeItems
              .map((w) => {
                const matches = findCurrentMovieMatchesAcrossCinemas(w);
                const summaryHtml =
                  matches.length === 0
                    ? `<div class="movie-subline">暂未在东莞三影院查到排片，持续监听中</div>`
                    : matches
                        .map(({ cinema, movie }) => {
                          const specialCount = (movie.shows || []).filter((s) => s.isSpecial).length;
                          return `<div class="movie-subline" style="color:var(--ink-secondary)">${escapeHtml(cinema.shortName)} · ${movie.showCount} 场${specialCount > 0 ? `（${specialCount} 特殊厅）` : ''}</div>`;
                        })
                        .join('');
                return `
                  <div class="movie-row">
                    <div class="poster-wrap open-detail-trigger" data-mid="${w.movieId || ''}" data-title="${escapeHtml(w.title || w.keyword)}" data-poster="${escapeHtml(w.poster || '')}">
                      ${
                        w.poster
                          ? `<img class="poster" src="${escapeHtml(w.poster)}" alt="" loading="lazy" />`
                          : `<div class="poster-placeholder">${icon('film')}</div>`
                      }
                    </div>
                    <div class="movie-meta">
                      <div class="movie-head">
                        <div class="movie-name open-detail-trigger" data-mid="${w.movieId || ''}" data-title="${escapeHtml(w.title || w.keyword)}" data-poster="${escapeHtml(w.poster || '')}">${escapeHtml(w.title || w.keyword)}</div>
                        <button class="star-pill starred stop-watch-btn" data-id="${escapeHtml(w.id)}" type="button">停止</button>
                      </div>
                      <div class="movie-subline">${escapeHtml(hallFilterLabel(w.hallFilter))} · 已推 ${w.roundCount || 0} 轮${w.lastAlertAt ? ` · ${formatRelTime(w.lastAlertAt)}` : ''}</div>
                      ${summaryHtml}
                    </div>
                  </div>
                `;
              })
              .join('')
      }
    </div>

    ${
      stoppedItems.length > 0
        ? `<div class="sheet sheet-pad">
            <div class="sheet-header"><div class="sheet-title">已手动停止（${stoppedItems.length}）</div></div>
            ${stoppedItems
              .map(
                (w) => `
              <div class="row-between" style="padding:10px 0;border-bottom:1px solid var(--hairline)">
                <div>
                  <div style="font-weight:600;font-size:14px">${escapeHtml(w.title || w.keyword)}</div>
                  <div class="muted">已推 ${w.roundCount || 0} 轮 · ${escapeHtml(hallFilterLabel(w.hallFilter))}</div>
                </div>
                <div class="row">
                  <button class="btn btn-soft btn-sm resume-watch-btn" data-id="${escapeHtml(w.id)}" type="button">恢复</button>
                  <button class="btn btn-danger btn-sm del-watch-btn" data-id="${escapeHtml(w.id)}" type="button">删除</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>`
        : ''
    }

    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div class="sheet-title">每轮开票记录</div>
        <span class="muted">一轮一条摘要</span>
      </div>
      ${
        alerts.length === 0
          ? `<div class="muted">暂无开票推送记录。当星标电影新开售场次时会记录在这里。</div>`
          : alerts
              .slice(0, 15)
              .map(
                (a) => `
              <div style="padding:10px 0;border-bottom:1px solid var(--hairline)">
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
    <div class="cinema-segs">
      ${CINEMAS.map(
        (c) => `
        <button class="cinema-seg ${appState.activeCinemaId === c.id ? 'active' : ''}" data-cid="${c.id}" type="button">
          <span class="cinema-seg-name">${escapeHtml(c.segName || c.shortName)}</span>
          <span class="cinema-seg-sub">${escapeHtml(c.segSub || '')}</span>
        </button>
      `
      ).join('')}
    </div>

    <div class="sheet sheet-pad" style="padding:13px 16px">
      <div class="row-between">
        <div style="min-width:0;flex:1">
          <div style="font-weight:700;font-size:14px;line-height:1.35">${escapeHtml(CINEMAS.find((c) => c.id === appState.activeCinemaId)?.name)}</div>
          <div class="muted">更新于 ${escapeHtml(formatRelTime(cinemaData?.fetchedAt))} · 在售 ${movies.length} 部</div>
        </div>
        <button class="btn ${appState.specialHallOnly ? 'btn-primary' : 'btn-soft'} btn-sm" style="flex-shrink:0" id="specialToggleBtn" type="button">
          ${appState.specialHallOnly ? '仅看特殊厅' : '全部影厅'}
        </button>
      </div>
      ${
        allDates.length > 0
          ? `<div class="pill-group" style="margin-top:10px;margin-bottom:0">
              <button class="chip ${appState.activeDateFilter === 'all' ? 'active' : ''}" data-dt="all" type="button">全部</button>
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
        ? `<div class="sheet sheet-pad"><div class="muted">暂无排片缓存，请前往「设置」配对后点击抓取。</div></div>`
        : `<div class="sheet">
            ${movies
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
                  <div class="movie-row">
                    <div class="poster-wrap open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">
                      ${
                        m.img
                          ? `<img class="poster" src="${escapeHtml(m.img)}" alt="" loading="lazy" />`
                          : `<div class="poster-placeholder">${icon('film')}</div>`
                      }
                    </div>
                    <div class="movie-meta">
                      <div class="movie-head">
                        <div class="movie-name open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">${escapeHtml(m.nm)}</div>
                        <button class="star-pill ${isStarred ? 'starred' : ''} star-movie-btn"
                          data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}" type="button">
                          ${icon(isStarred ? 'starFill' : 'star')} ${isStarred ? '盯票中' : '盯票'}
                        </button>
                      </div>
                      <div class="movie-subline">${escapeHtml(m.desc || '')}</div>
                      <div class="showtime-grid">
                        ${filteredShows
                          .slice(0, 18)
                          .map(
                            (s) => `
                          <div class="showtime-box ${s.isImaxGt ? 'gt' : s.isSpecial ? 'special' : ''}">
                            <div class="showtime-top">
                              <span class="showtime-tm">${escapeHtml(s.tm)}</span>
                              <span class="showtime-dt">${escapeHtml(s.dt.slice(5))}</span>
                            </div>
                            <div class="showtime-tag">${s.tags?.length ? escapeHtml(s.tags[0]) : escapeHtml(s.tp || '普通')}</div>
                            <div class="showtime-hall">${escapeHtml(s.th)}</div>
                          </div>
                        `
                          )
                          .join('')}
                      </div>
                      ${filteredShows.length > 18 ? `<div class="muted" style="margin-top:6px">仅展示前 18 场，共 ${filteredShows.length} 场</div>` : ''}
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>`
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
    <div class="toolbar-bar">
      <div class="muted">全量动态每 5 分钟巡检 · ${escapeHtml(lastCatSync)}（仅星标片触发推送）</div>
      <button class="icon-circle-btn" id="dynSyncBtn" type="button" title="刷新">${icon('refresh')}</button>
    </div>
    <div class="pill-group">
      <button class="chip ${appState.dynamicsFilter === 'all' ? 'active' : ''}" data-df="all" type="button">全部 ${dynamics.length}</button>
      <button class="chip ${appState.dynamicsFilter === 'scheduled' ? 'active' : ''}" data-df="scheduled" type="button">定档</button>
      <button class="chip ${appState.dynamicsFilter === 'presale_opened' ? 'active' : ''}" data-df="presale_opened" type="button">开票</button>
      <button class="chip ${appState.dynamicsFilter === 'rescheduled' ? 'active' : ''}" data-df="rescheduled" type="button">改档</button>
      <button class="chip ${appState.dynamicsFilter === 'scored' ? 'active' : ''}" data-df="scored" type="button">开分</button>
    </div>

    ${
      filtered.length === 0
        ? `<div class="sheet sheet-pad"><div class="muted">暂无动态记录。每当新电影出现定档、开票、改档或开分时都会记录在这里。</div></div>`
        : `<div class="sheet">
            ${filtered
              .map((d) => {
                const isStarred = watchlist.some(
                  (w) => w.active !== false && Number(w.movieId) === Number(d.movieId)
                );
                return `
                  <div class="dyn-row">
                    <div class="dyn-dot-col">
                      <span class="dyn-dot ${escapeHtml(d.type)}"></span>
                    </div>
                    <div class="poster-wrap open-detail-trigger" data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster || '')}">
                      ${
                        d.poster
                          ? `<img class="poster" style="width:52px;height:74px" src="${escapeHtml(d.poster)}" alt="" loading="lazy" />`
                          : `<div class="poster-placeholder" style="width:52px;height:74px">${icon('film')}</div>`
                      }
                    </div>
                    <div class="movie-meta">
                      <div class="movie-head">
                        <div class="row" style="gap:6px;min-width:0;flex:1">
                          <span class="dyn-badge ${escapeHtml(d.type)}">${escapeHtml(d.typeLabel)}</span>
                          <span class="movie-name open-detail-trigger" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster || '')}">${escapeHtml(d.title)}</span>
                        </div>
                        <button class="star-pill ${isStarred ? 'starred' : ''} star-dyn-btn"
                          data-mid="${d.movieId || ''}" data-title="${escapeHtml(d.title)}" data-poster="${escapeHtml(d.poster || '')}" type="button">
                          ${icon(isStarred ? 'starFill' : 'star')} ${isStarred ? '盯票中' : '盯票'}
                        </button>
                      </div>
                      <div style="margin-top:5px;font-size:13px;font-weight:600;color:var(--ink)">${escapeHtml(d.summary)}</div>
                      <div class="row-between" style="margin-top:3px">
                        <span class="muted">${escapeHtml(d.detail || '')}</span>
                        <span class="muted">${escapeHtml(formatRelTime(d.createdAt))}</span>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>`
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

  const watchlist = getEffectiveWatchlist();
  const isRankMode = appState.catalogTab === 'wish_total' || appState.catalogTab === 'wish_daily';

  const buildCatalogListHtml = () => {
    const kw = appState.catalogSearch.trim().toLowerCase();
    const filtered = kw
      ? list.filter((m) => {
          const mEnm = String(intelMap[String(m.id)]?.enm || '').toLowerCase();
          const mStar = String(m.star || '').toLowerCase();
          return (
            String(m.nm || '').toLowerCase().includes(kw) ||
            mEnm.includes(kw) ||
            mStar.includes(kw)
          );
        })
      : list;

    if (filtered.length === 0) {
      return `<div class="sheet sheet-pad"><div class="muted">暂无匹配影片。你也可以切到「盯票」直接输入关键词追踪未收录新片。</div></div>`;
    }

    return `<div class="sheet">
      ${filtered
        .map((m, idx) => {
          const isStarred = watchlist.some(
            (w) => w.active !== false && Number(w.movieId) === Number(m.id)
          );
          const hasImax = /imax/i.test(m.version || '');
          const intel = intelMap[String(m.id)] || {};
          const maoyanSc = Number(intel.maoyanScore || m.sc || 0);
          const scoreBits = [
            maoyanSc > 0 ? `猫眼 ${maoyanSc}` : '',
            intel.doubanScore > 0 ? `豆瓣 ${intel.doubanScore}` : '',
            intel.imdbScore > 0 ? `IMDb ${intel.imdbScore}` : '',
            intel.rtCriticsScore !== null && intel.rtCriticsScore !== undefined ? `烂番茄 ${intel.rtCriticsScore}%` : ''
          ].filter(Boolean);
          const rankClass = idx === 0 ? 'top1' : idx === 1 ? 'top2' : idx === 2 ? 'top3' : '';
          const shortGenres = intel.cat
            ? String(intel.cat).split(/[,，/\s]+/).filter(Boolean).slice(0, 2).join('/')
            : '';
          const shortCast = m.star
            ? String(m.star).split(/[,，、]+/).filter(Boolean).slice(0, 2).join('、')
            : '';
          const subMetaLine = [
            m.rt || m.comingTitle || m.statusLabel || '',
            hasImax ? 'IMAX' : '',
            shortGenres,
            shortCast
          ]
            .filter(Boolean)
            .join(' · ');

          return `
            <div class="movie-row">
              <div class="poster-wrap open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">
                ${isRankMode ? `<span class="rank-corner ${rankClass}">${String(idx + 1).padStart(2, '0')}</span>` : ''}
                ${
                  m.img
                    ? `<img class="poster" src="${escapeHtml(m.img)}" alt="" loading="lazy" />`
                    : `<div class="poster-placeholder">${icon('film')}</div>`
                }
              </div>
              <div class="movie-meta">
                <div class="movie-head">
                  <div class="movie-name open-detail-trigger" data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}">${escapeHtml(m.nm)}</div>
                  <button class="star-pill ${isStarred ? 'starred' : ''} star-cat-btn"
                    data-mid="${m.id}" data-title="${escapeHtml(m.nm)}" data-poster="${escapeHtml(m.img || '')}" type="button">
                    ${icon(isStarred ? 'starFill' : 'star')} ${isStarred ? '盯票中' : '盯票'}
                  </button>
                </div>
                <div class="movie-subline">${escapeHtml(subMetaLine)}</div>
                <div class="movie-wishline">
                  <span>猫眼 ${formatWishCount(m.wish)}</span>
                  ${Number(m.wishDailyGain || 0) > 0 ? `<span class="gain-text">+${Number(m.wishDailyGain).toLocaleString('zh-CN')}</span>` : ''}
                  ${intel.tppWish > 0 ? `<span class="muted">· 淘票票 ${formatWishCount(intel.tppWish)}</span>` : ''}
                </div>
                ${
                  scoreBits.length > 0
                    ? `<div class="movie-scoreline"><span class="score-accent">${escapeHtml(scoreBits[0])}</span>${scoreBits.length > 1 ? ` · ${escapeHtml(scoreBits.slice(1).join(' · '))}` : ''}</div>`
                    : ''
                }
              </div>
            </div>
          `;
        })
        .join('')}
    </div>`;
  };

  const { movie: heroMovie, intel: heroIntel, releaseDateStr: heroDate } = resolveHeroMovie();
  const heroCd = computeCountdownParts(heroDate);
  const pad = (n) => String(n).padStart(2, '0');
  const heroStarred = watchlist.some(
    (w) =>
      w.active !== false &&
      ((w.movieId && Number(w.movieId) === Number(heroMovie.id)) ||
        (w.keyword && String(heroMovie.nm || '').toLowerCase().includes(w.keyword.toLowerCase())))
  );
  const heroDateCaption = heroDate
    ? `${heroDate.replace(/-/g, '.')}${heroMovie.comingTitle ? ` · ${heroMovie.comingTitle}` : ''}`
    : heroMovie.comingTitle || '尚未定具体档期';

  const heroClockHtml =
    heroCd.status === 'future'
      ? `
        <div id="heroCountdownClock" class="countdown-clock" data-target-date="${escapeHtml(heroDate)}">
          <span class="cd-unit"><span id="heroCdDays" class="cd-num accent">${heroCd.days}</span><span class="cd-lbl">天</span></span>
          <span class="cd-unit"><span id="heroCdHours" class="cd-num">${pad(heroCd.hours)}</span><span class="cd-lbl">时</span></span>
          <span class="cd-unit"><span id="heroCdMins" class="cd-num">${pad(heroCd.mins)}</span><span class="cd-lbl">分</span></span>
          <span class="cd-unit"><span id="heroCdSecs" class="cd-num">${pad(heroCd.secs)}</span><span class="cd-lbl">秒</span></span>
        </div>
      `
      : heroCd.status === 'today'
        ? `<div class="countdown-clock"><span class="cd-num accent" style="font-size:24px">今日正式上映</span></div>`
        : heroCd.status === 'released'
          ? `<div class="countdown-clock"><span class="cd-unit"><span class="cd-num" style="font-size:24px">已上映 ${heroCd.elapsedDays}</span><span class="cd-lbl">天</span></span></div>`
          : `<div class="countdown-clock"><span class="cd-lbl" style="font-size:14px;color:rgba(255,255,255,0.8)">暂未定档 · 可点右上角手动设目标日期</span></div>`;

  const heroHtml = `
    <section class="countdown-hero">
      ${heroMovie.img ? `<div class="countdown-hero-bg" style="background-image:url('${escapeHtml(heroMovie.img)}')"></div>` : ''}
      <div class="countdown-hero-scrim"></div>
      <div class="hero-top">
        <span class="hero-kicker">FEATURED COUNTDOWN</span>
        <button class="hero-switch-btn" id="openCountdownPickerBtn" type="button">换一部 ${icon('chevronDown')}</button>
      </div>
      <div class="hero-main">
        ${
          heroMovie.img
            ? `<img class="hero-poster-thumb open-detail-trigger" data-mid="${heroMovie.id}" data-title="${escapeHtml(heroMovie.nm)}" data-poster="${escapeHtml(heroMovie.img)}" src="${escapeHtml(heroMovie.img)}" alt="" />`
            : `<div class="poster-placeholder" style="width:74px;height:106px;background:rgba(255,255,255,0.1);color:#fff">${icon('film')}</div>`
        }
        <div class="hero-info">
          <div class="hero-title open-detail-trigger" data-mid="${heroMovie.id}" data-title="${escapeHtml(heroMovie.nm)}" data-poster="${escapeHtml(heroMovie.img || '')}">${escapeHtml(heroMovie.nm)}</div>
          <div class="hero-date-line">${escapeHtml(heroIntel.enm ? `${heroIntel.enm} · ` : '')}${escapeHtml(heroDateCaption)}</div>
          ${heroClockHtml}
        </div>
      </div>
      <div class="hero-bottom">
        <div class="hero-wish">
          <span>猫眼 ${formatWishCount(heroMovie.wish)}${Number(heroMovie.wishDailyGain || 0) > 0 ? ` (+${Number(heroMovie.wishDailyGain).toLocaleString('zh-CN')})` : ''}</span>${heroIntel.tppWish > 0 ? `<span>淘票票 ${formatWishCount(heroIntel.tppWish)}</span>` : ''}
        </div>
        <button class="hero-star-btn ${heroStarred ? 'starred' : ''}" id="heroStarBtn" type="button">
          ${icon(heroStarred ? 'starFill' : 'star')} ${heroStarred ? '已星标' : '盯票'}
        </button>
      </div>
    </section>
  `;

  root.innerHTML = `
    ${heroHtml}

    <div class="toolbar-bar">
      <div class="underline-tabs">
        <button class="u-tab ${appState.catalogTab === 'coming' ? 'active' : ''}" data-ctab="coming" type="button">待映 ${comingList.length}</button>
        <button class="u-tab ${appState.catalogTab === 'onInfo' ? 'active' : ''}" data-ctab="onInfo" type="button">热映 ${onInfoList.length}</button>
        <button class="u-tab ${appState.catalogTab === 'wish_total' ? 'active' : ''}" data-ctab="wish_total" type="button">想看榜</button>
        <button class="u-tab ${appState.catalogTab === 'wish_daily' ? 'active' : ''}" data-ctab="wish_daily" type="button">飙升榜</button>
      </div>
      <button class="icon-circle-btn" id="syncCatalogBtn" type="button" title="刷新片单">${icon('refresh')}</button>
    </div>

    <div class="search-wrap">
      <span class="search-ico">${icon('search')}</span>
      <input id="catalogSearchInput" class="input" value="${escapeHtml(appState.catalogSearch)}" placeholder="搜索片名、英文名或主演..." />
    </div>

    <div id="catalogListContainer"></div>
  `;

  const bindRowEvents = (container) => {
    container.querySelectorAll('.star-cat-btn').forEach((btn) => {
      btn.onclick = () =>
        openStarModal({
          movieId: Number(btn.dataset.mid),
          title: btn.dataset.title,
          poster: btn.dataset.poster
        });
    });
    container.querySelectorAll('.open-detail-trigger').forEach((el) => {
      el.onclick = () =>
        openMovieDetailModal({
          movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
          title: el.dataset.title,
          poster: el.dataset.poster
        });
    });
  };

  const updateCatalogListOnly = () => {
    const listContainer = document.getElementById('catalogListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = buildCatalogListHtml();
    bindRowEvents(listContainer);
  };

  updateCatalogListOnly();

  document.getElementById('openCountdownPickerBtn').onclick = openCountdownPickerModal;
  document.getElementById('heroStarBtn').onclick = () =>
    openStarModal({
      movieId: heroMovie.id,
      title: heroMovie.nm,
      poster: heroMovie.img || ''
    });

  root.querySelectorAll('.countdown-hero .open-detail-trigger').forEach((el) => {
    el.onclick = () =>
      openMovieDetailModal({
        movieId: el.dataset.mid ? Number(el.dataset.mid) : null,
        title: el.dataset.title,
        poster: el.dataset.poster
      });
  });

  root.querySelectorAll('[data-ctab]').forEach((btn) => {
    btn.onclick = () => {
      appState.catalogTab = btn.dataset.ctab;
      render();
    };
  });
  document.getElementById('catalogSearchInput').oninput = (e) => {
    appState.catalogSearch = e.target.value;
    updateCatalogListOnly();
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
    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div>
          <div class="sheet-title">${icon('bell')} 本机通知推送</div>
          <div class="muted">${
            plat.isIOS
              ? plat.isStandalone
                ? 'iPhone 桌面模式 · 支持锁屏直推'
                : 'iPhone Safari · 请先添加到主屏幕'
              : plat.isHuawei
                ? '华为设备 · 建议配合作下方哨兵与微信'
                : '当前浏览器'
          } · 已绑定 ${subs.length} 台设备</div>
        </div>
      </div>
      <div class="row">
        <button class="btn btn-crimson" id="subWebPushBtn" type="button">
          ${icon('bell')} ${appState.pushSub ? '重新开启本机推送' : '开启本机推送'}
        </button>
        <button class="btn btn-soft" id="testSoundBtn" type="button">${icon('volume')} 测提示音</button>
        <button class="btn btn-soft" id="testRemotePushBtn" type="button">${icon('send')} 测远程推送</button>
      </div>
      ${
        subs.length > 0
          ? `<div class="muted" style="margin-top:10px">已绑定设备：${subs.map((s) => `${escapeHtml(s.deviceLabel)}`).join('、')}</div>`
          : ''
      }
    </div>

    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div>
          <div class="sheet-title">${icon('shield')} 华为保活 & 微信兜底通知</div>
          <div class="muted">华为若被系统清理后台，开启网页哨兵或 PushPlus 微信提醒可确保 100% 收到</div>
        </div>
      </div>
      <div class="row" style="margin-bottom:12px">
        <button class="btn ${appState.sentinel.enabled ? 'btn-gold' : 'btn-soft'}" id="toggleSentinelBtn" type="button">
          ${icon('shield')} ${appState.sentinel.enabled ? '网页哨兵巡检中 (45s)' : '开启华为网页哨兵'}
        </button>
        <button class="btn ${appState.sentinel.keepAwake ? 'btn-primary' : 'btn-soft'}" id="toggleWakeLockBtn" type="button">
          ${icon('sun')} ${appState.sentinel.keepAwake ? '防息屏已开启' : '屏幕常亮'}
        </button>
      </div>

      <div class="field">
        <label>微信 PushPlus Token（强烈推荐华为使用：微信扫码即收，无需后台常驻）</label>
        <input id="whPushplus" class="input" value="${escapeHtml(wh.pushplusToken || '')}" placeholder="在 pushplus.plus 微信扫码获取 token" />
      </div>

      <details class="disclosure">
        <summary>更多推送通道（企微/飞书/钉钉/Bark）</summary>
        <div class="disclosure-body">
          <div class="field">
            <label>企业微信群机器人 Webhook</label>
            <input id="whWecom" class="input" value="${escapeHtml(wh.wecomWebhook || '')}" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
          </div>
          <div class="field">
            <label>飞书群机器人 Webhook</label>
            <input id="whFeishu" class="input" value="${escapeHtml(wh.feishuWebhook || '')}" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
          </div>
          <div class="field">
            <label>钉钉 Webhook</label>
            <input id="whDingtalk" class="input" value="${escapeHtml(wh.dingtalkWebhook || '')}" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
          </div>
          <div class="field">
            <label>Bark 推送链接（iPhone 强响铃）</label>
            <input id="whBark" class="input" value="${escapeHtml(wh.barkUrl || '')}" placeholder="https://api.day.app/你的Key/" />
          </div>
        </div>
      </details>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" id="saveWebhooksBtn" type="button">保存微信 / 兜底通道</button>
      </div>
    </div>

    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div>
          <div class="sheet-title">盯票与推送策略</div>
          <div class="muted">盯票随 Cron 每 1~2 分钟抓 3 家影院；片单、淘票票想看与开分每 5 分钟刷新</div>
        </div>
      </div>
      <div class="field">
        <label>动态与开票推送范围（非星标新片仅在「动态」页展示）</label>
        <select id="settingNotifyDynamics" class="select">
          <option value="false" ${st.notifyAllDynamics !== true ? 'selected' : ''}>仅星标电影推送（定档/开分+放票，默认）</option>
          <option value="true" ${st.notifyAllDynamics === true ? 'selected' : ''}>全部新片动态都推送（含未星标）</option>
        </select>
      </div>
      <div class="field">
        <label>影院抓取节奏（无星标电影时自动休眠 0 请求）</label>
        <select id="settingRotateMode" class="select">
          <option value="all" ${st.rotateMode !== 'round_robin' ? 'selected' : ''}>标准错峰：每次随机间隔抓 3 家影院</option>
          <option value="round_robin" ${st.rotateMode === 'round_robin' ? 'selected' : ''}>低密度防风控：每次轮转抓 1 家</option>
        </select>
      </div>
      <div class="field">
        <label>全局监听开关</label>
        <select id="settingPaused" class="select">
          <option value="false" ${!st.paused ? 'selected' : ''}>正常监听（有星标电影即运行）</option>
          <option value="true" ${st.paused ? 'selected' : ''}>手动暂停所有抓取</option>
        </select>
      </div>

      <details class="disclosure">
        <summary>高级：手动补充猫眼 Cookie</summary>
        <div class="disclosure-body">
          <div class="field">
            <label>仅在触发风控且冷却仍不恢复时补充</label>
            <textarea id="settingCookie" class="textarea" placeholder="通常留空即可；仅存在你的私有 Gist">${escapeHtml(st.maoyanCookie || '')}</textarea>
          </div>
        </div>
      </details>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" id="saveSettingsBtn" type="button">保存策略</button>
      </div>
    </div>

    <div class="sheet sheet-pad">
      <div class="sheet-header">
        <div>
          <div class="sheet-title">${icon('link')} 朋友配对与设备同步</div>
          <div class="muted">${isPaired() ? '已完成配对 · 可一键分享给朋友或粘贴配对链接导入' : '请粘贴收到的 #pair= 配对链接一键导入'}</div>
        </div>
      </div>

      <div class="field">
        <label>快速导入（整条粘贴朋友链接即可）</label>
        <div class="row">
          <input id="quickPairUrlInput" class="input" style="flex:1" placeholder="https://...#pair=..." />
          <button class="btn btn-crimson btn-sm" id="importPairUrlBtn" type="button">一键导入</button>
        </div>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-soft" style="flex:1" id="sharePairLinkBtn" type="button">${icon('link')} 生成朋友专属配对链接</button>
      </div>
      ${
        appState.pairingFeedback
          ? `<div class="muted" style="margin-top:8px;color:${appState.pairingFeedback.ok ? 'var(--green)' : 'var(--crimson)'}">${escapeHtml(appState.pairingFeedback.text)}</div>`
          : isPaired()
            ? `<div class="muted" style="margin-top:8px;color:var(--green)">已连接私有 Gist（${escapeHtml(cfg.gistId.slice(0, 8))}...，共 ${subs.length} 台设备）</div>`
            : `<div class="muted" style="margin-top:8px">尚未配对：请粘入配对链接，或在下方开发者配置填入参数。</div>`
      }

      <details class="disclosure" ${!isPaired() ? 'open' : ''}>
        <summary>开发者高级配置（Token / Gist / VAPID / Cron 定时）</summary>
        <div class="disclosure-body">
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
            <label>GitHub PAT（仅存本机）</label>
            <input id="cfgToken" type="password" class="input" value="${escapeHtml(cfg.token)}" placeholder="ghp_... 或 github_pat_..." />
          </div>
          <div class="field">
            <label>私有 Gist ID</label>
            <div class="row">
              <input id="cfgGistId" class="input" style="flex:1" value="${escapeHtml(cfg.gistId)}" placeholder="32位私有 Gist ID" />
              <button class="btn btn-gold btn-sm" id="autoCreateGistBtn" type="button">新建 Gist</button>
            </div>
          </div>
          <div class="row" style="margin-top:8px;margin-bottom:14px">
            <button class="btn btn-primary btn-sm" id="savePairingBtn" type="button">保存配对并同步</button>
          </div>

          <div class="section-label">VAPID 密钥与 cron-job.org 参数</div>
          <div class="row" style="margin-bottom:8px">
            <button class="btn btn-sm btn-soft" id="genVapidBtn" type="button">${icon('key')} 生成本机 VAPID 密钥</button>
            ${vapidPub ? `<button class="btn btn-sm btn-soft" id="copyVapidPubBtn" type="button">复制公钥</button>` : ''}
            ${appState.generatedVapid?.privateKey ? `<button class="btn btn-sm btn-soft" id="copyVapidPrivBtn" type="button">复制私钥</button>` : ''}
          </div>
          ${
            vapidPub
              ? `<div class="code-box" style="margin-bottom:10px">VAPID_PUBLIC_KEY = ${escapeHtml(vapidPub)}${
                  appState.generatedVapid?.privateKey
                    ? `\nVAPID_PRIVATE_KEY = ${escapeHtml(appState.generatedVapid.privateKey)}`
                    : '\n(私钥已配置在 GitHub Secrets 中)'
                }\nRADAR_GIST_ID = ${escapeHtml(cfg.gistId || '待配置')}</div>`
              : ''
          }
          <div class="code-box">URL: ${escapeHtml(workflowDispatchUrl)}
Method: POST · Schedule: * * * * * 或 */2 * * * *
Body: {"ref":"main","inputs":{"mode":"tick"}}</div>
          <div class="row" style="margin-top:8px">
            <button class="btn btn-sm btn-soft" id="copyCronUrlBtn" type="button">复制 URL</button>
            <button class="btn btn-sm btn-soft" id="copyCronBodyBtn" type="button">复制 Body</button>
          </div>
        </div>
      </details>
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
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    if (hadController) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    appState.swReg = reg;
    reg.update().catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reg.update().catch(() => undefined);
      }
    });
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
  startCountdownTicker();
  await syncAllData({ silent: true });
  startOrStopSentinelTimer();
  if (appState.sentinel.keepAwake) {
    toggleWakeLock(true);
  }
}

bootstrap();
