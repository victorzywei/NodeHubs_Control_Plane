// POST /agent/apply-result → Report plan apply result

import { kvGet, kvPut, KEY } from '../_lib/kv.js';
import { ok, err } from '../_lib/response.js';

const MAX_HISTORY = 20;
const ALLOWED_STATUS = new Set(['success', 'failed']);

function extractAppliedProtocols(plan) {
    if (!plan || typeof plan !== 'object') return [];

    const entries = plan.inbounds || (plan.runtime_config && plan.runtime_config.configs) || [];
    const protocols = [];
    for (const entry of entries) {
        const proto = typeof entry?.protocol === 'string' ? entry.protocol.trim() : '';
        if (proto) protocols.push(proto);
    }
    return [...new Set(protocols)];
}

export async function onRequestPost(context) {
    const { request, env } = context;

    const body = await request.json();
    const { node_id, version, status, message } = body;
    const versionNum = Number(version);
    const nodeToken = request.headers.get('X-Node-Token') || '';

    if (!node_id) return err('MISSING_PARAM', 'node_id is required', 400);
    if (version === undefined || version === null || version === '') return err('MISSING_PARAM', 'version is required', 400);
    if (!Number.isInteger(versionNum) || versionNum < 1) return err('INVALID_PARAM', 'version must be a positive integer', 400);
    if (!status) return err('MISSING_PARAM', 'status (success|failed) is required', 400);
    if (!ALLOWED_STATUS.has(status)) return err('INVALID_PARAM', 'status must be success or failed', 400);
    if (!nodeToken) return err('MISSING_TOKEN', 'X-Node-Token header is required', 401);

    const KV = env.NODEHUB_KV;
    const node = await kvGet(KV, KEY.node(node_id));

    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_token !== nodeToken) return err('INVALID_TOKEN', 'Invalid node token', 401);
    const plan = await kvGet(KV, KEY.plan(node_id, versionNum));
    const appliedProtocols = extractAppliedProtocols(plan);

    if (!node.apply_history) node.apply_history = [];
    const normalizedMessage = String(message || '');
    const existingRecord = node.apply_history.find(h => h.version === versionNum);
    const existingProtocols = Array.isArray(existingRecord?.protocols) ? existingRecord.protocols : [];
    const sameAsExisting = existingRecord
        && existingRecord.status === status
        && String(existingRecord.message || '') === normalizedMessage
        && JSON.stringify(existingProtocols) === JSON.stringify(appliedProtocols);
    if (sameAsExisting) {
        return ok({ message: 'Already recorded', version: versionNum, status: existingRecord.status });
    }

    // Record apply result
    node.last_apply_status = status;
    node.last_apply_message = normalizedMessage;
    node.last_apply_at = new Date().toISOString();
    node.last_seen = new Date().toISOString();

    if (status === 'success') {
        node.applied_version = versionNum;
        node.consecutive_failures = 0;
    } else {
        node.consecutive_failures = (node.consecutive_failures || 0) + 1;
    }

    // Write history only on state/message transition for this version
    const nowIso = new Date().toISOString();
    if (existingRecord) {
        existingRecord.status = status;
        existingRecord.message = normalizedMessage;
        existingRecord.protocols = appliedProtocols;
        existingRecord.timestamp = nowIso;
    } else {
        node.apply_history.unshift({
            version: versionNum,
            status,
            message: normalizedMessage,
            protocols: appliedProtocols,
            timestamp: nowIso,
        });
        node.apply_history = node.apply_history.slice(0, MAX_HISTORY);
    }

    await kvPut(KV, KEY.node(node_id), node);

    return ok({
        recorded: true,
        version: versionNum,
        status,
        applied_version: node.applied_version,
        consecutive_failures: node.consecutive_failures,
    });
}
