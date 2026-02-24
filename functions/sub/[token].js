// GET /sub/:token?format=v2ray|clash|singbox → Public subscription endpoint

import { kvGet, KEY } from '../_lib/kv.js';
import { text, yaml, err } from '../_lib/response.js';
import { renderSubscription } from '../_lib/sub-renderer.js';

export async function onRequestGet(context) {
    const { request, env, params } = context;

    const token = params.token;
    const KV = env.NODEHUB_KV;
    const sub = await kvGet(KV, KEY.sub(token));

    if (!sub) return err('SUB_NOT_FOUND', 'Subscription not found', 404);
    if (!sub.enabled) return err('SUB_DISABLED', 'Subscription is disabled', 403);

    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'v2ray';

    const content = await renderSubscription(KV, sub, format);

    if (format === 'clash') {
        return yaml(content);
    }

    if (format === 'singbox') {
        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': 'attachment; filename="nodehub-singbox.json"',
            },
        });
    }

    // v2ray (base64)
    return text(content, 200, {
        'Content-Disposition': 'attachment; filename="nodehub-v2ray.txt"',
    });
}
