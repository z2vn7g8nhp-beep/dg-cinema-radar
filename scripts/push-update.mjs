/**
 * Pushes updated project files to an existing GitHub repository's `main` branch
 * without modifying the existing Private Gist or Actions Secrets.
 */

import { pushFilesToRepoMain } from './bootstrap-github.mjs';

async function main() {
  const token = (process.env.GH_BOOTSTRAP_TOKEN || '').trim();
  const repoName = (process.env.REPO_NAME || 'dg-cinema-radar').trim();
  if (!token) throw new Error('缺少 GH_BOOTSTRAP_TOKEN');

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dg-cinema-radar-updater'
    }
  });
  if (!userRes.ok) {
    throw new Error(`Token 验证失败 (${userRes.status})`);
  }
  const { login: owner } = await userRes.json();

  const count = await pushFilesToRepoMain({
    owner,
    repoName,
    token,
    message: 'feat: expanded catalog, wish daily growth, all-movie dynamics & multi-platform scores'
  });
  console.log(`已成功更新 ${count} 个文件到 https://github.com/${owner}/${repoName} (Pages 将自动重新部署)`);

  await fetch(`https://api.github.com/repos/${owner}/${repoName}/actions/workflows/monitor.yml/dispatches`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'dg-cinema-radar-updater'
    },
    body: JSON.stringify({ ref: 'main', inputs: { mode: 'refresh_catalog' } })
  }).catch(() => undefined);
  console.log('已顺带触发一次后台全量刷新 (refresh_catalog)，约 40 秒后可在手机端查看最新 5-Tab 界面与百余部新片片单！');
}

main().catch((err) => {
  console.error('更新失败:', err?.message || err);
  process.exitCode = 1;
});
