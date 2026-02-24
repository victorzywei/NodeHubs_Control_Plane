// Authentication helpers for three scopes

export function verifyAdmin(request, env) {
    const key = request.headers.get('X-Admin-Key') || '';
    if (!key) return { ok: false, error: 'Missing X-Admin-Key header' };
    if (key !== env.ADMIN_KEY) return { ok: false, error: 'Invalid admin key' };
    return { ok: true };
}

export function verifyNodeToken(request) {
    const token = request.headers.get('X-Node-Token') || '';
    if (!token) return { ok: false, error: 'Missing X-Node-Token header' };
    return { ok: true, token };
}
