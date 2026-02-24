// POST /api/auth/login → Validate admin key

import { ok, err } from '../../_lib/response.js';

export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const key = body.admin_key || '';

    if (!key || key !== env.ADMIN_KEY) {
        return err('UNAUTHORIZED', 'Invalid admin key', 401);
    }

    return ok({ message: 'Authenticated' });
}
