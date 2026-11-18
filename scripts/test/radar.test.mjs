import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHall, normalizePosterUrl, getBeijingDateStr } from '../lib/config.mjs';
import { detectRiskControl, evaluateShowStatus } from '../lib/maoyan.mjs';
import {
  buildConsolidatedAlert,
  computeBackoffMinutes,
  diffWatchlistRound
} from '../lib/radar.mjs';
import { updatePrivateGist } from '../lib/gist.mjs';
import { bootstrapGitHubProject, sealGitHubSecret } from '../bootstrap-github.mjs';
import { parseRottenTomatoesDetailJson, parseRottenTomatoesSearchRows, scoreTitleCandidate } from '../lib/intel.mjs';
import { attachWishGrowth, buildDynamicsAlert, detectDynamicEvents, updateWishSnapshots } from '../lib/dynamics.mjs';
import { buildMtopSign, matchTaopiaopiaoMovie } from '../lib/taopiaopiao.mjs';
import { selectMoviesForIntelEnrichment } from '../monitor.mjs';
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
      '30': { doubanScore: null, imdbScore: null, rtCriticsScore: null }
    },
    currIntelMap: {
      '30': { doubanScore: 8.3, imdbScore: 8.1, rtCriticsScore: 91 }
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

  const alertStarOnly = buildDynamicsAlert({
    events,
    watchlist: [{ id: 'w1', movieId: 20, active: true }],
    notifyAllDynamics: false
  });
  assert.ok(alertStarOnly);
  assert.match(alertStarOnly.body, /调档大片/);
  assert.doesNotMatch(alertStarOnly.body, /待定新片/);
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
      '1': { doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'A', checkedAt: checked5MinAgo },
      '2': { doubanScore: null, imdbScore: null, rtCriticsScore: 75, enm: 'B', checkedAt: checked5MinAgo },
      '3': { doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'C', checkedAt: checked1MinAgo },
      '4': { doubanScore: null, imdbScore: null, rtCriticsScore: null, enm: 'D', checkedAt: checked5MinAgo }
    },
    activeWatchItems: [],
    nowIso,
    todayStr: '2026-11-18',
    maxBudget: 10
  });

  const ids = selected.map((m) => m.id);
  assert.deepEqual(ids, [1, 2]);
});
