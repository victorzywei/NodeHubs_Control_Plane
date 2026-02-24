// GET  /api/profiles → List all profiles (built-in + custom)
// POST /api/profiles → Create custom profile

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, idxList, idxAdd, generateId, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import { BUILTIN_PROFILES } from '../../_lib/constants.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const builtins = BUILTIN_PROFILES.map(p => ({ ...p, is_builtin: true }));

    const idx = await idxList(KV, KEY.idxProfiles());
    const customs = [];
    for (const entry of idx) {
        const profile = await kvGet(KV, KEY.profile(entry.id));
        if (profile) customs.push({ ...profile, is_builtin: false });
    }

    return ok([...builtins, ...customs]);
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    if (!body.name) return err('VALIDATION', 'name is required', 400);
    if (!body.protocol) return err('VALIDATION', 'protocol is required', 400);

    const pid = generateId('p');
    const profile = {
        id: pid,
        name: body.name,
        protocol: body.protocol,
        transport: body.transport || 'tcp',
        tls_mode: body.tls_mode || 'tls',
        description: body.description || '',
        requirements: body.requirements || {},
        schema: body.schema || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await kvPut(KV, KEY.profile(pid), profile);
    await idxAdd(KV, KEY.idxProfiles(), { id: pid, name: profile.name });

    return ok(profile, 201);
}
