/**
 * Multi-platform score & metadata enrichment with strict bilingual (中英) + year + director/cast verification:
 * - Maoyan detailmovie (`enm`, `sc`, `snum`, `cat`, `dur`, `dir`, `pubDesc`)
 * - Douban (`movie.douban.com/j/subject_suggest` + `m.douban.com/rexxar/api/v2/movie/<id>`)
 * - IMDb (`v2/v3.sg.media-imdb.com/suggestion` with BOTH Chinese & English queries + `api.agregarr.org`, optional OMDb)
 * - Rotten Tomatoes (`www.rottentomatoes.com/search` + detail page with strict title/year/cast guard)
 */

import { shiftDateStr } from './config.mjs';
import { fetchMaoyanMovieDetail, jitterDelay, sleep } from './maoyan.mjs';

export const INTEL_MATCH_VERSION = 3;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SEQUEL_TOKENS = new Set(['2', '3', '4', '5', '6', 'ii', 'iii', 'iv', 'v', 'two', 'three', 'four']);
const STOP_TOKENS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for']);
const MANDARIN_PINYIN_SYLLABLE_RE =
  /^(?:[bpmfdtnlgkhjqxrzcsyw]|[zcs]h)?(?:a|o|e|ai|ei|ao|ou|an|en|ang|eng|ong|er|i|ia|io|ie|iu|iao|ian|in|iang|ing|iong|u|ua|uo|uai|ui|uan|un|uang|ueng|v|ve|van|vn)$/;

export function looksLikeMandarinPinyinOf(latinStr = '', zhTargets = []) {
  const cleaned = String(latinStr || '').trim();
  if (!cleaned || /[:\d]/.test(cleaned)) return false;
  const tokens = cleaned
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2) return false;
  if (!tokens.every((t) => MANDARIN_PINYIN_SYLLABLE_RE.test(t))) return false;

  return (zhTargets || []).some((zh) => {
    const cjk = String(zh || '').match(/[\u4e00-\u9fff]/g) || [];
    return cjk.length >= 2 && tokens.length === cjk.length;
  });
}

