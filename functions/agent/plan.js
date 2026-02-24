// GET /agent/plan?node_id=...&version=...
// Download plan for a specific version

import { kvGet, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env } = context;

    const url = new URL(request.url);
    const nodeId = url.searchParams.get('node_id');
    const version = parseInt(url.searchParams.get('version') || '0', 10);
    const nodeToken = request.headers.get('X-Node-Token') || '';

    if (!nodeId) return err('MISSING_PARAM', 'node_id is required', 400);
    if (!version) return err('MISSING_PARAM', 'version is required', 400);
    if (!nodeToken) return err('MISSING_TOKEN', 'X-Node-Token header is required', 401);

    const KV = env.NODEHUB_KV;
    const node = await kvGet(KV, KEY.node(nodeId));

    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_token !== nodeToken) return err('INVALID_TOKEN', 'Invalid node token', 401);

    const plan = await kvGet(KV, KEY.plan(nodeId, version));
    if (!plan) return err('PLAN_NOT_FOUND', `Plan v${version} not found for node ${nodeId}`, 404);

    return ok(plan);
}
