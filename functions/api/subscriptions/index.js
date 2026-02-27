// GET  /api/subscriptions → List subscriptions
// POST /api/subscriptions → Create subscription

import { verifyAdmin } from '../../_lib/auth.js';
import { kvPut, idxHydrate, idxAdd, generateToken, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const subs = await idxHydrate(KV, KEY.idxSubs(), KEY.sub);
    return ok(subs);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    const token = generateToken();
    const sub = {
        token,
        name: body.name || '',
        enabled: true,
        visible_node_ids: body.visible_node_ids || [],
        visible_profile_ids: body.visible_profile_ids || [],
        remark: body.remark || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await kvPut(KV, KEY.sub(token), sub);
    await idxAdd(KV, KEY.idxSubs(), { id: token, name: sub.name });

    return ok(sub, 201);
}
