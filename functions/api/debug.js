// GET /api/debug → Check env bindings status (remove in production)

export async function onRequestGet(context) {
    const { env } = context;

    const kvBinding = env.NODEHUB_KV;
    const adminKey = env.ADMIN_KEY;

    const kvInfo = {
        exists: kvBinding !== undefined && kvBinding !== null,
        type: typeof kvBinding,
        isString: typeof kvBinding === 'string',
        isObject: typeof kvBinding === 'object' && kvBinding !== null,
        hasGet: kvBinding && typeof kvBinding.get === 'function',
        hasPut: kvBinding && typeof kvBinding.put === 'function',
        hasDelete: kvBinding && typeof kvBinding.delete === 'function',
        value_if_string: typeof kvBinding === 'string' ? kvBinding.substring(0, 20) : null,
    };

    const adminKeyInfo = {
        exists: adminKey !== undefined && adminKey !== null,
        type: typeof adminKey,
        length: adminKey ? String(adminKey).length : 0,
    };

    return new Response(JSON.stringify({
        success: true,
        data: {
            kv_binding: kvInfo,
            admin_key: adminKeyInfo,
            all_env_keys: Object.keys(env),
        },
    }, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
