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
    const latestNode = await kvGet(KV, KEY.node(node_id));
    if (!latestNode || latestNode.node_token !== nodeToken) {
        return err('NODE_NOT_FOUND', 'Node not found', 404);
    }
    const writeNode = latestNode;

    if (!writeNode.apply_history) writeNode.apply_history = [];
    const normalizedMessage = String(message || '');
    const existingRecord = writeNode.apply_history.find(h => h.version === versionNum);
    const existingProtocols = Array.isArray(existingRecord?.protocols) ? existingRecord.protocols : [];
    const sameAsExisting = existingRecord
        && existingRecord.status === status
        && String(existingRecord.message || '') === normalizedMessage
        && JSON.stringify(existingProtocols) === JSON.stringify(appliedProtocols);
    if (sameAsExisting) {
        return ok({ message: 'Already recorded', version: versionNum, status: existingRecord.status });
    }

    // Record apply result
    writeNode.last_apply_status = status;
    writeNode.last_apply_message = normalizedMessage;
    writeNode.last_apply_at = new Date().toISOString();
    writeNode.last_seen = new Date().toISOString();

    if (status === 'success') {
        writeNode.applied_version = versionNum;
        writeNode.consecutive_failures = 0;
    } else {
        writeNode.consecutive_failures = (writeNode.consecutive_failures || 0) + 1;
    }

    // Write history only on state/message transition for this version
    const nowIso = new Date().toISOString();
    if (existingRecord) {
        existingRecord.status = status;
        existingRecord.message = normalizedMessage;
        existingRecord.protocols = appliedProtocols;
        existingRecord.timestamp = nowIso;
    } else {
        writeNode.apply_history.unshift({
            version: versionNum,
            status,
            message: normalizedMessage,
            protocols: appliedProtocols,
            timestamp: nowIso,
        });
        writeNode.apply_history = writeNode.apply_history.slice(0, MAX_HISTORY);
    }

    await kvPut(KV, KEY.node(node_id), writeNode);

    return ok({
        recorded: true,
        version: versionNum,
        status,
        applied_version: writeNode.applied_version,
        consecutive_failures: writeNode.consecutive_failures,
    });
}
