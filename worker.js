import { connect } from 'cloudflare:sockets';

/**
 * NodeHub CF Worker Node — 纯代理节点
 * 
 * 职责：
 * 1. 定期与 NodeHub 控制面板同步配置（两级频率策略，优化 KV 写入）
 * 2. 处理 WebSocket 代理流量（vless / trojan over ws）
 *
 * 所有页面、订阅链接展示均由 NodeHub 控制面板负责，本 Worker 只做代理。
 *
 * 环境变量:
 *   CONTROL_PLANE_URL  — 控制面板地址，如 "https://nodehub.pages.dev"
 *   NODE_ID            — 该 Worker 在控制面板中的节点 ID
 *   NODE_TOKEN         — 节点认证令牌
 *   UUID               — 降级用 UUID（控制面板不可达时生效）
 */

// ─── 全局状态（同一个 isolate 生命周期内缓存） ───
let LAST_POLL_TIME = 0;
let APPLIED_VERSION = 0;
let IS_SYNCING = false;
let CACHED_PLAN = null;
let LAST_ERROR = null;  // 记录最近的同步错误

// ─── 同步间隔 ───
const POLL_INTERVAL_MS = 60 * 1000; // 1 分钟轮询（心跳由后端自主判断是否写 KV）

// ─── 导出 Worker Handler ───
export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            // /debug 诊断端点 — 排查同步问题
            if (url.pathname === '/debug') {
                // 先尝试同步一次
                await ensureConfig(env, ctx);
                return new Response(JSON.stringify({
                    env_check: {
                        CONTROL_PLANE_URL: env.CONTROL_PLANE_URL ? '✅ 已设置' : '❌ 未设置',
                        NODE_ID: env.NODE_ID ? `✅ ${env.NODE_ID}` : '❌ 未设置',
                        NODE_TOKEN: env.NODE_TOKEN ? '✅ 已设置 (隐藏)' : '❌ 未设置',
                        UUID: env.UUID ? '✅ 已设置' : '⚠️ 未设置 (降级用)',
                    },
                    sync_state: {
                        applied_version: APPLIED_VERSION,
                        last_poll: LAST_POLL_TIME ? new Date(LAST_POLL_TIME).toISOString() : 'never',
                        has_plan: !!CACHED_PLAN,
                        is_syncing: IS_SYNCING,
                    },
                    last_error: LAST_ERROR,
                }, null, 2), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            // 后台同步控制面板配置
            await ensureConfig(env, ctx);

            // 仅处理 WebSocket 升级请求 → 代理流量
            const upgradeHeader = request.headers.get('Upgrade');
            if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
                return handleWsProxy(request, env);
            }

            // 非 WebSocket 请求 → 简单回应（CF 健康检查等）
            return new Response('ok', { status: 200 });

        } catch (err) {
            console.error('[NodeHub Worker]', err);
            return new Response('error: ' + err.message, { status: 500 });
        }
    },

    // Cron Trigger: 定时心跳（即使没有用户流量也保持在线）
    // 在 wrangler.toml 或 CF Dashboard 设置 cron = "*/5 * * * *"（每5分钟）
    async scheduled(event, env, ctx) {
        try {
            const cpUrl = (env.CONTROL_PLANE_URL || '').trim().replace(/\/+$/, '');
            const nodeId = env.NODE_ID;
            const nodeToken = env.NODE_TOKEN;

            if (!cpUrl || !nodeId || !nodeToken) return;

            const versionUrl = new URL(`${cpUrl}/agent/version`);
            versionUrl.searchParams.set('node_id', nodeId);
            versionUrl.searchParams.set('current_version', APPLIED_VERSION.toString());

            const res = await fetch(versionUrl.toString(), {
                headers: { 'X-Node-Token': nodeToken },
            });

            if (res.ok) {
                console.log('[Cron] 心跳发送成功');
            } else {
                console.error('[Cron] 心跳失败', res.status);
            }
        } catch (e) {
            console.error('[Cron] 错误', e.message);
        }
    },
};


// ============================================================
// 两级同步策略
// ============================================================

