// API client for NodeHub backend

const BASE = ''

async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' }
    const key = sessionStorage.getItem('admin_key')
    if (key) headers['X-Admin-Key'] = key

    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch(`${BASE}${path}`, opts)
    const raw = await res.text()
    let json = null
    if (raw) {
        try {
            json = JSON.parse(raw)
        } catch {
            throw new Error(`Invalid server response (${res.status})`)
        }
    }

    if (!res.ok) {
        throw new Error(json?.error?.message || `Request failed (${res.status})`)
    }
    if (!json || json.success !== true) {
        throw new Error(json?.error?.message || 'Request failed')
    }

    return json.data
}

export const api = {
    // Auth
    login: (admin_key) => request('POST', '/api/auth/login', { admin_key }),

    // Nodes
    getNodes: () => request('GET', '/api/nodes'),
    getNode: (nid) => request('GET', `/api/nodes/${nid}`),
    getNodeInstallCmd: (nid) => request('GET', `/api/nodes/${nid}/install`),
    createNode: (data) => request('POST', '/api/nodes', data),
    updateNode: (nid, data) => request('PATCH', `/api/nodes/${nid}`, data),
    deleteNode: (nid) => request('DELETE', `/api/nodes/${nid}`),

    // Profiles
    getProfiles: () => request('GET', '/api/profiles'),
    getProfile: (pid) => request('GET', `/api/profiles/${pid}`),
    createProfile: (data) => request('POST', '/api/profiles', data),
    updateProfile: (pid, data) => request('PATCH', `/api/profiles/${pid}`, data),
    deleteProfile: (pid) => request('DELETE', `/api/profiles/${pid}`),
    getRegistry: () => request('GET', '/api/profiles/registry'),

    // Deploy
    deploy: (data) => request('POST', '/api/deploy', data),
    getDeploys: () => request('GET', '/api/deploys'),

    // Subscriptions
    getSubscriptions: () => request('GET', '/api/subscriptions'),
    createSubscription: (data) => request('POST', '/api/subscriptions', data),
    updateSubscription: (token, data) => request('PATCH', `/api/subscriptions/${token}`, data),
    deleteSubscription: (token) => request('DELETE', `/api/subscriptions/${token}`),
}
