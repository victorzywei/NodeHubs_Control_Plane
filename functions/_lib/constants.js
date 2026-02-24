// Core constants — node types, capabilities schema, built-in profiles, subscription formats

export const NODE_TYPES = ['vps', 'cf_worker'];

export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
export const PLAN_RETENTION_COUNT = 10;

export const DEFAULT_CAPABILITIES = {
    vps: {
        protocols: ['vless', 'trojan'],
        transports: ['ws', 'tcp', 'grpc'],
        tls_modes: ['tls', 'reality'],
        features: ['multi-port'],
    },
    cf_worker: {
        protocols: ['vless'],
        transports: ['ws'],
        tls_modes: ['tls'],
        features: ['cdn-proxy'],
    },
};

export const BUILTIN_PROFILES = [
    {
        id: 'vless-ws-tls',
        name: 'VLESS+WS+TLS',
        protocol: 'vless',
        transport: 'ws',
        tls_mode: 'tls',
        description: 'VLESS over WebSocket with TLS, compatible with CDN',
        is_builtin: true,
        requirements: { protocols: ['vless'], transports: ['ws'], tls_modes: ['tls'] },
        schema: {
            uuid: { type: 'string', auto: 'uuid', description: 'User UUID' },
            path: { type: 'string', default: '/ws', description: 'WebSocket path' },
            host: { type: 'string', description: 'SNI hostname' },
            sni: { type: 'string', description: 'TLS SNI' },
            port: { type: 'number', default: 443, description: 'Listen port' },
        },
    },
    {
        id: 'trojan-ws-tls',
        name: 'Trojan+WS+TLS',
        protocol: 'trojan',
        transport: 'ws',
        tls_mode: 'tls',
        description: 'Trojan over WebSocket with TLS, compatible with CDN',
        is_builtin: true,
        requirements: { protocols: ['trojan'], transports: ['ws'], tls_modes: ['tls'] },
        schema: {
            password: { type: 'string', auto: 'password', description: 'Trojan password' },
            path: { type: 'string', default: '/trojan-ws', description: 'WebSocket path' },
            host: { type: 'string', description: 'SNI hostname' },
            sni: { type: 'string', description: 'TLS SNI' },
            port: { type: 'number', default: 443, description: 'Listen port' },
        },
    },
    {
        id: 'vless-reality-tcp',
        name: 'VLESS+Reality+TCP',
        protocol: 'vless',
        transport: 'tcp',
        tls_mode: 'reality',
        description: 'VLESS with Reality TLS, direct connection, anti-detection',
        is_builtin: true,
        requirements: { protocols: ['vless'], transports: ['tcp'], tls_modes: ['reality'] },
        schema: {
            uuid: { type: 'string', auto: 'uuid', description: 'User UUID' },
            sni: { type: 'string', default: 'www.microsoft.com', description: 'Reality SNI' },
            public_key: { type: 'string', description: 'Reality public key' },
            short_id: { type: 'string', default: '', description: 'Reality short ID' },
            fingerprint: { type: 'string', default: 'chrome', description: 'uTLS fingerprint' },
            port: { type: 'number', default: 443, description: 'Listen port' },
        },
    },
    {
        id: 'vless-grpc-tls',
        name: 'VLESS+gRPC+TLS',
        protocol: 'vless',
        transport: 'grpc',
        tls_mode: 'tls',
        description: 'VLESS over gRPC with TLS, supports multiplexing',
        is_builtin: true,
        requirements: { protocols: ['vless'], transports: ['grpc'], tls_modes: ['tls'] },
        schema: {
            uuid: { type: 'string', auto: 'uuid', description: 'User UUID' },
            service_name: { type: 'string', default: 'grpc', description: 'gRPC service name' },
            host: { type: 'string', description: 'SNI hostname' },
            sni: { type: 'string', description: 'TLS SNI' },
            port: { type: 'number', default: 443, description: 'Listen port' },
        },
    },
];
