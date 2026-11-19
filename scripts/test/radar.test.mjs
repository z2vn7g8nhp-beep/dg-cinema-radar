import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHall, normalizePosterUrl, getBeijingDateStr } from '../lib/config.mjs';
import { detectRiskControl, evaluateShowStatus, fetchMovieCatalog } from '../lib/maoyan.mjs';
import {
  buildConsolidatedAlert,
  computeBackoffMinutes,
  diffWatchlistRound
} from '../lib/radar.mjs';
import { updatePrivateGist } from '../lib/gist.mjs';
import { bootstrapGitHubProject, sealGitHubSecret } from '../bootstrap-github.mjs';
import { INTEL_MATCH_VERSION, fetchDoubanIntel, fetchImdbIntel, fetchRottenTomatoesIntel, looksLikeMandarinPinyinOf, parseRottenTomatoesDetailJson, parseRottenTomatoesSearchRows, scoreTitleCandidate } from '../lib/intel.mjs';
import { attachWishGrowth, buildDynamicsAlert, dedupeCatalogMovies, detectDynamicEvents, updateWishSnapshots } from '../lib/dynamics.mjs';
import { buildMtopSign, fetchTaopiaopiaoCatalog, matchTaopiaopiaoMovie } from '../lib/taopiaopiao.mjs';
import { DYNAMICS_EPOCH_VERSION, resolveBaselineDynamics, selectMoviesForIntelEnrichment } from '../monitor.mjs';
import sodium from 'libsodium-wrappers';
import webpush from 'web-push';

test('classifyHall detects IMAX GT, IMAX, 4DX, ScreenX without false positives on ordinary laser halls', () => {
  const gt = classifyHall('IMAX GT厅(激光)-儿童需购票', 'IMAX2D');
  assert.equal(gt.isImaxGt, true);
  assert.equal(gt.isImax, true);
  assert.equal(gt.isSpecial, true);
  assert.deepEqual(gt.tags, ['IMAX GT']);

  const sx = classifyHall('7号SCREENX激光厅(儿童需购票)', 'SCREENX2D');
  assert.equal(sx.isSpecial, true);
  assert.deepEqual(sx.tags, ['ScreenX']);

  const dx = classifyHall('8号4DX激光厅(儿童需购票)', '4DX2D');
  assert.equal(dx.isSpecial, true);
  assert.deepEqual(dx.tags, ['4DX']);

  const normal = classifyHall('2号杜比全景声激光厅', '2D');
  // 杜比 matches Dolby; ordinary hall without Dolby should not be flagged special
  assert.equal(normal.isSpecial, true);
  const plainLaser = classifyHall('5号激光厅-儿童需购票', '2D');
  assert.equal(plainLaser.isSpecial, false);
  assert.deepEqual(plainLaser.tags, []);
});

test('normalizePosterUrl converts http and w.h template cleanly', () => {
  assert.equal(
    normalizePosterUrl('http://p0.meituan.net/w.h/movie/abc.jpg'),
    'https://p0.meituan.net/300.420/movie/abc.jpg'
  );
});

test('getBeijingDateStr respects UTC+8 boundary', () => {
  // 2026-11-18T17:30:00Z is 2026-11-19 01:30 in Beijing
  assert.equal(getBeijingDateStr(new Date('2026-11-18T17:30:00Z')), '2026-11-19');
});

test('detectRiskControl catches Meituan slider redirect, 403, and HTML challenge pages', () => {
  assert.equal(detectRiskControl({ status: 403, body: '' }).triggered, true);
  assert.equal(
    detectRiskControl({ status: 302, location: 'https://verify.meituan.com/v2/web/general_page?action=spiderindefence', body: '' }).triggered,
    true
  );
  assert.equal(
    detectRiskControl({ status: 200, body: '<!doctype html><html><body>验证中心</body></html>' }).triggered,
    true
  );
  assert.equal(
    detectRiskControl({ status: 200, body: '{"cinemaId":"1485","showData":{"movies":[]}}' }).triggered,
    false
  );
});

test('evaluateShowStatus distinguishes open, scheduled pending pre-sale, and closed shows', () => {
  assert.deepEqual(
    evaluateShowStatus({ enterShowSeat: 1, ticketStatus: 0, forbiddenTip: '' }),
    { alertable: true, state: 'open', saleHint: '' }
  );
  assert.deepEqual(
    evaluateShowStatus({ enterShowSeat: 0, ticketStatus: 0, saleTimeText: '12:00开售', saleDate: '11-20' }),
    { alertable: true, state: 'pending', saleHint: '11-20 12:00开售' }
  );
  assert.deepEqual(
    evaluateShowStatus({ enterShowSeat: 0, ticketStatus: 1, forbiddenTip: '已停售' }),
    { alertable: false, state: 'closed', saleHint: '已停售' }
  );
});

test('diffWatchlistRound triggers on EVERY new wave round until manually stopped', () => {
  const watchlist = [
    {
      id: 'w1',
      movieId: 999,
      title: '奥德赛',
      active: true,
      hallFilter: 'all',
      roundCount: 0
    }
  ];

  // Wave 1: 1485 opens 2 shows
  const wave1Cinemas = [
    {
      ok: true,
      cinemaId: 1485,
      movies: [
        {
          id: 999,
          nm: '奥德赛',
          img: 'https://img/poster.jpg',
          shows: [
            { seqNo: 'S1', dt: '2026-11-25', dateShow: '11月25日', tm: '19:30', th: 'IMAX GT厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX GT'], isImaxGt: true, isImax: true, isSpecial: true, priority: 100 },
            { seqNo: 'S2', dt: '2026-11-25', dateShow: '11月25日', tm: '22:15', th: 'IMAX GT厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX GT'], isImaxGt: true, isImax: true, isSpecial: true, priority: 100 }
          ]
        }
      ]
    }
  ];

  const r1 = diffWatchlistRound({
    watchlist,
    cinemaResults: wave1Cinemas,
    seenMap: {},
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T10:00:00Z'
  });

  assert.equal(r1.findings.length, 1);
  assert.equal(r1.findings[0].round, 1);
  assert.equal(r1.findings[0].totalNew, 2);

  const alert1 = buildConsolidatedAlert(r1.findings, 'https://example.github.io/dg-cinema-radar/');
  assert.match(alert1.title, /第1轮开票/);
  assert.match(alert1.title, /IMAX GT/);
  assert.match(alert1.body, /华南MALL IMAX GT/);

  // Re-poll with no new shows -> 0 findings
  const rSame = diffWatchlistRound({
    watchlist: [{ ...watchlist[0], ...r1.watchUpdates.w1 }],
    cinemaResults: wave1Cinemas,
    seenMap: r1.nextSeenMap,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T10:01:00Z'
  });
  assert.equal(rSame.findings.length, 0);

  // Wave 2: 10418 & 26100 open new shows -> round 2 consolidated alert!
  const wave2Cinemas = [
    ...wave1Cinemas,
    {
      ok: true,
      cinemaId: 10418,
      movies: [
        {
          id: 999,
          nm: '奥德赛',
          shows: [
            { seqNo: 'S3', dt: '2026-11-26', dateShow: '11月26日', tm: '20:00', th: '7号IMAX厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX'], isImaxGt: false, isImax: true, isSpecial: true, priority: 80 }
          ]
        }
      ]
    }
  ];

  const r2 = diffWatchlistRound({
    watchlist: [{ ...watchlist[0], ...r1.watchUpdates.w1 }],
    cinemaResults: wave2Cinemas,
    seenMap: rSame.nextSeenMap,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T12:00:00Z'
  });
  assert.equal(r2.findings.length, 1);
  assert.equal(r2.findings[0].round, 2);
  assert.equal(r2.findings[0].totalNew, 1);

  // Manual stop -> active: false -> 0 findings even when new shows appear
  const rStopped = diffWatchlistRound({
    watchlist: [{ ...watchlist[0], ...r2.watchUpdates.w1, active: false }],
    cinemaResults: [
      {
        ok: true,
        cinemaId: 26100,
        movies: [
          {
            id: 999,
            nm: '奥德赛',
            shows: [
              { seqNo: 'S4', dt: '2026-11-27', tm: '18:00', th: 'IMAX厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX'], isImax: true, isSpecial: true, priority: 80 }
            ]
          }
        ]
      }
    ],
    seenMap: r2.nextSeenMap,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T13:00:00Z'
  });
  assert.equal(rStopped.findings.length, 0);
});

