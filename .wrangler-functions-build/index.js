var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/auth.js
function verifyAdmin(request, env) {
  if (!env.ADMIN_KEY) {
    return { ok: false, error: "ADMIN_KEY environment variable is not configured. Please add it in Cloudflare Pages Settings \u2192 Environment Variables, then redeploy." };
  }
  const key = request.headers.get("X-Admin-Key") || "";
  if (!key) return { ok: false, error: "Missing X-Admin-Key header" };
  if (key !== env.ADMIN_KEY) return { ok: false, error: "Invalid admin key" };
  return { ok: true };
}
__name(verifyAdmin, "verifyAdmin");

// _lib/kv.js
var KEY = {
  node: /* @__PURE__ */ __name((nid) => `node:${nid}`, "node"),
  profile: /* @__PURE__ */ __name((pid) => `profile:${pid}`, "profile"),
  deploy: /* @__PURE__ */ __name((did) => `deploy:${did}`, "deploy"),
  plan: /* @__PURE__ */ __name((nid, ver) => `plan:${nid}:${ver}`, "plan"),
  sub: /* @__PURE__ */ __name((token) => `sub:${token}`, "sub"),
  profileOverride: /* @__PURE__ */ __name((pid) => `profile_override:${pid}`, "profileOverride"),
  idxNodes: /* @__PURE__ */ __name(() => "idx:nodes", "idxNodes"),
  idxProfiles: /* @__PURE__ */ __name(() => "idx:profiles", "idxProfiles"),
  idxDeploys: /* @__PURE__ */ __name(() => "idx:deploys", "idxDeploys"),
  idxSubs: /* @__PURE__ */ __name(() => "idx:subs", "idxSubs"),
  versionCounter: /* @__PURE__ */ __name(() => "sys:version_counter", "versionCounter")
};
function checkKV(kv) {
  if (!kv) {
    throw new Error('KV binding "NODEHUB_KV" is not configured. Please add a KV namespace binding named NODEHUB_KV in Cloudflare Pages Settings \u2192 Bindings, then redeploy.');
  }
}
__name(checkKV, "checkKV");
async function kvGet(kv, key) {
  checkKV(kv);
  const raw = await kv.get(key, "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
__name(kvGet, "kvGet");
async function kvPut(kv, key, value) {
  checkKV(kv);
  await kv.put(key, JSON.stringify(value));
}
__name(kvPut, "kvPut");
async function kvDelete(kv, key) {
  checkKV(kv);
  await kv.delete(key);
}
__name(kvDelete, "kvDelete");
async function idxList(kv, key) {
  return await kvGet(kv, key) || [];
}
__name(idxList, "idxList");
async function idxAdd(kv, key, entry) {
  const list = await idxList(kv, key);
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await kvPut(kv, key, list);
}
__name(idxAdd, "idxAdd");
async function idxRemove(kv, key, id) {
  const list = await idxList(kv, key);
  await kvPut(kv, key, list.filter((e) => e.id !== id));
}
__name(idxRemove, "idxRemove");
async function nextVersion(kv) {
  const current = await kvGet(kv, KEY.versionCounter()) || 0;
  const next = current + 1;
  await kvPut(kv, KEY.versionCounter(), next);
  return next;
}
__name(nextVersion, "nextVersion");
function generateId(prefix = "n") {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}${rand}`;
}
__name(generateId, "generateId");
function generateToken() {
  const seg = /* @__PURE__ */ __name(() => Math.random().toString(36).substring(2, 10), "seg");
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
__name(generateToken, "generateToken");

// _lib/response.js
function ok(data, status = 200) {
  return new Response(JSON.stringify({
    success: true,
    data,
    meta: { timestamp: Date.now() }
  }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(ok, "ok");
function err(code, message, status = 400) {
  return new Response(JSON.stringify({
    success: false,
    error: { code, message },
    meta: { timestamp: Date.now() }
  }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(err, "err");
function text(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders }
  });
}
__name(text, "text");
function yaml(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/yaml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="nodehub.yaml"'
    }
  });
}
__name(yaml, "yaml");

// api/nodes/[nid]/install.js
function shellQuote(value = "") {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}
__name(shellQuote, "shellQuote");
async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const nid = params.nid;
  const node = await kvGet(KV, KEY.node(nid));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  if (node.node_type !== "vps") {
    return err("VALIDATION", "Only VPS nodes support this install command", 400);
  }
  const origin = new URL(request.url).origin;
  const scriptUrl = `${origin}/agent/install`;
  const githubMirror = typeof node.github_mirror === "string" ? node.github_mirror.trim() : "";
  const command = [
    `curl -fsSL ${shellQuote(scriptUrl)}`,
    " | sudo bash -s --",
    ` --api-base ${shellQuote(origin)}`,
    ` --node-id ${shellQuote(node.id)}`,
    ` --node-token ${shellQuote(node.node_token)}`,
    " --poll-interval 15",
    ...githubMirror ? [` --github-mirror ${shellQuote(githubMirror)}`] : []
  ].join("");
  return ok({
    node_id: node.id,
    script_url: scriptUrl,
    command
  });
}
__name(onRequestGet, "onRequestGet");

// api/auth/login.js
async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json();
  const key = body.admin_key || "";
  if (!key || key !== env.ADMIN_KEY) {
    return err("UNAUTHORIZED", "Invalid admin key", 401);
  }
  return ok({ message: "Authenticated" });
}
__name(onRequestPost, "onRequestPost");

// _lib/constants.js
var ONLINE_THRESHOLD_MS = 15 * 60 * 1e3;
var PLAN_RETENTION_COUNT = 10;
var CF_PORTS_HTTP = [80, 8080, 8880, 2052, 2082, 2086, 2095];
var CF_PORTS_HTTPS = [443, 8443, 2053, 2096, 2087, 2083];
var PROTOCOL_REGISTRY = {
  vless: {
    name: "VLESS",
    fields: {
      uuid: { type: "string", auto: "uuid", required: true, label: "UUID" },
      encryption: { type: "select", options: ["none"], default: "none", label: "\u52A0\u5BC6\u65B9\u5F0F" },
      flow: { type: "select", options: ["", "xtls-rprx-vision"], default: "", label: "Flow", hint: "Reality+TCP \u4E0B\u53EF\u9009 xtls-rprx-vision" }
    },
    compatible_transports: ["tcp", "ws", "grpc", "httpupgrade", "splithttp", "h2"],
    compatible_tls: ["none", "tls", "reality"]
  },
  trojan: {
    name: "Trojan",
    fields: {
      password: { type: "string", auto: "password", required: true, label: "\u5BC6\u7801" }
    },
    compatible_transports: ["tcp", "ws", "grpc", "h2"],
    compatible_tls: ["tls"]
    // Trojan 必须有 TLS
  },
  vmess: {
    name: "VMess",
    fields: {
      uuid: { type: "string", auto: "uuid", required: true, label: "UUID" },
      alter_id: { type: "number", default: 0, label: "Alter ID", hint: "\u63A8\u8350\u8BBE\u4E3A 0" },
      encryption: { type: "select", options: ["auto", "aes-128-gcm", "chacha20-poly1305", "none"], default: "auto", label: "\u52A0\u5BC6\u65B9\u5F0F" }
    },
    compatible_transports: ["tcp", "ws", "grpc", "h2", "httpupgrade"],
    compatible_tls: ["none", "tls"]
  },
  shadowsocks: {
    name: "Shadowsocks",
    fields: {
      password: { type: "string", auto: "password", required: true, label: "\u5BC6\u7801" },
      method: {
        type: "select",
        options: [
          "2022-blake3-aes-128-gcm",
          "2022-blake3-aes-256-gcm",
          "2022-blake3-chacha20-poly1305",
          "aes-256-gcm",
          "aes-128-gcm",
          "chacha20-ietf-poly1305",
          "xchacha20-ietf-poly1305"
        ],
        default: "2022-blake3-aes-128-gcm",
        label: "\u52A0\u5BC6\u65B9\u6CD5"
      }
    },
    compatible_transports: ["tcp"],
    compatible_tls: ["none", "tls"]
  },
  hysteria2: {
    name: "Hysteria2",
    fields: {
      password: { type: "string", auto: "password", required: true, label: "\u5BC6\u7801" },
      up_mbps: { type: "number", default: 100, label: "\u4E0A\u884C Mbps" },
      down_mbps: { type: "number", default: 100, label: "\u4E0B\u884C Mbps" },
      obfs_type: { type: "select", options: ["", "salamander"], default: "", label: "\u6DF7\u6DC6\u7C7B\u578B" },
      obfs_password: { type: "string", default: "", label: "\u6DF7\u6DC6\u5BC6\u7801" }
    },
    compatible_transports: ["udp"],
    compatible_tls: ["tls"]
  }
};
var TRANSPORT_REGISTRY = {
  tcp: {
    name: "TCP",
    fields: {
      header_type: { type: "select", options: ["none", "http"], default: "none", label: "Header \u7C7B\u578B" }
    }
  },
  ws: {
    name: "WebSocket",
    fields: {
      path: { type: "string", default: "/", label: "Path" },
      host: { type: "string", default: "", label: "Host", hint: "\u4E00\u822C\u4E0E SNI \u76F8\u540C" },
      max_early_data: { type: "number", default: 2560, label: "Max Early Data" },
      early_data_header: { type: "string", default: "Sec-WebSocket-Protocol", label: "Early Data Header" }
    }
  },
  grpc: {
    name: "gRPC",
    fields: {
      service_name: { type: "string", default: "grpc", label: "Service Name" },
      multi_mode: { type: "boolean", default: false, label: "Multi Mode" }
    }
  },
  httpupgrade: {
    name: "HTTPUpgrade",
    fields: {
      path: { type: "string", default: "/", label: "Path" },
      host: { type: "string", default: "", label: "Host" }
    }
  },
  splithttp: {
    name: "SplitHTTP",
    fields: {
      path: { type: "string", default: "/", label: "Path" },
      host: { type: "string", default: "", label: "Host" }
    }
  },
  h2: {
    name: "HTTP/2",
    fields: {
      path: { type: "string", default: "/", label: "Path" },
      host: { type: "string", default: "", label: "Host" }
    }
  },
  udp: {
    name: "UDP (QUIC)",
    fields: {}
  }
};
var TLS_REGISTRY = {
  none: {
    name: "\u65E0 TLS",
    fields: {}
  },
  tls: {
    name: "TLS",
    fields: {
      sni: { type: "string", default: "", label: "SNI", hint: "\u670D\u52A1\u5668\u540D\u79F0\u6307\u793A\uFF0C\u4E00\u822C\u586B\u57DF\u540D" },
      fingerprint: {
        type: "select",
        options: [
          "chrome",
          "firefox",
          "safari",
          "edge",
          "ios",
          "android",
          "random",
          "randomized"
        ],
        default: "chrome",
        label: "uTLS \u6307\u7EB9"
      },
      alpn: { type: "multi-select", options: ["h2", "http/1.1"], default: ["h2", "http/1.1"], label: "ALPN" },
      allow_insecure: { type: "boolean", default: false, label: "\u5141\u8BB8\u4E0D\u5B89\u5168\u8BC1\u4E66" }
    }
  },
  reality: {
    name: "Reality",
    fields: {
      sni: { type: "string", default: "www.microsoft.com", label: "SNI (\u4F2A\u88C5\u57DF\u540D)" },
      public_key: { type: "string", required: true, label: "\u516C\u94A5 (Public Key)" },
      private_key: { type: "string", default: "", label: "\u79C1\u94A5 (Private Key)", hint: "\u4EC5 VPS \u7AEF\u9700\u8981", server_side: true },
      short_id: { type: "string", default: "", label: "Short ID" },
      fingerprint: {
        type: "select",
        options: [
          "chrome",
          "firefox",
          "safari",
          "edge",
          "ios",
          "android",
          "random",
          "randomized"
        ],
        default: "chrome",
        label: "uTLS \u6307\u7EB9"
      },
      spider_x: { type: "string", default: "/", label: "SpiderX", hint: "\u722C\u866B\u8DEF\u5F84" }
    }
  }
};
var NODE_ADAPTERS = {
  vps: {
    name: "VPS",
    description: "\u591A\u534F\u8BAE\u3001\u5168\u529F\u80FD VPS \u8282\u70B9",
    fields: {
      listen_port: { type: "number", default: 443, label: "\u76D1\u542C\u7AEF\u53E3", hint: "\u53EF\u81EA\u5B9A\u4E49\u4EFB\u610F\u7AEF\u53E3" }
    },
    // VPS 支持所有协议、传输和 TLS
    supported_protocols: ["vless", "trojan", "vmess", "shadowsocks", "hysteria2"],
    supported_transports: ["tcp", "ws", "grpc", "httpupgrade", "splithttp", "h2", "udp"],
    supported_tls: ["none", "tls", "reality"]
  },
  cf_worker: {
    name: "CF Worker",
    description: "Cloudflare Workers/Pages \u8282\u70B9\uFF0C\u53D7 CDN \u9650\u5236",
    fields: {
      cf_port: { type: "select", options: [...CF_PORTS_HTTPS, ...CF_PORTS_HTTP], default: 443, label: "CF \u7AEF\u53E3", hint: "HTTPS\u7AEF\u53E3=TLS, HTTP\u7AEF\u53E3=\u65E0TLS" },
      proxyip: { type: "string", default: "", label: "ProxyIP", hint: "\u53CD\u4EE3 IP \u5730\u5740\uFF0C\u586B\u5165\u540E\u89E3\u9501\u66F4\u591A\u7F51\u7AD9" },
      nat64: { type: "boolean", default: false, label: "NAT64", hint: "\u5F00\u542F\u540E\u4F7F\u7528 NAT64 \u505A ProxyIP" }
    },
    // CF Worker 只支持 vless/trojan + ws + tls/none
    supported_protocols: ["vless", "trojan"],
    supported_transports: ["ws"],
    supported_tls: ["tls", "none"]
  }
};
var BUILTIN_PROFILES = [
  // ── VLESS 系列 ──
  {
    id: "vless-ws-tls",
    name: "VLESS+WS+TLS",
    protocol: "vless",
    transport: "ws",
    tls_mode: "tls",
    is_builtin: true,
    description: "VLESS over WebSocket+TLS\uFF0C\u517C\u5BB9 CDN\uFF0C\u6700\u901A\u7528\u7684\u65B9\u6848",
    node_types: ["vps", "cf_worker"],
    defaults: {
      path: "/?ed=2560",
      fingerprint: "randomized",
      alpn: ["h2", "http/1.1"]
    }
  },
  {
    id: "vless-ws-none",
    name: "VLESS+WS (\u65E0TLS)",
    protocol: "vless",
    transport: "ws",
    tls_mode: "none",
    is_builtin: true,
    description: "VLESS over WebSocket \u65E0 TLS\uFF0C\u9002\u7528 CF 80 \u7CFB\u7AEF\u53E3",
    node_types: ["cf_worker"],
    defaults: {
      path: "/?ed=2560"
    }
  },
  {
    id: "vless-reality-tcp",
    name: "VLESS+Reality+TCP",
    protocol: "vless",
    transport: "tcp",
    tls_mode: "reality",
    is_builtin: true,
    description: "VLESS+Reality \u76F4\u8FDE\u65B9\u6848\uFF0C\u6781\u5F3A\u6297\u68C0\u6D4B\uFF0C\u4EC5 VPS",
    node_types: ["vps"],
    defaults: {
      sni: "www.microsoft.com",
      fingerprint: "chrome",
      flow: "xtls-rprx-vision"
    }
  },
  {
    id: "vless-grpc-tls",
    name: "VLESS+gRPC+TLS",
    protocol: "vless",
    transport: "grpc",
    tls_mode: "tls",
    is_builtin: true,
    description: "VLESS over gRPC+TLS\uFF0C\u652F\u6301\u591A\u8DEF\u590D\u7528\uFF0C\u4EC5 VPS",
    node_types: ["vps"],
    defaults: {
      service_name: "grpc",
      fingerprint: "chrome"
    }
  },
  // ── Trojan 系列 ──
  {
    id: "trojan-ws-tls",
    name: "Trojan+WS+TLS",
    protocol: "trojan",
    transport: "ws",
    tls_mode: "tls",
    is_builtin: true,
    description: "Trojan over WebSocket+TLS\uFF0C\u517C\u5BB9 CDN",
    node_types: ["vps", "cf_worker"],
    defaults: {
      path: "/trojan-ws",
      fingerprint: "chrome"
    }
  },
  {
    id: "trojan-tcp-tls",
    name: "Trojan+TCP+TLS",
    protocol: "trojan",
    transport: "tcp",
    tls_mode: "tls",
    is_builtin: true,
    description: "Trojan \u7ECF\u5178 TCP \u65B9\u6848\uFF0C\u6027\u80FD\u6700\u4F73\uFF0C\u4EC5 VPS",
    node_types: ["vps"],
    defaults: {
      fingerprint: "chrome"
    }
  },
  // ── VMess 系列 ──
  {
    id: "vmess-ws-tls",
    name: "VMess+WS+TLS",
    protocol: "vmess",
    transport: "ws",
    tls_mode: "tls",
    is_builtin: true,
    description: "VMess over WebSocket+TLS\uFF0C\u517C\u5BB9\u6027\u597D",
    node_types: ["vps"],
    defaults: {
      path: "/vmess-ws",
      alter_id: 0,
      encryption: "auto",
      fingerprint: "chrome"
    }
  },
  // ── Shadowsocks ──
  {
    id: "ss-2022",
    name: "Shadowsocks 2022",
    protocol: "shadowsocks",
    transport: "tcp",
    tls_mode: "none",
    is_builtin: true,
    description: "Shadowsocks 2022 \u65B0\u534F\u8BAE\uFF0C\u9AD8\u6027\u80FD",
    node_types: ["vps"],
    defaults: {
      method: "2022-blake3-aes-128-gcm"
    }
  },
  // ── Hysteria2 ──
  {
    id: "hysteria2",
    name: "Hysteria2",
    protocol: "hysteria2",
    transport: "udp",
    tls_mode: "tls",
    is_builtin: true,
    description: "Hysteria2 QUIC \u534F\u8BAE\uFF0C\u9AD8\u901F\u4F4E\u5EF6\u8FDF",
    node_types: ["vps"],
    defaults: {
      up_mbps: 100,
      down_mbps: 100,
      fingerprint: "chrome"
    }
  }
];
var DEFAULT_CAPABILITIES = {
  vps: {
    protocols: NODE_ADAPTERS.vps.supported_protocols,
    transports: NODE_ADAPTERS.vps.supported_transports,
    tls_modes: NODE_ADAPTERS.vps.supported_tls,
    features: ["multi-port", "multi-protocol"]
  },
  cf_worker: {
    protocols: NODE_ADAPTERS.cf_worker.supported_protocols,
    transports: NODE_ADAPTERS.cf_worker.supported_transports,
    tls_modes: NODE_ADAPTERS.cf_worker.supported_tls,
    features: ["cdn-proxy"]
  }
};
function isValidCombination(protocolId, transportId, tlsMode) {
  const pReg = PROTOCOL_REGISTRY[protocolId];
  if (!pReg) return false;
  if (!pReg.compatible_transports.includes(transportId)) return false;
  if (!pReg.compatible_tls.includes(tlsMode)) return false;
  return true;
}
__name(isValidCombination, "isValidCombination");
function isProfileCompatibleWithNode(profile, nodeType) {
  const adapter = NODE_ADAPTERS[nodeType];
  if (!adapter) return false;
  if (profile.node_types && !profile.node_types.includes(nodeType)) return false;
  if (!adapter.supported_protocols.includes(profile.protocol)) return false;
  if (!adapter.supported_transports.includes(profile.transport)) return false;
  if (!adapter.supported_tls.includes(profile.tls_mode)) return false;
  return true;
}
__name(isProfileCompatibleWithNode, "isProfileCompatibleWithNode");
function buildFullSchema(protocolId, transportId, tlsMode) {
  const schema = {};
  schema.port = { type: "number", default: 443, label: "\u7AEF\u53E3", hint: "\u76D1\u542C/\u8FDE\u63A5\u7AEF\u53E3", group: "common" };
  const pReg = PROTOCOL_REGISTRY[protocolId];
  const tReg = TRANSPORT_REGISTRY[transportId];
  const sReg = TLS_REGISTRY[tlsMode];
  if (pReg) {
    for (const [k, v] of Object.entries(pReg.fields)) schema[k] = { ...v, group: "protocol" };
  }
  if (tReg) {
    for (const [k, v] of Object.entries(tReg.fields)) schema[k] = { ...v, group: "transport" };
  }
  if (sReg) {
    for (const [k, v] of Object.entries(sReg.fields)) schema[k] = { ...v, group: "tls" };
  }
  return schema;
}
__name(buildFullSchema, "buildFullSchema");
function getProfileSchema(profile) {
  const base = buildFullSchema(profile.protocol, profile.transport, profile.tls_mode);
  if (profile.defaults) {
    for (const [key, val] of Object.entries(profile.defaults)) {
      if (base[key]) {
        base[key].default = val;
      }
    }
  }
  if (profile.schema) {
    for (const [key, val] of Object.entries(profile.schema)) {
      base[key] = { ...val, group: val.group || "custom" };
    }
  }
  return base;
}
__name(getProfileSchema, "getProfileSchema");

// api/profiles/registry.js
async function onRequestGet2(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  return ok({
    protocols: PROTOCOL_REGISTRY,
    transports: TRANSPORT_REGISTRY,
    tls_modes: TLS_REGISTRY,
    node_adapters: NODE_ADAPTERS
  });
}
__name(onRequestGet2, "onRequestGet");

// api/nodes/[nid].js
async function onRequestGet3(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const nid = params.nid;
  const node = await kvGet(KV, KEY.node(nid));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  const isOnline = node.last_seen && Date.now() - new Date(node.last_seen).getTime() < ONLINE_THRESHOLD_MS;
  return ok({ ...node, is_online: isOnline });
}
__name(onRequestGet3, "onRequestGet");
async function onRequestPatch(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const nid = params.nid;
  const node = await kvGet(KV, KEY.node(nid));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  const body = await request.json();
  const allowedFields = ["name", "entry_domain", "entry_ip", "region", "tags", "capabilities", "github_mirror"];
  for (const field of allowedFields) {
    if (body[field] !== void 0) {
      node[field] = field === "github_mirror" && typeof body[field] === "string" ? body[field].trim() : body[field];
    }
  }
  if (body.rotate_token) {
    node.node_token = generateToken();
  }
  node.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await kvPut(KV, KEY.node(nid), node);
  await idxAdd(KV, KEY.idxNodes(), { id: nid, name: node.name, node_type: node.node_type });
  return ok(node);
}
__name(onRequestPatch, "onRequestPatch");
async function onRequestDelete(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const nid = params.nid;
  await kvDelete(KV, KEY.node(nid));
  await idxRemove(KV, KEY.idxNodes(), nid);
  return ok({ deleted: nid });
}
__name(onRequestDelete, "onRequestDelete");

// api/profiles/[pid].js
async function onRequestGet4(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const pid = params.pid;
  const builtin = BUILTIN_PROFILES.find((p) => p.id === pid);
  if (builtin) {
    const KV2 = env.NODEHUB_KV;
    const override = await kvGet(KV2, KEY.profileOverride(pid));
    const merged = override ? { ...builtin, defaults: { ...builtin.defaults || {}, ...override.defaults || {} }, description: override.description || builtin.description } : builtin;
    return ok({ ...merged, is_builtin: true, _has_override: !!override, schema: getProfileSchema(merged) });
  }
  const KV = env.NODEHUB_KV;
  const profile = await kvGet(KV, KEY.profile(pid));
  if (!profile) return err("PROFILE_NOT_FOUND", "Profile not found", 404);
  return ok({ ...profile, is_builtin: false, schema: getProfileSchema(profile) });
}
__name(onRequestGet4, "onRequestGet");
async function onRequestPatch2(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const pid = params.pid;
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  const builtin = BUILTIN_PROFILES.find((p) => p.id === pid);
  if (builtin) {
    const existingOverride = await kvGet(KV, KEY.profileOverride(pid)) || {};
    const override = {
      defaults: { ...existingOverride.defaults || {}, ...body.defaults || {} },
      description: body.description !== void 0 ? body.description : existingOverride.description || "",
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    await kvPut(KV, KEY.profileOverride(pid), override);
    const merged = {
      ...builtin,
      defaults: { ...builtin.defaults || {}, ...override.defaults },
      description: override.description || builtin.description
    };
    return ok({ ...merged, is_builtin: true, _has_override: true, schema: getProfileSchema(merged) });
  }
  const profile = await kvGet(KV, KEY.profile(pid));
  if (!profile) return err("PROFILE_NOT_FOUND", "Profile not found", 404);
  const allowedFields = ["name", "protocol", "transport", "tls_mode", "node_types", "defaults", "schema", "description"];
  for (const field of allowedFields) {
    if (body[field] !== void 0) profile[field] = body[field];
  }
  if (!isValidCombination(profile.protocol, profile.transport, profile.tls_mode)) {
    return err("VALIDATION", `Invalid combination: ${profile.protocol}+${profile.transport}+${profile.tls_mode}`, 400);
  }
  profile.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await kvPut(KV, KEY.profile(pid), profile);
  return ok({ ...profile, is_builtin: false, schema: getProfileSchema(profile) });
}
__name(onRequestPatch2, "onRequestPatch");
async function onRequestDelete2(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const pid = params.pid;
  const KV = env.NODEHUB_KV;
  const builtin = BUILTIN_PROFILES.find((p) => p.id === pid);
  if (builtin) {
    await kvDelete(KV, KEY.profileOverride(pid));
    return ok({ reset: pid, message: "Built-in profile reset to defaults" });
  }
  await kvDelete(KV, KEY.profile(pid));
  await idxRemove(KV, KEY.idxProfiles(), pid);
  return ok({ deleted: pid });
}
__name(onRequestDelete2, "onRequestDelete");

// api/subscriptions/[token].js
async function onRequestGet5(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const sub = await kvGet(KV, KEY.sub(params.token));
  if (!sub) return err("SUB_NOT_FOUND", "Subscription not found", 404);
  return ok(sub);
}
__name(onRequestGet5, "onRequestGet");
async function onRequestPatch3(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const sub = await kvGet(KV, KEY.sub(params.token));
  if (!sub) return err("SUB_NOT_FOUND", "Subscription not found", 404);
  const body = await request.json();
  const allowedFields = ["name", "enabled", "visible_node_ids", "visible_profile_ids", "remark"];
  for (const field of allowedFields) {
    if (body[field] !== void 0) sub[field] = body[field];
  }
  sub.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await kvPut(KV, KEY.sub(params.token), sub);
  return ok(sub);
}
__name(onRequestPatch3, "onRequestPatch");
async function onRequestDelete3(context) {
  const { request, env, params } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  await kvDelete(KV, KEY.sub(params.token));
  await idxRemove(KV, KEY.idxSubs(), params.token);
  return ok({ deleted: params.token });
}
__name(onRequestDelete3, "onRequestDelete");

// agent/apply-result.js
var MAX_HISTORY = 20;
async function onRequestPost2(context) {
  const { request, env } = context;
  const body = await request.json();
  const { node_id, version, status, message } = body;
  const nodeToken = request.headers.get("X-Node-Token") || "";
  if (!node_id) return err("MISSING_PARAM", "node_id is required", 400);
  if (!version) return err("MISSING_PARAM", "version is required", 400);
  if (!status) return err("MISSING_PARAM", "status (success|failed) is required", 400);
  if (!nodeToken) return err("MISSING_TOKEN", "X-Node-Token header is required", 401);
  const KV = env.NODEHUB_KV;
  const node = await kvGet(KV, KEY.node(node_id));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  if (node.node_token !== nodeToken) return err("INVALID_TOKEN", "Invalid node token", 401);
  if (!node.apply_history) node.apply_history = [];
  const normalizedMessage = String(message || "");
  const existingRecord = node.apply_history.find((h) => h.version === version);
  const sameAsExisting = existingRecord && existingRecord.status === status && String(existingRecord.message || "") === normalizedMessage;
  if (sameAsExisting) {
    return ok({ message: "Already recorded", version, status: existingRecord.status });
  }
  node.last_apply_status = status;
  node.last_apply_message = normalizedMessage;
  node.last_apply_at = (/* @__PURE__ */ new Date()).toISOString();
  node.last_seen = (/* @__PURE__ */ new Date()).toISOString();
  if (status === "success") {
    node.applied_version = version;
    node.consecutive_failures = 0;
  } else {
    node.consecutive_failures = (node.consecutive_failures || 0) + 1;
  }
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (existingRecord) {
    existingRecord.status = status;
    existingRecord.message = normalizedMessage;
    existingRecord.timestamp = nowIso;
  } else {
    node.apply_history.unshift({
      version,
      status,
      message: normalizedMessage,
      timestamp: nowIso
    });
    node.apply_history = node.apply_history.slice(0, MAX_HISTORY);
  }
  await kvPut(KV, KEY.node(node_id), node);
  return ok({
    recorded: true,
    version,
    status,
    applied_version: node.applied_version,
    consecutive_failures: node.consecutive_failures
  });
}
__name(onRequestPost2, "onRequestPost");

// agent/install.js
async function onRequestGet6() {
  const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE=""
NODE_ID=""
NODE_TOKEN=""
POLL_INTERVAL=15
GITHUB_MIRROR=""
XRAY_CONFIG="/usr/local/etc/xray/config.json"
NODEHUB_DIR="/etc/nodehub"
STATE_DIR="/var/lib/nodehub"

usage() {
  cat <<'EOF'
Usage:
  bash install.sh --api-base <url> --node-id <id> --node-token <token> [--poll-interval 15] [--github-mirror <url>]
EOF
}

build_github_url() {
  local url="$1"
  if [[ -z "$GITHUB_MIRROR" ]]; then
    echo "$url"
    return
  fi

  local mirror="\${GITHUB_MIRROR%/}"
  if [[ "$mirror" == *"{url}"* ]]; then
    echo "\${mirror//{url}/$url}"
  else
    echo "$mirror/$url"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-token) NODE_TOKEN="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    --github-mirror) GITHUB_MIRROR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$API_BASE" || -z "$NODE_ID" || -z "$NODE_TOKEN" ]]; then
  usage
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

if [[ -n "$GITHUB_MIRROR" && ! "$GITHUB_MIRROR" =~ ^https?:// ]]; then
  echo "Warning: invalid --github-mirror value '$GITHUB_MIRROR', fallback to default GitHub URL."
  GITHUB_MIRROR=""
fi

install_base_packages() {
  local missing=()
  for bin in curl jq unzip; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      missing+=("$bin")
    fi
  done

  if [[ "\${#missing[@]}" -eq 0 ]]; then
    return
  fi

  install_jq_binary() {
    local arch url tmp
    arch="$(uname -m)"
    case "$arch" in
      x86_64|amd64) url="$(build_github_url "https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64")" ;;
      aarch64|arm64) url="$(build_github_url "https://github.com/jqlang/jq/releases/latest/download/jq-linux-arm64")" ;;
      *)
        echo "Unsupported architecture for jq binary fallback: $arch"
        return 1
        ;;
    esac
    tmp="$(mktemp)"
    if ! curl -fsSL "$url" -o "$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    install -m 0755 "$tmp" /usr/local/bin/jq
    rm -f "$tmp"
  }

  pkg_install_failed=0
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y 2>/dev/null && apt-get install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
  elif command -v dnf >/dev/null 2>&1; then
    if dnf repolist enabled >/dev/null 2>&1; then
      dnf install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
    else
      pkg_install_failed=1
    fi
  elif command -v yum >/dev/null 2>&1; then
    if yum repolist enabled >/dev/null 2>&1; then
      yum install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
    else
      pkg_install_failed=1
    fi
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
  else
    pkg_install_failed=1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "Trying jq binary fallback..."
    install_jq_binary || true
  fi

  for bin in curl jq unzip; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "Missing required tools: \${missing[*]}"
      if [[ "$pkg_install_failed" -eq 1 ]]; then
        echo "Package-manager install failed or repositories are unavailable."
        echo "Attempting manual installation..."
        
        # Try manual jq installation
        if [[ "$bin" == "jq" ]]; then
          install_jq_binary || {
            echo "Failed to install jq manually."
            echo "Please install jq manually: https://jqlang.github.io/jq/download/"
            exit 1
          }
        else
          echo "Please install '$bin' manually and rerun installer."
          exit 1
        fi
      else
        echo "Please install '$bin' manually and rerun installer."
        exit 1
      fi
    fi
  done
}

install_xray() {
  write_xray_systemd_unit() {
    mkdir -p /usr/local/etc/xray
    if [[ ! -f "$XRAY_CONFIG" ]]; then
      cat > "$XRAY_CONFIG" <<'JSON'
{"log":{"loglevel":"warning"},"inbounds":[{"tag":"placeholder","listen":"127.0.0.1","port":10085,"protocol":"dokodemo-door","settings":{"address":"127.0.0.1"}}],"outbounds":[{"protocol":"freedom","tag":"direct"}]}
JSON
    fi

    if [[ ! -f /etc/systemd/system/xray.service ]]; then
      cat > /etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    fi
  }

  install_xray_binary_fallback() {
    local arch pkg url tmpdir
    arch="$(uname -m)"
    case "$arch" in
      x86_64|amd64) pkg="Xray-linux-64.zip" ;;
      aarch64|arm64) pkg="Xray-linux-arm64-v8a.zip" ;;
      armv7l|armv7) pkg="Xray-linux-arm32-v7a.zip" ;;
      i386|i686) pkg="Xray-linux-32.zip" ;;
      *)
        echo "Unsupported architecture for Xray fallback install: $arch"
        return 1
        ;;
    esac

    url="$(build_github_url "https://github.com/XTLS/Xray-core/releases/latest/download/$pkg")"
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN

    echo "Fallback: downloading Xray core from $url"
    if ! curl -fL --retry 3 --retry-delay 2 "$url" -o "$tmpdir/xray.zip"; then
      return 1
    fi
    if ! unzip -oq "$tmpdir/xray.zip" -d "$tmpdir/xray"; then
      return 1
    fi
    if [[ ! -f "$tmpdir/xray/xray" ]]; then
      return 1
    fi

    install -m 0755 "$tmpdir/xray/xray" /usr/local/bin/xray
    mkdir -p /usr/local/share/xray
    [[ -f "$tmpdir/xray/geoip.dat" ]] && install -m 0644 "$tmpdir/xray/geoip.dat" /usr/local/share/xray/geoip.dat
    [[ -f "$tmpdir/xray/geosite.dat" ]] && install -m 0644 "$tmpdir/xray/geosite.dat" /usr/local/share/xray/geosite.dat

    write_xray_systemd_unit
    return 0
  }

  if command -v xray >/dev/null 2>&1; then
    echo "Xray already installed."
    return 0
  fi
  
  echo "Installing Xray..."
  local xray_install_url
  xray_install_url="$(build_github_url "https://github.com/XTLS/Xray-install/raw/main/install-release.sh")"
  # Use official installer but suppress systemd errors
  bash -c "$(curl -fsSL "$xray_install_url")" @ install -u root 2>&1 | grep -v "libsystemd-shared" | grep -v "systemctl: error" || true

  if ! command -v xray >/dev/null 2>&1; then
    echo "Official installer failed, trying binary fallback..."
    if ! install_xray_binary_fallback; then
      echo "Error: Xray installation failed"
      exit 1
    fi
  fi

  write_xray_systemd_unit
  echo "Xray installed successfully."
}

write_converter() {
  mkdir -p /usr/local/lib/nodehub
  cat > /usr/local/lib/nodehub/plan-to-xray.jq <<'JQ'
def fail($msg): error($msg);
def as_int($v; $d): try ($v | tonumber) catch $d;
def nonempty: (tostring | length) > 0;

def build_stream:
  . as $in
  | ($in.settings // {}) as $s
  | ($in.transport // "tcp") as $t
  | ($in.tls_mode // "none") as $tls
  | (
      if $t == "ws" then
        {"network":"ws","security":"none","wsSettings":{"path":($s.path // "/"),"headers":{"Host":($s.host // "")}}}
      elif $t == "grpc" then
        {"network":"grpc","security":"none","grpcSettings":{"serviceName":($s.service_name // "grpc"),"multiMode":($s.multi_mode // false)}}
      elif $t == "h2" then
        {"network":"http","security":"none","httpSettings":{"path":($s.path // "/"),"host":(if (($s.host // "") | nonempty) then [($s.host)] else [] end)}}
      elif $t == "httpupgrade" then
        {"network":"httpupgrade","security":"none","httpupgradeSettings":{"path":($s.path // "/"),"host":($s.host // "")}}
      elif $t == "splithttp" then
        {"network":"splithttp","security":"none","splithttpSettings":{"path":($s.path // "/")}}
      elif ($t == "tcp" or $t == "udp") then
        {"network":$t,"security":"none"}
      else
        fail("unsupported transport: ($t)")
      end
    ) as $base
  | if $tls == "tls" then
      $base + {
        "security":"tls",
        "tlsSettings":{
          "serverName":($s.sni // ""),
          "certificates":[{"certificateFile":($s.tls_cert_file // "/etc/ssl/certs/nodehub.crt"),"keyFile":($s.tls_key_file // "/etc/ssl/private/nodehub.key")}]
        }
      }
      | if (($s.alpn // null) | type) == "array" and (($s.alpn // []) | length) > 0 then
          .tlsSettings.alpn = $s.alpn
        else
          .
        end
    elif $tls == "reality" then
      ($s.reality_private_key // $s.private_key // "") as $pk
      | ($s.sni // $s.host // "") as $sn
      | if ($pk | nonempty) | not then
          fail("reality requires settings.reality_private_key")
        elif ($sn | nonempty) | not then
          fail("reality requires settings.sni")
        else
          $base + {
            "security":"reality",
            "realitySettings":{
              "show":false,
              "dest":"($sn):443",
              "xver":0,
              "serverNames":[ $sn ],
              "privateKey":$pk,
              "shortIds":[($s.short_id // "")]
            }
          }
        end
    else
      $base
    end;

def build_inbound($default_port):
  . as $in
  | ($in.settings // {}) as $s
  | ($in.protocol // "") as $proto
  | ($in.tag // ("inbound-" + $proto)) as $tag
  | {
      "tag": $tag,
      "protocol": $proto,
      "listen": "0.0.0.0",
      "port": as_int(($s.port // $default_port); $default_port),
      "settings": {},
      "sniffing": {"enabled": true, "destOverride": ["http", "tls", "quic"]},
      "streamSettings": ($in | build_stream)
    }
  | if $proto == "vless" then
      ($s.uuid // "") as $uuid
      | if ($uuid | nonempty) | not then
          fail("($tag): vless missing uuid")
        else
          .settings = {"clients":[{"id":$uuid,"level":0,"email":$tag}],"decryption":"none"}
          | if (($s.flow // "") | nonempty) then .settings.clients[0].flow = $s.flow else . end
        end
    elif $proto == "trojan" then
      ($s.password // "") as $password
      | if ($password | nonempty) | not then
          fail("($tag): trojan missing password")
        else
          .settings = {"clients":[{"password":$password,"email":$tag}]}
        end
    elif $proto == "vmess" then
      ($s.uuid // "") as $uuid
      | if ($uuid | nonempty) | not then
          fail("($tag): vmess missing uuid")
        else
          .settings = {"clients":[{"id":$uuid,"alterId":as_int(($s.alter_id // 0); 0),"email":$tag}],"disableInsecureEncryption":false}
        end
    elif $proto == "shadowsocks" then
      ($s.method // "") as $method
      | ($s.password // "") as $password
      | if (($method | nonempty) and ($password | nonempty)) | not then
          fail("($tag): shadowsocks missing method/password")
        else
          .settings = {"method":$method,"password":$password,"network":"tcp,udp"}
        end
    else
      fail("($tag): unsupported protocol on xray: ($proto)")
    end;

. as $raw
| ($raw.data // $raw) as $plan
| if ($plan.node_type // "") != "vps" then fail("only vps plan is supported") else . end
| ($plan.inbounds // []) as $inbounds
| if ($inbounds | length) == 0 then fail("plan has no inbounds") else . end
| ($plan.routing.listen_port // 443 | as_int(.; 443)) as $default_port
| {
    "log":{"loglevel":"warning"},
    "inbounds":($inbounds | map(build_inbound($default_port))),
    "outbounds":[
      {"protocol":"freedom","tag":"direct"},
      {"protocol":"blackhole","tag":"blocked"}
    ]
  }
JQ

  cat > /usr/local/bin/nodehub-plan-to-xray <<'SH'
#!/usr/bin/env bash
set -euo pipefail
jq -f /usr/local/lib/nodehub/plan-to-xray.jq
SH
  chmod +x /usr/local/bin/nodehub-plan-to-xray
}

write_agent_script() {
  cat > /usr/local/bin/nodehub-agent.sh <<'SH'
#!/usr/bin/env bash
set -u

if [[ -f /etc/nodehub/agent.env ]]; then
  # shellcheck disable=SC1091
  source /etc/nodehub/agent.env
fi

mkdir -p /var/lib/nodehub /usr/local/etc/xray
STATE_FILE="/var/lib/nodehub/current_version"
[[ -f "$STATE_FILE" ]] || echo 0 > "$STATE_FILE"

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

test_xray_config() {
  if xray run -test -config "$XRAY_CONFIG" >/dev/null 2>&1; then
    return 0
  fi
  if xray -test -config "$XRAY_CONFIG" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

report_apply_result() {
  local version="$1"
  local status="$2"
  local message="$3"
  local payload
  payload=$(jq -cn     --arg node_id "$NODE_ID"     --argjson version "$version"     --arg status "$status"     --arg message "$message"     '{node_id:$node_id, version:$version, status:$status, message:$message}')
  curl -fsS -X POST     -H "Content-Type: application/json"     -H "X-Node-Token: $NODE_TOKEN"     -d "$payload"     "$API_BASE/agent/apply-result" >/dev/null || true
}

while true; do
  current_version=$(cat "$STATE_FILE" 2>/dev/null || echo 0)

  version_resp=$(curl -fsS     -H "X-Node-Token: $NODE_TOKEN"     "$API_BASE/agent/version?node_id=$NODE_ID&current_version=$current_version" 2>/tmp/nodehub-version.err || true)
  if [[ -z "$version_resp" ]]; then
    log "version check failed: $(cat /tmp/nodehub-version.err 2>/dev/null)"
    sleep "$POLL_INTERVAL"
    continue
  fi

  ok=$(echo "$version_resp" | jq -r '.success // false')
  if [[ "$ok" != "true" ]]; then
    log "version API error: $(echo "$version_resp" | jq -cr '.error // .')"
    sleep "$POLL_INTERVAL"
    continue
  fi

  needs_update=$(echo "$version_resp" | jq -r '.data.needs_update')
  target_version=$(echo "$version_resp" | jq -r '.data.target_version')

  if [[ "$needs_update" == "true" ]]; then
    log "update required: $current_version -> $target_version"
    plan_resp=$(curl -fsS       -H "X-Node-Token: $NODE_TOKEN"       "$API_BASE/agent/plan?node_id=$NODE_ID&version=$target_version" 2>/tmp/nodehub-plan.err || true)

    if [[ -z "$plan_resp" ]]; then
      msg="download plan failed: $(cat /tmp/nodehub-plan.err 2>/dev/null)"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! echo "$plan_resp" | jq -e '.success == true' >/dev/null 2>&1; then
      msg="invalid plan response"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! echo "$plan_resp" | /usr/local/bin/nodehub-plan-to-xray > "$XRAY_CONFIG" 2>/tmp/nodehub-apply.err; then
      msg=$(tr '
' ' ' < /tmp/nodehub-apply.err | cut -c1-500)
      log "plan convert failed: $msg"
      report_apply_result "$target_version" "failed" "plan convert failed: $msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! test_xray_config; then
      msg="xray config test failed"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! systemctl restart xray >/tmp/nodehub-restart.err 2>&1; then
      msg=$(tr '
' ' ' < /tmp/nodehub-restart.err | cut -c1-500)
      log "xray restart failed: $msg"
      report_apply_result "$target_version" "failed" "xray restart failed: $msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    echo "$target_version" > "$STATE_FILE"
    report_apply_result "$target_version" "success" "applied"
    log "applied version $target_version"
  fi

  sleep "$POLL_INTERVAL"
done
SH
  chmod +x /usr/local/bin/nodehub-agent.sh
}

write_systemd_unit() {
  cat > /etc/systemd/system/nodehub-agent.service <<'UNIT'
[Unit]
Description=NodeHub VPS Agent
After=network-online.target xray.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/nodehub/agent.env
ExecStart=/usr/local/bin/nodehub-agent.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
}

write_env_file() {
  mkdir -p "$NODEHUB_DIR" "$STATE_DIR"
  cat > "$NODEHUB_DIR/agent.env" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
NODE_TOKEN=$NODE_TOKEN
POLL_INTERVAL=$POLL_INTERVAL
XRAY_CONFIG=$XRAY_CONFIG
EOF
  chmod 600 "$NODEHUB_DIR/agent.env"
}

install_base_packages
install_xray
write_converter
write_agent_script
write_systemd_unit
write_env_file

# Try systemd first, but don't fail if it doesn't work
USE_SYSTEMD=false
if command -v systemctl >/dev/null 2>&1; then
  # Test if systemctl actually works
  if systemctl daemon-reload 2>/dev/null; then
    USE_SYSTEMD=true
  fi
fi

if [ "$USE_SYSTEMD" = true ]; then
  echo "Starting services with systemd..."
  systemctl enable xray 2>/dev/null || true
  systemctl enable nodehub-agent 2>/dev/null || true
  
  if systemctl restart nodehub-agent 2>/dev/null; then
    if systemctl restart xray 2>/dev/null; then
      echo "Services started successfully via systemd."
    else
      echo "NodeHub agent started via systemd; xray will be restarted after first plan is applied."
    fi
  else
    echo "systemd start failed for nodehub-agent, falling back to manual start..."
    USE_SYSTEMD=false
  fi
fi

if [ "$USE_SYSTEMD" = false ]; then
  echo "Starting services manually..."
  
  # Kill any existing processes
  pkill -f "xray run" 2>/dev/null || true
  pkill -f "nodehub-agent.sh" 2>/dev/null || true
  sleep 1
  
  # Start Xray
  mkdir -p /var/log/xray
  nohup /usr/local/bin/xray run -config "$XRAY_CONFIG" >/var/log/xray/xray.log 2>&1 &
  XRAY_PID=$!
  echo "Xray started (PID: $XRAY_PID)"
  
  # Start NodeHub agent
  nohup /usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
  AGENT_PID=$!
  echo "NodeHub agent started (PID: $AGENT_PID)"
  
  # Create a simple init script for auto-start on reboot
  cat > /etc/rc.local <<'RCLOCAL'
#!/bin/bash
/usr/local/bin/xray run -config /usr/local/etc/xray/config.json >/var/log/xray/xray.log 2>&1 &
/usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
RCLOCAL
  chmod +x /etc/rc.local 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "\u2713 NodeHub agent installation completed!"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Node ID: $NODE_ID"
echo "  API Base: $API_BASE"
echo "  Poll Interval: \${POLL_INTERVAL}s"
if [[ -n "$GITHUB_MIRROR" ]]; then
  echo "  GitHub Mirror: $GITHUB_MIRROR"
fi
echo ""
if [ "$USE_SYSTEMD" = true ]; then
  echo "Service Management (systemd):"
  echo "  systemctl status nodehub-agent"
  echo "  systemctl status xray"
  echo "  journalctl -u nodehub-agent -f"
else
  echo "Service Management (manual):"
  echo "  ps aux | grep -E 'xray|nodehub-agent'"
  echo "  tail -f /var/log/nodehub-agent.log"
  echo "  tail -f /var/log/xray/xray.log"
  echo ""
  echo "  To stop: pkill -f 'xray run' && pkill -f 'nodehub-agent.sh'"
fi
echo ""
`;
  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
__name(onRequestGet6, "onRequestGet");

// agent/plan.js
async function onRequestGet7(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nodeId = url.searchParams.get("node_id");
  const version = parseInt(url.searchParams.get("version") || "0", 10);
  const nodeToken = request.headers.get("X-Node-Token") || "";
  if (!nodeId) return err("MISSING_PARAM", "node_id is required", 400);
  if (!version) return err("MISSING_PARAM", "version is required", 400);
  if (!nodeToken) return err("MISSING_TOKEN", "X-Node-Token header is required", 401);
  const KV = env.NODEHUB_KV;
  const node = await kvGet(KV, KEY.node(nodeId));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  if (node.node_token !== nodeToken) return err("INVALID_TOKEN", "Invalid node token", 401);
  const plan = await kvGet(KV, KEY.plan(nodeId, version));
  if (!plan) return err("PLAN_NOT_FOUND", `Plan v${version} not found for node ${nodeId}`, 404);
  return ok(plan);
}
__name(onRequestGet7, "onRequestGet");

// agent/version.js
var HEARTBEAT_WRITE_INTERVAL_MS = 10 * 60 * 1e3;
async function onRequestGet8(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const nodeId = url.searchParams.get("node_id");
  const currentVersion = parseInt(url.searchParams.get("current_version") || "0", 10);
  const nodeToken = request.headers.get("X-Node-Token") || "";
  if (!nodeId) return err("MISSING_PARAM", "node_id is required", 400);
  if (!nodeToken) return err("MISSING_TOKEN", "X-Node-Token header is required", 401);
  const KV = env.NODEHUB_KV;
  const node = await kvGet(KV, KEY.node(nodeId));
  if (!node) return err("NODE_NOT_FOUND", "Node not found", 404);
  if (node.node_token !== nodeToken) return err("INVALID_TOKEN", "Invalid node token", 401);
  const now = Date.now();
  const lastSeen = node.last_seen ? new Date(node.last_seen).getTime() : 0;
  const gap = now - lastSeen;
  if (gap >= HEARTBEAT_WRITE_INTERVAL_MS) {
    node.last_seen = new Date(now).toISOString();
    node.applied_version = currentVersion;
    await kvPut(KV, KEY.node(nodeId), node);
  }
  const needsUpdate = node.target_version && node.target_version > currentVersion;
  return ok({
    node_id: nodeId,
    current_version: currentVersion,
    target_version: node.target_version || 0,
    needs_update: needsUpdate
  });
}
__name(onRequestGet8, "onRequestGet");

// api/debug.js
async function onRequestGet9(context) {
  const { env } = context;
  const kvBinding = env.NODEHUB_KV;
  const adminKey = env.ADMIN_KEY;
  const kvInfo = {
    exists: kvBinding !== void 0 && kvBinding !== null,
    type: typeof kvBinding,
    isString: typeof kvBinding === "string",
    isObject: typeof kvBinding === "object" && kvBinding !== null,
    hasGet: kvBinding && typeof kvBinding.get === "function",
    hasPut: kvBinding && typeof kvBinding.put === "function",
    hasDelete: kvBinding && typeof kvBinding.delete === "function",
    value_if_string: typeof kvBinding === "string" ? kvBinding.substring(0, 20) : null
  };
  const adminKeyInfo = {
    exists: adminKey !== void 0 && adminKey !== null,
    type: typeof adminKey,
    length: adminKey ? String(adminKey).length : 0
  };
  return new Response(JSON.stringify({
    success: true,
    data: {
      kv_binding: kvInfo,
      admin_key: adminKeyInfo,
      all_env_keys: Object.keys(env)
    }
  }, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(onRequestGet9, "onRequestGet");

// _lib/plan-generator.js
function cleanDomain(domain) {
  if (!domain) return "";
  return domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}
__name(cleanDomain, "cleanDomain");
function generatePlan(node, profiles, params, version) {
  const applicableProfiles = profiles.filter((p) => isProfileCompatible(p, node));
  if (applicableProfiles.length === 0) {
    throw new Error(`No compatible profiles for node ${node.id} (${node.node_type})`);
  }
  if (node.node_type === "vps") {
    return generateVpsPlan(node, applicableProfiles, params, version);
  } else if (node.node_type === "cf_worker") {
    return generateWorkerPlan(node, applicableProfiles, params, version);
  }
  throw new Error(`Unknown node_type: ${node.node_type}`);
}
__name(generatePlan, "generatePlan");
function isProfileCompatible(profile, node) {
  if (isProfileCompatibleWithNode(profile, node.node_type)) return true;
  const caps = node.capabilities || {};
  const adapter = NODE_ADAPTERS[node.node_type];
  if (!adapter) return false;
  const supportedProtocols = caps.protocols || adapter.supported_protocols;
  if (!supportedProtocols.includes(profile.protocol)) return false;
  const supportedTransports = caps.transports || adapter.supported_transports;
  if (!supportedTransports.includes(profile.transport)) return false;
  const supportedTls = caps.tls_modes || adapter.supported_tls;
  if (!supportedTls.includes(profile.tls_mode)) return false;
  return true;
}
__name(isProfileCompatible, "isProfileCompatible");
function generateVpsPlan(node, profiles, params, version) {
  const inbounds = profiles.map((profile) => {
    const templateProfile = resolveProfile(profile);
    return {
      tag: `inbound-${profile.id}`,
      protocol: profile.protocol,
      transport: profile.transport,
      tls_mode: profile.tls_mode,
      settings: resolveProfileParams(templateProfile, params, node, "vps")
    };
  });
  return {
    version,
    node_id: node.id,
    node_type: "vps",
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    inbounds,
    routing: {
      strategy: "unified_port",
      listen_port: params.listen_port || 443
    },
    meta: {
      profile_count: profiles.length,
      profile_ids: profiles.map((p) => p.id)
    }
  };
}
__name(generateVpsPlan, "generateVpsPlan");
function generateWorkerPlan(node, profiles, params, version) {
  const cfPort = params.cf_port || 443;
  const isHttp = CF_PORTS_HTTP.includes(cfPort);
  const configs = profiles.map((profile) => {
    const templateProfile = resolveProfile(profile);
    const settings = resolveProfileParams(templateProfile, params, node, "cf_worker");
    settings.path = settings.path || "/?ed=2560";
    return {
      profile_id: profile.id,
      protocol: profile.protocol,
      transport: profile.transport,
      tls_mode: isHttp ? "none" : profile.tls_mode,
      settings
    };
  });
  return {
    version,
    node_id: node.id,
    node_type: "cf_worker",
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    cf_config: {
      port: cfPort,
      is_https: !isHttp,
      proxyip: params.proxyip || "",
      nat64: !!params.nat64
    },
    runtime_config: {
      configs,
      listen_port: cfPort
    },
    meta: {
      profile_count: profiles.length,
      profile_ids: profiles.map((p) => p.id)
    }
  };
}
__name(generateWorkerPlan, "generateWorkerPlan");
function resolveProfile(profile) {
  const builtin = BUILTIN_PROFILES.find((bp) => bp.id === profile.id);
  return builtin || profile;
}
__name(resolveProfile, "resolveProfile");
function resolveProfileParams(profile, params, node, nodeType) {
  const schema = getProfileSchema(profile);
  const resolved = {};
  for (const [field, def] of Object.entries(schema)) {
    if (def.server_side) continue;
    if (params[field] !== void 0) {
      resolved[field] = params[field];
    } else if (field === "host" && node.entry_domain) {
      resolved[field] = cleanDomain(node.entry_domain);
    } else if (field === "sni" && node.entry_domain) {
      resolved[field] = cleanDomain(node.entry_domain);
    } else if (def.auto === "uuid") {
      resolved[field] = params.uuid || generateUUID();
    } else if (def.auto === "password") {
      resolved[field] = params.password || generatePassword();
    } else if (profile.defaults && profile.defaults[field] !== void 0) {
      resolved[field] = profile.defaults[field];
    } else if (def.default !== void 0) {
      resolved[field] = def.default;
    }
  }
  if (nodeType === "cf_worker") {
    resolved.port = params.cf_port || 443;
  } else {
    resolved.port = params.listen_port || resolved.port || 443;
    if (params.tls_cert_file) resolved.tls_cert_file = params.tls_cert_file;
    if (params.tls_key_file) resolved.tls_key_file = params.tls_key_file;
    if (params.reality_private_key) resolved.reality_private_key = params.reality_private_key;
  }
  return resolved;
}
__name(resolveProfileParams, "resolveProfileParams");
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
__name(generateUUID, "generateUUID");
function generatePassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
__name(generatePassword, "generatePassword");

// api/deploy.js
async function onRequestPost3(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  const { node_ids, profile_ids, params: deployParams = {} } = body;
  if (!node_ids || !Array.isArray(node_ids) || node_ids.length === 0) {
    return err("VALIDATION", "node_ids must be a non-empty array", 400);
  }
  if (!profile_ids || !Array.isArray(profile_ids) || profile_ids.length === 0) {
    return err("VALIDATION", "profile_ids must be a non-empty array", 400);
  }
  const profiles = [];
  for (const pid of profile_ids) {
    const builtin = BUILTIN_PROFILES.find((p) => p.id === pid);
    if (builtin) {
      profiles.push(builtin);
    } else {
      const custom = await kvGet(KV, KEY.profile(pid));
      if (custom) profiles.push(custom);
    }
  }
  if (profiles.length === 0) {
    return err("VALIDATION", "No valid profiles found", 400);
  }
  const ver = await nextVersion(KV);
  const did = generateId("d");
  const results = [];
  for (const nid of node_ids) {
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) {
      results.push({ node_id: nid, status: "skipped", reason: "node not found" });
      continue;
    }
    try {
      const plan = generatePlan(node, profiles, deployParams, ver);
      await kvPut(KV, KEY.plan(nid, ver), plan);
      results.push({ node_id: nid, status: "plan_written" });
    } catch (e) {
      results.push({ node_id: nid, status: "error", reason: e.message });
    }
  }
  for (const nid of node_ids) {
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) continue;
    node.target_version = ver;
    node.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await kvPut(KV, KEY.node(nid), node);
    const oldVer = ver - PLAN_RETENTION_COUNT - 1;
    if (oldVer > 0) {
      try {
        await KV.delete(KEY.plan(nid, oldVer));
      } catch {
      }
    }
    const r = results.find((r2) => r2.node_id === nid);
    if (r && r.status === "plan_written") r.status = "deployed";
  }
  const deploy = {
    id: did,
    version: ver,
    node_ids,
    profile_ids,
    params_snapshot: deployParams,
    results,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kvPut(KV, KEY.deploy(did), deploy);
  await idxAdd(KV, KEY.idxDeploys(), { id: did, version: ver, created_at: deploy.created_at });
  return ok({ deploy_id: did, version: ver, results });
}
__name(onRequestPost3, "onRequestPost");

// api/deploys.js
async function onRequestGet10(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const idx = await idxList(KV, KEY.idxDeploys());
  idx.sort((a, b) => (b.version || 0) - (a.version || 0));
  const deploys = [];
  for (const entry of idx.slice(0, 20)) {
    const deploy = await kvGet(KV, KEY.deploy(entry.id));
    if (deploy) deploys.push(deploy);
  }
  return ok(deploys);
}
__name(onRequestGet10, "onRequestGet");

// api/nodes/index.js
async function onRequestGet11(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const idx = await idxList(KV, KEY.idxNodes());
  const nodes = [];
  for (const entry of idx) {
    const node = await kvGet(KV, KEY.node(entry.id));
    if (node) {
      const isOnline = node.last_seen && Date.now() - new Date(node.last_seen).getTime() < ONLINE_THRESHOLD_MS;
      nodes.push({ ...node, is_online: isOnline });
    }
  }
  return ok(nodes);
}
__name(onRequestGet11, "onRequestGet");
async function onRequestPost4(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  if (!body.name) return err("VALIDATION", "name is required", 400);
  if (!body.node_type) return err("VALIDATION", "node_type is required", 400);
  const nid = generateId("n");
  const node = {
    id: nid,
    name: body.name,
    node_type: body.node_type,
    entry_domain: body.entry_domain || "",
    entry_ip: body.entry_ip || "",
    region: body.region || "",
    tags: body.tags || [],
    github_mirror: typeof body.github_mirror === "string" ? body.github_mirror.trim() : "",
    node_token: generateToken(),
    capabilities: DEFAULT_CAPABILITIES[body.node_type] || DEFAULT_CAPABILITIES.vps,
    target_version: 0,
    applied_version: 0,
    last_seen: null,
    last_apply_status: null,
    last_apply_message: "",
    consecutive_failures: 0,
    apply_history: [],
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kvPut(KV, KEY.node(nid), node);
  await idxAdd(KV, KEY.idxNodes(), { id: nid, name: node.name, node_type: node.node_type });
  return ok(node, 201);
}
__name(onRequestPost4, "onRequestPost");

// api/profiles/index.js
function mergeBuiltinOverride(builtin, override) {
  if (!override) return { ...builtin, is_builtin: true, _has_override: false };
  return {
    ...builtin,
    is_builtin: true,
    _has_override: true,
    defaults: { ...builtin.defaults || {}, ...override.defaults || {} },
    description: override.description || builtin.description
  };
}
__name(mergeBuiltinOverride, "mergeBuiltinOverride");
async function onRequestGet12(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const builtins = [];
  for (const bp of BUILTIN_PROFILES) {
    const override = await kvGet(KV, KEY.profileOverride(bp.id));
    const merged = mergeBuiltinOverride(bp, override);
    merged.schema = getProfileSchema(merged);
    builtins.push(merged);
  }
  const idx = await idxList(KV, KEY.idxProfiles());
  const customs = [];
  for (const entry of idx) {
    const profile = await kvGet(KV, KEY.profile(entry.id));
    if (profile) customs.push({
      ...profile,
      is_builtin: false,
      schema: getProfileSchema(profile)
    });
  }
  return ok([...builtins, ...customs]);
}
__name(onRequestGet12, "onRequestGet");
async function onRequestPost5(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  if (!body.name) return err("VALIDATION", "name is required", 400);
  if (!body.protocol) return err("VALIDATION", "protocol is required", 400);
  if (!body.transport) return err("VALIDATION", "transport is required", 400);
  if (!body.tls_mode) return err("VALIDATION", "tls_mode is required", 400);
  if (!PROTOCOL_REGISTRY[body.protocol]) {
    return err("VALIDATION", `Unknown protocol: ${body.protocol}. Supported: ${Object.keys(PROTOCOL_REGISTRY).join(", ")}`, 400);
  }
  if (!TRANSPORT_REGISTRY[body.transport]) {
    return err("VALIDATION", `Unknown transport: ${body.transport}. Supported: ${Object.keys(TRANSPORT_REGISTRY).join(", ")}`, 400);
  }
  if (!TLS_REGISTRY[body.tls_mode]) {
    return err("VALIDATION", `Unknown tls_mode: ${body.tls_mode}. Supported: ${Object.keys(TLS_REGISTRY).join(", ")}`, 400);
  }
  if (!isValidCombination(body.protocol, body.transport, body.tls_mode)) {
    return err("VALIDATION", `Invalid combination: ${body.protocol}+${body.transport}+${body.tls_mode}`, 400);
  }
  let nodeTypes = body.node_types || [];
  if (nodeTypes.length === 0) {
    for (const [type, adapter] of Object.entries(NODE_ADAPTERS)) {
      if (adapter.supported_protocols.includes(body.protocol) && adapter.supported_transports.includes(body.transport) && adapter.supported_tls.includes(body.tls_mode)) {
        nodeTypes.push(type);
      }
    }
  }
  const pid = generateId("p");
  const profile = {
    id: pid,
    name: body.name,
    protocol: body.protocol,
    transport: body.transport,
    tls_mode: body.tls_mode,
    description: body.description || "",
    node_types: nodeTypes,
    defaults: body.defaults || {},
    schema: body.schema || {},
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kvPut(KV, KEY.profile(pid), profile);
  await idxAdd(KV, KEY.idxProfiles(), { id: pid, name: profile.name });
  return ok({
    ...profile,
    is_builtin: false,
    schema: getProfileSchema(profile)
  }, 201);
}
__name(onRequestPost5, "onRequestPost");

// api/rollback.js
async function onRequestPost6(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  const { node_ids, target_version } = body;
  if (!node_ids || !Array.isArray(node_ids)) {
    return err("VALIDATION", "node_ids must be an array", 400);
  }
  if (!target_version || typeof target_version !== "number") {
    return err("VALIDATION", "target_version must be a number", 400);
  }
  const results = [];
  for (const nid of node_ids) {
    const node = await kvGet(KV, KEY.node(nid));
    if (!node) {
      results.push({ node_id: nid, status: "skipped", reason: "node not found" });
      continue;
    }
    const plan = await kvGet(KV, KEY.plan(nid, target_version));
    if (!plan) {
      results.push({ node_id: nid, status: "skipped", reason: `plan v${target_version} not found` });
      continue;
    }
    node.target_version = target_version;
    node.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await kvPut(KV, KEY.node(nid), node);
    results.push({ node_id: nid, status: "rolled_back" });
  }
  return ok({ target_version, results });
}
__name(onRequestPost6, "onRequestPost");

// api/subscriptions/index.js
async function onRequestGet13(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const idx = await idxList(KV, KEY.idxSubs());
  const subs = [];
  for (const entry of idx) {
    const sub = await kvGet(KV, KEY.sub(entry.id));
    if (sub) subs.push(sub);
  }
  return ok(subs);
}
__name(onRequestGet13, "onRequestGet");
async function onRequestPost7(context) {
  const { request, env } = context;
  const auth = verifyAdmin(request, env);
  if (!auth.ok) return err("UNAUTHORIZED", auth.error, 401);
  const KV = env.NODEHUB_KV;
  const body = await request.json();
  const token = generateToken();
  const sub = {
    token,
    name: body.name || "",
    enabled: true,
    visible_node_ids: body.visible_node_ids || [],
    visible_profile_ids: body.visible_profile_ids || [],
    remark: body.remark || "",
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kvPut(KV, KEY.sub(token), sub);
  await idxAdd(KV, KEY.idxSubs(), { id: token, name: sub.name });
  return ok(sub, 201);
}
__name(onRequestPost7, "onRequestPost");

// _lib/sub-renderer.js
function cleanDomain2(domain) {
  if (!domain) return "";
  return domain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}
__name(cleanDomain2, "cleanDomain");
async function renderSubscription(kv, sub, format = "v2ray") {
  const nodes = [];
  const nodeIds = sub.visible_node_ids || [];
  if (nodeIds.length === 0) {
    const idx = await kvGet(kv, KEY.idxNodes()) || [];
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
  const outbounds = [];
  for (const node of nodes) {
    if (!node.target_version) continue;
    const plan = await kvGet(kv, KEY.plan(node.id, node.target_version));
    if (!plan) continue;
    const entries = plan.inbounds || (plan.runtime_config?.configs || []);
    for (const entry of entries) {
      const settings = entry.settings || {};
      const addr = cleanDomain2(node.entry_domain) || node.entry_ip || "127.0.0.1";
      const port = settings.port || plan.cf_config?.port || plan.routing?.listen_port || 443;
      const isHttpPort = CF_PORTS_HTTP.includes(parseInt(port));
      outbounds.push({
        name: `${node.name}-${entry.protocol || entry.tag || "proxy"}`,
        node,
        protocol: entry.protocol,
        transport: entry.transport,
        tls_mode: isHttpPort ? "none" : entry.tls_mode || "tls",
        port,
        address: addr,
        settings,
        is_cf: plan.node_type === "cf_worker"
      });
    }
  }
  switch (format) {
    case "v2ray":
      return renderV2ray(outbounds);
    case "clash":
      return renderClash(outbounds);
    case "singbox":
      return renderSingbox(outbounds);
    default:
      return renderV2ray(outbounds);
  }
}
__name(renderSubscription, "renderSubscription");
function renderV2ray(outbounds) {
  const links = outbounds.map((ob) => {
    const s = ob.settings;
    const addr = ob.address;
    const port = ob.port;
    const hasTls = ob.tls_mode !== "none";
    if (ob.protocol === "vless") {
      const params = new URLSearchParams({
        type: ob.transport || "tcp",
        security: ob.tls_mode || "none",
        encryption: "none"
      });
      if (ob.transport === "ws") {
        params.set("host", s.host || "");
        params.set("path", s.path || "/");
      } else if (ob.transport === "grpc") {
        params.set("serviceName", s.service_name || "grpc");
        params.set("mode", s.multi_mode ? "multi" : "gun");
      } else if (ob.transport === "h2") {
        params.set("host", s.host || "");
        params.set("path", s.path || "/");
      } else if (ob.transport === "httpupgrade") {
        params.set("host", s.host || "");
        params.set("path", s.path || "/");
      }
      if (hasTls) {
        params.set("sni", s.sni || s.host || "");
        params.set("fp", s.fingerprint || "chrome");
      }
      if (ob.tls_mode === "reality") {
        params.set("pbk", s.public_key || "");
        params.set("sid", s.short_id || "");
        if (s.spider_x) params.set("spx", s.spider_x);
        if (s.flow) params.set("flow", s.flow);
      }
      return `vless://${s.uuid}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
    }
    if (ob.protocol === "trojan") {
      const params = new URLSearchParams({
        type: ob.transport || "tcp",
        security: hasTls ? "tls" : "none"
      });
      if (ob.transport === "ws") {
        params.set("host", s.host || "");
        params.set("path", s.path || "/trojan-ws");
      } else if (ob.transport === "grpc") {
        params.set("serviceName", s.service_name || "grpc");
      }
      if (hasTls) {
        params.set("sni", s.sni || s.host || "");
        params.set("fp", s.fingerprint || "chrome");
      }
      return `trojan://${s.password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
    }
    if (ob.protocol === "vmess") {
      const vmessConfig = {
        v: "2",
        ps: ob.name,
        add: addr,
        port: parseInt(port),
        id: s.uuid,
        aid: s.alter_id || 0,
        scy: s.encryption || "auto",
        net: ob.transport || "ws",
        type: "none",
        host: s.host || "",
        path: s.path || "/",
        tls: hasTls ? "tls" : "",
        sni: s.sni || s.host || "",
        fp: s.fingerprint || "",
        alpn: Array.isArray(s.alpn) ? s.alpn.join(",") : ""
      };
      if (ob.transport === "grpc") {
        vmessConfig.path = s.service_name || "grpc";
        vmessConfig.type = "gun";
      }
      return `vmess://${btoa(JSON.stringify(vmessConfig))}`;
    }
    if (ob.protocol === "shadowsocks") {
      const userinfo = btoa(`${s.method}:${s.password}`);
      return `ss://${userinfo}@${addr}:${port}#${encodeURIComponent(ob.name)}`;
    }
    if (ob.protocol === "hysteria2") {
      const params = new URLSearchParams({ sni: s.sni || "" });
      if (s.obfs_type) {
        params.set("obfs", s.obfs_type);
        params.set("obfs-password", s.obfs_password || "");
      }
      return `hysteria2://${s.password}@${addr}:${port}?${params.toString()}#${encodeURIComponent(ob.name)}`;
    }
    return "";
  }).filter(Boolean);
  return btoa(links.join("\n"));
}
__name(renderV2ray, "renderV2ray");
function renderClash(outbounds) {
  const proxies = outbounds.map((ob) => {
    const s = ob.settings;
    const base = {
      name: ob.name,
      server: ob.address,
      port: parseInt(ob.port)
    };
    const hasTls = ob.tls_mode !== "none";
    if (ob.protocol === "vless") {
      return {
        ...base,
        type: "vless",
        uuid: s.uuid,
        tls: hasTls,
        "skip-cert-verify": s.allow_insecure || false,
        servername: s.sni || s.host || "",
        network: ob.transport || "ws",
        flow: s.flow || void 0,
        "client-fingerprint": s.fingerprint || "chrome",
        "ws-opts": ob.transport === "ws" ? { path: s.path || "/", headers: { Host: s.host || "" } } : void 0,
        "grpc-opts": ob.transport === "grpc" ? { "grpc-service-name": s.service_name || "grpc" } : void 0,
        "reality-opts": ob.tls_mode === "reality" ? { "public-key": s.public_key || "", "short-id": s.short_id || "" } : void 0
      };
    }
    if (ob.protocol === "trojan") {
      return {
        ...base,
        type: "trojan",
        password: s.password,
        sni: s.sni || "",
        "skip-cert-verify": s.allow_insecure || false,
        network: ob.transport || "tcp",
        "client-fingerprint": s.fingerprint || "chrome",
        "ws-opts": ob.transport === "ws" ? { path: s.path || "/trojan-ws", headers: { Host: s.host || "" } } : void 0,
        "grpc-opts": ob.transport === "grpc" ? { "grpc-service-name": s.service_name || "grpc" } : void 0
      };
    }
    if (ob.protocol === "vmess") {
      return {
        ...base,
        type: "vmess",
        uuid: s.uuid,
        alterId: s.alter_id || 0,
        cipher: s.encryption || "auto",
        tls: hasTls,
        "skip-cert-verify": s.allow_insecure || false,
        servername: s.sni || s.host || "",
        network: ob.transport || "ws",
        "ws-opts": ob.transport === "ws" ? { path: s.path || "/", headers: { Host: s.host || "" } } : void 0,
        "grpc-opts": ob.transport === "grpc" ? { "grpc-service-name": s.service_name || "grpc" } : void 0
      };
    }
    if (ob.protocol === "shadowsocks") {
      return {
        ...base,
        type: "ss",
        cipher: s.method,
        password: s.password
      };
    }
    if (ob.protocol === "hysteria2") {
      return {
        ...base,
        type: "hysteria2",
        password: s.password,
        sni: s.sni || "",
        up: `${s.up_mbps || 100} Mbps`,
        down: `${s.down_mbps || 100} Mbps`,
        obfs: s.obfs_type || void 0,
        "obfs-password": s.obfs_password || void 0
      };
    }
    return base;
  });
  const config = {
    proxies,
    "proxy-groups": [{
      name: "NodeHub",
      type: "select",
      proxies: proxies.map((p) => p.name)
    }]
  };
  return simpleYaml(config);
}
__name(renderClash, "renderClash");
function renderSingbox(outbounds) {
  const obs = outbounds.map((ob) => {
    const s = ob.settings;
    const base = {
      tag: ob.name,
      type: ob.protocol === "shadowsocks" ? "shadowsocks" : ob.protocol,
      server: ob.address,
      server_port: parseInt(ob.port)
    };
    const hasTls = ob.tls_mode !== "none";
    if (ob.protocol === "vless") {
      base.uuid = s.uuid;
      base.flow = s.flow || void 0;
      if (hasTls) {
        base.tls = {
          enabled: true,
          server_name: s.sni || s.host || "",
          insecure: s.allow_insecure || false
        };
        if (ob.tls_mode === "reality") {
          base.tls.reality = {
            enabled: true,
            public_key: s.public_key || "",
            short_id: s.short_id || ""
          };
          base.tls.utls = { enabled: true, fingerprint: s.fingerprint || "chrome" };
        } else {
          base.tls.utls = { enabled: true, fingerprint: s.fingerprint || "chrome" };
          if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn];
        }
      }
      applyTransportSingbox(base, ob, s);
    }
    if (ob.protocol === "trojan") {
      base.password = s.password;
      if (hasTls) {
        base.tls = {
          enabled: true,
          server_name: s.sni || s.host || "",
          insecure: s.allow_insecure || false,
          utls: { enabled: true, fingerprint: s.fingerprint || "chrome" }
        };
        if (s.alpn) base.tls.alpn = Array.isArray(s.alpn) ? s.alpn : [s.alpn];
      }
      applyTransportSingbox(base, ob, s);
    }
    if (ob.protocol === "vmess") {
      base.uuid = s.uuid;
      base.alter_id = s.alter_id || 0;
      base.security = s.encryption || "auto";
      if (hasTls) {
        base.tls = {
          enabled: true,
          server_name: s.sni || s.host || "",
          insecure: s.allow_insecure || false
        };
      }
      applyTransportSingbox(base, ob, s);
    }
    if (ob.protocol === "shadowsocks") {
      base.method = s.method;
      base.password = s.password;
    }
    if (ob.protocol === "hysteria2") {
      base.password = s.password;
      base.up_mbps = s.up_mbps || 100;
      base.down_mbps = s.down_mbps || 100;
      base.tls = {
        enabled: true,
        server_name: s.sni || "",
        insecure: s.allow_insecure || false
      };
      if (s.obfs_type) {
        base.obfs = { type: s.obfs_type, password: s.obfs_password || "" };
      }
    }
    return base;
  });
  return JSON.stringify({
    outbounds: [
      { tag: "NodeHub", type: "selector", outbounds: obs.map((o) => o.tag) },
      ...obs,
      { tag: "direct", type: "direct" }
    ]
  }, null, 2);
}
__name(renderSingbox, "renderSingbox");
function applyTransportSingbox(base, ob, s) {
  if (ob.transport === "ws") {
    base.transport = {
      type: "ws",
      path: s.path || "/",
      headers: { Host: s.host || "" },
      max_early_data: s.max_early_data || 0,
      early_data_header_name: s.early_data_header || "Sec-WebSocket-Protocol"
    };
  } else if (ob.transport === "grpc") {
    base.transport = { type: "grpc", service_name: s.service_name || "grpc" };
  } else if (ob.transport === "h2") {
    base.transport = { type: "http", host: [s.host || ""], path: s.path || "/" };
  } else if (ob.transport === "httpupgrade") {
    base.transport = { type: "httpupgrade", host: s.host || "", path: s.path || "/" };
  }
}
__name(applyTransportSingbox, "applyTransportSingbox");
function simpleYaml(obj, indent = 0) {
  let result = "";
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === void 0) continue;
    if (Array.isArray(value)) {
      result += `${pad}${key}:
`;
      for (const item of value) {
        if (typeof item === "object") {
          result += `${pad}- `;
          const lines = simpleYaml(item, 0).trim().split("\n");
          result += lines[0] + "\n";
          for (let i = 1; i < lines.length; i++) {
            result += `${pad}  ${lines[i]}
`;
          }
        } else {
          result += `${pad}- ${item}
`;
        }
      }
    } else if (typeof value === "object") {
      result += `${pad}${key}:
${simpleYaml(value, indent + 1)}`;
    } else {
      result += `${pad}${key}: ${value}
`;
    }
  }
  return result;
}
__name(simpleYaml, "simpleYaml");

// sub/[token].js
async function onRequestGet14(context) {
  const { request, env, params } = context;
  const token = params.token;
  const KV = env.NODEHUB_KV;
  const sub = await kvGet(KV, KEY.sub(token));
  if (!sub) return err("SUB_NOT_FOUND", "Subscription not found", 404);
  if (!sub.enabled) return err("SUB_DISABLED", "Subscription is disabled", 403);
  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "v2ray";
  const content = await renderSubscription(KV, sub, format);
  if (format === "clash") {
    return yaml(content);
  }
  if (format === "singbox") {
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nodehub-singbox.json"'
      }
    });
  }
  return text(content, 200, {
    "Content-Disposition": 'attachment; filename="nodehub-v2ray.txt"'
  });
}
__name(onRequestGet14, "onRequestGet");

// _middleware.js
async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Node-Token",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  try {
    const response = await context.next();
    const cloned = new Response(response.body, response);
    cloned.headers.set("Access-Control-Allow-Origin", "*");
    cloned.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Node-Token");
    return cloned;
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: e.message || "Unknown internal error",
        stack: e.stack || ""
      },
      meta: { timestamp: Date.now() }
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, X-Node-Token"
      }
    });
  }
}
__name(onRequest, "onRequest");

