// POST /agent/apply-result → Report plan apply result

import { kvGet, kvPut, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

const MAX_HISTORY = 20;

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await request.json();
    const { node_id, version, status, message } = body;
    const nodeToken = request.headers.get('X-Node-Token') || '';

    if (!node_id) return err('MISSING_PARAM', 'node_id is required', 400);
    if (!version) return err('MISSING_PARAM', 'version is required', 400);
    if (!status) return err('MISSING_PARAM', 'status (success|failed) is required', 400);
    if (!nodeToken) return err('MISSING_TOKEN', 'X-Node-Token header is required', 401);

    const KV = env.NODEHUB_KV;
    const node = await kvGet(KV, KEY.node(node_id));

    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_token !== nodeToken) return err('INVALID_TOKEN', 'Invalid node token', 401);

    // Idempotency: skip if already recorded
    const existingRecord = (node.apply_history || []).find(h => h.version === version);
    if (existingRecord) {
        return ok({ message: 'Already recorded', version, status: existingRecord.status });
    }

    // Record apply result
    node.last_apply_status = status;
    node.last_apply_at = new Date().toISOString();
    node.last_seen = new Date().toISOString();

    if (status === 'success') {
        node.applied_version = version;
        node.consecutive_failures = 0;
    } else {
        node.consecutive_failures = (node.consecutive_failures || 0) + 1;
    }

    // Append to history
    if (!node.apply_history) node.apply_history = [];
    node.apply_history.unshift({
        version,
        status,
        message: message || '',
        timestamp: new Date().toISOString(),
    });
    node.apply_history = node.apply_history.slice(0, MAX_HISTORY);

    await kvPut(KV, KEY.node(node_id), node);

    return ok({
        recorded: true,
        version,
        status,
        applied_version: node.applied_version,
        consecutive_failures: node.consecutive_failures,
    });
}
