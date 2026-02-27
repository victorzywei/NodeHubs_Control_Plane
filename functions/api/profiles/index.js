// GET  /api/profiles → List all profiles (built-in + custom)
// POST /api/profiles → Create custom profile (3x-ui style)

import { verifyAdmin } from '../../_lib/auth.js';
import { kvGet, kvPut, idxHydrate, idxAdd, generateId, KEY } from '../../_lib/kv.js';
import { ok, err } from '../../_lib/response.js';
import {
    BUILTIN_PROFILES, PROTOCOL_REGISTRY, TRANSPORT_REGISTRY, TLS_REGISTRY,
    NODE_ADAPTERS, isValidCombination, getProfileSchema,
} from '../../_lib/constants.js';

/**
 * Merge built-in profile with stored overrides
 */
function mergeBuiltinOverride(builtin, override) {
    if (!override) return { ...builtin, is_builtin: true, _has_override: false };
    return {
        ...builtin,
        is_builtin: true,
        _has_override: true,
        defaults: { ...(builtin.defaults || {}), ...(override.defaults || {}) },
        description: override.description || builtin.description,
    };
}

/**
 * GET /api/profiles — returns all profiles + protocol registry metadata
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;

    // Load built-in profiles with any user overrides merged
    const builtins = await Promise.all(
        BUILTIN_PROFILES.map(async (bp) => {
            const override = await kvGet(KV, KEY.profileOverride(bp.id));
            const merged = mergeBuiltinOverride(bp, override);
            return { ...merged, schema: getProfileSchema(merged) };
        })
    );

    // Load custom profiles
    const customs = (await idxHydrate(KV, KEY.idxProfiles(), KEY.profile)).map((profile) => ({
        ...profile,
        is_builtin: false,
        schema: getProfileSchema(profile),
    }));

    return ok([...builtins, ...customs]);
}

/**
 * POST /api/profiles — create a custom profile
 * Body: { name, protocol, transport, tls_mode, description?, defaults?, node_types?, schema? }
 */
export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    // Validation
    if (!body.name) return err('VALIDATION', 'name is required', 400);
    if (!body.protocol) return err('VALIDATION', 'protocol is required', 400);
    if (!body.transport) return err('VALIDATION', 'transport is required', 400);
    if (!body.tls_mode) return err('VALIDATION', 'tls_mode is required', 400);

    // Validate protocol exists in registry
    if (!PROTOCOL_REGISTRY[body.protocol]) {
        return err('VALIDATION', `Unknown protocol: ${body.protocol}. Supported: ${Object.keys(PROTOCOL_REGISTRY).join(', ')}`, 400);
    }

    // Validate transport exists
    if (!TRANSPORT_REGISTRY[body.transport]) {
        return err('VALIDATION', `Unknown transport: ${body.transport}. Supported: ${Object.keys(TRANSPORT_REGISTRY).join(', ')}`, 400);
    }

    // Validate TLS mode exists
    if (!TLS_REGISTRY[body.tls_mode]) {
        return err('VALIDATION', `Unknown tls_mode: ${body.tls_mode}. Supported: ${Object.keys(TLS_REGISTRY).join(', ')}`, 400);
    }

    // Validate combination is valid
    if (!isValidCombination(body.protocol, body.transport, body.tls_mode)) {
        return err('VALIDATION', `Invalid combination: ${body.protocol}+${body.transport}+${body.tls_mode}`, 400);
    }

    // Determine compatible node types
    let nodeTypes = body.node_types || [];
    if (nodeTypes.length === 0) {
        for (const [type, adapter] of Object.entries(NODE_ADAPTERS)) {
            if (adapter.supported_protocols.includes(body.protocol) &&
                adapter.supported_transports.includes(body.transport) &&
                adapter.supported_tls.includes(body.tls_mode)) {
                nodeTypes.push(type);
            }
        }
    }

    const pid = generateId('p');
    const profile = {
        id: pid,
        name: body.name,
        protocol: body.protocol,
        transport: body.transport,
        tls_mode: body.tls_mode,
        description: body.description || '',
        node_types: nodeTypes,
        defaults: body.defaults || {},
        schema: body.schema || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    await kvPut(KV, KEY.profile(pid), profile);
    await idxAdd(KV, KEY.idxProfiles(), { id: pid, name: profile.name });

    return ok({
        ...profile,
        is_builtin: false,
        schema: getProfileSchema(profile),
    }, 201);
}
