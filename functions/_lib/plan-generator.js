// Plan Generator: creates execution plans based on protocol registry
// 基于注册表系统的计划生成器

import {
    BUILTIN_PROFILES, PROTOCOL_REGISTRY, TRANSPORT_REGISTRY, TLS_REGISTRY,
    NODE_ADAPTERS, CF_PORTS_HTTP, isProfileCompatibleWithNode, getProfileSchema,
} from './constants.js';

/** Strip protocol prefix and trailing slashes from domain strings */
function cleanDomain(domain) {
    if (!domain) return '';
    return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Generate a plan for a specific node
 */
export function generatePlan(node, profiles, params, version) {
    const applicableProfiles = profiles.filter(p => isProfileCompatible(p, node));

    if (applicableProfiles.length === 0) {
        throw new Error(`No compatible profiles for node ${node.id} (${node.node_type})`);
    }

    if (node.node_type === 'vps') {
        return generateVpsPlan(node, applicableProfiles, params, version);
    } else if (node.node_type === 'cf_worker') {
        return generateWorkerPlan(node, applicableProfiles, params, version);
    }

    throw new Error(`Unknown node_type: ${node.node_type}`);
}

/**
 * Check if a profile is compatible with a node
 * Uses the new registry-based compatibility checking
 */
export function isProfileCompatible(profile, node) {
    // First check the new registry-based way
    if (isProfileCompatibleWithNode(profile, node.node_type)) return true;

    // Fallback: legacy capability check
    const caps = node.capabilities || {};
    const adapter = NODE_ADAPTERS[node.node_type];
    if (!adapter) return false;

    // Check protocol
    const supportedProtocols = caps.protocols || adapter.supported_protocols;
    if (!supportedProtocols.includes(profile.protocol)) return false;

    // Check transport
    const supportedTransports = caps.transports || adapter.supported_transports;
    if (!supportedTransports.includes(profile.transport)) return false;

    // Check TLS
    const supportedTls = caps.tls_modes || adapter.supported_tls;
    if (!supportedTls.includes(profile.tls_mode)) return false;

    return true;
}

/**
 * Generate a VPS plan — multi-protocol, multi-inbound
 */
function generateVpsPlan(node, profiles, params, version) {
    const inbounds = profiles.map(profile => {
        const templateProfile = resolveProfile(profile);
        return {
            tag: `inbound-${profile.id}`,
            protocol: profile.protocol,
            transport: profile.transport,
            tls_mode: profile.tls_mode,
            settings: resolveProfileParams(templateProfile, params, node, 'vps'),
        };
    });

    for (const inbound of inbounds) {
        if (inbound.tls_mode !== 'reality') continue;
        const pk = inbound.settings.reality_private_key || inbound.settings.private_key || '';
        if (!pk) {
            throw new Error(
                `${inbound.tag}: reality requires settings.reality_private_key (or settings.private_key)`
            );
        }
    }

    return {
        version,
        node_id: node.id,
        node_type: 'vps',
        created_at: new Date().toISOString(),
        inbounds,
        routing: {
            strategy: 'unified_port',
            listen_port: params.listen_port || 443,
        },
        meta: {
            profile_count: profiles.length,
            profile_ids: profiles.map(p => p.id),
        },
    };
}

/**
 * Generate a CF Worker plan — limited to ws, with CF-specific params
 */
function generateWorkerPlan(node, profiles, params, version) {
    // Determine port and TLS from the CF port selection
    const cfPort = params.cf_port || 443;
    const isHttp = CF_PORTS_HTTP.includes(cfPort);

    const configs = profiles.map(profile => {
        const templateProfile = resolveProfile(profile);
        const settings = resolveProfileParams(templateProfile, params, node, 'cf_worker');

        // 标准路径 + Early Data 优化（Worker 自动识别协议）
        settings.path = settings.path || '/?ed=2560';

        return {
            profile_id: profile.id,
            protocol: profile.protocol,
            transport: profile.transport,
            tls_mode: isHttp ? 'none' : profile.tls_mode,
            settings,
        };
    });

    return {
        version,
        node_id: node.id,
        node_type: 'cf_worker',
        created_at: new Date().toISOString(),
        cf_config: {
            port: cfPort,
            is_https: !isHttp,
            proxyip: params.proxyip || '',
            nat64: !!params.nat64,
        },
        runtime_config: {
            configs,
            listen_port: cfPort,
        },
        meta: {
            profile_count: profiles.length,
            profile_ids: profiles.map(p => p.id),
        },
    };
}

/**
 * Resolve a profile to its full definition (builtin or custom)
 */
function resolveProfile(profile) {
    const builtin = BUILTIN_PROFILES.find(bp => bp.id === profile.id);
    return builtin || profile;
}

/**
 * Resolve parameters based on registry schema
 * Merges: profile defaults → node info → user params
 */
function resolveProfileParams(profile, params, node, nodeType) {
    const schema = getProfileSchema(profile);
    const resolved = {};

    for (const [field, def] of Object.entries(schema)) {
        // Keep server-side fields for VPS plan generation.
        if (def.server_side && nodeType !== 'vps') continue;

        // Priority: user params > node auto-fill > profile defaults > schema defaults > auto-generate
        if (params[field] !== undefined) {
            resolved[field] = params[field];
        } else if (field === 'host' && node.entry_domain) {
            resolved[field] = cleanDomain(node.entry_domain);
        } else if (field === 'sni' && node.entry_domain) {
            resolved[field] = cleanDomain(node.entry_domain);
        } else if (def.auto === 'uuid') {
            resolved[field] = params.uuid || generateUUID();
        } else if (def.auto === 'password') {
            resolved[field] = params.password || generatePassword();
        } else if (profile.defaults && profile.defaults[field] !== undefined) {
            resolved[field] = profile.defaults[field];
        } else if (def.default !== undefined) {
            resolved[field] = def.default;
        }
    }

    // Add port based on node type
    if (nodeType === 'cf_worker') {
        resolved.port = params.cf_port || 443;
    } else {
        // Keep per-profile template port as the first priority so subscription
        // links stay consistent with deployed profile defaults.
        resolved.port = resolved.port || params.listen_port || 443;

        // VPS-only passthrough fields used by server-side apply scripts
        // (e.g. Xray TLS cert/key and Reality private key)
        if (params.tls_cert_file) resolved.tls_cert_file = params.tls_cert_file;
        if (params.tls_key_file) resolved.tls_key_file = params.tls_key_file;
        if (params.reality_private_key) resolved.reality_private_key = params.reality_private_key;
    }

    return resolved;
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function generatePassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
