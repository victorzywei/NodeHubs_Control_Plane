// ==========================================
// NodeHub Protocol Registry System
// 分层协议注册表 — 参考 3x-ui 协议配置模式
// ==========================================

// ─── 节点类型 ───
export const NODE_TYPES = ['vps', 'cf_worker'];

// ─── 系统常量 ───
export const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;
export const PLAN_RETENTION_COUNT = 10;

// ─── CF 标准端口集合 ───
export const CF_PORTS_HTTP = [80, 8080, 8880, 2052, 2082, 2086, 2095];
export const CF_PORTS_HTTPS = [443, 8443, 2053, 2096, 2087, 2083];

// ==============================================================
// 1) 协议注册表 — 定义每种协议的字段与兼容规则
// ==============================================================
export const PROTOCOL_REGISTRY = {
    vless: {
        name: 'VLESS',
        fields: {
            uuid: { type: 'string', auto: 'uuid', required: true, label: 'UUID' },
            encryption: { type: 'select', options: ['none'], default: 'none', label: '加密方式' },
            flow: { type: 'select', options: ['', 'xtls-rprx-vision'], default: '', label: 'Flow', hint: 'Reality+TCP 下可选 xtls-rprx-vision' },
        },
        compatible_transports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'splithttp', 'h2'],
        compatible_tls: ['none', 'tls', 'reality'],
    },
    trojan: {
        name: 'Trojan',
        fields: {
            password: { type: 'string', auto: 'password', required: true, label: '密码' },
        },
        compatible_transports: ['tcp', 'ws', 'grpc', 'h2'],
        compatible_tls: ['tls'],   // Trojan 必须有 TLS
    },
    vmess: {
        name: 'VMess',
        fields: {
            uuid: { type: 'string', auto: 'uuid', required: true, label: 'UUID' },
            alter_id: { type: 'number', default: 0, label: 'Alter ID', hint: '推荐设为 0' },
            encryption: { type: 'select', options: ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none'], default: 'auto', label: '加密方式' },
        },
        compatible_transports: ['tcp', 'ws', 'grpc', 'h2', 'httpupgrade'],
        compatible_tls: ['none', 'tls'],
    },
    shadowsocks: {
        name: 'Shadowsocks',
        fields: {
            password: { type: 'string', auto: 'password', required: true, label: '密码' },
            method: {
                type: 'select', options: [
                    '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305',
                    'aes-256-gcm', 'aes-128-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
                ], default: '2022-blake3-aes-128-gcm', label: '加密方法'
            },
        },
        compatible_transports: ['tcp'],
        compatible_tls: ['none', 'tls'],
    },
    hysteria2: {
        name: 'Hysteria2',
        fields: {
            password: { type: 'string', auto: 'password', required: true, label: '密码' },
            up_mbps: { type: 'number', default: 100, label: '上行 Mbps' },
            down_mbps: { type: 'number', default: 100, label: '下行 Mbps' },
            obfs_type: { type: 'select', options: ['', 'salamander'], default: '', label: '混淆类型' },
            obfs_password: { type: 'string', default: '', label: '混淆密码' },
        },
        compatible_transports: ['udp'],
        compatible_tls: ['tls'],
    },
};

