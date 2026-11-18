/**
 * Multi-platform score & metadata enrichment:
 * - Maoyan detailmovie (`enm`, `sc`, `snum`, `cat`, `dur`, `pubDesc`)
 * - Douban (`movie.douban.com/j/subject_suggest` + `m.douban.com/rexxar/api/v2/movie/<id>`)
 * - IMDb (`v2.sg.media-imdb.com/suggestion` + `api.agregarr.org/api/ratings`, optional OMDb)
 * - Rotten Tomatoes (`www.rottentomatoes.com/search` + detail page Popcornmeter)
 */

import { fetchMaoyanMovieDetail, jitterDelay, sleep } from './maoyan.mjs';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function extractYear(dateStr = '') {
  const m = String(dateStr || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function normalizeTitle(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s:：·\-—_'’"“”()（）.,!?！？]+/g, '');
}

export function scoreTitleCandidate({ candTitle = '', candSubTitle = '', candYear = null }, { title = '', enm = '', year = null }) {
  let score = 0;
  const nTitle = normalizeTitle(title);
  const nEnm = normalizeTitle(enm);
  const nCand = normalizeTitle(candTitle);
  const nSub = normalizeTitle(candSubTitle);

  if (nTitle && nCand === nTitle) score += 80;
  else if (nTitle && (nCand.includes(nTitle) || nTitle.includes(nCand))) score += 28;

  if (nEnm && (nCand === nEnm || nSub === nEnm)) score += 80;
  else if (nEnm && (nCand.includes(nEnm) || nSub.includes(nEnm))) score += 28;

  if (year && candYear) {
    const diff = Math.abs(Number(year) - Number(candYear));
    if (diff === 0) score += 35;
    else if (diff === 1) score += 20;
    else if (diff >= 3) score -= 25;
  }
  return score;
}

async function fetchTextSafe(url, headers = {}, timeoutMs = 8000, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': BROWSER_UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJsonSafe(url, headers = {}, timeoutMs = 8000, fetchImpl = fetch) {
  const text = await fetchTextSafe(url, headers, timeoutMs, fetchImpl);
  return JSON.parse(text);
}

export async function fetchDoubanIntel({ title, enm = '', year = null, knownId = '', fetchImpl = fetch }) {
  let doubanId = knownId || '';
  let subTitleFromDouban = '';

  if (!doubanId && title) {
    const list = await fetchJsonSafe(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
      { Referer: 'https://movie.douban.com/' },
      8000,
      fetchImpl
    );
    const moviesOnly = (Array.isArray(list) ? list : []).filter((item) => item.type === 'movie');
    let best = null;
    let bestScore = -999;
    for (const c of moviesOnly) {
      const s = scoreTitleCandidate(
        { candTitle: c.title, candSubTitle: c.sub_title, candYear: extractYear(c.year) },
        { title, enm, year }
      );
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best && bestScore >= 25) {
      doubanId = String(best.id);
      subTitleFromDouban = best.sub_title || '';
    }
  }

  if (!doubanId) return null;

  const detail = await fetchJsonSafe(
    `https://m.douban.com/rexxar/api/v2/movie/${encodeURIComponent(doubanId)}`,
    { Referer: `https://m.douban.com/movie/subject/${doubanId}/` },
    8000,
    fetchImpl
  );

  const val = Number(detail?.rating?.value || 0);
  const count = Number(detail?.rating?.count || 0);

  return {
    doubanId,
    doubanUrl: `https://movie.douban.com/subject/${doubanId}/`,
    doubanScore: val > 0 ? val : null,
    doubanVotes: count > 0 ? count : 0,
    enmFromDouban: subTitleFromDouban
  };
}

export async function fetchImdbIntel({ enm = '', title = '', year = null, knownId = '', omdbApiKey = '', fetchImpl = fetch }) {
  let imdbId = knownId || '';

  if (!imdbId) {
    const query = (enm || title || '').trim();
    if (!query) return null;
    const first = query[0].toLowerCase().replace(/[^a-z0-9]/g, 'x') || 'x';
    const sug = await fetchJsonSafe(
      `https://v2.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(query)}.json`,
      {},
      8000,
      fetchImpl
    );
    const candidates = (sug?.d || []).filter((x) => x.id?.startsWith('tt') && (!x.qid || x.qid === 'movie'));
    let best = null;
    let bestScore = -999;
    for (const c of candidates) {
      const s = scoreTitleCandidate(
        { candTitle: c.l, candYear: c.y },
        { title, enm: query, year }
      );
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best && bestScore >= 25) {
      imdbId = best.id;
    }
  }

  if (!imdbId) return null;

  if (omdbApiKey) {
    try {
      const omdb = await fetchJsonSafe(
        `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(omdbApiKey)}`,
        {},
        8000,
        fetchImpl
      );
      const val = Number(omdb?.imdbRating);
      const votes = Number(String(omdb?.imdbVotes || '').replace(/,/g, ''));
      const rtStr = (omdb?.Ratings || []).find((r) => r.Source === 'Rotten Tomatoes')?.Value || '';
      const rtMatch = rtStr.match(/(\d+)%/);
      if (!Number.isNaN(val) && val > 0) {
        return {
          imdbId,
          imdbUrl: `https://www.imdb.com/title/${imdbId}/`,
          imdbScore: val,
          imdbVotes: Number.isNaN(votes) ? 0 : votes,
          rtFromOmdb: rtMatch ? Number(rtMatch[1]) : null
        };
      }
    } catch {
      // Fall back to agregarr
    }
  }

  const ratings = await fetchJsonSafe(
    `https://api.agregarr.org/api/ratings?id=${encodeURIComponent(imdbId)}`,
    {},
    8000,
    fetchImpl
  );
  const first = Array.isArray(ratings) ? ratings[0] : ratings;
  const ratingVal = Number(first?.rating || 0);
  const votes = Number(first?.votes || 0);

  return {
    imdbId,
    imdbUrl: `https://www.imdb.com/title/${imdbId}/`,
    imdbScore: ratingVal > 0 ? ratingVal : null,
    imdbVotes: votes > 0 ? votes : 0
  };
}

export function parseRottenTomatoesSearchRows(html = '') {
  const rows = [];
  const matches = html.matchAll(/<search-page-media-row([\s\S]*?)<\/search-page-media-row>/g);
  for (const m of matches) {
    const block = m[1];
    const scoreRaw = block.match(/tomatometer-score="([^"]*)"/)?.[1] || '';
    const yearRaw = block.match(/release-year="([^"]*)"/)?.[1] || '';
    const href = block.match(/href="(https:\/\/www\.rottentomatoes\.com\/m\/[^"]+)"/)?.[1] || '';
    const title = block.match(/slot="title"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.trim() || '';
    if (!href) continue;
    rows.push({
      title,
      year: yearRaw ? Number(yearRaw) : null,
      criticsScore: scoreRaw !== '' && !Number.isNaN(Number(scoreRaw)) ? Number(scoreRaw) : null,
      url: href
    });
  }
  return rows;
}

