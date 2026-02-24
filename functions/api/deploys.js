// GET /api/deploys → List recent deploys

import { verifyAdmin } from '../_lib/auth.js';
import { kvGet, idxList, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const idx = await idxList(KV, KEY.idxDeploys());

    // Sort by version descending
    idx.sort((a, b) => (b.version || 0) - (a.version || 0));

    const deploys = [];
    for (const entry of idx.slice(0, 20)) {
        const deploy = await kvGet(KV, KEY.deploy(entry.id));
        if (deploy) deploys.push(deploy);
    }

    return ok(deploys);
}
