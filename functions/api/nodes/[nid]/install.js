// GET /api/nodes/:nid/install -> Generate one-click VPS install command

import { verifyAdmin } from '../../../_lib/auth.js';
import { kvGet, KEY } from '../../../_lib/kv.js';
import { ok, err } from '../../../_lib/response.js';

function shellQuote(value = '') {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

export async function onRequestGet(context) {
    const { request, env, params } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    const KV = env.NODEHUB_KV;
    const nid = params.nid;
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) return err('NODE_NOT_FOUND', 'Node not found', 404);
    if (node.node_type !== 'vps') {
        return err('VALIDATION', 'Only VPS nodes support this install command', 400);
    }

    const origin = new URL(request.url).origin;
    const scriptUrl = `${origin}/agent/install`;
    const command = [
        `curl -fsSL ${shellQuote(scriptUrl)}`,
        ' | sudo bash -s --',
        ` --api-base ${shellQuote(origin)}`,
        ` --node-id ${shellQuote(node.id)}`,
        ` --node-token ${shellQuote(node.node_token)}`,
        ' --poll-interval 15',
    ].join('');

    return ok({
        node_id: node.id,
        script_url: scriptUrl,
        command,
    });
}

