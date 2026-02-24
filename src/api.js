// API client for NodeHub backend

const BASE = ''

async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' }
    const key = sessionStorage.getItem('admin_key')
    if (key) headers['X-Admin-Key'] = key

    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch(`${BASE}${path}`, opts)
    const json = await res.json()
    if (!json.success) throw new Error(json.error?.message || 'Request failed')
    return json.data
}

export const api = {
    // Auth
    login: (admin_key) => request('POST', '/api/auth/login', { admin_key }),

    // Nodes
    getNodes: () => request('GET', '/api/nodes'),
    getNode: (nid) => request('GET', `/api/nodes/${nid}`),
    createNode: (data) => request('POST', '/api/nodes', data),
    updateNode: (nid, data) => request('PATCH', `/api/nodes/${nid}`, data),
    deleteNode: (nid) => request('DELETE', `/api/nodes/${nid}`),

    // Profiles
    getProfiles: () => request('GET', '/api/profiles'),

    // Deploy
    deploy: (data) => request('POST', '/api/deploy', data),
    rollback: (data) => request('POST', '/api/rollback', data),
    getDeploys: () => request('GET', '/api/deploys'),

    // Subscriptions
    getSubscriptions: () => request('GET', '/api/subscriptions'),
    createSubscription: (data) => request('POST', '/api/subscriptions', data),
    updateSubscription: (token, data) => request('PATCH', `/api/subscriptions/${token}`, data),
    deleteSubscription: (token) => request('DELETE', `/api/subscriptions/${token}`),
}