export function parseRottenTomatoesDetailJson(html = '') {
  const criticsBlock = html.match(/"criticsScore"\s*:\s*(\{[^}]+\})/)?.[1];
  const audienceBlock = html.match(/"audienceScore"\s*:\s*(\{[^}]+\})/)?.[1];
  let criticsScore = null;
  let audienceScore = null;
  try {
    if (criticsBlock) {
      const c = JSON.parse(criticsBlock);
      const pct = String(c.scorePercent || '').replace('%', '');
      if (pct !== '' && !Number.isNaN(Number(pct))) criticsScore = Number(pct);
    }
  } catch {
    // ignore
  }
  try {
    if (audienceBlock) {
      const a = JSON.parse(audienceBlock);
      const pct = String(a.scorePercent || '').replace('%', '');
      if (pct !== '' && !Number.isNaN(Number(pct))) audienceScore = Number(pct);
    }
  } catch {
    // ignore
  }
  return { criticsScore, audienceScore };
}

export async function fetchRottenTomatoesIntel({ enm = '', title = '', year = null, knownUrl = '', fetchImpl = fetch }) {
  let rtUrl = knownUrl || '';
  let criticsScore = null;

  if (!rtUrl) {
    const query = (enm || title || '').trim();
    if (!query) return null;
    const html = await fetchTextSafe(
      `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`,
      {},
      9000,
      fetchImpl
    );
    const rows = parseRottenTomatoesSearchRows(html);
    let best = null;
    let bestScore = -999;
    for (const r of rows) {
      const s = scoreTitleCandidate(
        { candTitle: r.title, candYear: r.year },
        { title, enm: query, year }
      );
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    if (best && bestScore >= 25) {
      rtUrl = best.url;
      criticsScore = best.criticsScore;
    }
  }

  if (!rtUrl) return null;

  let audienceScore = null;
  try {
    const detailHtml = await fetchTextSafe(rtUrl, {}, 9000, fetchImpl);
    const parsed = parseRottenTomatoesDetailJson(detailHtml);
    if (parsed.criticsScore !== null) criticsScore = parsed.criticsScore;
    if (parsed.audienceScore !== null) audienceScore = parsed.audienceScore;
  } catch {
    // Keep search score if detail page timed out
  }

  return {
    rtUrl,
    rtCriticsScore: criticsScore,
    rtAudienceScore: audienceScore
  };
}

/**
 * Enriches one movie with Maoyan detail (`enm`, `sc`, `cat`, `dur`, `pubDesc`) plus Douban, IMDb, and RT scores.
 * Each external call is isolated so one platform failing never breaks the others.
 */
export async function enrichMovieIntel(movie, prevIntel = {}, { cookie = '', omdbApiKey = '', fetchImpl = fetch } = {}) {
  const next = {
    movieId: Number(movie.id),
    enm: prevIntel.enm || '',
    cat: prevIntel.cat || '',
    dur: prevIntel.dur || 0,
    dir: prevIntel.dir || '',
    pubDesc: prevIntel.pubDesc || '',
    maoyanScore: Number(movie.sc || prevIntel.maoyanScore || 0) || null,
    maoyanVotes: prevIntel.maoyanVotes || 0,
    doubanId: prevIntel.doubanId || '',
    doubanUrl: prevIntel.doubanUrl || '',
    doubanScore: prevIntel.doubanScore ?? null,
    doubanVotes: prevIntel.doubanVotes || 0,
    imdbId: prevIntel.imdbId || '',
    imdbUrl: prevIntel.imdbUrl || '',
    imdbScore: prevIntel.imdbScore ?? null,
    imdbVotes: prevIntel.imdbVotes || 0,
    rtUrl: prevIntel.rtUrl || '',
    rtCriticsScore: prevIntel.rtCriticsScore ?? null,
    rtAudienceScore: prevIntel.rtAudienceScore ?? null,
    tppWish: prevIntel.tppWish ?? null,
    checkedAt: new Date().toISOString()
  };

  if (!next.enm || !next.pubDesc || !next.maoyanScore) {
    try {
      const dm = await fetchMaoyanMovieDetail(movie.id, { cookie, fetchImpl });
      if (dm.ok && dm.data) {
        next.enm = dm.data.enm || next.enm;
        next.cat = dm.data.cat || next.cat;
        next.dur = dm.data.dur || next.dur;
        next.dir = dm.data.dir || next.dir;
        next.pubDesc = dm.data.pubDesc || next.pubDesc;
        if (dm.data.sc > 0) next.maoyanScore = dm.data.sc;
        if (dm.data.snum > 0) next.maoyanVotes = dm.data.snum;
      }
    } catch {
      // Ignore transient detailmovie error
    }
  }

  const year = extractYear(movie.rt || next.pubDesc);

  // Douban
  if (!next.doubanScore || !next.doubanId) {
    try {
      await sleep(jitterDelay(250, 500));
      const db = await fetchDoubanIntel({
        title: movie.nm,
        enm: next.enm,
        year,
        knownId: next.doubanId,
        fetchImpl
      });
      if (db) {
        next.doubanId = db.doubanId;
        next.doubanUrl = db.doubanUrl;
        if (db.doubanScore !== null) next.doubanScore = db.doubanScore;
        if (db.doubanVotes > 0) next.doubanVotes = db.doubanVotes;
        if (!next.enm && db.enmFromDouban) next.enm = db.enmFromDouban;
      }
    } catch {
      // Keep previous Douban state
    }
  }

  // IMDb
  if (!next.imdbScore || !next.imdbId) {
    try {
      await sleep(jitterDelay(200, 450));
      const im = await fetchImdbIntel({
        enm: next.enm,
        title: movie.nm,
        year,
        knownId: next.imdbId,
        omdbApiKey,
        fetchImpl
      });
      if (im) {
        next.imdbId = im.imdbId;
        next.imdbUrl = im.imdbUrl;
        if (im.imdbScore !== null) next.imdbScore = im.imdbScore;
        if (im.imdbVotes > 0) next.imdbVotes = im.imdbVotes;
        if (next.rtCriticsScore === null && im.rtFromOmdb !== undefined && im.rtFromOmdb !== null) {
          next.rtCriticsScore = im.rtFromOmdb;
        }
      }
    } catch {
      // Keep previous IMDb state
    }
  }

  // Rotten Tomatoes
  if (next.rtCriticsScore === null || !next.rtUrl) {
    try {
      await sleep(jitterDelay(250, 550));
      const rt = await fetchRottenTomatoesIntel({
        enm: next.enm,
        title: movie.nm,
        year,
        knownUrl: next.rtUrl,
        fetchImpl
      });
      if (rt) {
        next.rtUrl = rt.rtUrl;
        if (rt.rtCriticsScore !== null) next.rtCriticsScore = rt.rtCriticsScore;
        if (rt.rtAudienceScore !== null) next.rtAudienceScore = rt.rtAudienceScore;
      }
    } catch {
      // Keep previous RT state
    }
  }

  return next;
}