// ==============================================================
// 2) 传输层注册表 — 定义每种传输方式的字段
// ==============================================================
export const TRANSPORT_REGISTRY = {
    tcp: {
        name: 'TCP',
        fields: {
            header_type: { type: 'select', options: ['none', 'http'], default: 'none', label: 'Header 类型' },
        },
    },
    ws: {
        name: 'WebSocket',
        fields: {
            path: { type: 'string', default: '/', label: 'Path' },
            host: { type: 'string', default: '', label: 'Host', hint: '一般与 SNI 相同' },
            max_early_data: { type: 'number', default: 2560, label: 'Max Early Data' },
            early_data_header: { type: 'string', default: 'Sec-WebSocket-Protocol', label: 'Early Data Header' },
        },
    },
    grpc: {
        name: 'gRPC',
        fields: {
            service_name: { type: 'string', default: 'grpc', label: 'Service Name' },
            multi_mode: { type: 'boolean', default: false, label: 'Multi Mode' },
        },
    },
    httpupgrade: {
        name: 'HTTPUpgrade',
        fields: {
            path: { type: 'string', default: '/', label: 'Path' },
            host: { type: 'string', default: '', label: 'Host' },
        },
    },
    splithttp: {
        name: 'SplitHTTP',
        fields: {
            path: { type: 'string', default: '/', label: 'Path' },
            host: { type: 'string', default: '', label: 'Host' },
        },
    },
    h2: {
        name: 'HTTP/2',
        fields: {
            path: { type: 'string', default: '/', label: 'Path' },
            host: { type: 'string', default: '', label: 'Host' },
        },
    },
    udp: {
        name: 'UDP (QUIC)',
        fields: {},
    },
};

// ==============================================================
// 3) TLS 模式注册表 — 定义每种 TLS 模式的字段
// ==============================================================
export const TLS_REGISTRY = {
    none: {
        name: '无 TLS',
        fields: {},
    },
    tls: {
        name: 'TLS',
        fields: {
            sni: { type: 'string', default: '', label: 'SNI', hint: '服务器名称指示，一般填域名' },
            fingerprint: {
                type: 'select', options: [
                    'chrome', 'firefox', 'safari', 'edge', 'ios', 'android', 'random', 'randomized',
                ], default: 'chrome', label: 'uTLS 指纹'
            },
            alpn: { type: 'multi-select', options: ['h2', 'http/1.1'], default: ['h2', 'http/1.1'], label: 'ALPN' },
            allow_insecure: { type: 'boolean', default: false, label: '允许不安全证书' },
        },
    },
    reality: {
        name: 'Reality',
        fields: {
            sni: { type: 'string', default: 'www.microsoft.com', label: 'SNI (伪装域名)' },
            public_key: { type: 'string', required: true, label: '公钥 (Public Key)' },
            private_key: { type: 'string', default: '', label: '私钥 (Private Key)', hint: '仅 VPS 端需要', server_side: true },
            short_id: { type: 'string', default: '', label: 'Short ID' },
            fingerprint: {
                type: 'select', options: [
                    'chrome', 'firefox', 'safari', 'edge', 'ios', 'android', 'random', 'randomized',
                ], default: 'chrome', label: 'uTLS 指纹'
            },
            spider_x: { type: 'string', default: '/', label: 'SpiderX', hint: '爬虫路径' },
        },
    },
};

// ==============================================================
// 4) 节点类型适配器 — 定义每种节点类型的能力边界和专属参数
// ==============================================================
export const NODE_ADAPTERS = {
    vps: {
        name: 'VPS',
        description: '多协议、全功能 VPS 节点',
        fields: {
            listen_port: { type: 'number', default: 443, label: '监听端口', hint: '可自定义任意端口' },
        },
        // VPS 支持所有协议、传输和 TLS
        supported_protocols: ['vless', 'trojan', 'vmess', 'shadowsocks', 'hysteria2'],
        supported_transports: ['tcp', 'ws', 'grpc', 'httpupgrade', 'splithttp', 'h2', 'udp'],
        supported_tls: ['none', 'tls', 'reality'],
    },
    cf_worker: {
        name: 'CF Worker',
        description: 'Cloudflare Workers/Pages 节点，受 CDN 限制',
        fields: {
            cf_port: { type: 'select', options: [...CF_PORTS_HTTPS, ...CF_PORTS_HTTP], default: 443, label: 'CF 端口', hint: 'HTTPS端口=TLS, HTTP端口=无TLS' },
            proxyip: { type: 'string', default: '', label: 'ProxyIP', hint: '反代 IP 地址，填入后解锁更多网站' },
            nat64: { type: 'boolean', default: false, label: 'NAT64', hint: '开启后使用 NAT64 做 ProxyIP' },
        },
        // CF Worker 只支持 vless/trojan + ws + tls/none
        supported_protocols: ['vless', 'trojan'],
        supported_transports: ['ws'],
        supported_tls: ['tls', 'none'],
    },
};

