// KV abstraction layer — key conventions, generic CRUD, index management, ID generators

export const KEY = {
    node: (nid) => `node:${nid}`,
    profile: (pid) => `profile:${pid}`,
    deploy: (did) => `deploy:${did}`,
    plan: (nid, ver) => `plan:${nid}:${ver}`,
    sub: (token) => `sub:${token}`,
    idxNodes: () => 'idx:nodes',
    idxProfiles: () => 'idx:profiles',
    idxDeploys: () => 'idx:deploys',
    idxSubs: () => 'idx:subs',
    versionCounter: () => 'sys:version_counter',
};

export async function kvGet(kv, key) {
    const raw = await kv.get(key, 'text');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
}

export async function kvPut(kv, key, value) {
    await kv.put(key, JSON.stringify(value));
}

export async function kvDelete(kv, key) {
    await kv.delete(key);
}

// Index operations — an index is a JSON array of {id, ...summary}
export async function idxList(kv, key) {
    return (await kvGet(kv, key)) || [];
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

// Version counter
export async function nextVersion(kv) {
    const current = (await kvGet(kv, KEY.versionCounter())) || 0;
    const next = current + 1;
    await kvPut(kv, KEY.versionCounter(), next);
    return next;
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
