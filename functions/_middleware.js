const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, X-Node-Token',
};

function withCors(response) {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
        headers.set(key, value);
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...CORS_HEADERS,
                'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    try {
        return withCors(await context.next());
    } catch (e) {
        return withCors(new Response(JSON.stringify({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: e.message || 'Unknown internal error',
                stack: e.stack || '',
            },
            meta: { timestamp: Date.now() },
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        }));
    }
}