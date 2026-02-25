// Subscription renderer — generates v2ray, Clash, sing-box configs
// 全协议支持的订阅渲染器

import { kvGet, KEY } from './kv.js';
import { BUILTIN_PROFILES, CF_PORTS_HTTP } from './constants.js';

/** Strip protocol prefix and trailing slashes from domain strings */
function cleanDomain(domain) {
    if (!domain) return '';
    return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

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

    // Get plans for each node → extract outbound configs
    const outbounds = [];
    for (const node of nodes) {
        if (!node.target_version) continue;
        const plan = await kvGet(kv, KEY.plan(node.id, node.target_version));
        if (!plan) continue;

        // Unified extraction: supports both VPS inbounds and CF Worker configs
        const entries = plan.inbounds || (plan.runtime_config?.configs || []);
        for (const entry of entries) {
            const settings = entry.settings || {};
            const addr = cleanDomain(node.entry_domain) || node.entry_ip || '127.0.0.1';
            const port = settings.port || plan.cf_config?.port || plan.routing?.listen_port || 443;
            const isHttpPort = CF_PORTS_HTTP.includes(parseInt(port));

            outbounds.push({
                name: `${node.name}-${entry.protocol || entry.tag || 'proxy'}`,
                node,
                protocol: entry.protocol,
                transport: entry.transport,
                tls_mode: isHttpPort ? 'none' : (entry.tls_mode || 'tls'),
                port,
                address: addr,
                settings,
                is_cf: plan.node_type === 'cf_worker',
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

// ─── V2Ray / V2RayN 格式 ───
function renderV2ray(outbounds) {
    const links = outbounds.map(ob => {
        const s = ob.settings;
        const addr = ob.address;
        const port = ob.port;
        const hasTls = ob.tls_mode !== 'none';

        if (ob.protocol === 'vless') {
            const params = new URLSearchParams({
                type: ob.transport || 'tcp',
                security: ob.tls_mode || 'none',
                encryption: 'none',
            });
            // Transport fields
            if (ob.transport === 'ws') {
                params.set('host', s.host || '');
                params.set('path', s.path || '/');
            } else if (ob.transport === 'grpc') {
                params.set('serviceName', s.service_name || 'grpc');
                params.set('mode', s.multi_mode ? 'multi' : 'gun');
            } else if (ob.transport === 'h2') {
                params.set('host', s.host || '');
                params.set('path', s.path || '/');
            } else if (ob.transport === 'httpupgrade') {
                params.set('host', s.host || '');
                params.set('path', s.path || '/');
            }
            // TLS fields
            if (hasTls) {
                params.set('sni', s.sni || s.host || '');
                params.set('fp', s.fingerprint || 'chrome');
            }
            if (ob.tls_mode === 'reality') {
                params.set('pbk', s.public_key || '');
                params.set('sid', s.short_id || '');
                if (s.spider_x) params.set('spx', s.spider_x);
                if (s.flow) params.set('flow', s.flow);
            }
            return `vless://${s.uuid}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
        }

        if (ob.protocol === 'trojan') {
            const params = new URLSearchParams({
                type: ob.transport || 'tcp',
                security: hasTls ? 'tls' : 'none',
            });
            if (ob.transport === 'ws') {
                params.set('host', s.host || '');
                params.set('path', s.path || '/trojan-ws');
            } else if (ob.transport === 'grpc') {
                params.set('serviceName', s.service_name || 'grpc');
            }
            if (hasTls) {
                params.set('sni', s.sni || s.host || '');
                params.set('fp', s.fingerprint || 'chrome');
            }
            return `trojan://${s.password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
        }

        if (ob.protocol === 'vmess') {
            const vmessConfig = {
                v: '2', ps: ob.name,
                add: addr, port: parseInt(port),
                id: s.uuid, aid: s.alter_id || 0,
                scy: s.encryption || 'auto',
                net: ob.transport || 'ws',
                type: 'none',
                host: s.host || '', path: s.path || '/',
                tls: hasTls ? 'tls' : '',
                sni: s.sni || s.host || '',
                fp: s.fingerprint || '',
                alpn: Array.isArray(s.alpn) ? s.alpn.join(',') : '',
            };
            if (ob.transport === 'grpc') {
                vmessConfig.path = s.service_name || 'grpc';
                vmessConfig.type = 'gun';
            }
            return `vmess://${btoa(JSON.stringify(vmessConfig))}`;
        }

        if (ob.protocol === 'shadowsocks') {
            const userinfo = btoa(`${s.method}:${s.password}`);
            return `ss://${userinfo}@${addr}:${port}#${encodeURIComponent(ob.name)}`;
        }

        if (ob.protocol === 'hysteria2') {
            const params = new URLSearchParams({ sni: s.sni || '' });
            if (s.obfs_type) {
                params.set('obfs', s.obfs_type);
                params.set('obfs-password', s.obfs_password || '');
            }
            return `hysteria2://${s.password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
        }

        return '';
    }).filter(Boolean);

    return btoa(links.join('\n'));
}

// ─── Clash / Clash Meta 格式 ───
function renderClash(outbounds) {
    const proxies = outbounds.map(ob => {
        const s = ob.settings;
        const base = {
            name: ob.name,
            server: ob.address,
            port: parseInt(ob.port),
        };
        const hasTls = ob.tls_mode !== 'none';

        if (ob.protocol === 'vless') {
            return {
                ...base, type: 'vless', uuid: s.uuid,
                tls: hasTls, 'skip-cert-verify': s.allow_insecure || false,
                servername: s.sni || s.host || '',
                network: ob.transport || 'ws',
                flow: s.flow || undefined,
                'client-fingerprint': s.fingerprint || 'chrome',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
                'reality-opts': ob.tls_mode === 'reality' ? { 'public-key': s.public_key || '', 'short-id': s.short_id || '' } : undefined,
            };
        }

        if (ob.protocol === 'trojan') {
            return {
                ...base, type: 'trojan', password: s.password,
                sni: s.sni || '', 'skip-cert-verify': s.allow_insecure || false,
                network: ob.transport || 'tcp',
                'client-fingerprint': s.fingerprint || 'chrome',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/trojan-ws', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
            };
        }

        if (ob.protocol === 'vmess') {
            return {
                ...base, type: 'vmess', uuid: s.uuid,
                alterId: s.alter_id || 0, cipher: s.encryption || 'auto',
                tls: hasTls, 'skip-cert-verify': s.allow_insecure || false,
                servername: s.sni || s.host || '',
                network: ob.transport || 'ws',
                'ws-opts': ob.transport === 'ws' ? { path: s.path || '/', headers: { Host: s.host || '' } } : undefined,
                'grpc-opts': ob.transport === 'grpc' ? { 'grpc-service-name': s.service_name || 'grpc' } : undefined,
            };
        }

        if (ob.protocol === 'shadowsocks') {
            return {
                ...base, type: 'ss',
                cipher: s.method, password: s.password,
            };
        }

        if (ob.protocol === 'hysteria2') {
            return {
                ...base, type: 'hysteria2',
                password: s.password, sni: s.sni || '',
                up: `${s.up_mbps || 100} Mbps`,
                down: `${s.down_mbps || 100} Mbps`,
                obfs: s.obfs_type || undefined,
                'obfs-password': s.obfs_password || undefined,
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

    return simpleYaml(config);
}

// ─── sing-box 格式 ───
function renderSingbox(outbounds) {
    const obs = outbounds.map(ob => {
        const s = ob.settings;
        const base = {
            tag: ob.name,
            type: ob.protocol === 'shadowsocks' ? 'shadowsocks' : ob.protocol,
            server: ob.address,
            server_port: parseInt(ob.port),
        };
        const hasTls = ob.tls_mode !== 'none';

        if (ob.protocol === 'vless') {
            base.uuid = s.uuid;
            base.flow = s.flow || undefined;
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.host || '',
                    insecure: s.allow_insecure || false,
                };
                if (ob.tls_mode === 'reality') {
                    base.tls.reality = {
                        enabled: true,
                        public_key: s.public_key || '',
                        short_id: s.short_id || '',
                    };
                    base.tls.utls = { enabled: true, fingerprint: s.fingerprint || 'chrome' };
                } else {
                    base.tls.utls = { enabled: true, fingerprint: s.fingerprint || 'chrome' };
                    if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn];
                }
            }
            applyTransportSingbox(base, ob, s);
        }

        if (ob.protocol === 'trojan') {
            base.password = s.password;
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.host || '',
                    insecure: s.allow_insecure || false,
                    utls: { enabled: true, fingerprint: s.fingerprint || 'chrome' },
                };
                if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn];
            }
            applyTransportSingbox(base, ob, s);
        }

        if (ob.protocol === 'vmess') {
            base.uuid = s.uuid;
            base.alter_id = s.alter_id || 0;
            base.security = s.encryption || 'auto';
            if (hasTls) {
                base.tls = {
                    enabled: true,
                    server_name: s.sni || s.host || '',
                    insecure: s.allow_insecure || false,
                };
            }
            applyTransportSingbox(base, ob, s);
        }

        if (ob.protocol === 'shadowsocks') {
            base.method = s.method;
            base.password = s.password;
        }

        if (ob.protocol === 'hysteria2') {
            base.password = s.password;
            base.up_mbps = s.up_mbps || 100;
            base.down_mbps = s.down_mbps || 100;
            base.tls = {
                enabled: true,
                server_name: s.sni || '',
                insecure: s.allow_insecure || false,
            };
            if (s.obfs_type) {
                base.obfs = { type: s.obfs_type, password: s.obfs_password || '' };
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

// ─── Helper: apply transport config for sing-box ───
function applyTransportSingbox(base, ob, s) {
    if (ob.transport === 'ws') {
        base.transport = {
            type: 'ws',
            path: s.path || '/',
            headers: { Host: s.host || '' },
            max_early_data: s.max_early_data || 0,
            early_data_header_name: s.early_data_header || 'Sec-WebSocket-Protocol',
        };
    } else if (ob.transport === 'grpc') {
        base.transport = { type: 'grpc', service_name: s.service_name || 'grpc' };
    } else if (ob.transport === 'h2') {
        base.transport = { type: 'http', host: [s.host || ''], path: s.path || '/' };
    } else if (ob.transport === 'httpupgrade') {
        base.transport = { type: 'httpupgrade', host: s.host || '', path: s.path || '/' };
    }
}

// ─── YAML serializer ───
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
