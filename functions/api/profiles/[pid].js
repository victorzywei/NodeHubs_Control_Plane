// GET    /api/profiles/:pid → Get profile
// PATCH  /api/profiles/:pid → Update profile (built-in: save override, custom: update directly)
// DELETE /api/profiles/:pid → Delete custom / Reset built-in

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

    if (builtin) {
        const KV = env.NODEHUB_KV;
        const override = await kvGet(KV, KEY.profileOverride(pid));
        const merged = override
            ? { ...builtin, defaults: { ...(builtin.defaults || {}), ...(override.defaults || {}) }, description: override.description || builtin.description }
            : builtin;
        return ok({ ...merged, is_builtin: true, _has_override: !!override, schema: getProfileSchema(merged) });
    }

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
    const KV = env.NODEHUB_KV;
    const body = await request.json();
    const builtin = BUILTIN_PROFILES.find(p => p.id === pid);

    if (builtin) {
        // Built-in profile: save overrides only (defaults + description)
        const existingOverride = (await kvGet(KV, KEY.profileOverride(pid))) || {};
        const override = {
            defaults: { ...(existingOverride.defaults || {}), ...(body.defaults || {}) },
            description: body.description !== undefined ? body.description : (existingOverride.description || ''),
            updated_at: new Date().toISOString(),
        };
        await kvPut(KV, KEY.profileOverride(pid), override);

        // Return merged result
        const merged = {
            ...builtin,
            defaults: { ...(builtin.defaults || {}), ...override.defaults },
            description: override.description || builtin.description,
        };
        return ok({ ...merged, is_builtin: true, _has_override: true, schema: getProfileSchema(merged) });
    }

    // Custom profile: update directly
    const profile = await kvGet(KV, KEY.profile(pid));
    if (!profile) return err('PROFILE_NOT_FOUND', 'Profile not found', 404);

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
    return ok({ ...profile, is_builtin: false, schema: getProfileSchema(profile) });
}

export async function onRequestDelete(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const pid = params.pid;
    const KV = env.NODEHUB_KV;
    const builtin = BUILTIN_PROFILES.find(p => p.id === pid);

    if (builtin) {
        // Built-in profile: DELETE = reset (remove override)
        await kvDelete(KV, KEY.profileOverride(pid));
        return ok({ reset: pid, message: 'Built-in profile reset to defaults' });
    }

    // Custom profile: actually delete
    await kvDelete(KV, KEY.profile(pid));
    await idxRemove(KV, KEY.idxProfiles(), pid);

    return ok({ deleted: pid });
}