// ==============================================================
// 5) 内置协议配置 (Profiles) — 预组合的常用方案
// ==============================================================
export const BUILTIN_PROFILES = [
    // ── VLESS 系列 ──
    {
        id: 'vless-ws-tls',
        name: 'VLESS+WS+TLS',
        protocol: 'vless',
        transport: 'ws',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'VLESS over WebSocket+TLS，兼容 CDN，最通用的方案',
        node_types: ['vps', 'cf_worker'],
        defaults: {
            path: '/?ed=2560', fingerprint: 'randomized', alpn: ['h2', 'http/1.1'],
        },
    },
    {
        id: 'vless-ws-none',
        name: 'VLESS+WS (无TLS)',
        protocol: 'vless',
        transport: 'ws',
        tls_mode: 'none',
        is_builtin: true,
        description: 'VLESS over WebSocket 无 TLS，适用 CF 80 系端口',
        node_types: ['cf_worker'],
        defaults: {
            path: '/?ed=2560',
        },
    },
    {
        id: 'vless-reality-tcp',
        name: 'VLESS+Reality+TCP',
        protocol: 'vless',
        transport: 'tcp',
        tls_mode: 'reality',
        is_builtin: true,
        description: 'VLESS+Reality 直连方案，极强抗检测，仅 VPS',
        node_types: ['vps'],
        defaults: {
            sni: 'www.microsoft.com', fingerprint: 'chrome',
            flow: 'xtls-rprx-vision',
        },
    },
    {
        id: 'vless-grpc-tls',
        name: 'VLESS+gRPC+TLS',
        protocol: 'vless',
        transport: 'grpc',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'VLESS over gRPC+TLS，支持多路复用，仅 VPS',
        node_types: ['vps'],
        defaults: {
            service_name: 'grpc', fingerprint: 'chrome',
        },
    },
    // ── Trojan 系列 ──
    {
        id: 'trojan-ws-tls',
        name: 'Trojan+WS+TLS',
        protocol: 'trojan',
        transport: 'ws',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'Trojan over WebSocket+TLS，兼容 CDN',
        node_types: ['vps', 'cf_worker'],
        defaults: {
            path: '/trojan-ws', fingerprint: 'chrome',
        },
    },
    {
        id: 'trojan-tcp-tls',
        name: 'Trojan+TCP+TLS',
        protocol: 'trojan',
        transport: 'tcp',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'Trojan 经典 TCP 方案，性能最佳，仅 VPS',
        node_types: ['vps'],
        defaults: {
            fingerprint: 'chrome',
        },
    },
    // ── VMess 系列 ──
    {
        id: 'vmess-ws-tls',
        name: 'VMess+WS+TLS',
        protocol: 'vmess',
        transport: 'ws',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'VMess over WebSocket+TLS，兼容性好',
        node_types: ['vps'],
        defaults: {
            path: '/vmess-ws', alter_id: 0, encryption: 'auto',
            fingerprint: 'chrome',
        },
    },
    // ── Shadowsocks ──
    {
        id: 'ss-2022',
        name: 'Shadowsocks 2022',
        protocol: 'shadowsocks',
        transport: 'tcp',
        tls_mode: 'none',
        is_builtin: true,
        description: 'Shadowsocks 2022 新协议，高性能',
        node_types: ['vps'],
        defaults: {
            method: '2022-blake3-aes-128-gcm',
        },
    },
    // ── Hysteria2 ──
    {
        id: 'hysteria2',
        name: 'Hysteria2',
        protocol: 'hysteria2',
        transport: 'udp',
        tls_mode: 'tls',
        is_builtin: true,
        description: 'Hysteria2 QUIC 协议，高速低延迟',
        node_types: ['vps'],
        defaults: {
            up_mbps: 100, down_mbps: 100, fingerprint: 'chrome',
        },
    },
];

