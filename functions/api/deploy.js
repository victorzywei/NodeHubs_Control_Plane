// POST /api/deploy → Deploy profiles to nodes

import { verifyAdmin } from '../_lib/auth.js';
import { kvGet, kvPut, idxAdd, nextVersion, generateId, KEY } from '../_lib/kv.js';
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

    // Resolve profiles
    const profiles = [];
    for (const pid of profile_ids) {
        const builtin = BUILTIN_PROFILES.find(p => p.id === pid);
        if (builtin) {
            profiles.push(builtin);
        } else {
            const custom = await kvGet(KV, KEY.profile(pid));
            if (custom) profiles.push(custom);
        }
    }

    if (profiles.length === 0) {
        return err('VALIDATION', 'No valid profiles found', 400);
    }

    const ver = await nextVersion(KV);
    const did = generateId('d');
    const results = [];
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
                if (!hasPrivate) {
                    const { publicKey, privateKey } = await generateRealityKeyPair();
                    nodeParams.reality_private_key = privateKey;
                    // Keep generated key-pair consistent for this plan.
                    nodeParams.public_key = publicKey;
                }
            }

            const plan = generatePlan(node, profiles, nodeParams, ver);
            await kvPut(KV, KEY.plan(nid, ver), plan);

            node.target_version = ver;
            node.updated_at = new Date().toISOString();
            await kvPut(KV, KEY.node(nid), node);

            const oldVer = ver - PLAN_RETENTION_COUNT - 1;
            if (oldVer > 0) {
                try { await KV.delete(KEY.plan(nid, oldVer)); } catch { }
            }

            results.push({ node_id: nid, status: 'deployed' });
        } catch (e) {
            results.push({ node_id: nid, status: 'error', reason: e.message });
        }
    }

    // Phase 3: Write deploy record
    const deploy = {
        id: did,
        version: ver,
        node_ids,
        profile_ids,
        params_snapshot: deployParams,
        results,
        created_at: new Date().toISOString(),
    };
    await kvPut(KV, KEY.deploy(did), deploy);
    await idxAdd(KV, KEY.idxDeploys(), { id: did, version: ver, created_at: deploy.created_at });

    return ok({ deploy_id: did, version: ver, results });
}
