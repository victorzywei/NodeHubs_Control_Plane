// Global middleware — add CORS headers to all responses

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

    const response = await context.next();
    const cloned = new Response(response.body, response);
    cloned.headers.set('Access-Control-Allow-Origin', '*');
    cloned.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, X-Node-Token');

    return cloned;
}