export function extractYear(dateStr = '') {
  const m = String(dateStr || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function normalizeTitle(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s:：·\-—_'’"“”()（）.,!?！？]+/g, '');
}

function stripYearSuffix(s = '') {
  return String(s || '').replace(/\s*[\(（]\d{4}[\)）]\s*$/g, '').trim();
}

function stripLeadingArticles(s = '') {
  return String(s || '').replace(/^(the|a|an)\s+/i, '').trim();
}

export function tokenizeLatin(s = '') {
  return stripYearSuffix(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 1);
}

function hasLatinLetters(s = '') {
  return /[a-zA-Z]/.test(String(s || ''));
}

function normalizePersonNames(raw = '') {
  return String(raw || '')
    .split(/[,，/、]+/)
    .map((x) => normalizeTitle(x))
    .filter((x) => x.length >= 2);
}

/**
 * Computes strict title similarity (0..100). Returns 0 when two titles do not genuinely match.
 */
export function scoreStrictTitleMatch(candRaw = '', targetRaw = '') {
  const cClean = stripYearSuffix(candRaw);
  const tClean = stripYearSuffix(targetRaw);
  const nC = normalizeTitle(cClean);
  const nT = normalizeTitle(tClean);
  if (!nC || !nT) return 0;

  if (nC === nT) return 100;

  const aC = normalizeTitle(stripLeadingArticles(cClean));
  const aT = normalizeTitle(stripLeadingArticles(tClean));
  if (aC && aT && aC === aT) return 96;

  // Reject single- or two-character Latin titles like "V" unless exact match above succeeded
  if (hasLatinLetters(tClean) && !/[\u4e00-\u9fff]/.test(tClean) && nT.length <= 2) {
    return 0;
  }

  const cTokens = tokenizeLatin(cClean);
  const tTokens = tokenizeLatin(tClean);
  if (cTokens.length > 0 && tTokens.length > 0) {
    // Prevent "Dune" matching "Dune: Part Three" when sequel markers differ
    const cSeq = cTokens.filter((t) => SEQUEL_TOKENS.has(t)).join(',');
    const tSeq = tTokens.filter((t) => SEQUEL_TOKENS.has(t)).join(',');
    if (cSeq !== tSeq) return 0;

    const cCore = cTokens.filter((t) => !STOP_TOKENS.has(t));
    const tCore = tTokens.filter((t) => !STOP_TOKENS.has(t));
    if (cCore.length >= 2 && tCore.length >= 2) {
      const cSet = new Set(cCore);
      const tSet = new Set(tCore);
      let inter = 0;
      for (const w of cSet) {
        if (tSet.has(w)) inter++;
      }
      const union = new Set([...cSet, ...tSet]).size;
      const jaccard = union > 0 ? inter / union : 0;
      if (inter >= 2 && jaccard >= 0.8) return 78;
      if (inter >= 2 && jaccard >= 0.65 && (aC.startsWith(aT) || aT.startsWith(aC))) return 64;
    }
    return 0;
  }

  // CJK partial check (only for re-release tags etc. on >= 4-char CJK titles without sequel digits)
  if (/[\u4e00-\u9fff]/.test(tClean) && /[\u4e00-\u9fff]/.test(cClean)) {
    const minLen = Math.min(nC.length, nT.length);
    const maxLen = Math.max(nC.length, nT.length);
    if (minLen >= 4 && minLen / maxLen >= 0.65 && (nC.includes(nT) || nT.includes(nC))) {
      return 68;
    }
  }

  return 0;
}

export function scoreTitleCandidate(
  { candTitle = '', candSubTitle = '', candYear = null, candDirectors = [] },
  { title = '', enm = '', akaList = [], year = null, allowedYears = [], directors = [] }
) {
  const candStrings = [candTitle, candSubTitle].filter(Boolean);
  const targetStrings = Array.from(new Set([title, enm, ...akaList].filter(Boolean)));

  let titleScore = 0;
  for (const cs of candStrings) {
    for (const ts of targetStrings) {
      titleScore = Math.max(titleScore, scoreStrictTitleMatch(cs, ts));
    }
  }

  // Never allow year/director bonuses to create a match when titles do not match
  if (titleScore === 0) {
    return -999;
  }

  let score = titleScore;
  const yearsToCheck = Array.from(
    new Set([year, ...allowedYears].map((y) => Number(y)).filter((y) => y >= 1900 && y <= 2100))
  );

  if (candYear && yearsToCheck.length > 0) {
    const minDiff = Math.min(...yearsToCheck.map((y) => Math.abs(Number(candYear) - y)));
    if (minDiff === 0) score += 40;
    else if (minDiff === 1) score += 25;
    else if (minDiff === 2) score -= 10;
    else score -= 200; // Hard reject wrong-era movies
  } else if (!candYear && yearsToCheck.length > 0 && tokenizeLatin(enm || title).length <= 1) {
    score -= 100;
  }

  if (directors.length > 0 && candDirectors.length > 0) {
    const cDirs = new Set(candDirectors.map((d) => normalizeTitle(d)).filter((x) => x.length >= 2));
    const hasDirOverlap = directors.some((d) => cDirs.has(d));
    score += hasDirOverlap ? 60 : -120;
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

async function queryImdbSuggestion(query, fetchImpl = fetch) {
  const q = String(query || '').trim();
  if (!q) return [];
  const first = q[0].toLowerCase().replace(/[^a-z0-9]/g, 'x') || 'x';
  for (const host of ['v2.sg.media-imdb.com', 'v3.sg.media-imdb.com']) {
    try {
      const sug = await fetchJsonSafe(
        `https://${host}/suggestion/${first}/${encodeURIComponent(q)}.json`,
        {},
        8000,
        fetchImpl
      );
      if (Array.isArray(sug?.d)) return sug.d;
    } catch {
      // try next IMDb suggestion host
    }
  }
  return [];
}

export async function fetchDoubanIntel({ title, enm = '', year = null, dir = '', knownId = '', fetchImpl = fetch }) {
  const directors = normalizePersonNames(dir);
  const candidateIds = [];

  if (knownId) {
    candidateIds.push({ id: String(knownId), subTitle: '', bothZhEnMatch: false, delayedYearCheck: false });
  } else if (title) {
    const list = await fetchJsonSafe(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`,
      { Referer: 'https://movie.douban.com/' },
      8000,
      fetchImpl
    );
    const moviesOnly = (Array.isArray(list) ? list : []).filter((item) => item.type === 'movie');
    const scored = moviesOnly
      .map((c) => {
        const candYear = extractYear(c.year);
        const zhScore = scoreStrictTitleMatch(c.title, title);
        const enScore = enm ? Math.max(scoreStrictTitleMatch(c.sub_title, enm), scoreStrictTitleMatch(c.title, enm)) : 0;
        const bothZhEnMatch = zhScore >= 96 && enScore >= 96;
        let s = scoreTitleCandidate(
          { candTitle: c.title, candSubTitle: c.sub_title, candYear },
          { title, enm, year }
        );
        if (bothZhEnMatch && s < 0) {
          s = 90;
        }
        const isDelayedImport = Boolean(
          zhScore === 100 && candYear && year && candYear <= year && (year - candYear) <= 10
        );
        if (isDelayedImport && s < 86) {
          s = 86;
        }
        const delayedYearCheck = Boolean(
          candYear && year && Math.abs(candYear - year) >= 3 && !bothZhEnMatch
        );
        return {
          id: String(c.id),
          subTitle: c.sub_title || '',
          bothZhEnMatch,
          delayedYearCheck,
          score: s + (bothZhEnMatch ? 60 : 0)
        };
      })
      .filter((c) => c.score >= 85)
      .sort((a, b) => b.score - a.score);

    for (const c of scored.slice(0, 3)) {
      candidateIds.push({
        id: c.id,
        subTitle: c.subTitle,
        bothZhEnMatch: c.bothZhEnMatch,
        delayedYearCheck: c.delayedYearCheck
      });
    }
  }

  for (const cand of candidateIds) {
    const detail = await fetchJsonSafe(
      `https://m.douban.com/rexxar/api/v2/movie/${encodeURIComponent(cand.id)}`,
      { Referer: `https://m.douban.com/movie/subject/${cand.id}/` },
      8000,
      fetchImpl
    );

    const detailDirs = (detail?.directors || []).map((d) => d?.name || '').filter(Boolean);
    const doubanYear = extractYear(detail?.year);
    const allDbTitles = [detail?.title, detail?.original_title, ...(detail?.aka || []), cand.subTitle].filter(Boolean);

    let hasDirOverlap = false;
    if (directors.length > 0 && detailDirs.length > 0) {
      const cDirs = new Set(detailDirs.map((d) => normalizeTitle(d)).filter((x) => x.length >= 2));
      hasDirOverlap = directors.some((d) => cDirs.has(d));
    }
    const hasEnAkaMatch = Boolean(
      enm &&
      [detail?.original_title, ...(detail?.aka || []), cand.subTitle]
        .filter(Boolean)
        .some((t) => scoreStrictTitleMatch(t, enm) >= 96)
    );

    if (!knownId) {
      if (cand.delayedYearCheck) {
        if (!hasDirOverlap && !hasEnAkaMatch) {
          continue;
        }
      } else if (directors.length > 0 && detailDirs.length > 0 && !hasDirOverlap) {
        const strongBilingualYear = Boolean(
          cand.bothZhEnMatch && doubanYear && year && Math.abs(doubanYear - year) <= 1
        );
        if (!strongBilingualYear) {
          continue;
        }
      }
    }

    const val = Number(detail?.rating?.value || 0);
    const count = Number(detail?.rating?.count || 0);
    const origLatin = hasLatinLetters(detail?.original_title || '') ? detail.original_title : '';
    const akaLatin = (detail?.aka || []).find((a) => hasLatinLetters(a)) || '';

    return {
      doubanId: cand.id,
      doubanUrl: `https://movie.douban.com/subject/${cand.id}/`,
      doubanScore: val > 0 ? val : null,
      doubanVotes: count > 0 ? count : 0,
      doubanYear,
      doubanOrigTitle: detail?.original_title || '',
      doubanAka: detail?.aka || [],
      doubanTitles: allDbTitles,
      enmFromDouban: origLatin || akaLatin || cand.subTitle || ''
    };
  }

  return null;
}

export async function fetchImdbIntel({
  enm = '',
  title = '',
  akaList = [],
  zhTitles = [],
  year = null,
  allowedYears = [],
  dir = '',
  knownId = '',
  omdbApiKey = '',
  fetchImpl = fetch
}) {
  let imdbId = knownId || '';
  let imdbTitle = '';
  let imdbYear = null;
  let imdbActors = '';
  let matchedByZhEn = false;

  if (!imdbId) {
    const zhQuery = /[\u4e00-\u9fff]/.test(String(title || '')) ? String(title).trim() : '';
    const enCand = [enm, ...akaList].find((t) => hasLatinLetters(t) && normalizeTitle(t).length >= 2) || '';
    const enQuery = enCand && normalizeTitle(enCand) !== normalizeTitle(zhQuery) ? enCand.trim() : '';

    const [zhList, enList] = await Promise.all([
      zhQuery ? queryImdbSuggestion(zhQuery, fetchImpl) : Promise.resolve([]),
      enQuery ? queryImdbSuggestion(enQuery, fetchImpl) : Promise.resolve([])
    ]);

    const zhMovies = zhList.filter((x) => x.id?.startsWith('tt') && (!x.qid || x.qid === 'movie' || x.qid === 'tvSpecial'));
    const enMovies = enList.filter((x) => x.id?.startsWith('tt') && (!x.qid || x.qid === 'movie' || x.qid === 'tvSpecial'));

    const zhIds = new Set(zhMovies.map((x) => x.id));
    const enIds = new Set(enMovies.map((x) => x.id));
    const mergedById = new Map();
    for (const c of [...zhMovies, ...enMovies]) {
      if (!mergedById.has(c.id)) mergedById.set(c.id, c);
    }

    const yearsPool = Array.from(
      new Set([year, ...allowedYears].map((y) => Number(y)).filter((y) => y >= 1900 && y <= 2100))
    );
    const hasChineseDir = /[\u4e00-\u9fff]/.test(String(dir || ''));
    const isSingleWordEn = enQuery ? tokenizeLatin(enQuery).length <= 1 : true;
    const zhPool = Array.from(new Set([title, ...zhTitles].filter((t) => /[\u4e00-\u9fff]/.test(String(t || '')))));

    let best = null;
    let bestScore = -999;

    for (const c of mergedById.values()) {
      const hitZh = zhIds.has(c.id);
      const hitEn = enIds.has(c.id);
      const candYear = c.y ? Number(c.y) : null;
      const isMultiWordExactMatch = tokenizeLatin(enQuery || enm).length >= 2 && scoreStrictTitleMatch(c.l, enQuery || enm) >= 96;
      const allowDelayedBilingual = hitZh && hitEn && isMultiWordExactMatch;

      // Reject hard year mismatches (>= 3 years off) unless dual Chinese+English multi-word hit confirms delayed release
      if (candYear && yearsPool.length > 0 && !allowDelayedBilingual) {
        const minDiff = Math.min(...yearsPool.map((y) => Math.abs(candYear - y)));
        if (minDiff >= 3) continue;
      }

      let base = scoreTitleCandidate(
        { candTitle: c.l, candYear },
        { title, enm: enQuery || enm, akaList, year, allowedYears }
      );
      if (allowDelayedBilingual && base < 0) {
        base = 96;
      }

      if (hitZh) {
        if (base < 0) {
          // Only allow a zh-only IMDb hit when its title fails enm/akaList IF it is rank #0, within <=2y, AND matches Mandarin pinyin of Chinese title/aliases (e.g. "Yu Jin", "Ye ye nai nai na xie shi"). Never let unrelated foreign titles like "Corpus" or "Godzilla X Kong" pass blindly.
          const zhRank = zhMovies.findIndex((z) => z.id === c.id);
          const minDiff = candYear && yearsPool.length > 0 ? Math.min(...yearsPool.map((y) => Math.abs(candYear - y))) : 99;
          const isPinyin = looksLikeMandarinPinyinOf(c.l, zhPool);
          if (zhRank === 0 && minDiff <= 2 && isPinyin) {
            base = 80 + (minDiff === 0 ? 40 : minDiff === 1 ? 25 : -10);
          } else {
            continue;
          }
        }
        base += hitEn ? 100 : 60;
      } else {
        // English-only hit: block ambiguous 1-word titles on Chinese films (e.g. "Reset", "Crossing", "V") unless exact zh hit
        if (base < 95) continue;
        if (isSingleWordEn && (hasChineseDir || yearsPool.length === 0)) continue;
        if (isSingleWordEn && candYear && yearsPool.length > 0) {
          const minDiff = Math.min(...yearsPool.map((y) => Math.abs(candYear - y)));
          if (minDiff > 1) continue;
        }
      }

      if (base > bestScore) {
        bestScore = base;
        best = { c, hitZh, hitEn };
      }
    }

    if (best && bestScore >= 95) {
      imdbId = best.c.id;
      imdbTitle = best.c.l || '';
      imdbYear = best.c.y ? Number(best.c.y) : null;
      imdbActors = best.c.s || '';
      matchedByZhEn = Boolean(best.hitZh && best.hitEn);
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
          imdbTitle,
          imdbYear,
          imdbActors,
          matchedByZhEn,
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
    imdbVotes: votes > 0 ? votes : 0,
    imdbTitle,
    imdbYear,
    imdbActors,
    matchedByZhEn
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
    const castAttr = block.match(/cast="([^"]*)"/)?.[1] || '';
    if (!href) continue;
    rows.push({
      title,
      year: yearRaw ? Number(yearRaw) : null,
      cast: castAttr,
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

function rtDetailMatchesActors(detailHtml = '', imdbActors = '') {
  if (!imdbActors || !detailHtml) return false;
  const lower = detailHtml.toLowerCase();
  const names = String(imdbActors)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 4);
  if (names.length === 0) return false;
  return names.some((name) => lower.includes(name));
}

export async function fetchRottenTomatoesIntel({
  enm = '',
  title = '',
  akaList = [],
  year = null,
  allowedYears = [],
  dir = '',
  imdbTitle = '',
  imdbYear = null,
  imdbActors = '',
  knownUrl = '',
  fetchImpl = fetch
}) {
  let rtUrl = knownUrl || '';
  let criticsScore = null;
  const hasChineseDir = /[\u4e00-\u9fff]/.test(String(dir || ''));
  const yearsPool = Array.from(
    new Set([year, imdbYear, ...allowedYears].map((y) => Number(y)).filter((y) => y >= 1900 && y <= 2100))
  );

  const latinCandidates = [imdbTitle, enm, ...akaList].filter(
    (t) => hasLatinLetters(t) && normalizeTitle(t).length >= 3
  );
  const query = latinCandidates[0] || '';

  if (!rtUrl) {
    if (!query) return null;
    const isSingleWordQuery = tokenizeLatin(query).length <= 1;

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
      if (isSingleWordQuery) {
        if (!r.year || (yearsPool.length > 0 && Math.min(...yearsPool.map((y) => Math.abs(r.year - y))) > 1)) {
          continue;
        }
      }
      const s = scoreTitleCandidate(
        { candTitle: r.title, candYear: r.year },
        { title: '', enm: query, akaList: latinCandidates, year, allowedYears: yearsPool }
      );
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }

    // Require strict title + compatible year (score >= 95)
    if (best && bestScore >= 95) {
      rtUrl = best.url;
      criticsScore = best.criticsScore;
    }
  }

  if (!rtUrl) return null;

  let audienceScore = null;
  try {
    const detailHtml = await fetchTextSafe(rtUrl, {}, 9000, fetchImpl);
    const isSingleWordQuery = query ? tokenizeLatin(query).length <= 1 : false;
    // For ambiguous single-word titles on Chinese films (e.g. "Crossing", "Reset"), require actor cross-check in RT detail page
    if (isSingleWordQuery && hasChineseDir && imdbActors && !rtDetailMatchesActors(detailHtml, imdbActors)) {
      return null;
    }
    const parsed = parseRottenTomatoesDetailJson(detailHtml);
    if (parsed.criticsScore !== null) criticsScore = parsed.criticsScore;
    if (parsed.audienceScore !== null) audienceScore = parsed.audienceScore;
  } catch {
    // Keep search score if detail page timed out, except ambiguous Chinese single-word titles
    if (query && tokenizeLatin(query).length <= 1 && hasChineseDir) {
      return null;
    }
  }

  return {
    rtUrl,
    rtCriticsScore: criticsScore,
    rtAudienceScore: audienceScore
  };
}

/**
 * Enriches one movie with Maoyan detail (`enm`, `sc`, `cat`, `dur`, `pubDesc`) plus Douban, IMDb, and RT scores.
 * Uses bilingual Chinese+English queries plus year & director/cast cross-checks to prevent false platform matches.
 */
export async function enrichMovieIntel(
  movie,
  prevIntel = {},
  { cookie = '', omdbApiKey = '', tppMatch = null, forceDetailRefresh = false, todayStr = '', fetchImpl = fetch } = {}
) {
  const isCurrent = prevIntel?.matchVersion === INTEL_MATCH_VERSION;
  const basePrev = isCurrent ? prevIntel : {};
  // Keep already-verified Douban ID/score passed from monitor.mjs while re-verifying IMDb/RT under v3
  const doubanPrev = isCurrent || prevIntel?.doubanId ? prevIntel : {};
  const tppEnm = tppMatch?.showNameEn && hasLatinLetters(tppMatch.showNameEn) ? tppMatch.showNameEn : '';

  const next = {
    matchVersion: INTEL_MATCH_VERSION,
    movieId: Number(movie.id),
    enm: prevIntel.enm || tppEnm || '',
    cat: prevIntel.cat || '',
    dur: prevIntel.dur || 0,
    dir: prevIntel.dir || '',
    origRt: basePrev.origRt || prevIntel.origRt || '',
    pubDesc: prevIntel.pubDesc || '',
    maoyanScore: Number(movie.sc || prevIntel.maoyanScore || 0) || null,
    maoyanVotes: prevIntel.maoyanVotes || 0,
    doubanId: doubanPrev.doubanId || '',
    doubanUrl: doubanPrev.doubanUrl || '',
    doubanScore: doubanPrev.doubanScore ?? null,
    doubanVotes: doubanPrev.doubanVotes || 0,
    doubanYear: doubanPrev.doubanYear ?? null,
    doubanAka: Array.isArray(doubanPrev.doubanAka) ? doubanPrev.doubanAka : [],
    doubanZhAka: Array.isArray(doubanPrev.doubanZhAka) ? doubanPrev.doubanZhAka : [],
    doubanMetaLoaded: Boolean(doubanPrev.doubanMetaLoaded),
    imdbId: basePrev.imdbId || '',
    imdbUrl: basePrev.imdbUrl || '',
    imdbScore: basePrev.imdbScore ?? null,
    imdbVotes: basePrev.imdbVotes || 0,
    imdbTitle: basePrev.imdbTitle || '',
    imdbYear: basePrev.imdbYear ?? null,
    imdbActors: basePrev.imdbActors || '',
    rtUrl: basePrev.rtUrl || '',
    rtCriticsScore: basePrev.rtCriticsScore ?? null,
    rtAudienceScore: basePrev.rtAudienceScore ?? null,
    tppId: tppMatch?.tppId || prevIntel.tppId || null,
    tppWish: tppMatch?.tppWish ?? prevIntel.tppWish ?? null,
    tppScore: tppMatch?.tppScore ?? prevIntel.tppScore ?? null,
    checkedAt: new Date().toISOString()
  };

  if (!next.pubDesc || !next.origRt || forceDetailRefresh) {
    try {
      const dm = await fetchMaoyanMovieDetail(movie.id, { cookie, fetchImpl });
      if (dm.ok && dm.data) {
        next.enm = dm.data.enm || next.enm;
        next.cat = dm.data.cat || next.cat;
        next.dur = dm.data.dur || next.dur;
        next.dir = dm.data.dir || next.dir;
        next.origRt = dm.data.rt || next.origRt;
        next.pubDesc = dm.data.pubDesc || next.pubDesc;
        if (dm.data.sc > 0) next.maoyanScore = dm.data.sc;
        if (dm.data.snum > 0) next.maoyanVotes = dm.data.snum;
      }
    } catch {
      // Ignore transient detailmovie error
    }
  }

  const maoyanYear = extractYear(next.origRt || movie.rt || next.pubDesc);
  const akaList = [...(next.doubanAka || [])];
  const zhTitles = [...(next.doubanZhAka || [])];

  // Douban (matched by Chinese + English + director/year)
  const isFarFuture = Boolean(
    todayStr &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(movie.rt || '').trim()) &&
    String(movie.rt).trim() > shiftDateStr(todayStr, 7)
  );
  if (!(isFarFuture && next.doubanId && next.doubanMetaLoaded) && (!next.doubanScore || !next.doubanId || !next.doubanYear || !next.doubanMetaLoaded)) {
    try {
      await sleep(jitterDelay(250, 500));
      const db = await fetchDoubanIntel({
        title: movie.nm,
        enm: next.enm,
        year: maoyanYear,
        dir: next.dir,
        knownId: next.doubanId,
        fetchImpl
      });
      if (db) {
        next.doubanId = db.doubanId;
        next.doubanUrl = db.doubanUrl;
        next.doubanMetaLoaded = true;
        if (db.doubanScore !== null) next.doubanScore = db.doubanScore;
        if (db.doubanVotes > 0) next.doubanVotes = db.doubanVotes;
        if (db.doubanYear) next.doubanYear = db.doubanYear;
        if (!hasLatinLetters(next.enm) && db.enmFromDouban) next.enm = db.enmFromDouban;
        const latinAlias = [];
        const zhAlias = [];
        for (const t of [db.doubanOrigTitle, ...(db.doubanAka || [])]) {
          if (!t) continue;
          if (hasLatinLetters(t)) latinAlias.push(t);
          if (/[\u4e00-\u9fff]/.test(t)) zhAlias.push(t);
        }
        next.doubanAka = Array.from(new Set([...(next.doubanAka || []), ...latinAlias])).slice(0, 8);
        next.doubanZhAka = Array.from(new Set([...(next.doubanZhAka || []), ...zhAlias])).slice(0, 8);
        akaList.push(...latinAlias);
        zhTitles.push(...zhAlias);
      }
    } catch {
      // Keep previous Douban state
    }
  }

  const dedupAkaList = Array.from(new Set(akaList));
  const dedupZhTitles = Array.from(new Set(zhTitles));

  // Prefer Douban's true production year when Maoyan shows a later re-release date (e.g. Dune 2021 re-released in 2026)
  const isRerelease = /重映|4k|imax/i.test(movie.nm || '');
  const primaryYear =
    next.doubanYear && maoyanYear && Math.abs(next.doubanYear - maoyanYear) >= 3 && (isRerelease || maoyanYear >= 2025)
      ? next.doubanYear
      : (maoyanYear || next.doubanYear);
  const allowedYears = Array.from(new Set([primaryYear, next.doubanYear, maoyanYear].filter(Boolean)));
  if (primaryYear === next.doubanYear && maoyanYear && Math.abs(next.doubanYear - maoyanYear) >= 3 && isRerelease) {
    // Exclude re-release year for classics explicitly labeled as re-releases
    allowedYears.splice(0, allowedYears.length, next.doubanYear);
  }

  // IMDb (simultaneous Chinese + English lookup with strict year & bilingual cross-verification)
  if (!next.imdbScore || !next.imdbId) {
    try {
      await sleep(jitterDelay(200, 450));
      const im = await fetchImdbIntel({
        enm: next.enm,
        title: movie.nm,
        akaList: dedupAkaList,
        zhTitles: dedupZhTitles,
        year: primaryYear,
        allowedYears,
        dir: next.dir,
        knownId: next.imdbId,
        omdbApiKey,
        fetchImpl
      });
      if (im) {
        next.imdbId = im.imdbId;
        next.imdbUrl = im.imdbUrl;
        if (im.imdbScore !== null) next.imdbScore = im.imdbScore;
        if (im.imdbVotes > 0) next.imdbVotes = im.imdbVotes;
        if (im.imdbTitle) next.imdbTitle = im.imdbTitle;
        if (im.imdbYear) next.imdbYear = im.imdbYear;
        if (im.imdbActors) next.imdbActors = im.imdbActors;
        if (next.rtCriticsScore === null && im.rtFromOmdb !== undefined && im.rtFromOmdb !== null) {
          next.rtCriticsScore = im.rtFromOmdb;
        }
      }
    } catch {
      // Keep previous IMDb state
    }
  }

  // Rotten Tomatoes (strict title + year + actor verification)
  const hasChineseDir = /[\u4e00-\u9fff]/.test(String(next.dir || ''));
  const skipDomesticRt = Boolean(!next.rtUrl && hasChineseDir && !hasLatinLetters(next.enm) && !next.imdbTitle);
  if (!skipDomesticRt && (next.rtCriticsScore === null || !next.rtUrl)) {
    try {
      await sleep(jitterDelay(250, 550));
      const rt = await fetchRottenTomatoesIntel({
        enm: next.enm,
        title: movie.nm,
        akaList: dedupAkaList,
        year: primaryYear,
        allowedYears,
        dir: next.dir,
        imdbTitle: next.imdbTitle,
        imdbYear: next.imdbYear,
        imdbActors: next.imdbActors,
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
