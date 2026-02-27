<script setup>
import { ref, inject, onMounted } from 'vue'
import { api } from '../api.js'

const toast = inject('toast')
const nodes = ref([])
const loading = ref(true)
const showModal = ref(false)
const showDetail = ref(false)
const editId = ref(null)
const detailNode = ref(null)
const installCmd = ref('')

const form = ref({
  name: '',
  node_type: 'vps',
  entry_domain_cdn: '',
  entry_domain_direct: '',
  entry_ip: '',
  region: '',
  tags: '',
  github_mirror: '',
  cf_api_token: '',
  cf_zone_id: '',
  rotate_token: false,
})

onMounted(() => loadNodes())

async function loadNodes() {
  loading.value = true
  try {
    nodes.value = await api.getNodes()
  } catch (e) {
    toast?.(`Load failed: ${e.message}`, 'error')
  }
  loading.value = false
}

function openCreate() {
  editId.value = null
  form.value = {
    name: '',
    node_type: 'vps',
    entry_domain_cdn: '',
    entry_domain_direct: '',
    entry_ip: '',
    region: '',
    tags: '',
    github_mirror: '',
    cf_api_token: '',
    cf_zone_id: '',
    rotate_token: false,
  }
  showModal.value = true
}

async function openEdit(nid) {
  editId.value = nid
  try {
    const node = await api.getNode(nid)
    form.value = {
      name: node.name || '',
      node_type: node.node_type,
      entry_domain_cdn: node.entry_domain_cdn || node.entry_domain || '',
      entry_domain_direct: node.entry_domain_direct || node.entry_domain_cdn || node.entry_domain || '',
      entry_ip: node.entry_ip || '',
      region: node.region || '',
      tags: (node.tags || []).join(', '),
      github_mirror: node.github_mirror || '',
      cf_api_token: node.cf_api_token || '',
      cf_zone_id: node.cf_zone_id || '',
      rotate_token: false,
    }
    showModal.value = true
  } catch (e) {
    toast?.(`Load failed: ${e.message}`, 'error')
  }
}

async function openDetail(nid) {
  try {
    detailNode.value = await api.getNode(nid)
    installCmd.value = ''
    if (detailNode.value?.node_type === 'vps') {
      const install = await api.getNodeInstallCmd(nid)
      installCmd.value = install.command || ''
    }
    showDetail.value = true
  } catch (e) {
    toast?.(`Load failed: ${e.message}`, 'error')
  }
}

async function saveNode() {
  const data = {
    name: form.value.name.trim(),
    entry_domain_cdn: form.value.entry_domain_cdn.trim(),
    entry_domain_direct: form.value.entry_domain_direct.trim(),
    entry_ip: form.value.entry_ip.trim(),
    region: form.value.region.trim(),
    tags: form.value.tags.split(',').map((t) => t.trim()).filter(Boolean),
    github_mirror: form.value.github_mirror.trim(),
    cf_api_token: form.value.cf_api_token.trim(),
    cf_zone_id: form.value.cf_zone_id.trim(),
  }

  try {
    if (editId.value) {
      if (form.value.rotate_token) data.rotate_token = true
      await api.updateNode(editId.value, data)
      toast?.('Node updated', 'success')
    } else {
      data.node_type = form.value.node_type
      await api.createNode(data)
      toast?.('Node created', 'success')
    }
    showModal.value = false
    await loadNodes()
  } catch (e) {
    toast?.(`Save failed: ${e.message}`, 'error')
  }
}

async function deleteNode(nid, name) {
  if (!confirm(`Delete node \"${name}\"?`)) return
  try {
    await api.deleteNode(nid)
    toast?.('Node deleted', 'success')
    await loadNodes()
  } catch (e) {
    toast?.(`Delete failed: ${e.message}`, 'error')
  }
}

function copyToken() {
  if (!detailNode.value?.node_token) return
  navigator.clipboard.writeText(detailNode.value.node_token)
  toast?.('Token copied', 'success')
}

