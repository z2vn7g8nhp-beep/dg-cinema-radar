# 东莞三影院开票雷达 (`dg-cinema-radar`)

专为 **iPhone Safari PWA** 与 **华为浏览器 / 鸿蒙设备** 适配的纯 GitHub 开源盯票 Web App，配合 `cron-job.org` 实现每 1~2 分钟自动抓取并推送每一轮开票提醒。

## 监控影院（东莞三家）
| 影院名称 | 猫眼 `cinemaId` | 特色厅 |
| --- | --- | --- |
| 万达影城（华南MALL-IMAXGT激光店） | `1485` | IMAX GT 1.43:1 |
| 万达影城（东城万达广场IMAX店） | `10418` | IMAX |
| CGV影城（民盈·国贸城店） | `26100` | IMAX / 4DX / ScreenX |

## 核心特性
- **每一轮开票都提醒，直到手动停止**：按 `(cinemaId, movieId, seqNo, state)` 追踪，只要星标电影新放出任意排片（如先开普通厅，再开 IMAX GT 或新日期加场），每一轮新放票自动合并成 **1 条摘要提醒**，不会重复刷屏也不会中途自动停止。
- **全量新片片单 & 想看日增榜**：通过猫眼 `moreComingList` + `mostExpected` 分页拉取百余部热映/待映新片，并同步接入淘票票东莞在映与待映片单；按北京时间（UTC+8）记录每日零点基线，展示**猫眼想看总榜**与**今日想看增长排名**。
- **全网新片动态（定档 / 开票 / 改档 / 开分）**：每 5 分钟自动巡检全部新片动态并在「动态」板块全量展示；推送提醒默认仅针对**星标电影**触发（定档/开票/改档/开分 + 三影院每轮排片开票），非星标电影仅展示不打扰；开分聚合**猫眼、豆瓣、IMDb、烂番茄**四平台。点进电影详情即可查看猫眼与淘票票双平台想看对比及四平台评分。
- **猫眼防风控设计**：
  - 场次盯票与全量片单分层抓取：无星标电影时仅每 5 分钟同步一次全量片单、淘票票想看、想看增长与动态；有星标电影时随 `cron-job.org` 每 1~2 分钟盯紧三家影院。
  - 每次抓取三家影院之间自带随机错峰延时与移动端 UA 轮换，支持在 Web App 内一键切为「轮转抓 1 家」模式。
  - 自动检测 `verify.meituan.com` / `spiderindefence` / 非 JSON 拦截，命中后立即熔断并按 `5 → 15 → 30 → 60 分钟` 自动退避，同时发一条风控预警通知。
- **iPhone + 华为双端直接提醒**：
  - **iPhone (iOS 16.4+)**：Safari 点击分享 →「添加到主屏幕」后，支持苹果 **APNs 原生 Web Push** 锁屏提醒。
  - **华为 / 鸿蒙**：因国行无 Google GMS/FCM，除尝试标准 Web Push 外，内置**华为网页哨兵模式**（45 秒自动巡检 + 本地系统通知 + 提示音/震动 + 防息屏常亮）以及**微信 PushPlus / 企业微信 / 飞书 / 钉钉 / Bark** 免翻墙锁屏兜底。
  - 手机端可一键生成**朋友专属配对链接**（通过 `#pair=...` 客户端片段分享），华为朋友无需登录 GitHub 即可直接开用。

---

## 快速上线步骤（约 3 分钟）

### 1. 开启 GitHub Pages
进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。

### 2. 创建最小权限 Fine-Grained PAT
在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 新建一个 Token：
- Repository access：只选本仓库 `dg-cinema-radar`
- Repository permissions：**Actions → Read and write**
- Account permissions：**Gists → Read and write**

### 3. 打开 Web App 初始化私有 Gist 与 VAPID 密钥
1. 打开你的 GitHub Pages 地址：`https://<你的用户名>.github.io/dg-cinema-radar/`
2. 切到右下角 **「提醒与设置」**，填入用户名、仓库名和刚创建的 Token。
3. 点击 **「一键创建私有 Gist」**（推送订阅和 Webhook 密钥均保存在私有 Gist，绝不暴露到公开仓库）。
4. 点击 **「在本机生成一对 VAPID 密钥」**。

### 4. 配置仓库 Secrets（4 个）
打开仓库 **Settings → Secrets and variables → Actions → New repository secret**：
- `RADAR_GIST_ID`：上一步生成的私有 Gist ID
- `RADAR_GH_TOKEN`：第 2 步创建的 PAT
- `VAPID_PUBLIC_KEY`：第 3 步生成的公钥
- `VAPID_PRIVATE_KEY`：第 3 步生成的私钥

### 5. 在 cron-job.org 配置每分钟 / 每两分钟触发
在 [cron-job.org](https://cron-job.org/) 新建定时任务：
- **URL**：`https://api.github.com/repos/<你的用户名>/dg-cinema-radar/actions/workflows/monitor.yml/dispatches`
- **Request Method**：`POST`
- **Schedule**：`* * * * *`（每 1 分钟）或 `*/2 * * * *`（每 2 分钟）
- **Headers**：
  - `Accept`: `application/vnd.github+json`
  - `Authorization`: `Bearer 你的_PAT`
  - `X-GitHub-Api-Version`: `2022-11-28`
  - `Content-Type`: `application/json`
- **Request Body**：
  ```json
  {"ref":"main","inputs":{"mode":"tick"}}
  ```

---

## 本地测试
```bash
npm install
npm test
```
