// GET /agent/version?node_id=...&current_version=...
// 心跳 + 版本检查（简化逻辑：后端自主判断是否需要写 KV）

import { kvGet, kvPut, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

const HEARTBEAT_WRITE_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟内不重复写 KV

export async function onRequestGet(context) {
    const { request, env } = context;

    const url = new URL(request.url);
    const nodeId = url.searchParams.get('node_id');
    const currentVersion = parseInt(url.searchParams.get('current_version') || '0', 10);
    const nodeToken = request.headers.get('X-Node-Token') || '';

    if (!nodeId) return err('MISSING_PARAM', 'node_id is required', 400);
    if (!nodeToken) return err('MISSING_TOKEN', 'X-Node-Token header is required', 401);

    const KV = env.NODEHUB_KV;
    const node = await kvGet(KV, KEY.node(nodeId));

    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_token !== nodeToken) return err('INVALID_TOKEN', 'Invalid node token', 401);

    // 判断是否需要写 KV：距上次心跳超过 10 分钟才写入，节省 KV 写入配额
    const now = Date.now();
    const lastSeen = node.last_seen ? new Date(node.last_seen).getTime() : 0;
    const gap = now - lastSeen;

    if (gap >= HEARTBEAT_WRITE_INTERVAL_MS) {
        node.last_seen = new Date(now).toISOString();
        node.applied_version = currentVersion;
        await kvPut(KV, KEY.node(nodeId), node);
    }

    const needsUpdate = node.target_version && node.target_version > currentVersion;

    return ok({
        node_id: nodeId,
        current_version: currentVersion,
        target_version: node.target_version || 0,
        needs_update: needsUpdate,
    });
}