function copyInstallCommand() {
  if (!installCmd.value) return
  navigator.clipboard.writeText(installCmd.value)
  toast?.('Install command copied', 'success')
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold">Nodes</h1>
      <button class="btn-primary" @click="openCreate">+ Add Node</button>
    </div>

    <div v-if="!loading && nodes.length === 0" class="glass-card p-16 text-center text-text-muted">
      No nodes yet.
    </div>

    <div v-else-if="nodes.length > 0" class="glass-card overflow-hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Type</th>
            <th>Domain</th>
            <th>Version</th>
            <th>Region</th>
            <th>Last Seen</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in nodes" :key="n.id">
            <td>
              <div class="flex items-center gap-2">
                <span
                  class="status-dot"
                  :class="n.is_online ? (n.last_apply_status === 'failed' ? 'status-dot-error' : 'status-dot-online') : 'status-dot-offline'"
                />
                <span class="text-xs text-text-secondary">{{ n.is_online ? 'online' : 'offline' }}</span>
              </div>
            </td>
            <td class="font-medium">{{ n.name }}</td>
            <td>
              <span
                class="text-[10px] px-2 py-0.5 rounded font-semibold"
                :class="n.node_type === 'vps' ? 'bg-accent/10 text-accent' : 'bg-worker/10 text-worker'"
              >
                {{ n.node_type === 'vps' ? 'VPS' : 'Worker' }}
              </span>
            </td>
            <td class="font-mono text-xs text-text-secondary">{{ n.entry_domain_cdn || n.entry_domain_direct || n.entry_domain || n.entry_ip || '-' }}</td>
            <td>
              <span v-if="n.target_version > 0" class="text-xs font-mono text-text-secondary">v{{ n.applied_version || 0 }}/v{{ n.target_version }}</span>
              <span v-else class="text-xs text-text-muted">not deployed</span>
            </td>
            <td class="text-sm">{{ n.region || '-' }}</td>
            <td class="text-xs text-text-muted">{{ timeAgo(n.last_seen) }}</td>
            <td>
              <div class="flex gap-1">
                <button @click="openDetail(n.id)" class="px-2 py-1 rounded text-xs text-text-secondary hover:bg-white/5 transition">View</button>
                <button @click="openEdit(n.id)" class="px-2 py-1 rounded text-xs text-text-secondary hover:bg-white/5 transition">Edit</button>
                <button @click="deleteNode(n.id, n.name)" class="px-2 py-1 rounded text-xs text-danger hover:bg-danger/10 transition">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @mousedown.self="showModal = false">
        <div class="modal-panel">
          <div class="flex items-center justify-between mb-6">
            <h3 class="font-semibold text-lg">{{ editId ? 'Edit Node' : 'Add Node' }}</h3>
            <button @click="showModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">x</button>
          </div>

          <form @submit.prevent="saveNode" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Name *</label>
              <input v-model="form.name" class="form-input" required />
            </div>

            <div v-if="!editId">
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Type *</label>
              <select v-model="form.node_type" class="form-input">
                <option value="vps">VPS</option>
                <option value="cf_worker">Cloudflare Worker</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">CDN Domain</label>
                <input v-model="form.entry_domain_cdn" class="form-input" placeholder="cdn.example.com" />
              </div>
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">Direct Domain (Optional)</label>
                <input v-model="form.entry_domain_direct" class="form-input" placeholder="direct.example.com" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Entry IP</label>
              <input v-model="form.entry_ip" class="form-input" placeholder="1.2.3.4" />
              <div class="text-[10px] text-text-muted mt-1">If direct domain is empty, CDN domain is used for direct links.</div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">Region</label>
                <input v-model="form.region" class="form-input" />
              </div>
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">Tags (comma separated)</label>
                <input v-model="form.tags" class="form-input" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">GitHub Mirror (Optional)</label>
              <input v-model="form.github_mirror" class="form-input" />
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Cloudflare API Token (Optional)</label>
              <input v-model="form.cf_api_token" class="form-input" />
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Cloudflare Zone ID (Optional)</label>
              <input v-model="form.cf_zone_id" class="form-input" />
            </div>

            <label v-if="editId" class="flex items-center gap-2 py-2 cursor-pointer text-sm text-text-secondary">
              <input type="checkbox" v-model="form.rotate_token" class="accent-accent" />
              <span>Rotate Node Token</span>
            </label>

            <div class="flex justify-end gap-3 pt-4 border-t border-border">
              <button type="button" @click="showModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">Cancel</button>
              <button type="submit" class="btn-primary">{{ editId ? 'Save' : 'Create' }}</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showDetail && detailNode" class="modal-overlay" @mousedown.self="showDetail = false">
        <div class="modal-panel max-w-xl">
          <div class="flex items-center justify-between mb-6">
            <h3 class="font-semibold text-lg">Node Detail - {{ detailNode.name }}</h3>
            <button @click="showDetail = false" class="text-text-muted hover:text-text-primary text-xl leading-none">x</button>
          </div>

          <div class="grid grid-cols-2 gap-4 mb-5 text-sm">
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">Node ID</div>
              <div class="font-mono text-xs">{{ detailNode.id }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">Type</div>
              <div class="text-xs">{{ detailNode.node_type === 'vps' ? 'VPS' : 'CF Worker' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">CDN Domain</div>
              <div class="text-xs">{{ detailNode.entry_domain_cdn || detailNode.entry_domain || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">Direct Domain</div>
              <div class="text-xs">{{ detailNode.entry_domain_direct || detailNode.entry_domain_cdn || detailNode.entry_domain || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">Entry IP</div>
              <div class="font-mono text-xs">{{ detailNode.entry_ip || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">Region</div>
              <div class="text-xs">{{ detailNode.region || '-' }}</div>
            </div>
          </div>

          <div class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">Node Token</div>
            <div class="flex items-center gap-2 p-3 rounded-lg bg-bg-input border border-border">
              <code class="flex-1 text-xs font-mono text-text-secondary truncate">{{ detailNode.node_token }}</code>
              <button @click="copyToken" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition">Copy</button>
            </div>
          </div>

          <div v-if="detailNode.node_type === 'vps'" class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">One-click Install Command</div>
            <div class="p-3 rounded-lg bg-bg-input border border-border">
              <code class="text-[11px] font-mono text-text-secondary break-all">{{ installCmd || 'Loading...' }}</code>
            </div>
            <div class="mt-2">
              <button @click="copyInstallCommand" :disabled="!installCmd" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition disabled:opacity-50">Copy Command</button>
            </div>
          </div>

          <div class="flex justify-end pt-4 mt-4 border-t border-border">
            <button @click="showDetail = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">Close</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
