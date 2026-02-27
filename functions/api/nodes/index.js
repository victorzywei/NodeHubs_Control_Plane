// GET  /api/nodes → List all nodes
// POST /api/nodes → Create node

import { verifyAdmin } from '../../_lib/auth.js';
import { kvPut, idxHydrate, idxAdd, generateId, generateToken, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import { DEFAULT_CAPABILITIES, ONLINE_THRESHOLD_MS } from '../../_lib/constants.js';

function withOnlineState(node) {
    const lastSeen = node.last_seen ? new Date(node.last_seen).getTime() : 0;
    return { ...node, is_online: Date.now() - lastSeen < ONLINE_THRESHOLD_MS };
}

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nodes = await idxHydrate(KV, KEY.idxNodes(), KEY.node);
    return ok(nodes.map(withOnlineState));
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
        cf_api_token: typeof body.cf_api_token === 'string' ? body.cf_api_token.trim() : '',
        cf_zone_id: typeof body.cf_zone_id === 'string' ? body.cf_zone_id.trim() : '',
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
