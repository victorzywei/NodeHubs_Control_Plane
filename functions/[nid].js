// GET /:nid -> Public node diagnosis page
// Supports:
//   - /n_xxxxx
//   - /n_xxxxx?format=json

import { kvGet, KEY } from './_lib/kv.js';
import { err, ok } from './_lib/response.js';
import { ONLINE_THRESHOLD_MS } from './_lib/constants.js';

function asNodeDiagnosis(node) {
    const now = Date.now();
    const lastSeenTs = node.last_seen ? new Date(node.last_seen).getTime() : 0;
    const isOnline = lastSeenTs > 0 && (now - lastSeenTs) < ONLINE_THRESHOLD_MS;
    const lagSeconds = lastSeenTs > 0 ? Math.max(0, Math.floor((now - lastSeenTs) / 1000)) : null;
    const targetVersion = Number(node.target_version || 0);
    const appliedVersion = Number(node.applied_version || 0);

    const history = Array.isArray(node.apply_history) ? node.apply_history : [];
    const runtimeErrors = history.filter(h => h && h.status === 'failed').map(h => ({
        timestamp: h.timestamp || null,
        version: Number(h.version || 0),
        status: h.status || 'failed',
        message: String(h.message || ''),
        protocols: Array.isArray(h.protocols) ? h.protocols : [],
    }));

    return {
        node_id: node.id,
        name: node.name || '',
        node_type: node.node_type || '',
        manager_connection: {
            is_online: isOnline,
            last_seen: node.last_seen || null,
            last_seen_lag_seconds: lagSeconds,
            online_threshold_ms: ONLINE_THRESHOLD_MS,
        },
        template_sync: {
            target_version: targetVersion,
            applied_version: appliedVersion,
            is_in_sync: targetVersion === appliedVersion,
            last_apply_status: node.last_apply_status || null,
            last_apply_message: String(node.last_apply_message || ''),
            last_apply_at: node.last_apply_at || null,
            consecutive_failures: Number(node.consecutive_failures || 0),
        },
        runtime_error_diary: {
            total_failed_records: runtimeErrors.length,
            recent_failed_records: runtimeErrors.slice(0, 20),
        },
        apply_history: history.slice(0, 20).map(h => ({
            timestamp: h?.timestamp || null,
            version: Number(h?.version || 0),
            status: h?.status || '',
            message: String(h?.message || ''),
            protocols: Array.isArray(h?.protocols) ? h.protocols : [],
        })),
    };
}

function renderHtml(diag) {
    const esc = (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Node Diagnosis - ${esc(diag.node_id)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 24px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
    .ok { color: #166534; }
    .bad { color: #991b1b; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
    h1 { margin: 0 0 12px; font-size: 18px; }
    h2 { margin: 0 0 8px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>节点诊断 / ${esc(diag.node_id)}</h1>
  <div class="card">
    <h2>连接状态</h2>
    <pre>${esc(JSON.stringify(diag.manager_connection, null, 2))}</pre>
  </div>
  <div class="card">
    <h2>模板同步</h2>
    <pre>${esc(JSON.stringify(diag.template_sync, null, 2))}</pre>
  </div>
  <div class="card">
    <h2>运行错误日记（最近失败）</h2>
    <pre>${esc(JSON.stringify(diag.runtime_error_diary, null, 2))}</pre>
  </div>
  <div class="card">
    <h2>应用历史（最近 20 条）</h2>
    <pre>${esc(JSON.stringify(diag.apply_history, null, 2))}</pre>
  </div>
</body>
</html>`;
}

export async function onRequestGet(context) {
    const { env, params, request } = context;
    const nid = params.nid;

    // Avoid catching common static files and invalid IDs.
    if (!nid || nid.includes('.') || !/^n_[a-z0-9]+$/i.test(nid)) {
        return err('NOT_FOUND', 'Node not found', 404);
    }

    const node = await kvGet(env.NODEHUB_KV, KEY.node(nid));
    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);

    const diag = asNodeDiagnosis(node);
    const format = new URL(request.url).searchParams.get('format');
    if (format === 'json') return ok(diag);

    return new Response(renderHtml(diag), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

