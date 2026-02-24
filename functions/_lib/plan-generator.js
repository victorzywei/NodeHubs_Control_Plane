// Plan Generator: creates execution plans for nodes based on profiles + parameters

import { BUILTIN_PROFILES } from './constants.js';

/**
 * Generate a plan for a specific node
 */
export function generatePlan(node, profiles, params, version) {
    const applicableProfiles = profiles.filter(p => isProfileCompatible(p, node));

    if (node.node_type === 'vps') {
        return generateVpsPlan(node, applicableProfiles, params, version);
    } else if (node.node_type === 'cf_worker') {
        return generateWorkerPlan(node, applicableProfiles, params, version);
    }

    throw new Error(`Unknown node_type: ${node.node_type}`);
}

function isProfileCompatible(profile, node) {
    const caps = node.capabilities || {};
    const reqs = profile.requirements || {};

    if (reqs.protocols && caps.protocols) {
        if (!reqs.protocols.some(p => caps.protocols.includes(p))) return false;
    }
    if (reqs.transports && caps.transports) {
        if (!reqs.transports.some(t => caps.transports.includes(t))) return false;
    }
    if (reqs.tls_modes && caps.tls_modes) {
        if (!reqs.tls_modes.some(t => caps.tls_modes.includes(t))) return false;
    }

    return true;
}

function generateVpsPlan(node, profiles, params, version) {
    const inbounds = profiles.map(profile => {
        const templateProfile = BUILTIN_PROFILES.find(bp => bp.id === profile.id) || profile;
        return {
            tag: `inbound-${profile.id}`,
            protocol: profile.protocol,
            transport: profile.transport,
            tls_mode: profile.tls_mode,
            settings: resolveProfileParams(templateProfile, params, node),
        };
    });

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

function generateWorkerPlan(node, profiles, params, version) {
    const configs = profiles.map(profile => {
        const templateProfile = BUILTIN_PROFILES.find(bp => bp.id === profile.id) || profile;
        return {
            profile_id: profile.id,
            protocol: profile.protocol,
            transport: profile.transport,
            tls_mode: profile.tls_mode,
            settings: resolveProfileParams(templateProfile, params, node),
        };
    });

    return {
        version,
        node_id: node.id,
        node_type: 'cf_worker',
        created_at: new Date().toISOString(),
        runtime_config: {
            configs,
            listen_port: params.listen_port || 443,
        },
        meta: {
            profile_count: profiles.length,
            profile_ids: profiles.map(p => p.id),
        },
    };
}

function resolveProfileParams(profile, params, node) {
    const schema = profile.schema || {};
    const resolved = {};

    for (const [field, def] of Object.entries(schema)) {
        if (params[field] !== undefined) {
            resolved[field] = params[field];
        } else if (field === 'host' && node.entry_domain) {
            resolved[field] = node.entry_domain;
        } else if (field === 'sni' && node.entry_domain) {
            resolved[field] = node.entry_domain;
        } else if (def.auto === 'uuid') {
            resolved[field] = params.uuid || generateUUID();
        } else if (def.auto === 'password') {
            resolved[field] = params.password || generatePassword();
        } else if (def.default !== undefined) {
            resolved[field] = def.default;
        }
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

export { isProfileCompatible };
