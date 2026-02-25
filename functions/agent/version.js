// GET /agent/version?node_id=...
// Heartbeat + check if update is available

import { kvGet, kvPut, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env } = context;

    const url = new URL(request.url);
    const nodeId = url.searchParams.get('node_id');
    const currentVersion = parseInt(url.searchParams.get('current_version') || '0', 10);
    const sync = url.searchParams.get('sync') === 'true';
    const nodeToken = request.headers.get('X-Node-Token') || '';

    if (!nodeId) return err('MISSING_PARAM', 'node_id is required', 400);
    if (!nodeToken) return err('MISSING_TOKEN', 'X-Node-Token header is required', 401);

    const KV = env.NODEHUB_KV;
    const node = await kvGet(KV, KEY.node(nodeId));

    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_token !== nodeToken) return err('INVALID_TOKEN', 'Invalid node token', 401);

    // Update heartbeat only if requested via sync=true
    if (sync) {
        node.last_seen = new Date().toISOString();
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
