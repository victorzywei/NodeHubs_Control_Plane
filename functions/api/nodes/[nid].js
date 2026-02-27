// GET    /api/nodes/:nid → Get single node
// PATCH  /api/nodes/:nid → Update node
// DELETE /api/nodes/:nid → Delete node

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, kvDelete, idxAdd, idxRemove, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import { ONLINE_THRESHOLD_MS } from '../../_lib/constants.js';
import { generateToken } from '../../_lib/kv.js';

function normalizeNodeDomains(node) {
    const cdn = typeof node.entry_domain_cdn === 'string' ? node.entry_domain_cdn : (node.entry_domain || '');
    const directRaw = typeof node.entry_domain_direct === 'string' ? node.entry_domain_direct : '';
    const direct = directRaw || cdn;
    return {
        ...node,
        entry_domain_cdn: cdn,
        entry_domain_direct: direct,
        entry_domain: cdn,
    };
}

export async function onRequestGet(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nid = params.nid;
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);

    const normalized = normalizeNodeDomains(node);
    const isOnline = normalized.last_seen && (Date.now() - new Date(normalized.last_seen).getTime() < ONLINE_THRESHOLD_MS);
    return ok({ ...normalized, is_online: isOnline });
}

export async function onRequestPatch(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nid = params.nid;
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);

    const body = await request.json();

    const allowedFields = ['name', 'entry_domain', 'entry_domain_cdn', 'entry_domain_direct', 'entry_ip', 'region', 'tags', 'capabilities', 'github_mirror', 'cf_api_token', 'cf_zone_id'];
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            const trimFields = ['entry_domain', 'entry_domain_cdn', 'entry_domain_direct', 'github_mirror', 'cf_api_token', 'cf_zone_id'];
            node[field] = trimFields.includes(field) && typeof body[field] === 'string'
                ? body[field].trim()
                : body[field];
        }
    }

    if (body.entry_domain !== undefined && body.entry_domain_cdn === undefined) {
        node.entry_domain_cdn = node.entry_domain;
    }
    if (!node.entry_domain_cdn) node.entry_domain_cdn = node.entry_domain || '';
    if (!node.entry_domain_direct) node.entry_domain_direct = node.entry_domain_cdn;
    node.entry_domain = node.entry_domain_cdn;

    if (body.rotate_token) {
        node.node_token = generateToken();
    }

    node.updated_at = new Date().toISOString();

    await kvPut(KV, KEY.node(nid), node);
    await idxAdd(KV, KEY.idxNodes(), { id: nid, name: node.name, node_type: node.node_type });

    return ok(normalizeNodeDomains(node));
}

export async function onRequestDelete(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nid = params.nid;

    await kvDelete(KV, KEY.node(nid));
    await idxRemove(KV, KEY.idxNodes(), nid);

    return ok({ deleted: nid });
}
