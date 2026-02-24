// GET    /api/subscriptions/:token → Get subscription
// PATCH  /api/subscriptions/:token → Update subscription
// DELETE /api/subscriptions/:token → Delete subscription

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, kvDelete, idxRemove, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const sub = await kvGet(KV, KEY.sub(params.token));
    if (!sub) return err('SUB_NOT_FOUND', 'Subscription not found', 404);

    return ok(sub);
}

export async function onRequestPatch(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const sub = await kvGet(KV, KEY.sub(params.token));
    if (!sub) return err('SUB_NOT_FOUND', 'Subscription not found', 404);

    const body = await request.json();
    const allowedFields = ['name', 'enabled', 'visible_node_ids', 'visible_profile_ids', 'remark'];
    for (const field of allowedFields) {
        if (body[field] !== undefined) sub[field] = body[field];
    }
    sub.updated_at = new Date().toISOString();

    await kvPut(KV, KEY.sub(params.token), sub);
    return ok(sub);
}

export async function onRequestDelete(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    await kvDelete(KV, KEY.sub(params.token));
    await idxRemove(KV, KEY.idxSubs(), params.token);

    return ok({ deleted: params.token });
}
