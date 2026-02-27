// KV abstraction layer — key conventions, generic CRUD, index management, ID generators

export const KEY = {
    node: (nid) => `node:${nid}`,
    profile: (pid) => `profile:${pid}`,
    deploy: (did) => `deploy:${did}`,
    plan: (nid, ver) => `plan:${nid}:${ver}`,
    sub: (token) => `sub:${token}`,
    profileOverride: (pid) => `profile_override:${pid}`,
    idxNodes: () => 'idx:nodes',
    idxProfiles: () => 'idx:profiles',
    idxDeploys: () => 'idx:deploys',
    idxSubs: () => 'idx:subs',
};

function checkKV(kv) {
    if (!kv) {
        throw new Error('KV binding "NODEHUB_KV" is not configured. Please add a KV namespace binding named NODEHUB_KV in Cloudflare Pages Settings → Bindings, then redeploy.');
    }
}

export async function kvGet(kv, key) {
    checkKV(kv);
    const raw = await kv.get(key, 'text');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
}

export async function kvPut(kv, key, value) {
    checkKV(kv);
    await kv.put(key, JSON.stringify(value));
}

export async function kvDelete(kv, key) {
    checkKV(kv);
    await kv.delete(key);
}

// Index operations — an index is a JSON array of {id, ...summary}
export async function idxList(kv, key) {
    return (await kvGet(kv, key)) || [];
}

export async function idxHydrate(kv, indexKey, entityKeyBuilder) {
    const idx = await idxList(kv, indexKey);
    if (idx.length === 0) return [];

    const records = await Promise.all(
        idx.map((entry) => kvGet(kv, entityKeyBuilder(entry.id)))
    );
    return records.filter(Boolean);
}

export async function idxAdd(kv, key, entry) {
    const list = await idxList(kv, key);
    const idx = list.findIndex(e => e.id === entry.id);
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    await kvPut(kv, key, list);
}

export async function idxRemove(kv, key, id) {
    const list = await idxList(kv, key);
    await kvPut(kv, key, list.filter(e => e.id !== id));
}

// ID generators
export function generateId(prefix = 'n') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${ts}${rand}`;
}

export function generateToken() {
    const seg = () => Math.random().toString(36).substring(2, 10);
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
