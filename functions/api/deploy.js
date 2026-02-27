// POST /api/deploy → Deploy profiles to nodes

import { verifyAdmin } from '../_lib/auth.js';
import { kvGet, kvPut, idxAdd, generateId, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';
import { generatePlan, isProfileCompatible } from '../_lib/plan-generator.js';
import { BUILTIN_PROFILES, PLAN_RETENTION_COUNT } from '../_lib/constants.js';

function hasNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

async function generateRealityKeyPair() {
    try {
        if (!globalThis.crypto?.subtle) {
            throw new Error('WebCrypto is unavailable');
        }

        const keyPair = await crypto.subtle.generateKey(
            { name: 'X25519' },
            true,
            ['deriveBits']
        );

        const [publicJwk, privateJwk] = await Promise.all([
            crypto.subtle.exportKey('jwk', keyPair.publicKey),
            crypto.subtle.exportKey('jwk', keyPair.privateKey),
        ]);

        const publicKey = publicJwk?.x || '';
        const privateKey = privateJwk?.d || '';
        if (!publicKey || !privateKey) {
            throw new Error('Missing exported key material');
        }

        return { publicKey, privateKey };
    } catch {
        throw new Error('Auto Reality key generation failed. Please provide params.reality_private_key and params.public_key manually.');
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const body = await request.json();

    const { node_ids, profile_ids, params: deployParams = {} } = body;
    if (!node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
        return err('VALIDATION', 'node_ids must be a non-empty array', 400);
    }
    if (!profile_ids || !Array.isArray(profile_ids) || profile_ids.length === 0) {
        return err('VALIDATION', 'profile_ids must be a non-empty array', 400);
    }

    // Resolve profiles (built-ins must include persisted overrides)
    const profiles = [];
    for (const pid of profile_ids) {
        const builtin = BUILTIN_PROFILES.find(p => p.id === pid);
        if (builtin) {
            const override = await kvGet(KV, KEY.profileOverride(pid));
            const mergedBuiltin = override
                ? {
                    ...builtin,
                    defaults: { ...(builtin.defaults || {}), ...(override.defaults || {}) },
                    description: override.description || builtin.description,
                }
                : builtin;
            profiles.push(mergedBuiltin);
        } else {
            const custom = await kvGet(KV, KEY.profile(pid));
            if (custom) profiles.push(custom);
        }
    }

    if (profiles.length === 0) {
        return err('VALIDATION', 'No valid profiles found', 400);
    }

    const did = generateId('d');
    const results = [];
    const nodeVersions = [];
    for (const nid of node_ids) {
        const node = await kvGet(KV, KEY.node(nid));
        if (!node) {
            results.push({ node_id: nid, status: 'skipped', reason: 'node not found' });
            continue;
        }

        try {
            const applicableProfiles = profiles.filter((p) => isProfileCompatible(p, node));
            const needsReality = node.node_type === 'vps' && applicableProfiles.some((p) => p.tls_mode === 'reality');
            const nodeParams = { ...deployParams };

            if (needsReality) {
                const hasPrivate = hasNonEmptyString(nodeParams.reality_private_key) || hasNonEmptyString(nodeParams.private_key);
                const hasPublic = hasNonEmptyString(nodeParams.public_key);
                if (!hasPrivate || !hasPublic) {
                    const { publicKey, privateKey } = await generateRealityKeyPair();
                    // If either side is missing, replace with a fresh consistent key-pair.
                    nodeParams.reality_private_key = privateKey;
                    nodeParams.private_key = privateKey;
                    nodeParams.public_key = publicKey;
                }
            }

            const desiredVersion = Number(node.desired_version || 0);
            const appliedVersion = Number(node.applied_version ?? 0);
            const baseVersion = Math.max(desiredVersion, appliedVersion, 0);
            let ver = baseVersion + 1;
            while (await kvGet(KV, KEY.plan(nid, ver))) ver += 1;

            const plan = generatePlan(node, profiles, nodeParams, ver);
            await kvPut(KV, KEY.plan(nid, ver), plan);

            node.desired_version = ver;
            node.last_apply_status = 'pending';
            node.last_apply_message = `release queued: v${ver}`;
            node.updated_at = new Date().toISOString();
            await kvPut(KV, KEY.node(nid), node);

            const oldVer = ver - PLAN_RETENTION_COUNT - 1;
            if (oldVer > 0) {
                try { await KV.delete(KEY.plan(nid, oldVer)); } catch { }
            }

            results.push({ node_id: nid, node_name: node.name || nid, status: 'deployed', version: ver });
            nodeVersions.push({ node_id: nid, node_name: node.name || nid, version: ver });
        } catch (e) {
            results.push({ node_id: nid, status: 'error', reason: e.message });
            nodeVersions.push({ node_id: nid, version: 0, status: 'error', reason: e.message });
        }
    }

    // Phase 3: Write deploy record
    const config_names = profiles
        .map((p) => p.name || p.id)
        .filter((name) => typeof name === 'string' && name.trim() !== '');

    const successfulVersions = nodeVersions
        .map((x) => Number(x.version || 0))
        .filter((v) => v > 0);
    const maxVersion = successfulVersions.length ? Math.max(...successfulVersions) : 0;
    const minVersion = successfulVersions.length ? Math.min(...successfulVersions) : 0;

    const deploy = {
        id: did,
        version: successfulVersions.length === 1 ? successfulVersions[0] : (minVersion === maxVersion ? maxVersion : null),
        version_min: minVersion || null,
        version_max: maxVersion || null,
        node_ids,
        node_versions: nodeVersions,
        profile_ids,
        config_names,
        params_snapshot: deployParams,
        results,
        created_at: new Date().toISOString(),
    };
    await kvPut(KV, KEY.deploy(did), deploy);
    await idxAdd(KV, KEY.idxDeploys(), {
        id: did,
        version: deploy.version,
        version_min: deploy.version_min,
        version_max: deploy.version_max,
        created_at: deploy.created_at,
    });

    return ok({
        deploy_id: did,
        version: deploy.version,
        version_min: deploy.version_min,
        version_max: deploy.version_max,
        node_versions: nodeVersions,
        results,
    });
}
