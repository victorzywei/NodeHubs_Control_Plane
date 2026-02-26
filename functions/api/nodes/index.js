// GET  /api/nodes → List all nodes
// POST /api/nodes → Create node

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, idxList, idxAdd, generateId, generateToken, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import { DEFAULT_CAPABILITIES, ONLINE_THRESHOLD_MS } from '../../_lib/constants.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const idx = await idxList(KV, KEY.idxNodes());
    const nodes = [];

    for (const entry of idx) {
        const node = await kvGet(KV, KEY.node(entry.id));
        if (node) {
            const isOnline = node.last_seen && (Date.now() - new Date(node.last_seen).getTime() < ONLINE_THRESHOLD_MS);
            nodes.push({ ...node, is_online: isOnline });
        }
    }

    return ok(nodes);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    if (!body.name) return err('VALIDATION', 'name is required', 400);
    if (!body.node_type) return err('VALIDATION', 'node_type is required', 400);

    const nid = generateId('n');
    const node = {
        id: nid,
        name: body.name,
        node_type: body.node_type,
        entry_domain: body.entry_domain || '',
        entry_ip: body.entry_ip || '',
        region: body.region || '',
        tags: body.tags || [],
        github_mirror: typeof body.github_mirror === 'string' ? body.github_mirror.trim() : '',
        node_token: generateToken(),
        capabilities: DEFAULT_CAPABILITIES[body.node_type] || DEFAULT_CAPABILITIES.vps,
        target_version: 0,
        applied_version: 0,
        last_seen: null,
        last_apply_status: null,
        last_apply_message: '',
        consecutive_failures: 0,
        apply_history: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await kvPut(KV, KEY.node(nid), node);
    await idxAdd(KV, KEY.idxNodes(), { id: nid, name: node.name, node_type: node.node_type });

    return ok(node, 201);
}
