/**
 * One-command automated GitHub repository, Pages, Private Gist, VAPID & Secrets bootstrapper.
 * Runs locally on the user's machine so their GitHub PAT never leaves their terminal.
 */

import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import sodium from 'libsodium-wrappers';

const IGNORED_DIRS = new Set(['node_modules', '.git']);
const IGNORED_FILES = new Set(['PAIR_URL.txt', '.DS_Store', '.env']);

export async function collectProjectFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) await walk(full);
        continue;
      }
      if (IGNORED_FILES.has(ent.name)) continue;
      if (rel.startsWith('web/icons/') && ent.name.endsWith('.png')) continue;
      if (ent.name.endsWith('.log')) continue;
      const content = await fs.readFile(full);
      results.push({ path: rel, content });
    }
  }
  await walk(rootDir);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

export async function sealGitHubSecret(base64PublicKey, secretValue) {
  await sodium.ready;
  const binKey = sodium.from_base64(base64PublicKey, sodium.base64_variants.ORIGINAL);
  const binSec = sodium.from_string(String(secretValue));
  const encrypted = sodium.crypto_box_seal(binSec, binKey);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

async function ghApi(url, token, options = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dg-cinema-radar-bootstrap',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, data: json };
}

async function waitForMainRef(owner, repo, token, fetchImpl = fetch) {
  for (let i = 0; i < 8; i++) {
    const r = await ghApi(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`, token, {}, fetchImpl);
    if (r.ok && r.data?.object?.sha) return r.data.object.sha;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error('等待仓库 main 分支初始化超时，请检查仓库是否创建成功。');
}

export async function pushFilesToRepoMain({
  owner,
  repoName,
  token,
  rootDir = process.cwd(),
  message = 'feat: initial Dongguan 3-cinema Maoyan radar web app',
  fetchImpl = fetch
}) {
  const parentCommitSha = await waitForMainRef(owner, repoName, token, fetchImpl);
  const parentCommitRes = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/git/commits/${parentCommitSha}`,
    token,
    {},
    fetchImpl
  );
  const baseTreeSha = parentCommitRes.data.tree.sha;

  const files = await collectProjectFiles(rootDir);
  const treeItems = [];
  for (const f of files) {
    const blobRes = await ghApi(
      `https://api.github.com/repos/${owner}/${repoName}/git/blobs`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          content: f.content.toString('base64'),
          encoding: 'base64'
        })
      },
      fetchImpl
    );
    if (!blobRes.ok) {
      throw new Error(`上传文件失败 ${f.path} (${blobRes.status}): ${JSON.stringify(blobRes.data)}`);
    }
    treeItems.push({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blobRes.data.sha
    });
  }

  const treeRes = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems })
    },
    fetchImpl
  );
  if (!treeRes.ok) {
    throw new Error(`创建 Git Tree 失败 (${treeRes.status}): ${JSON.stringify(treeRes.data)}`);
  }

  const commitRes = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/git/commits`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeRes.data.sha,
        parents: [parentCommitSha]
      })
    },
    fetchImpl
  );
  if (!commitRes.ok) {
    throw new Error(`创建 Commit 失败 (${commitRes.status}): ${JSON.stringify(commitRes.data)}`);
  }

  const refRes = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitRes.data.sha, force: false })
    },
    fetchImpl
  );
  if (!refRes.ok) {
    throw new Error(`更新 main 分支失败 (${refRes.status}): ${JSON.stringify(refRes.data)}`);
  }

  return files.length;
}

export async function bootstrapGitHubProject({
  token,
  repoName = 'dg-cinema-radar',
  rootDir = process.cwd(),
  fetchImpl = fetch
}) {
  if (!token) throw new Error('Token 不能为空');

  // 1. Identify user
  const userRes = await ghApi('https://api.github.com/user', token, {}, fetchImpl);
  if (!userRes.ok) {
    throw new Error(`Token 验证失败 (${userRes.status}): ${JSON.stringify(userRes.data)}`);
  }
  const owner = userRes.data.login;

  // 2. Create repository (or reuse if user already created it empty)
  const createRepoRes = await ghApi(
    'https://api.github.com/user/repos',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        private: false,
        auto_init: true,
        description: '东莞三影院（华南MALL IMAX GT / 东城万达IMAX / 民盈国贸城CGV）猫眼每轮开票监控与iPhone/华为双端PWA提醒雷达'
      })
    },
    fetchImpl
  );
  if (!createRepoRes.ok && createRepoRes.status !== 422) {
    throw new Error(`创建仓库失败 (${createRepoRes.status}): ${JSON.stringify(createRepoRes.data)}`);
  }

  // 3. Collect project files and push via Git Data API
  const uploadedFiles = await pushFilesToRepoMain({
    owner,
    repoName,
    token,
    rootDir,
    fetchImpl
  });

  // 4. Enable GitHub Pages (GitHub Actions workflow mode)
  let pagesEnabled = false;
  const pagesPost = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/pages`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ build_type: 'workflow' })
    },
    fetchImpl
  );
  if (pagesPost.ok) {
    pagesEnabled = true;
  } else if (pagesPost.status === 409) {
    const pagesPut = await ghApi(
      `https://api.github.com/repos/${owner}/${repoName}/pages`,
      token,
      {
        method: 'PUT',
        body: JSON.stringify({ build_type: 'workflow' })
      },
      fetchImpl
    );
    pagesEnabled = pagesPut.ok;
  }

  // 5. Create Private Gist
  const gistRes = await ghApi(
    'https://api.github.com/gists',
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        description: `${repoName} private state (watchlist, push subscriptions, webhooks)`,
        public: false,
        files: {
          'watchlist.json': { content: '[]' },
          'subscriptions.json': { content: '[]' },
          'webhooks.json': { content: '{}' },
          'settings.json': { content: JSON.stringify({ rotateMode: 'all', staggerMinMs: 850, staggerMaxMs: 1850, maoyanCookie: '', paused: false }, null, 2) },
          'seen.json': { content: '{}' },
          'runtime.json': { content: '{}' },
          'alerts.json': { content: '[]' }
        }
      })
    },
    fetchImpl
  );
  if (!gistRes.ok) {
    throw new Error(`创建私有 Gist 失败 (${gistRes.status}): ${JSON.stringify(gistRes.data)}`);
  }
  const gistId = gistRes.data.id;

  // 6. Generate VAPID keys & upload 4 GitHub Actions Secrets
  const vapid = webpush.generateVAPIDKeys();
  const pubKeyRes = await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/public-key`,
    token,
    {},
    fetchImpl
  );
  if (!pubKeyRes.ok) {
    throw new Error(`读取 Actions 公钥失败 (${pubKeyRes.status}): ${JSON.stringify(pubKeyRes.data)}`);
  }

  const secretsToSet = {
    RADAR_GIST_ID: gistId,
    RADAR_GH_TOKEN: token,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey
  };
  for (const [name, val] of Object.entries(secretsToSet)) {
    const encrypted_value = await sealGitHubSecret(pubKeyRes.data.key, val);
    const putSec = await ghApi(
      `https://api.github.com/repos/${owner}/${repoName}/actions/secrets/${name}`,
      token,
      {
        method: 'PUT',
        body: JSON.stringify({
          encrypted_value,
          key_id: pubKeyRes.data.key_id
        })
      },
      fetchImpl
    );
    if (!putSec.ok) {
      throw new Error(`写入 Secret ${name} 失败 (${putSec.status}): ${JSON.stringify(putSec.data)}`);
    }
  }

  // 7. Trigger initial Pages build and catalog refresh
  await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/deploy-pages.yml/dispatches`,
    token,
    { method: 'POST', body: JSON.stringify({ ref: 'main' }) },
    fetchImpl
  );
  await ghApi(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/monitor.yml/dispatches`,
    token,
    { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { mode: 'refresh_catalog' } }) },
    fetchImpl
  );

  const pageUrl = `https://${owner}.github.io/${repoName}/`;
  const pairPayload = Buffer.from(
    JSON.stringify({
      owner,
      repo: repoName,
      gistId,
      token,
      vapidPublicKey: vapid.publicKey
    })
  ).toString('base64url');
  const pairUrl = `${pageUrl}#pair=${pairPayload}`;

  return {
    owner,
    repoName,
    repoUrl: `https://github.com/${owner}/${repoName}`,
    pageUrl,
    gistId,
    vapidPublicKey: vapid.publicKey,
    pagesEnabled,
    uploadedFiles,
    pairUrl
  };
}

