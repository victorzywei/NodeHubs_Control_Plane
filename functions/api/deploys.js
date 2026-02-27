// GET /api/deploys → List recent deploys

import { verifyAdmin } from '../_lib/auth.js';
import { idxHydrate, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const deploys = await idxHydrate(KV, KEY.idxDeploys(), KEY.deploy);
    deploys.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return ok(deploys.slice(0, 20));
}