async function ensureConfig(env, ctx) {
    const cpUrl = env.CONTROL_PLANE_URL;
    const nodeId = env.NODE_ID;
    const nodeToken = env.NODE_TOKEN;

    // 未配置控制面板 → 使用环境变量降级
    if (!cpUrl || !nodeId || !nodeToken) {
        if (!CACHED_PLAN) CACHED_PLAN = buildFallbackPlan(env);
        return;
    }

    const now = Date.now();
    const needsPoll = !CACHED_PLAN || (now - LAST_POLL_TIME) >= POLL_INTERVAL_MS;

    if (!needsPoll) return;
    if (IS_SYNCING) {
        if (!CACHED_PLAN) await new Promise(r => setTimeout(r, 1500));
        return;
    }

    const syncPromise = performSync(cpUrl, nodeId, nodeToken).catch(e => {
        console.error('[Agent Sync Error]', e.message);
        LAST_ERROR = { time: new Date().toISOString(), message: e.message, stack: e.stack };
        if (!CACHED_PLAN) CACHED_PLAN = buildFallbackPlan(env);
    });

    if (!CACHED_PLAN) {
        await syncPromise; // 首次阻塞
    } else if (ctx?.waitUntil) {
        ctx.waitUntil(syncPromise); // 已有缓存 → 后台执行
    } else {
        await syncPromise;
    }
}

