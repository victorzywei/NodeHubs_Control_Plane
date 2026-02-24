// POST /api/deploy → Deploy profiles to nodes

import { verifyAdmin } from '../_lib/auth.js';
import { kvGet, kvPut, idxAdd, nextVersion, generateId, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';
import { generatePlan } from '../_lib/plan-generator.js';
import { BUILTIN_PROFILES, PLAN_RETENTION_COUNT } from '../_lib/constants.js';

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

    // Phase 1: Write plans
    for (const nid of node_ids) {
        const node = await kvGet(KV, KEY.node(nid));
        if (!node) {
            results.push({ node_id: nid, status: 'skipped', reason: 'node not found' });
            continue;
        }

        try {
            const plan = generatePlan(node, profiles, deployParams, ver);
            await kvPut(KV, KEY.plan(nid, ver), plan);
            results.push({ node_id: nid, status: 'plan_written' });
        } catch (e) {
            results.push({ node_id: nid, status: 'error', reason: e.message });
        }
    }

    // Phase 2: Update target_version
    for (const nid of node_ids) {
        const node = await kvGet(KV, KEY.node(nid));
        if (!node) continue;

        node.target_version = ver;
        node.updated_at = new Date().toISOString();
        await kvPut(KV, KEY.node(nid), node);

        const oldVer = ver - PLAN_RETENTION_COUNT - 1;
        if (oldVer > 0) {
            try { await KV.delete(KEY.plan(nid, oldVer)); } catch { }
        }

        const r = results.find(r => r.node_id === nid);
        if (r && r.status === 'plan_written') r.status = 'deployed';
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