// ../.wrangler/tmp/pages-BtrwwX/functionsRoutes-0.4216676390464986.mjs
var routes = [
  {
    routePath: "/api/nodes/:nid/install",
    mountPath: "/api/nodes/:nid",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/auth/login",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/profiles/registry",
    mountPath: "/api/profiles",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/nodes/:nid",
    mountPath: "/api/nodes",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/nodes/:nid",
    mountPath: "/api/nodes",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/nodes/:nid",
    mountPath: "/api/nodes",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch]
  },
  {
    routePath: "/api/profiles/:pid",
    mountPath: "/api/profiles",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete2]
  },
  {
    routePath: "/api/profiles/:pid",
    mountPath: "/api/profiles",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/profiles/:pid",
    mountPath: "/api/profiles",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch2]
  },
  {
    routePath: "/api/subscriptions/:token",
    mountPath: "/api/subscriptions",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete3]
  },
  {
    routePath: "/api/subscriptions/:token",
    mountPath: "/api/subscriptions",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/subscriptions/:token",
    mountPath: "/api/subscriptions",
    method: "PATCH",
    middlewares: [],
    modules: [onRequestPatch3]
  },
  {
    routePath: "/agent/apply-result",
    mountPath: "/agent",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/agent/install",
    mountPath: "/agent",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/agent/plan",
    mountPath: "/agent",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/agent/version",
    mountPath: "/agent",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/debug",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/deploy",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/deploys",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  },
  {
    routePath: "/api/nodes",
    mountPath: "/api/nodes",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet11]
  },
  {
    routePath: "/api/nodes",
    mountPath: "/api/nodes",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/profiles",
    mountPath: "/api/profiles",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet12]
  },
  {
    routePath: "/api/profiles",
    mountPath: "/api/profiles",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/rollback",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/subscriptions",
    mountPath: "/api/subscriptions",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet13]
  },
  {
    routePath: "/api/subscriptions",
    mountPath: "/api/subscriptions",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/sub/:token",
    mountPath: "/sub",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet14]
  },
  {
    routePath: "/",
    mountPath: "/",
    method: "",
    middlewares: [onRequest],
    modules: []
  }
];

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