async function performSync(cpUrl, nodeId, nodeToken) {
    IS_SYNCING = true;
    try {
        LAST_POLL_TIME = Date.now();

        // 清理 URL：去除空格和尾部斜杠
        cpUrl = cpUrl.trim().replace(/\/+$/, '');

        // ① 版本检查（后端自动处理心跳写入）
        const versionUrl = new URL(`${cpUrl}/agent/version`);
        versionUrl.searchParams.set('node_id', nodeId);
        versionUrl.searchParams.set('current_version', APPLIED_VERSION.toString());

        const res = await fetch(versionUrl.toString(), {
            headers: { 'X-Node-Token': nodeToken },
        });

        const resText = await res.text();
        if (!res.ok) throw new Error(`Version check ${res.status}: ${resText.slice(0, 200)}`);

        let body;
        try {
            body = JSON.parse(resText);
        } catch (e) {
            throw new Error(`Version response not JSON (status=${res.status}): ${resText.slice(0, 300)}`);
        }
        const ver = body.data || body;

        // ② 拉取新 plan
        if (ver.needs_update && ver.target_version > APPLIED_VERSION) {
            console.log(`[NodeHub] 拉取 plan v${ver.target_version}`);

            const planUrl = new URL(`${cpUrl}/agent/plan`);
            planUrl.searchParams.set('node_id', nodeId);
            planUrl.searchParams.set('version', ver.target_version.toString());

            const planRes = await fetch(planUrl.toString(), {
                headers: { 'X-Node-Token': nodeToken },
            });

            let applyStatus = 'failed';
            let applyMessage = '';

            if (planRes.ok) {
                const planBody = await planRes.json();
                CACHED_PLAN = planBody.data || planBody;
                APPLIED_VERSION = ver.target_version;
                applyStatus = 'success';
                console.log(`[NodeHub] Plan v${ver.target_version} 已应用`);
            } else {
                applyMessage = `Plan fetch ${planRes.status}`;
            }

            // ③ 回报结果
            try {
                await fetch(`${cpUrl}/agent/apply-result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Node-Token': nodeToken },
                    body: JSON.stringify({
                        node_id: nodeId,
                        version: ver.target_version,
                        status: applyStatus,
                        message: applyMessage,
                    }),
                });
            } catch (e) {
                console.error('[NodeHub] apply-result 报告失败', e.message);
            }
        }
    } finally {
        IS_SYNCING = false;
    }
}

/** 降级 plan — 使用环境变量构造最小可用配置 */
function buildFallbackPlan(env) {
    const uuid = env.UUID || '';
    if (!uuid) return null;

    return {
        version: 0,
        node_type: 'cf_worker',
        cf_config: { port: 443, proxyip: env.PROXYIP || '' },
        runtime_config: {
            configs: [{
                protocol: 'vless',
                transport: 'ws',
                tls_mode: 'tls',
                settings: { uuid, path: '/?ed=2560', port: 443 },
            }],
        },
    };
}


// ============================================================
// WebSocket 代理（vless / trojan over ws）
// ============================================================

async function handleWsProxy(request, env) {
    if (!CACHED_PLAN) {
        return new Response('Node not configured', { status: 503 });
    }

    const proxyIp = CACHED_PLAN.cf_config?.proxyip || env.PROXYIP || '';
    const entries = CACHED_PLAN.runtime_config?.configs || [];
    if (entries.length === 0) {
        return new Response('No proxy config', { status: 503 });
    }

    // 收集所有可用的协议配置
    const vlessConfig = entries.find(c => c.protocol === 'vless');
    const trojanConfig = entries.find(c => c.protocol === 'trojan');

    // 建立 WebSocket 对
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    // 自动检测协议：从首包数据判断 VLESS / Trojan
    // VLESS: 首字节 = 0x00 (version)
    // Trojan: 首 56 字节 = hex SHA224 hash
    let firstMessage = true;
    let vlessBuffer = new Uint8Array(0);
    let trojanBuffer = new Uint8Array(0);
    let detectedHandler = null;

    server.addEventListener('message', async (event) => {
        try {
            const chunk = new Uint8Array(event.data);

            if (firstMessage) {
                firstMessage = false;

                // 检测协议类型
                if (chunk.length > 0 && chunk[0] === 0x00 && vlessConfig) {
                    // VLESS: 首字节 = 0x00 (version byte)
                    detectedHandler = 'vless';
                    handleVlessStream(server, vlessConfig.settings?.uuid, proxyIp, chunk);
                } else if (chunk.length >= 56 && trojanConfig) {
                    // 可能是 Trojan: 检查前 56 字节是否全是 hex 字符
                    const possibleHash = new TextDecoder().decode(chunk.slice(0, 56));
                    if (/^[0-9a-f]{56}$/.test(possibleHash)) {
                        detectedHandler = 'trojan';
                        handleTrojanStream(server, trojanConfig.settings?.password, proxyIp, chunk);
                    } else if (vlessConfig) {
                        // 回退到 VLESS
                        detectedHandler = 'vless';
                        handleVlessStream(server, vlessConfig.settings?.uuid, proxyIp, chunk);
                    }
                } else if (vlessConfig) {
                    // 默认 VLESS
                    detectedHandler = 'vless';
                    handleVlessStream(server, vlessConfig.settings?.uuid, proxyIp, chunk);
                } else {
                    console.error('[Proxy] 无法识别协议');
                    server.close(1008, 'Unknown protocol');
                }
            }
            // 后续数据由各协议 handler 内部的 relay 处理
        } catch (e) {
            console.error('[Proxy] Error', e);
            server.close(1011, 'Internal error');
        }
    });

    return new Response(null, { status: 101, webSocket: client });
}

/**
 * VLESS 协议处理
 * 解析首包：[版本1B][UUID 16B][附加信息长度1B][附加信息][命令1B][端口2B][地址类型1B][地址][载荷]
 * @param {WebSocket} ws
 * @param {string} uuid
 * @param {string} proxyIp
 * @param {Uint8Array} initialData - 首包数据（由协议检测器传入）
 */
async function handleVlessStream(ws, uuid, proxyIp, initialData) {
    try {
        const buffer = initialData;

        if (buffer.length < 24) {
            ws.close(1008, 'VLESS header too short');
            return;
        }

        // 解析 VLESS 首包
        const version = buffer[0];
        const reqUUID = bytesToUUID(buffer.slice(1, 17));
        const addonLen = buffer[17];
        const cmdOffset = 18 + addonLen;

        if (buffer.length < cmdOffset + 4) {
            ws.close(1008, 'VLESS header incomplete');
            return;
        }

        // 验证 UUID
        if (reqUUID !== uuid) {
            console.error('[VLESS] UUID 不匹配');
            ws.close(1008, 'Invalid UUID');
            return;
        }

        const cmd = buffer[cmdOffset]; // 1=TCP, 2=UDP
        const port = (buffer[cmdOffset + 1] << 8) | buffer[cmdOffset + 2];
        const addrType = buffer[cmdOffset + 3];

        let addr = '';
        let addrEnd = cmdOffset + 4;

        if (addrType === 1) {
            // IPv4
            if (buffer.length < addrEnd + 4) return;
            addr = `${buffer[addrEnd]}.${buffer[addrEnd + 1]}.${buffer[addrEnd + 2]}.${buffer[addrEnd + 3]}`;
            addrEnd += 4;
        } else if (addrType === 2) {
            // 域名
            const domainLen = buffer[addrEnd];
            addrEnd += 1;
            if (buffer.length < addrEnd + domainLen) return;
            addr = new TextDecoder().decode(buffer.slice(addrEnd, addrEnd + domainLen));
            addrEnd += domainLen;
        } else if (addrType === 3) {
            // IPv6
            if (buffer.length < addrEnd + 16) return;
            const ipv6 = [];
            for (let i = 0; i < 16; i += 2) {
                ipv6.push(((buffer[addrEnd + i] << 8) | buffer[addrEnd + i + 1]).toString(16));
            }
            addr = ipv6.join(':');
            addrEnd += 16;
        }

        const payload = buffer.slice(addrEnd);

        // 连接远程（如有 proxyIp 则通过 proxyIp 中继）
        const connectAddr = proxyIp || addr;
        console.log(`[VLESS] → ${addr}:${port} via ${connectAddr}`);

        const remote = connect({ hostname: connectAddr, port });

        // 发送 VLESS 响应头: [版本1B][附加信息长度1B]
        ws.send(new Uint8Array([version, 0]));

        // 发送首包剩余载荷
        if (payload.length > 0) {
            const writer = remote.writable.getWriter();
            await writer.write(payload);
            writer.releaseLock();
        }

        // 双向中继
        relay(ws, remote);
    } catch (e) {
        console.error('[VLESS] 处理错误', e);
        ws.close(1011, 'Internal error');
    }
}

/**
 * Trojan 协议处理
 * 解析首包：[密码hash 56B(hex)][CRLF 2B][命令1B][地址类型1B][地址][端口2B][CRLF 2B][载荷]
 * @param {WebSocket} ws
 * @param {string} password
 * @param {string} proxyIp
 * @param {Uint8Array} initialData - 首包数据（由协议检测器传入）
 */
async function handleTrojanStream(ws, password, proxyIp, initialData) {
    try {
        const buffer = initialData;

        if (buffer.length < 60) {
            ws.close(1008, 'Trojan header too short');
            return;
        }

        // 验证密码 hash
        const hashHex = new TextDecoder().decode(buffer.slice(0, 56));
        const hashBuf = await crypto.subtle.digest('SHA-224', new TextEncoder().encode(password));
        const expectedHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

        if (hashHex !== expectedHash) {
            console.error('[Trojan] 密码不匹配');
            ws.close(1008, 'Invalid password');
            return;
        }

        // \r\n
        if (buffer[56] !== 0x0d || buffer[57] !== 0x0a) {
            ws.close(1008, 'Invalid header');
            return;
        }

        const cmd = buffer[58]; // 1=TCP, 3=UDP
        const addrType = buffer[59];
        let offset = 60;
        let addr = '';

        if (addrType === 1) {
            if (buffer.length < offset + 4) return;
            addr = `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
            offset += 4;
        } else if (addrType === 3) {
            const domainLen = buffer[offset];
            offset += 1;
            if (buffer.length < offset + domainLen) return;
            addr = new TextDecoder().decode(buffer.slice(offset, offset + domainLen));
            offset += domainLen;
        } else if (addrType === 4) {
            if (buffer.length < offset + 16) return;
            const ipv6 = [];
            for (let i = 0; i < 16; i += 2) {
                ipv6.push(((buffer[offset + i] << 8) | buffer[offset + i + 1]).toString(16));
            }
            addr = ipv6.join(':');
            offset += 16;
        }

        if (buffer.length < offset + 2) return;
        const port = (buffer[offset] << 8) | buffer[offset + 1];
        offset += 2;

        // \r\n
        if (buffer[offset] === 0x0d && buffer[offset + 1] === 0x0a) {
            offset += 2;
        }

        const payload = buffer.slice(offset);

        const connectAddr = proxyIp || addr;
        console.log(`[Trojan] → ${addr}:${port} via ${connectAddr}`);

        const remote = connect({ hostname: connectAddr, port });

        if (payload.length > 0) {
            const writer = remote.writable.getWriter();
            await writer.write(payload);
            writer.releaseLock();
        }

        relay(ws, remote);
    } catch (e) {
        console.error('[Trojan] 处理错误', e);
        ws.close(1011, 'Internal error');
    }
}


// ============================================================
// 双向中继：WebSocket ↔ TCP Socket
// ============================================================

function relay(ws, remote) {
    // remote → ws
    remote.readable.pipeTo(new WritableStream({
        write(chunk) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(chunk);
            }
        },
        close() {
            if (ws.readyState === WebSocket.OPEN) ws.close(1000);
        },
        abort(reason) {
            if (ws.readyState === WebSocket.OPEN) ws.close(1011, 'Remote closed');
        },
    })).catch(() => { });

    // ws → remote
    const writer = remote.writable.getWriter();
    ws.addEventListener('message', (event) => {
        writer.write(new Uint8Array(event.data)).catch(() => { });
    });
    ws.addEventListener('close', () => {
        writer.close().catch(() => { });
    });
    ws.addEventListener('error', () => {
        writer.abort().catch(() => { });
    });
}


// ============================================================
// 工具函数
// ============================================================

function bytesToUUID(bytes) {
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
