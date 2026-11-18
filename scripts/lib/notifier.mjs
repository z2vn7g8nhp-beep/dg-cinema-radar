/**
 * Multi-channel notification dispatcher:
 * - Standard Web Push (VAPID via `web-push`: iPhone Safari PWA APNs + compatible browsers)
 * - Mainland China Huawei-friendly fallbacks: PushPlus, WeCom, Feishu, DingTalk, Bark, ntfy, Webhook
 */

import webpush from 'web-push';

async function postJson(url, payload, headers = {}, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

/**
 * Dispatches one consolidated alert across all configured Web Push subscriptions & China webhooks.
 * Returns summary stats and `aliveSubscriptions` (pruning 404/410 expired Web Push endpoints).
 */
export async function dispatchAlerts({
  alertPayload,
  subscriptions = [],
  webhooks = {},
  vapid = {},
  fetchImpl = fetch
}) {
  const results = {
    webPushSent: 0,
    webPushFailed: 0,
    expiredRemoved: 0,
    webhooksSent: [],
    webhookErrors: [],
    aliveSubscriptions: [...subscriptions]
  };

  if (!alertPayload) return results;

  // 1. Web Push (iPhone Safari PWA + compatible desktop/Android browsers)
  if (subscriptions.length > 0 && vapid.publicKey && vapid.privateKey) {
    webpush.setVapidDetails(
      vapid.subject || 'mailto:dg-cinema-radar@example.com',
      vapid.publicKey,
      vapid.privateKey
    );

    const pushJson = JSON.stringify({
      title: alertPayload.title,
      body: alertPayload.body,
      url: alertPayload.url || './',
      tag: alertPayload.tag || 'dg-cinema-wave'
    });

    const kept = [];
    for (const entry of subscriptions) {
      if (!entry?.subscription?.endpoint) continue;
      try {
        await webpush.sendNotification(entry.subscription, pushJson, {
          TTL: 3600,
          urgency: 'high'
        });
        results.webPushSent += 1;
        kept.push(entry);
      } catch (err) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          results.expiredRemoved += 1;
        } else {
          results.webPushFailed += 1;
          kept.push(entry);
          console.error(`WebPush failed (${statusCode || 'err'}) for ${entry.deviceLabel || 'device'}:`, err?.message);
        }
      }
    }
    results.aliveSubscriptions = kept;
  }

  // 2. Mainland China & mobile fallbacks (ideal for Huawei background lock-screen delivery)
  const { title, body, url } = alertPayload;
  const fullText = url ? `${title}\n\n${body}\n\n购票/查看雷达：${url}` : `${title}\n\n${body}`;

  const tasks = [];

  if (webhooks.pushplusToken?.trim()) {
    tasks.push(
      postJson(
        'https://www.pushplus.plus/send',
        {
          token: webhooks.pushplusToken.trim(),
          title,
          content: `${body.replace(/\n/g, '<br/>')}${url ? `<br/><br/><a href="${url}">打开影院雷达</a>` : ''}`,
          template: 'html'
        },
        {},
        fetchImpl
      ).then((r) => ({ channel: 'PushPlus', ...r }))
    );
  }

  if (webhooks.wecomWebhook?.trim()) {
    tasks.push(
      postJson(
        webhooks.wecomWebhook.trim(),
        { msgtype: 'text', text: { content: fullText } },
        {},
        fetchImpl
      ).then((r) => ({ channel: '企业微信', ...r }))
    );
  }

  if (webhooks.feishuWebhook?.trim()) {
    tasks.push(
      postJson(
        webhooks.feishuWebhook.trim(),
        { msg_type: 'text', content: { text: fullText } },
        {},
        fetchImpl
      ).then((r) => ({ channel: '飞书', ...r }))
    );
  }

  if (webhooks.dingtalkWebhook?.trim()) {
    tasks.push(
      postJson(
        webhooks.dingtalkWebhook.trim(),
        { msgtype: 'text', text: { content: fullText } },
        {},
        fetchImpl
      ).then((r) => ({ channel: '钉钉', ...r }))
    );
  }

  if (webhooks.barkUrl?.trim()) {
    const base = webhooks.barkUrl.trim().replace(/\/+$/, '');
    tasks.push(
      postJson(
        base,
        {
          title,
          body,
          url: url || undefined,
          group: '东莞影院雷达',
          sound: 'bell'
        },
        {},
        fetchImpl
      ).then((r) => ({ channel: 'Bark', ...r }))
    );
  }

  if (webhooks.ntfyTopic?.trim()) {
    const topicUrl = webhooks.ntfyTopic.trim().startsWith('http')
      ? webhooks.ntfyTopic.trim()
      : `https://ntfy.sh/${encodeURIComponent(webhooks.ntfyTopic.trim())}`;
    tasks.push(
      fetchImpl(topicUrl, {
        method: 'POST',
        headers: {
          'Title': title,
          'Priority': 'high',
          ...(url ? { Click: url } : {})
        },
        body,
        signal: AbortSignal.timeout(10000)
      })
        .then(async (res) => ({ channel: 'ntfy', ok: res.ok, status: res.status, text: await res.text().catch(() => '') }))
    );
  }

  if (webhooks.customWebhook?.trim()) {
    tasks.push(
      postJson(
        webhooks.customWebhook.trim(),
        { title, body, url, timestamp: new Date().toISOString() },
        {},
        fetchImpl
      ).then((r) => ({ channel: 'CustomWebhook', ...r }))
    );
  }

  const settled = await Promise.allSettled(tasks);
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      if (item.value.ok) {
        results.webhooksSent.push(item.value.channel);
      } else {
        results.webhookErrors.push(`${item.value.channel}(${item.value.status})`);
      }
    } else {
      results.webhookErrors.push(item.reason?.message || 'Webhook error');
    }
  }

  return results;
}
