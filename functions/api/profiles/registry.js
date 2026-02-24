// GET /api/profiles/registry → Returns protocol registry metadata for frontend
// This is a public-ish API (still needs auth) that the frontend uses to render
// the 3x-ui style cascading protocol selector

import { verifyAdmin } from '../../_lib/auth.js';
import { ok, err } from '../../_lib/response.js';
import {
    PROTOCOL_REGISTRY, TRANSPORT_REGISTRY, TLS_REGISTRY, NODE_ADAPTERS,
} from '../../_lib/constants.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const auth = verifyAdmin(request, env);
    if (!auth.ok) return err('UNAUTHORIZED', auth.error, 401);

    return ok({
        protocols: PROTOCOL_REGISTRY,
        transports: TRANSPORT_REGISTRY,
        tls_modes: TLS_REGISTRY,
        node_adapters: NODE_ADAPTERS,
    });
}
