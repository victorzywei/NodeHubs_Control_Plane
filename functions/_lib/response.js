// Standardized API response builder

/**
 * @param {any} data
 * @param {number} status
 */
export function ok(data, status = 200) {
    return new Response(JSON.stringify({
        success: true,
        data,
        meta: { timestamp: Date.now() },
    }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * @param {string} code
 * @param {string} message
 * @param {number} status
 */
export function err(code, message, status = 400) {
    return new Response(JSON.stringify({
        success: false,
        error: { code, message },
        meta: { timestamp: Date.now() },
    }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Plain text response (for subscriptions)
 */
export function text(content, status = 200, extraHeaders = {}) {
    return new Response(content, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders },
    });
}

/**
 * YAML response (for Clash subscriptions)
 */
export function yaml(content, status = 200) {
    return new Response(content, {
        status,
        headers: {
            'Content-Type': 'text/yaml; charset=utf-8',
            'Content-Disposition': 'attachment; filename="nodehub.yaml"',
        },
    });
}
