// Subscription renderer — generates v2rayN, Clash, sing-box configs

import { kvGet, KEY } from './kv.js';
import { BUILTIN_PROFILES } from './constants.js';

/**
 * Render subscription for a given token
 */
export async function renderSubscription(kv, sub, format = 'v2ray') {
    // Get all visible nodes
    const nodes = [];
    const nodeIds = sub.visible_node_ids || [];

    if (nodeIds.length === 0) {
        // All nodes
        const idx = (await kvGet(kv, KEY.idxNodes())) || [];
        for (const entry of idx) {
            const node = await kvGet(kv, KEY.node(entry.id));
            if (node) nodes.push(node);
        }
    } else {
        for (const nid of nodeIds) {
            const node = await kvGet(kv, KEY.node(nid));
            if (node) nodes.push(node);
        }
    }

    // Get plans for each node
    const outbounds = [];
    for (const node of nodes) {
        if (!node.target_version) continue;
        const plan = await kvGet(kv, KEY.plan(node.id, node.target_version));
        if (!plan) continue;

        const inbounds = plan.inbounds || (plan.runtime_config?.configs || []);
        for (const ib of inbounds) {
            const settings = ib.settings || {};
            outbounds.push({
                name: `${node.name}-${ib.protocol || ib.tag || 'proxy'}`,
                node,
                protocol: ib.protocol,
                transport: ib.transport,
                tls_mode: ib.tls_mode,
                settings,
            });
        }
    }

    switch (format) {
        case 'v2ray': return renderV2ray(outbounds);
        case 'clash': return renderClash(outbounds);
        case 'singbox': return renderSingbox(outbounds);
        default: return renderV2ray(outbounds);
    }
}

function renderV2ray(outbounds) {
    const links = outbounds.map(ob => {
        const s = ob.settings;
        if (ob.protocol === 'vless') {
            const params = new URLSearchParams({
                type: ob.transport || 'tcp',
                security: ob.tls_mode || 'tls',
                sni: s.sni || s.host || '',
                host: s.host || '',
                path: s.path || '',
                fp: s.fingerprint || 'chrome',
                encryption: 'none',
            });
            if (ob.transport === 'grpc') params.set('serviceName', s.service_name || 'grpc');
            if (ob.tls_mode === 'reality') {
                params.set('pbk', s.public_key || '');
                params.set('sid', s.short_id || '');
            }
            const addr = ob.node.entry_domain || ob.node.entry_ip || '127.0.0.1';
            const port = s.port || 443;
            return `vless://${s.uuid}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
        }
        if (ob.protocol === 'trojan') {
            const params = new URLSearchParams({
                type: ob.transport || 'tcp',
                security: 'tls',
                sni: s.sni || s.host || '',
                host: s.host || '',
                path: s.path || '',
            });
            const addr = ob.node.entry_domain || ob.node.entry_ip || '127.0.0.1';
            return `trojan://${s.password}@${addr}:${s.port || 443}?${params.toString()}#${encodeURIComponent(ob.name)}`;
        }
        return '';
    }).filter(Boolean);

    return btoa(links.join('\n'));
}

function renderClash(outbounds) {
    const proxies = outbounds.map(ob => {
        const s = ob.settings;
        const base = {
            name: ob.name,
            server: ob.node.entry_domain || ob.node.entry_ip || '127.0.0.1',
            port: s.port || 443,
        };

        if (ob.protocol === 'vless') {
            return {
                ...base,
                type: 'vless',
                uuid: s.uuid,
                tls: true,
                'skip-cert-verify': false,
                servername: s.sni || s.host || '',
                network: ob.transport || 'ws',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/ws', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
            };
        }

        if (ob.protocol === 'trojan') {
            return {
                ...base,
                type: 'trojan',
                password: s.password,
                sni: s.sni || '',
                network: ob.transport || 'ws',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/trojan-ws', headers: { Host: s.host || '' } } : undefined,
            };
        }

        return base;
    });

    const config = {
        proxies,
        'proxy-groups': [{
            name: 'NodeHub',
            type: 'select',
            proxies: proxies.map(p => p.name),
        }],
    };

    // Simple YAML serialization
    return simpleYaml(config);
}

function renderSingbox(outbounds) {
    const obs = outbounds.map(ob => {
        const s = ob.settings;
        const base = {
            tag: ob.name,
            type: ob.protocol,
            server: ob.node.entry_domain || ob.node.entry_ip || '127.0.0.1',
            server_port: s.port || 443,
        };

        if (ob.protocol === 'vless') {
            base.uuid = s.uuid;
            base.tls = {
                enabled: true,
                server_name: s.sni || s.host || '',
                insecure: false,
            };
            if (ob.tls_mode === 'reality') {
                base.tls.reality = {
                    enabled: true,
                    public_key: s.public_key || '',
                    short_id: s.short_id || '',
                };
                base.tls.utls = { enabled: true, fingerprint: s.fingerprint || 'chrome' };
            }
            if (ob.transport === 'ws') {
                base.transport = { type: 'ws', path: s.path || '/ws', headers: { Host: s.host || '' } };
            } else if (ob.transport === 'grpc') {
                base.transport = { type: 'grpc', service_name: s.service_name || 'grpc' };
            }
        }

        if (ob.protocol === 'trojan') {
            base.password = s.password;
            base.tls = {
                enabled: true,
                server_name: s.sni || s.host || '',
            };
            if (ob.transport === 'ws') {
                base.transport = { type: 'ws', path: s.path || '/trojan-ws', headers: { Host: s.host || '' } };
            }
        }

        return base;
    });

    return JSON.stringify({
        outbounds: [
            { tag: 'NodeHub', type: 'selector', outbounds: obs.map(o => o.tag) },
            ...obs,
            { tag: 'direct', type: 'direct' },
        ],
    }, null, 2);
}

function simpleYaml(obj, indent = 0) {
    let result = '';
    const pad = '  '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            result += `${pad}${key}:\n`;
            for (const item of value) {
                if (typeof item === 'object') {
                    result += `${pad}- `;
                    const lines = simpleYaml(item, 0).trim().split('\n');
                    result += lines[0] + '\n';
                    for (let i = 1; i < lines.length; i++) {
                        result += `${pad}  ${lines[i]}\n`;
                    }
                } else {
                    result += `${pad}- ${item}\n`;
                }
            }
        } else if (typeof value === 'object') {
            result += `${pad}${key}:\n${simpleYaml(value, indent + 1)}`;
        } else {
            result += `${pad}${key}: ${value}\n`;
        }
    }
    return result;
}
