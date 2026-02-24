// Global middleware — CORS + global error handler

export async function onRequest(context) {
    const { request } = context;

    // Handle preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Node-Token',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    try {
        const response = await context.next();
        const cloned = new Response(response.body, response);
        cloned.headers.set('Access-Control-Allow-Origin', '*');
        cloned.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, X-Node-Token');
        return cloned;
    } catch (e) {
        // Catch any unhandled error from downstream handlers and return a JSON error
        return new Response(JSON.stringify({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: e.message || 'Unknown internal error',
                stack: e.stack || '',
            },
            meta: { timestamp: Date.now() },
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Node-Token',
            },
        });
    }
}
