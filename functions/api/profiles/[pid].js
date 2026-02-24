// GET    /api/profiles/:pid → Get profile
// PATCH  /api/profiles/:pid → Update custom profile
// DELETE /api/profiles/:pid → Delete custom profile

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, kvDelete, idxRemove, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import {
    BUILTIN_PROFILES, isValidCombination, getProfileSchema,
} from '../../_lib/constants.js';

export async function onRequestGet(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const pid = params.pid;
    const builtin = BUILTIN_PROFILES.find(p => p.id === pid);
    if (builtin) return ok({ ...builtin, is_builtin: true, schema: getProfileSchema(builtin) });

    const KV = env.NODEHUB_KV;
    const profile = await kvGet(KV, KEY.profile(pid));
    if (!profile) return err('PROFILE_NOT_FOUND', 'Profile not found', 404);

    return ok({ ...profile, is_builtin: false, schema: getProfileSchema(profile) });
}

export async function onRequestPatch(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const pid = params.pid;
    if (BUILTIN_PROFILES.find(p => p.id === pid)) {
        return err('IMMUTABLE', 'Cannot modify built-in profiles', 400);
    }

    const KV = env.NODEHUB_KV;
    const profile = await kvGet(KV, KEY.profile(pid));
    if (!profile) return err('PROFILE_NOT_FOUND', 'Profile not found', 404);

    const body = await request.json();
    const allowedFields = ['name', 'protocol', 'transport', 'tls_mode', 'node_types', 'defaults', 'schema', 'description'];
    for (const field of allowedFields) {
        if (body[field] !== undefined) profile[field] = body[field];
    }

    // Validate new combination if changed
    if (!isValidCombination(profile.protocol, profile.transport, profile.tls_mode)) {
        return err('VALIDATION', `Invalid combination: ${profile.protocol}+${profile.transport}+${profile.tls_mode}`, 400);
    }

    profile.updated_at = new Date().toISOString();

    await kvPut(KV, KEY.profile(pid), profile);
    return ok({ ...profile, schema: getProfileSchema(profile) });
}

export async function onRequestDelete(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const pid = params.pid;
    if (BUILTIN_PROFILES.find(p => p.id === pid)) {
        return err('IMMUTABLE', 'Cannot delete built-in profiles', 400);
    }

    const KV = env.NODEHUB_KV;
    await kvDelete(KV, KEY.profile(pid));
    await idxRemove(KV, KEY.idxProfiles(), pid);

    return ok({ deleted: pid });
}