test('pendingBaselineInit skips current shows on first run and catches subsequent round', () => {
  const watchlist = [
    { id: 'w2', keyword: '星际穿越', active: true, hallFilter: 'imax_gt', pendingBaselineInit: true, roundCount: 0 }
  ];
  const tick1 = diffWatchlistRound({
    watchlist,
    cinemaResults: [
      {
        ok: true,
        cinemaId: 1485,
        movies: [
          {
            id: 500,
            nm: '星际穿越 (IMAX重映)',
            shows: [
              { seqNo: 'B1', dt: '2026-11-20', tm: '14:00', th: '2号厅', tp: '2D', alertable: true, state: 'open', tags: [], isImaxGt: false, isImax: false, isSpecial: false, priority: 0 },
              { seqNo: 'B2', dt: '2026-11-20', tm: '19:00', th: 'IMAX GT厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX GT'], isImaxGt: true, isImax: true, isSpecial: true, priority: 100 }
            ]
          }
        ]
      }
    ],
    seenMap: {},
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T10:00:00Z'
  });

  assert.equal(tick1.findings.length, 0);
  assert.equal(tick1.watchUpdates.w2.pendingBaselineInit, false);

  const tick2 = diffWatchlistRound({
    watchlist: [{ ...watchlist[0], ...tick1.watchUpdates.w2 }],
    cinemaResults: [
      {
        ok: true,
        cinemaId: 1485,
        movies: [
          {
            id: 500,
            nm: '星际穿越 (IMAX重映)',
            shows: [
              { seqNo: 'B2', dt: '2026-11-20', tm: '19:00', th: 'IMAX GT厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX GT'], isImaxGt: true, isImax: true, isSpecial: true, priority: 100 },
              { seqNo: 'B3', dt: '2026-11-21', tm: '19:00', th: 'IMAX GT厅', tp: 'IMAX2D', alertable: true, state: 'open', tags: ['IMAX GT'], isImaxGt: true, isImax: true, isSpecial: true, priority: 100 },
              { seqNo: 'B4', dt: '2026-11-21', tm: '15:00', th: '3号厅', tp: '2D', alertable: true, state: 'open', tags: [], isImaxGt: false, isImax: false, isSpecial: false, priority: 0 }
            ]
          }
        ]
      }
    ],
    seenMap: tick1.nextSeenMap,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T11:00:00Z'
  });

  // Only B3 (IMAX GT) passes hallFilter='imax_gt'; B4 (2D) is ignored
  assert.equal(tick2.findings.length, 1);
  assert.equal(tick2.findings[0].totalNew, 1);
  assert.equal(tick2.findings[0].shows[0].seqNo, 'B3');
});

test('computeBackoffMinutes scales 5 -> 15 -> 30 -> 60', () => {
  assert.equal(computeBackoffMinutes(1), 5);
  assert.equal(computeBackoffMinutes(2), 15);
  assert.equal(computeBackoffMinutes(3), 30);
  assert.equal(computeBackoffMinutes(4), 60);
  assert.equal(computeBackoffMinutes(9), 60);
});

test('updatePrivateGist merges concurrent user star without clobbering', async () => {
  let patchedBody = null;
  const fakeFetch = async (_url, init) => {
    if (!init || init.method !== 'PATCH') {
      // Simulate user added w_new while scraper was running
      return new Response(
        JSON.stringify({
          files: {
            'watchlist.json': {
              content: JSON.stringify([
                { id: 'w1', title: 'Movie 1', roundCount: 0, active: true },
                { id: 'w_new', title: 'Movie New', roundCount: 0, active: true }
              ])
            }
          }
        }),
        { status: 200 }
      );
    }
    patchedBody = JSON.parse(init.body);
    return new Response('{}', { status: 200 });
  };

  await updatePrivateGist({
    gistId: 'abc',
    token: 'tok',
    watchUpdates: { w1: { roundCount: 1 } },
    fetchImpl: fakeFetch
  });

  const savedWatchlist = JSON.parse(patchedBody.files['watchlist.json'].content);
  assert.equal(savedWatchlist.length, 2);
  assert.equal(savedWatchlist[0].roundCount, 1);
  assert.equal(savedWatchlist[1].id, 'w_new');
});

