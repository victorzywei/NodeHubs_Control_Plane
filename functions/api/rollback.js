// POST /api/rollback → Rollback nodes to a specific version

import { verifyAdmin } from '../_lib/auth.js';
import { kvGet, kvPut, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    const { node_ids, target_version } = body;
    const version = Number(target_version);
    if (!node_ids || !Array.isArray(node_ids)) {
        return err('VALIDATION', 'node_ids must be an array', 400);
    }
    if (!Number.isInteger(version) || version < 1) {
        return err('VALIDATION', 'target_version must be a positive integer', 400);
    }

    const results = [];
    for (const nid of node_ids) {
        const node = await kvGet(KV, KEY.node(nid));
        if (!node) {
            results.push({ node_id: nid, status: 'skipped', reason: 'node not found' });
            continue;
        }

        // Verify plan exists
        const plan = await kvGet(KV, KEY.plan(nid, version));
        if (!plan) {
            results.push({ node_id: nid, status: 'skipped', reason: `plan v${version} not found` });
            continue;
        }

        node.target_version = version;
        node.updated_at = new Date().toISOString();
        await kvPut(KV, KEY.node(nid), node);
        results.push({ node_id: nid, status: 'rolled_back' });
    }

    return ok({ target_version: version, results });
}