async function cli() {
  let token = (process.env.GH_BOOTSTRAP_TOKEN || '').trim();
  let repoName = (process.env.REPO_NAME || 'dg-cinema-radar').trim();

  if (!token) {
    const rl = readline.createInterface({ input, output });
    try {
      token = (await rl.question('请粘贴你的 GitHub Classic Token (ghp_...): ')).trim();
      const customName = (await rl.question('新仓库名称 (直接回车默认 dg-cinema-radar): ')).trim();
      if (customName) repoName = customName;
    } finally {
      rl.close();
    }
  }

  console.log('\n正在自动创建仓库、推送代码、开启 Pages、创建私有 Gist 并写入 Secrets...');
  const res = await bootstrapGitHubProject({ token, repoName });

  const outText = [
    `仓库地址: ${res.repoUrl}`,
    `Web App 网址: ${res.pageUrl}`,
    `私有 Gist ID: ${res.gistId}`,
    `手机一键配对专属链接（发给自己和华为朋友点开即用，请勿公开分享）:`,
    res.pairUrl,
    '',
    `cron-job.org 配置:`,
    `URL: https://api.github.com/repos/${res.owner}/${res.repoName}/actions/workflows/monitor.yml/dispatches`,
    `Method: POST`,
    `Schedule: * * * * * (每1分钟) 或 */2 * * * * (每2分钟)`,
    `Headers:`,
    `  Accept: application/vnd.github+json`,
    `  Authorization: Bearer <你的Token>`,
    `  X-GitHub-Api-Version: 2022-11-28`,
    `  Content-Type: application/json`,
    `Body: {"ref":"main","inputs":{"mode":"tick"}}`
  ].join('\n');

  await fs.writeFile(path.resolve('PAIR_URL.txt'), outText, 'utf8');

  console.log('\n==================================================');
  console.log(`全部完成！已上传 ${res.uploadedFiles} 个文件到 ${res.repoUrl}`);
  console.log(`GitHub Pages 状态: ${res.pagesEnabled ? '已自动开启 (约1分钟后可访问)' : '请在仓库 Settings -> Pages 手动选 GitHub Actions'}`);
  console.log(`Web App 访问地址: ${res.pageUrl}`);
  console.log(`详细信息与手机一键配对链接已保存到当前目录 PAIR_URL.txt (不会上传到 GitHub)`);
  console.log('==================================================\n');
}

const isMain =
  Boolean(process.argv[1]) &&
  realpathSync(path.resolve(process.argv[1])) === realpathSync(path.resolve(fileURLToPath(import.meta.url)));
if (isMain) {
  cli().catch((err) => {
    console.error('\n初始化失败:', err?.message || err);
    process.exitCode = 1;
  });
}