// ==============================================================
// 6) 默认节点能力（节点注册时自动填充）
// ==============================================================
export const DEFAULT_CAPABILITIES = {
    vps: {
        protocols: NODE_ADAPTERS.vps.supported_protocols,
        transports: NODE_ADAPTERS.vps.supported_transports,
        tls_modes: NODE_ADAPTERS.vps.supported_tls,
        features: ['multi-port', 'multi-protocol'],
    },
    cf_worker: {
        protocols: NODE_ADAPTERS.cf_worker.supported_protocols,
        transports: NODE_ADAPTERS.cf_worker.supported_transports,
        tls_modes: NODE_ADAPTERS.cf_worker.supported_tls,
        features: ['cdn-proxy'],
    },
};

// ==============================================================
// 7) 工具函数 — 获取兼容的配置选项
// ==============================================================

/**
 * 给定协议名，返回兼容的传输列表
 */
export function getCompatibleTransports(protocolId) {
    const reg = PROTOCOL_REGISTRY[protocolId];
    return reg ? reg.compatible_transports : [];
}

/**
 * 给定协议名，返回兼容的 TLS 模式列表
 */
export function getCompatibleTlsModes(protocolId) {
    const reg = PROTOCOL_REGISTRY[protocolId];
    return reg ? reg.compatible_tls : [];
}

/**
 * 检查 protocol+transport+tls 组合是否有效
 */
export function isValidCombination(protocolId, transportId, tlsMode) {
    const pReg = PROTOCOL_REGISTRY[protocolId];
    if (!pReg) return false;
    if (!pReg.compatible_transports.includes(transportId)) return false;
    if (!pReg.compatible_tls.includes(tlsMode)) return false;
    return true;
}

/**
 * 检查 profile 是否兼容某节点类型
 */
export function isProfileCompatibleWithNode(profile, nodeType) {
    const adapter = NODE_ADAPTERS[nodeType];
    if (!adapter) return false;
    // 检查 profile 的 node_types 白名单
    if (profile.node_types && !profile.node_types.includes(nodeType)) return false;
    // 检查协议、传输、TLS 是否在节点支持范围内
    if (!adapter.supported_protocols.includes(profile.protocol)) return false;
    if (!adapter.supported_transports.includes(profile.transport)) return false;
    if (!adapter.supported_tls.includes(profile.tls_mode)) return false;
    return true;
}

/**
 * 构建完整配置 Schema — 合并 protocol + transport + tls 的字段
 */
export function buildFullSchema(protocolId, transportId, tlsMode) {
    const schema = {};
    const pReg = PROTOCOL_REGISTRY[protocolId];
    const tReg = TRANSPORT_REGISTRY[transportId];
    const sReg = TLS_REGISTRY[tlsMode];

    if (pReg) {
        for (const [k, v] of Object.entries(pReg.fields)) schema[k] = { ...v, group: 'protocol' };
    }
    if (tReg) {
        for (const [k, v] of Object.entries(tReg.fields)) schema[k] = { ...v, group: 'transport' };
    }
    if (sReg) {
        for (const [k, v] of Object.entries(sReg.fields)) schema[k] = { ...v, group: 'tls' };
    }
    return schema;
}

/**
 * 获取 profile 的完整 schema（含默认值覆盖）
 */
export function getProfileSchema(profile) {
    const base = buildFullSchema(profile.protocol, profile.transport, profile.tls_mode);
    // 将 profile.defaults 合并到 schema 的 default 值中
    if (profile.defaults) {
        for (const [key, val] of Object.entries(profile.defaults)) {
            if (base[key]) {
                base[key].default = val;
            }
        }
    }
    // 兼容旧式 profile.schema（用户自定义的）
    if (profile.schema) {
        for (const [key, val] of Object.entries(profile.schema)) {
            base[key] = { ...val, group: val.group || 'custom' };
        }
    }
    return base;
}