test('WebCrypto JWK VAPID key derivation is accepted by web-push', async () => {
  const b64uToU8 = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    return new Uint8Array(Buffer.from((s + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  };
  const u8ToB64u = (b) => Buffer.from(b).toString('base64url');
  const kp = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub.set(b64uToU8(jwk.x), 1);
  pub.set(b64uToU8(jwk.y), 33);
  const publicKey = u8ToB64u(pub);
  const privateKey = jwk.d;
  assert.doesNotThrow(() => webpush.setVapidDetails('mailto:test@example.com', publicKey, privateKey));
});

test('bootstrapGitHubProject creates repo, pushes tree, enables pages, creates gist, and seals 4 secrets', async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  const sodiumPubB64 = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL);

  const calls = [];
  const uploadedSecrets = {};
  const fakeFetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', url });
    const u = String(url);
    if (u === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: 'demo-user' }), { status: 200 });
    }
    if (u === 'https://api.github.com/user/repos') {
      return new Response(JSON.stringify({ name: 'dg-cinema-radar' }), { status: 201 });
    }
    if (u.endsWith('/git/ref/heads/main') && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ object: { sha: 'commit0' } }), { status: 200 });
    }
    if (u.endsWith('/git/commits/commit0')) {
      return new Response(JSON.stringify({ tree: { sha: 'tree0' } }), { status: 200 });
    }
    if (u.endsWith('/git/blobs')) {
      return new Response(JSON.stringify({ sha: 'blob_x' }), { status: 201 });
    }
    if (u.endsWith('/git/trees')) {
      return new Response(JSON.stringify({ sha: 'tree1' }), { status: 201 });
    }
    if (u.endsWith('/git/commits')) {
      return new Response(JSON.stringify({ sha: 'commit1' }), { status: 201 });
    }
    if (u.endsWith('/git/refs/heads/main') && init.method === 'PATCH') {
      return new Response(JSON.stringify({ ref: 'refs/heads/main' }), { status: 200 });
    }
    if (u.endsWith('/pages')) {
      return new Response(JSON.stringify({ html_url: 'https://demo-user.github.io/dg-cinema-radar/' }), { status: 201 });
    }
    if (u === 'https://api.github.com/gists') {
      return new Response(JSON.stringify({ id: 'gist123456' }), { status: 201 });
    }
    if (u.endsWith('/actions/secrets/public-key')) {
      return new Response(JSON.stringify({ key_id: 'kid_1', key: sodiumPubB64 }), { status: 200 });
    }
    if (u.includes('/actions/secrets/')) {
      const name = u.split('/').pop();
      const body = JSON.parse(init.body);
      const sealedBytes = sodium.from_base64(body.encrypted_value, sodium.base64_variants.ORIGINAL);
      const opened = sodium.crypto_box_seal_open(sealedBytes, kp.publicKey, kp.privateKey);
      uploadedSecrets[name] = sodium.to_string(opened);
      return new Response('', { status: 201 });
    }
    if (u.endsWith('/dispatches')) {
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 404 });
  };

  const sealedSample = await sealGitHubSecret(sodiumPubB64, 'secret-val');
  assert.ok(sealedSample.length > 10);

  const res = await bootstrapGitHubProject({
    token: 'ghp_dummy',
    repoName: 'dg-cinema-radar',
    rootDir: process.cwd(),
    fetchImpl: fakeFetch
  });

  assert.equal(res.owner, 'demo-user');
  assert.equal(res.gistId, 'gist123456');
  assert.equal(res.pagesEnabled, true);
  assert.ok(res.uploadedFiles >= 20);
  assert.equal(uploadedSecrets.RADAR_GIST_ID, 'gist123456');
  assert.equal(uploadedSecrets.RADAR_GH_TOKEN, 'ghp_dummy');
  assert.ok(uploadedSecrets.VAPID_PUBLIC_KEY.length > 20);
  assert.equal(uploadedSecrets.VAPID_PRIVATE_KEY.length > 20, true);
  assert.ok(res.pairUrl.includes('#pair='));
});

