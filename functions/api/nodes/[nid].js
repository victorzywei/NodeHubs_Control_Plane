// GET    /api/nodes/:nid → Get single node
// PATCH  /api/nodes/:nid → Update node
// DELETE /api/nodes/:nid → Delete node

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, kvDelete, idxAdd, idxRemove, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import { ONLINE_THRESHOLD_MS } from '../../_lib/constants.js';
import { generateToken } from '../../_lib/kv.js';

export async function onRequestGet(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nid = params.nid;
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);

    const isOnline = node.last_seen && (Date.now() - new Date(node.last_seen).getTime() < ONLINE_THRESHOLD_MS);
    return ok({ ...node, is_online: isOnline });
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

    const allowedFields = ['name', 'entry_domain', 'entry_ip', 'region', 'tags', 'capabilities'];
    for (const field of allowedFields) {
        if (body[field] !== undefined) {
            node[field] = body[field];
        }
    }

    if (body.rotate_token) {
        node.node_token = generateToken();
    }

    node.updated_at = new Date().toISOString();

    await kvPut(KV, KEY.node(nid), node);
    await idxAdd(KV, KEY.idxNodes(), { id: nid, name: node.name, node_type: node.node_type });

    return ok(node);
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