test('intel parsers extract RT Tomatometer and Popcornmeter and score year/title accurately', () => {
  const rows = parseRottenTomatoesSearchRows(`
    <search-page-media-row release-year="2024" tomatometer-score="92">
      <a href="https://www.rottentomatoes.com/m/dune_part_two" slot="title">Dune: Part Two</a>
    </search-page-media-row>
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].criticsScore, 92);
  assert.equal(rows[0].year, 2024);

  const detail = parseRottenTomatoesDetailJson(
    '"criticsScore":{"scorePercent":"92%"},"audienceScore":{"scorePercent":"95%"}'
  );
  assert.deepEqual(detail, { criticsScore: 92, audienceScore: 95 });

  const sExact = scoreTitleCandidate({ candTitle: 'Dune: Part Two', candYear: 2024 }, { enm: 'Dune: Part Two', year: 2024 });
  const sWrong = scoreTitleCandidate({ candTitle: 'Dune', candYear: 1984 }, { enm: 'Dune: Part Two', year: 2024 });
  assert.ok(sExact > sWrong);
});

test('wish snapshots track daily growth and roll over across Beijing days', () => {
  const snap1 = updateWishSnapshots({}, [{ id: 1, wish: 1000 }, { id: 2, wish: 500 }], '2026-11-18');
  const snap2 = updateWishSnapshots(snap1, [{ id: 1, wish: 1350 }, { id: 2, wish: 520 }], '2026-11-18');
  const withGain = attachWishGrowth([{ id: 1, wish: 1350 }], snap2);
  assert.equal(withGain[0].wishDailyGain, 350);

  const snapNextDay = updateWishSnapshots(snap2, [{ id: 1, wish: 1410 }], '2026-11-19');
  const nextGain = attachWishGrowth([{ id: 1, wish: 1410 }], snapNextDay);
  assert.equal(nextGain[0].wishDailyGain, 60);
  assert.equal(nextGain[0].wishYesterdayGain, 350);
});

test('detectDynamicEvents catches 定档, 改档, 开票, and 开分 across Maoyan/Douban/IMDb/RT', () => {
  const events = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T11:00:00Z',
    prevCatalogMap: {
      '10': { id: 10, nm: '待定新片', rt: '', statusLabel: '想看', sc: 0 },
      '20': { id: 20, nm: '调档大片', rt: '2026-12-01', statusLabel: '想看', sc: 0 },
      '30': { id: 30, nm: '开分大片', rt: '2026-11-18', statusLabel: '预售', sc: 0 }
    },
    currMovies: [
      { id: 10, nm: '待定新片', rt: '2026-12-20', statusLabel: '想看', sc: 0 },
      { id: 20, nm: '调档大片', rt: '2026-12-18', statusLabel: '预售', sc: 0 },
      { id: 30, nm: '开分大片', rt: '2026-11-18', statusLabel: '购票', sc: 9.2 }
    ],
    prevIntelMap: {
      '30': {
        matchVersion: INTEL_MATCH_VERSION,
        checkedAt: '2026-11-18T10:00:00Z',
        doubanScore: null,
        imdbScore: null,
        rtCriticsScore: null
      }
    },
    currIntelMap: {
      '30': {
        matchVersion: INTEL_MATCH_VERSION,
        doubanScore: 8.3,
        imdbScore: 8.1,
        rtCriticsScore: 91
      }
    },
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set([20])
  });

  const types = events.map((e) => e.type);
  assert.ok(types.includes('scheduled'));
  assert.ok(types.includes('rescheduled'));
  assert.ok(types.includes('presale_opened'));
  assert.ok(types.includes('scored'));

  const scoreEv = events.find((e) => e.type === 'scored');
  assert.match(scoreEv.summary, /猫眼 9.2/);
  assert.match(scoreEv.summary, /豆瓣 8.3/);
  assert.match(scoreEv.summary, /IMDb 8.1/);
  assert.match(scoreEv.summary, /烂番茄 91%/);

  const alertAll = buildDynamicsAlert({ events, watchlist: [], notifyAllDynamics: true });
  assert.ok(alertAll);
  assert.match(alertAll.title, /新片动态/);

  const alertDefaultStarOnly = buildDynamicsAlert({
    events,
    watchlist: [{ id: 'w1', movieId: 20, active: true }]
  });
  assert.ok(alertDefaultStarOnly);
  assert.match(alertDefaultStarOnly.body, /调档大片/);
  assert.doesNotMatch(alertDefaultStarOnly.body, /待定新片/);
  assert.equal(buildDynamicsAlert({ events, watchlist: [] }), null);
});

test('taopiaopiao MTOP sign and fuzzy title matcher work cleanly', () => {
  const sig = buildMtopSign('abc123', 1700000000000, '12574478', '{"citycode":"441900"}');
  assert.match(sig, /^[a-f0-9]{32}$/);

  const catalog = {
    ok: true,
    byNormTitle: new Map([
      ['神探之痕迹', { tppId: 1557745, showName: '神探之痕迹', tppWish: 181091, tppScore: 9.5 }],
      ['饥饿游戏收获日出', { tppId: 1529356, showName: '饥饿游戏：收获日出', showNameEn: 'The Hunger Games: Sunrise on the Reaping', tppWish: 24487, tppScore: null }]
    ])
  };

  const m1 = matchTaopiaopiaoMovie({ nm: '神探之痕迹' }, catalog);
  assert.equal(m1.tppWish, 181091);
  assert.equal(m1.tppScore, 9.5);

  const m2 = matchTaopiaopiaoMovie({ nm: '饥饿游戏：收获日出' }, catalog);
  assert.equal(m2.tppWish, 24487);
  assert.equal(m2.showNameEn, 'The Hunger Games: Sunrise on the Reaping');
});

test('selectMoviesForIntelEnrichment refreshes starred/onInfo/near-release movies on 5-min cadence', () => {
  const nowIso = '2026-11-18T12:00:00Z';
  const checked5MinAgo = '2026-11-18T11:55:00Z';
  const checked1MinAgo = '2026-11-18T11:59:00Z';

  const selected = selectMoviesForIntelEnrichment({
    catalogMovies: [
      { id: 1, nm: '刚热映未开分', source: 'onInfo', rt: '2026-11-18', wish: 50000 },
      { id: 2, nm: '即将上映缺失', source: 'coming', rt: '2026-11-20', wish: 40000 },
      { id: 3, nm: '一分钟前刚查', source: 'coming', rt: '2026-11-20', wish: 60000 },
      { id: 4, nm: '明年远期片', source: 'coming', rt: '2027-05-01', wish: 80000 }
    ],
    intelMap: {
      '1': { matchVersion: INTEL_MATCH_VERSION, doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'A', checkedAt: checked5MinAgo },
      '2': { matchVersion: INTEL_MATCH_VERSION, doubanScore: null, imdbScore: null, rtCriticsScore: 75, enm: 'B', checkedAt: checked5MinAgo },
      '3': { matchVersion: INTEL_MATCH_VERSION, doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'C', checkedAt: checked1MinAgo },
      '4': { matchVersion: INTEL_MATCH_VERSION, doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'D', checkedAt: checked5MinAgo }
    },
    activeWatchItems: [],
    nowIso,
    todayStr: '2026-11-18',
    maxBudget: 10
  });

  const ids = selected.map((m) => m.id);
  assert.deepEqual(ids, [1, 2]);
});

test('v2 bilingual matcher rejects deep_water_2026, single-char V collisions, wrong-year films, and prioritizes Chinese+English IMDb hits', async () => {
  // 1. Year-only match must never pass when titles do not match (e.g. Deep Quiet Room vs Deep Water 2026)
  assert.ok(scoreTitleCandidate({ candTitle: 'Deep Water', candYear: 2026 }, { enm: 'Deep Quiet Room', year: 2026 }) < 0);
  // 2. Short Latin "V" must never match "Five Nights at Freddy's 2"
  assert.ok(scoreTitleCandidate({ candTitle: "Five Nights at Freddy's 2", candYear: 2026 }, { enm: 'V', year: 2026 }) < 0);
  // 3. Re-released/sequel mismatch: "Dune" must not match "Dune: Part Three"
  assert.ok(scoreTitleCandidate({ candTitle: 'Dune: Part Three', candYear: 2026 }, { enm: 'Dune', year: 2026 }) < 0);
  // 4. Wrong-decade homonym must be rejected ("You Are My Sunshine" 2005 vs 2026 Chinese film)
  assert.ok(scoreTitleCandidate({ candTitle: 'You Are My Sunshine', candYear: 2005 }, { enm: 'You are my sunshine', year: 2026 }) < 0);

  // 5. Dual Chinese+English IMDb query picks tt39276601 (Chinese film Crossing) over foreign crossings
  const mockFetchImdb = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('四渡')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt39276601', l: 'Crossing', y: 2026, qid: 'movie', s: 'Ye Liu, Lei Wang' }] }), { status: 200 });
    }
    if (u.includes('CROSSING')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt27417166', l: 'Crossing', y: 2024, qid: 'movie', s: 'Mzia Arabuli' }] }), { status: 200 });
    }
    if (u.includes('agregarr')) {
      return new Response(JSON.stringify([{ rating: 0, votes: 0 }]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  const imRes = await fetchImdbIntel({
    title: '四渡',
    enm: 'CROSSING',
    year: 2026,
    dir: '徐展雄',
    fetchImpl: mockFetchImdb
  });
  assert.equal(imRes.imdbId, 'tt39276601');

  // 6. RT rejects deep_water_2026 for Deep Quiet Room and rejects crossing_2024 without Chinese cast overlap
  const rtResFake = await fetchRottenTomatoesIntel({
    enm: 'Deep Quiet Room',
    title: '深度安静',
    year: 2026,
    dir: '沈可尚',
    fetchImpl: async () =>
      new Response('<search-page-media-row release-year="2026" tomatometer-score="69"><a href="https://www.rottentomatoes.com/m/deep_water_2026" slot="title">Deep Water</a></search-page-media-row>', { status: 200 })
  });
  assert.equal(rtResFake, null);

  const rtResSingle = await fetchRottenTomatoesIntel({
    enm: 'CROSSING',
    title: '四渡',
    year: 2026,
    dir: '徐展雄',
    imdbActors: 'Ye Liu, Lei Wang',
    fetchImpl: async () =>
      new Response('<search-page-media-row release-year="2024" tomatometer-score="97"><a href="https://www.rottentomatoes.com/m/crossing_2024" slot="title">Crossing</a></search-page-media-row>', { status: 200 })
  });
  assert.equal(rtResSingle, null);
});

test('v3 bilingual pinyin matcher blocks Corpus/Godzilla/PaperBride false hits while keeping Yu Jin and Ye ye', async () => {
  assert.equal(looksLikeMandarinPinyinOf('Ye ye nai nai na xie shi', ['爷爷奶奶那些事']), true);
  assert.equal(looksLikeMandarinPinyinOf('Yu Jin', ['我们仅有一次的人生', '余烬']), true);
  assert.equal(looksLikeMandarinPinyinOf('Corpus', ['活色生香']), false);
  assert.equal(looksLikeMandarinPinyinOf('Godzilla X Kong: The New Empire', ['大圣崛起']), false);
  assert.equal(looksLikeMandarinPinyinOf('Red Wedding Dress: Paper Bride', ['红衣新娘·子怨']), false);

  const mockImdb = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('活色生香')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt38117143', l: 'Corpus', y: 2026, qid: 'movie', s: 'Jeff Wahlberg' }] }), { status: 200 });
    }
    if (u.includes('大圣崛起')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt14539740', l: 'Godzilla X Kong: The New Empire', y: 2024, qid: 'movie' }] }), { status: 200 });
    }
    if (u.includes('红衣新娘·子怨')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt35871402', l: 'Red Wedding Dress: Paper Bride', y: 2025, qid: 'movie' }] }), { status: 200 });
    }
    if (u.includes('我们仅有一次的人生')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt36424371', l: 'Yu Jin', y: 2026, qid: 'movie' }] }), { status: 200 });
    }
    if (u.includes('agregarr')) {
      return new Response(JSON.stringify([{ rating: 5.0, votes: 120 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ d: [] }), { status: 200 });
  };

  const fake1 = await fetchImdbIntel({ title: '活色生香', enm: 'Waiting for Myself', year: 2026, dir: '罗冬', fetchImpl: mockImdb });
  assert.equal(fake1, null);
  const fake2 = await fetchImdbIntel({ title: '大圣崛起', enm: '', year: 2026, fetchImpl: mockImdb });
  assert.equal(fake2, null);
  const fake3 = await fetchImdbIntel({ title: '红衣新娘·子怨', enm: 'bride in red: blood vendetta', year: 2026, fetchImpl: mockImdb });
  assert.equal(fake3, null);

  const okPinyin = await fetchImdbIntel({
    title: '我们仅有一次的人生',
    enm: 'Embers',
    zhTitles: ['余烬'],
    year: 2026,
    fetchImpl: mockImdb
  });
  assert.equal(okPinyin.imdbId, 'tt36424371');
  assert.equal(okPinyin.imdbScore, 5);
});

test('taopiaopiao catalog paginates soon shows page 2 when page 1 hits 100 items and dynamics uses monitored cinema details', async () => {
  const fakeFetch = async (url) => {
    const u = new URL(url);
    const hasToken = Boolean(u.searchParams.get('sign') && u.searchParams.get('sign') !== '00000000000000000000000000000000');
    if (!hasToken) {
      return {
        status: 200,
        headers: { getSetCookie: () => ['_m_h5_tk=tok123_999; Path=/'] },
        text: async () => '{}'
      };
    }
    const api = u.searchParams.get('api') || '';
    const data = JSON.parse(u.searchParams.get('data') || '{}');
    if (api.includes('getshowsbycitycode')) {
      return { status: 200, headers: {}, text: async () => JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { returnValue: [{ id: 1, showName: '热映片A', wantCount: 1000 }] } }) };
    }
    if (api.includes('getsoonshowsbycitycode') && data.pageIndex === 1) {
      const p1 = Array.from({ length: 100 }, (_, i) => ({ id: 100 + i, showName: `待映片${i}`, wantCount: 500 + i }));
      return { status: 200, headers: {}, text: async () => JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { returnValue: p1 } }) };
    }
    if (api.includes('getsoonshowsbycitycode') && data.pageIndex === 2) {
      return { status: 200, headers: {}, text: async () => JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { returnValue: [{ id: 999, showName: '流浪地球3', wantCount: 880000 }] } }) };
    }
    return { status: 200, headers: {}, text: async () => JSON.stringify({ ret: ['SUCCESS::调用成功'], data: { returnValue: [] } }) };
  };

  const tpp = await fetchTaopiaopiaoCatalog({ fetchImpl: fakeFetch });
  assert.equal(tpp.ok, true);
  assert.equal(tpp.count, 102);
  assert.equal(matchTaopiaopiaoMovie({ nm: '流浪地球3' }, tpp).tppWish, 880000);

  const dyn = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T12:00:00Z',
    prevCatalogMap: { '50': { id: 50, nm: '新开票片', rt: '2026-11-20', statusLabel: '想看' } },
    currMovies: [{ id: 50, nm: '新开票片', rt: '2026-11-20', statusLabel: '预售', showInfo: '今天7家影院放映14场' }],
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set([50]),
    currCinemaDetailMap: new Map([[50, '华南MALL IMAX GT 2场 · 民盈国贸城 CGV 1场']])
  });
  const openEv = dyn.find((e) => e.type === 'presale_opened');
  assert.equal(openEv.detail, '华南MALL IMAX GT 2场 · 民盈国贸城 CGV 1场');
});

test('detectDynamicEvents ignores historical backfill, re-releases, first-time intel, and matchVersion upgrades while allowing genuine new score openings', () => {
  const dyn = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T15:00:00Z',
    prevCatalogMap: {
      '101': { id: 101, nm: '老片回填', rt: '2026-10-01', statusLabel: '热映', sc: 0 },
      '102': { id: 102, nm: '沙丘重映版', rt: '2026-11-20', statusLabel: '预售', sc: 0 },
      '103': { id: 103, nm: '疾速追杀', rt: '2026-11-20', statusLabel: '热映', sc: 0 },
      '104': { id: 104, nm: '版本升级电影', rt: '2026-11-18', statusLabel: '热映', sc: 0 },
      '105': { id: 105, nm: '首次入库片', rt: '2026-11-18', statusLabel: '热映', sc: 0 },
      '106': { id: 106, nm: '深度安静', rt: '2026-11-19', statusLabel: '预售', sc: 0 },
      '107': { id: 107, nm: '淘票票占位片', rt: '2026-11-07', statusLabel: '热映', sc: 0 },
      '108': { id: 108, nm: '待重检未检查片', rt: '2026-11-18', statusLabel: '热映', sc: 0 }
    },
    currMovies: [
      { id: 101, nm: '老片回填', rt: '2026-10-01', statusLabel: '热映', sc: 8.8 },
      { id: 102, nm: '沙丘重映版', rt: '2026-11-20', statusLabel: '购票', sc: 0 },
      { id: 103, nm: '疾速追杀', rt: '2026-11-20', statusLabel: '热映', sc: 0 },
      { id: 104, nm: '版本升级电影', rt: '2026-11-18', statusLabel: '热映', sc: 0 },
      { id: 105, nm: '首次入库片', rt: '2026-11-18', statusLabel: '热映', sc: 0 },
      { id: 106, nm: '深度安静', rt: '2026-11-19', statusLabel: '购票', sc: 0 },
      { id: 107, nm: '淘票票占位片', rt: '2026-11-07', statusLabel: '热映', sc: 0 },
      { id: 108, nm: '待重检未检查片', rt: '2026-11-18', statusLabel: '热映', sc: 0 }
    ],
    prevIntelMap: {
      '101': { matchVersion: 3, checkedAt: '2026-11-18T14:00:00Z', doubanScore: null },
      '102': { matchVersion: 3, checkedAt: '2026-11-18T14:00:00Z', doubanScore: null },
      '103': { matchVersion: 3, checkedAt: '2026-11-18T14:00:00Z', doubanScore: null },
      '104': { matchVersion: 1, checkedAt: '2026-11-18T14:00:00Z', doubanScore: null },
      '106': { matchVersion: 3, checkedAt: '2026-11-18T14:00:00Z', doubanYear: 2025, doubanScore: null, imdbScore: null },
      '107': { movieId: 107, tppId: 1651220, enm: 'BACK HOME' },
      '108': { matchVersion: 1, doubanScore: null }
    },
    currIntelMap: {
      '101': { matchVersion: 3, doubanScore: 7.9, imdbScore: 7.6 },
      '102': { matchVersion: 3, doubanScore: 7.7 },
      '103': { matchVersion: 3, doubanYear: 2014, doubanScore: 7.8, imdbScore: 7.5 },
      '104': { matchVersion: 3, doubanScore: 7.4, rtCriticsScore: 80 },
      '105': { matchVersion: 3, doubanScore: 8.1, imdbScore: 7.8 },
      '106': { matchVersion: 3, doubanYear: 2025, doubanScore: 7.3, imdbScore: 7.1 },
      '107': { matchVersion: 3, checkedAt: '2026-11-18T15:00:00Z', imdbScore: 5.8 },
      '108': { matchVersion: 3, checkedAt: '2026-11-18T15:00:00Z', doubanScore: 7.5 }
    },
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set()
  });

  const scored = dyn.filter((e) => e.type === 'scored');
  assert.equal(scored.length, 1);
  assert.equal(scored[0].movieId, 106);
  assert.match(scored[0].summary, /豆瓣 7\.3/);
  assert.match(scored[0].summary, /IMDb 7\.1/);
});

test('resolveBaselineDynamics resets legacy dynamics before DYNAMICS_EPOCH_VERSION and preserves current epoch dynamics', () => {
  assert.deepEqual(
    resolveBaselineDynamics({ dynamics: [{ id: 'old1' }] }),
    []
  );
  assert.deepEqual(
    resolveBaselineDynamics({ dynamicsVersion: 1, dynamics: [{ id: 'old1' }] }),
    []
  );
  assert.deepEqual(
    resolveBaselineDynamics({ dynamicsVersion: DYNAMICS_EPOCH_VERSION, dynamics: [{ id: 'fresh1' }] }),
    [{ id: 'fresh1' }]
  );
});

test('dedupeCatalogMovies preserves rich onInfo rt/status when a sparse coming stub shares the same movieId', () => {
  const prevOnInfo = { id: 1441786, nm: '沙丘2', rt: '2026-12-04', statusLabel: '预售', showInfo: '2026-12-04重映', source: 'onInfo' };
  const prevComingStub = { id: 1441786, nm: '沙丘2', rt: '', statusLabel: '想看', showInfo: '', source: 'coming' };
  const { map: prevCatalogMap } = dedupeCatalogMovies([prevOnInfo, prevComingStub]);
  assert.equal(prevCatalogMap['1441786'].rt, '2026-12-04');
  assert.equal(prevCatalogMap['1441786'].statusLabel, '预售');

  const events = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T15:15:00Z',
    prevCatalogMap,
    currMovies: [prevOnInfo, prevComingStub],
    prevIntelMap: { '1441786': { matchVersion: 3, doubanYear: 2024, doubanScore: null } },
    currIntelMap: { '1441786': { matchVersion: 3, doubanYear: 2024, doubanScore: 8.2 } },
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set()
  });
  assert.deepEqual(events, []);
});

test('detectDynamicEvents ignores Maoyan coming stub rt="" flip-flop when comingTitle matches M月D日 and ignores >2d old presale tails', () => {
  // 1. onInfo -> coming stub (rt '' with comingTitle '12月4日 周五') must not emit 调整为待定
  const toStub = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T15:20:00Z',
    prevCatalogMap: {
      '1441786': { id: 1441786, nm: '沙丘2', rt: '2026-12-04', comingTitle: '12月4日 周五', statusLabel: '预售' }
    },
    currMovies: [
      { id: 1441786, nm: '沙丘2', rt: '', comingTitle: '12月4日 周五', statusLabel: '想看' },
      { id: 1510966, nm: '爷爷奶奶那些事', rt: '2026-11-10', statusLabel: '购票' }
    ],
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set([1510966])
  });
  assert.deepEqual(toStub, []);

  // 2. coming stub -> onInfo (rt '2026-12-04' returning when prev.comingTitle already had '12月4日 周五') must not emit 正式定档
  const backToOnInfo = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-18',
    nowIso: '2026-11-18T15:25:00Z',
    prevCatalogMap: {
      '1441786': { id: 1441786, nm: '沙丘2', rt: '', comingTitle: '12月4日 周五', statusLabel: '想看' }
    },
    currMovies: [
      { id: 1441786, nm: '沙丘2', rt: '2026-12-04', comingTitle: '12月4日 周五', statusLabel: '想看' }
    ],
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set()
  });
  assert.deepEqual(backToOnInfo, []);
});

test('fetchMovieCatalog paginates in chunks of 12 before mostExpected, uses showst fallback, and fails closed on partial risk control', async () => {
  const comingIds = Array.from({ length: 28 }, (_, i) => 1000 + i);
  const requestedBatches = [];
  const mockMaoyan = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('movieOnInfoList')) {
      return new Response(
        JSON.stringify({
          movieList: [{ id: 500, nm: '热映A', rt: '2026-11-15', showst: 3, globalReleased: true }],
          movieIds: [500, 501]
        }),
        { status: 200 }
      );
    }
    if (u.pathname.includes('comingList')) {
      return new Response(
        JSON.stringify({
          coming: [{ id: 1000, nm: '新片1000', rt: '2026-11-25', showst: 4 }],
          movieIds: comingIds
        }),
        { status: 200 }
      );
    }
    if (u.pathname.includes('mostExpected')) {
      return new Response(
        JSON.stringify({
          coming: [
            { id: 1015, nm: '新片1015', comingTitle: '12月16日 周三', wish: 700000 }, // rt omitted by mostExpected!
            { id: 9999, nm: '高期待独有', comingTitle: '2027年 待定', wish: 12000 }
          ]
        }),
        { status: 200 }
      );
    }
    if (u.pathname.includes('moreComingList')) {
      const ids = u.searchParams.get('movieIds').split(',').map(Number);
      requestedBatches.push(ids);
      assert.ok(ids.length <= 12, `Expected chunk <= 12, got ${ids.length}`);
      return new Response(
        JSON.stringify({
          coming: ids.map((id) => ({
            id,
            nm: id === 501 ? '未映点映501' : `新片${id}`,
            rt: id === 9999 ? '' : id === 1015 ? '2026-12-16' : '2026-12-20',
            comingTitle: id === 9999 ? '2027年 待定' : '12月20日 周日',
            showst: id === 501 ? 1 : 4
          }))
        }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  };

  const full = await fetchMovieCatalog({ fetchImpl: mockMaoyan, delayRange: [0, 0] });
  assert.equal(full.ok, true);
  assert.equal(full.onInfo.length, 2);
  assert.equal(full.onInfo.find((m) => m.id === 501).statusLabel, '想看'); // showst=1 fallback instead of blind '热映'
  assert.equal(full.coming.length, 29); // all 28 comingIds + extra 9999 from mostExpected
  assert.equal(full.coming.find((m) => m.id === 1015).rt, '2026-12-16'); // NOT poisoned to '' by mostExpected!
  assert.ok(requestedBatches.every((b) => b.length <= 12));

  // Fail closed when one batch hits risk control
  const riskFetch = async (url) => {
    if (String(url).includes('moreComingList') && String(url).includes('1013')) {
      return new Response('<!doctype html><html><body>验证中心</body></html>', { status: 200 });
    }
    return mockMaoyan(url);
  };
  const failed = await fetchMovieCatalog({ fetchImpl: riskFetch, delayRange: [0, 0] });
  assert.equal(failed.ok, false);
  assert.equal(failed.riskTriggered, true);
  assert.equal(failed.partial, true);
});

test('detectDynamicEvents catches reschedules from prevIntelMap, pulls to vague/partial dates, partial shifts, and suppresses schema backfill', () => {
  const dyn = detectDynamicEvents({
    baselineReady: true,
    suppressNewAdditions: true,
    todayStr: '2026-11-19',
    nowIso: '2026-11-19T05:00:00Z',
    prevCatalogMap: {
      '2001': { id: 2001, nm: '撤档至待定年份', rt: '2026-11-27', comingTitle: '11月27日 周五', statusLabel: '想看' },
      '2002': { id: 2002, nm: '推迟至明年五月', rt: '2026-12-10', comingTitle: '12月10日 周四', statusLabel: '想看' },
      '2003': { id: 2003, nm: '全撤档空日期', rt: '2026-12-01', comingTitle: '12月1日 周二', statusLabel: '想看' },
      '2004': { id: 2004, nm: '待定年份后延', rt: '2026', comingTitle: '2026年 待定', statusLabel: '想看' }
    },
    prevIntelMap: {
      '1608228': { movieId: 1608228, origRt: '2026-11-27', pubDesc: '2026-11-27中国大陆上映' }
    },
    currMovies: [
      { id: 1608228, nm: '肆条', rt: '2027-01-15', comingTitle: '2027年1月15日 周五', statusLabel: '想看' },
      { id: 2001, nm: '撤档至待定年份', rt: '2026', comingTitle: '2026年 待定', statusLabel: '想看' },
      { id: 2002, nm: '推迟至明年五月', rt: '2027-05', comingTitle: '2027年5月 待定', statusLabel: '想看' },
      { id: 2003, nm: '全撤档空日期', rt: '', comingTitle: '', statusLabel: '想看' },
      { id: 2004, nm: '待定年份后延', rt: '2027', comingTitle: '2027年 待定', statusLabel: '想看' },
      { id: 3001, nm: '补齐的历史新片', rt: '2026-12-24', comingTitle: '12月24日 周四', statusLabel: '预售' }
    ],
    prevCinemaMovieIds: new Set(),
    currCinemaMovieIds: new Set()
  });

  const resch = dyn.filter((e) => e.type === 'rescheduled');
  assert.equal(resch.length, 5);
  assert.equal(resch.find((e) => e.movieId === 1608228).summary, '档期变更：2026-11-27 → 2027-01-15');
  assert.equal(resch.find((e) => e.movieId === 2001).summary, '档期变更：原 2026-11-27 调整为 2026年 待定');
  assert.equal(resch.find((e) => e.movieId === 2002).summary, '档期变更：原 2026-12-10 调整为 2027年5月 待定');
  assert.equal(resch.find((e) => e.movieId === 2003).summary, '档期变更：原 2026-12-01 调整为 待定');
  assert.equal(resch.find((e) => e.movieId === 2004).summary, '档期变更：2026 → 2027');

  // Newly backfilled item 3001 must NOT emit fake 定档 or 开票 during schema upgrade
  assert.equal(dyn.filter((e) => e.movieId === 3001).length, 0);
});

test('selectMoviesForIntelEnrichment deduplicates catalog duplicates and prevents starvation across legacy & onInfo items', () => {
  const nowIso = '2026-11-19T05:00:00Z';
  const catalogMovies = [
    { id: 100, nm: '重复热映片', source: 'onInfo', rt: '2026-11-19', wish: 50000 },
    { id: 100, nm: '重复热映片', source: 'coming', rt: '2026-11-19', wish: 50000 },
    { id: 200, nm: 'v1待升级老片', source: 'onInfo', rt: '2026-11-08', wish: 1000 },
    ...Array.from({ length: 26 }, (_, i) => ({
      id: 9000 + i,
      nm: `远期星标${i}`,
      source: 'coming',
      rt: '2026-12-12',
      wish: 100000
    }))
  ];
  const intelMap = {
    '100': { matchVersion: INTEL_MATCH_VERSION, doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'Dup', checkedAt: '2026-11-19T04:50:00Z' },
    '200': { matchVersion: 1, doubanScore: null, checkedAt: '2026-11-18T00:00:00Z' }
  };
  const activeWatchItems = [];
  for (let i = 0; i < 26; i++) {
    activeWatchItems.push({ movieId: 9000 + i, active: true });
    intelMap[String(9000 + i)] = {
      matchVersion: INTEL_MATCH_VERSION,
      doubanScore: null,
      imdbScore: null,
      rtCriticsScore: null,
      enm: `Star${i}`,
      checkedAt: '2026-11-19T04:50:00Z' // checked 10m ago (<60m cooldown for far-future starred)
    };
  }

  const picked = selectMoviesForIntelEnrichment({
    catalogMovies,
    intelMap,
    activeWatchItems,
    nowIso,
    todayStr: '2026-11-19',
    maxBudget: 10
  });
  const ids = picked.map((m) => m.id);
  assert.deepEqual(ids, [200, 100]); // deduplicated 100 + v1 legacy 200 NOT starved by 26 far-future stars
});

test('fetchDoubanIntel accepts delayed mainland imports and bilingual+year matches with director transliteration variance', async () => {
  const mockDouban = async (url) => {
    const u = String(url);
    if (u.includes('subject_suggest') && decodeURIComponent(u).includes('霹雳英雄')) {
      return new Response(
        JSON.stringify([{ id: '35622269', title: '霹雳英雄：素还真', sub_title: '素還真', year: '2022', type: 'movie' }]),
        { status: 200 }
      );
    }
    if (u.includes('/movie/35622269')) {
      return new Response(
        JSON.stringify({
          title: '霹雳英雄：素还真',
          original_title: '素還真',
          year: '2022',
          rating: { value: 6.8, count: 971 },
          directors: [{ name: '黄强华' }],
          aka: ['Demigod: The Legend Begins']
        }),
        { status: 200 }
      );
    }
    if (u.includes('subject_suggest') && decodeURIComponent(u).includes('小羊肖恩3')) {
      return new Response(
        JSON.stringify([{ id: '37344902', title: '小羊肖恩3：怪兽来袭', sub_title: 'Shaun the Sheep: The Beast of Mossy Bottom', year: '2026', type: 'movie' }]),
        { status: 200 }
      );
    }
    if (u.includes('/movie/37344902')) {
      return new Response(
        JSON.stringify({
          title: '小羊肖恩3：怪兽来袭',
          original_title: 'Shaun the Sheep: The Beast of Mossy Bottom',
          year: '2026',
          rating: { value: 0, count: 0 },
          directors: [{ name: 'Steve Cox' }], // Latin spelling vs Maoyan's '史蒂夫·考克斯'
          aka: []
        }),
        { status: 200 }
      );
    }
    return new Response('[]', { status: 200 });
  };

  const pili = await fetchDoubanIntel({
    title: '霹雳英雄：素还真',
    enm: 'DEMIGOD: The Legend Begins',
    year: 2026,
    dir: '黄强华',
    fetchImpl: mockDouban
  });
  assert.equal(pili.doubanId, '35622269');
  assert.equal(pili.doubanScore, 6.8);

  const shaun = await fetchDoubanIntel({
    title: '小羊肖恩3：怪兽来袭',
    enm: 'Shaun the Sheep: The Beast of Mossy Bottom',
    year: 2026,
    dir: '史蒂夫·考克斯,马修·沃克',
    fetchImpl: mockDouban
  });
  assert.equal(shaun.doubanId, '37344902');
});

test('v5 dynamics fixes suppress onInfo/today scheduled, clean v4 artifacts, block domestic 2-word IMDb false hits, and prioritize date-drifted intel refresh', async () => {
  // 1. detectDynamicEvents suppresses 定档 for onInfo or release-day movies while keeping genuine future coming movies
  const dyn = detectDynamicEvents({
    baselineReady: true,
    todayStr: '2026-11-19',
    nowIso: '2026-11-19T05:00:00Z',
    prevCatalogMap: {},
    currMovies: [
      { id: 1366184, nm: '深度安静', rt: '2026-11-19', source: 'onInfo', statusLabel: '热映' },
      { id: 9001, nm: '当日空降片', rt: '2026-11-19', source: 'coming', statusLabel: '想看' },
      { id: 9002, nm: '真正新定档片', rt: '2026-12-25', source: 'coming', comingTitle: '12月25日 周五', statusLabel: '想看' }
    ]
  });
  assert.deepEqual(
    dyn.filter((e) => e.type === 'scheduled').map((e) => e.movieId),
    [9002]
  );

  // 2. fetchImdbIntel rejects generic 2-word English-only IMDb hit on domestic film when Douban AKA disagrees, but allows AKA-confirmed 2-word hit
  const mockImdb = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('BACK HOME')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt37660891', l: 'Back Home', y: 2025, qid: 'movie', s: 'Anong Houngheuangsy' }] }), { status: 200 });
    }
    if (u.includes('The Uniform')) {
      return new Response(JSON.stringify({ d: [{ id: 'tt33708235', l: 'The Uniform', y: 2024, qid: 'movie', s: 'Buffy Chen' }] }), { status: 200 });
    }
    if (u.includes('agregarr')) {
      return new Response(JSON.stringify([{ rating: 6.9, votes: 158 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ d: [] }), { status: 200 });
  };

  const backHomeRes = await fetchImdbIntel({
    title: '乡归',
    enm: 'BACK HOME',
    akaList: ['Go Back to the South'],
    year: 2025,
    allowedYears: [2025, 2026],
    dir: '徐晓晖',
    fetchImpl: mockImdb
  });
  assert.equal(backHomeRes, null);

  const uniformRes = await fetchImdbIntel({
    title: '喜欢了你一整个青春',
    enm: 'The Uniform',
    akaList: ['The Uniform'],
    year: 2024,
    allowedYears: [2024, 2026],
    dir: '庄景燊',
    fetchImpl: mockImdb
  });
  assert.equal(uniformRes.imdbId, 'tt33708235');

  // 3. resolveBaselineDynamics cleans v4 artifacts while preserving genuine 改档 / 开票 and resetting v < 4
  assert.deepEqual(
    resolveBaselineDynamics({
      dynamicsVersion: 3,
      dynamics: [{ id: 'dyn_resch_1608228_2026-11-27_2027-01-15', type: 'rescheduled' }]
    }),
    []
  );
  const migrated = resolveBaselineDynamics({
    dynamicsVersion: 4,
    dynamics: [
      { id: 'dyn_score_1601225_IMDb 5.8', type: 'scored', createdAt: '2026-11-19T04:46:24.861Z' },
      { id: 'dyn_resch_1608228_2026-11-27_2027-01-15', type: 'rescheduled', createdAt: '2026-11-19T04:41:30.488Z' },
      { id: 'dyn_sch_1672717_2026-12-05', type: 'scheduled', createdAt: '2026-11-19T04:14:19.276Z' },
      { id: 'dyn_open_1366184_2026-11-19', type: 'presale_opened', createdAt: '2026-11-18T19:32:24.801Z' },
      { id: 'dyn_sch_999999_2027-02-01', type: 'scheduled', createdAt: '2026-11-19T05:00:00.000Z' }
    ]
  });
  assert.deepEqual(
    migrated.map((d) => d.id),
    [
      'dyn_resch_1608228_2026-11-27_2027-01-15',
      'dyn_open_1366184_2026-11-19',
      'dyn_sch_999999_2027-02-01'
    ]
  );

  // 4. selectMoviesForIntelEnrichment prioritizes date-drifted rescheduled movies even within 60m cooldown
  const selected = selectMoviesForIntelEnrichment({
    catalogMovies: [
      { id: 1608228, nm: '肆条', source: 'coming', rt: '2027-01-15', wish: 883 },
      { id: 5555, nm: '刚查过远期片', source: 'coming', rt: '2027-02-01', wish: 50000 }
    ],
    intelMap: {
      '1608228': {
        matchVersion: INTEL_MATCH_VERSION,
        enm: 'Life Begins At Forty',
        origRt: '2026-11-27',
        pubDesc: '2026-11-27中国大陆上映',
        doubanScore: 7.2,
        imdbScore: 6.5,
        rtCriticsScore: 80,
        checkedAt: '2026-11-19T04:55:00Z'
      },
      '5555': {
        matchVersion: INTEL_MATCH_VERSION,
        enm: 'Other',
        origRt: '2027-02-01',
        pubDesc: '2027-02-01中国大陆上映',
        checkedAt: '2026-11-19T04:55:00Z'
      }
    },
    activeWatchItems: [],
    nowIso: '2026-11-19T05:00:00Z',
    todayStr: '2026-11-19',
    maxBudget: 5
  });
  assert.deepEqual(selected.map((m) => m.id), [1608228]);
});
