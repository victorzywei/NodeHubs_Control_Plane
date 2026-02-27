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
    toast?.(`加载失败: ${e.message}`, 'error')
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
    toast?.(`加载失败: ${e.message}`, 'error')
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
    toast?.(`加载失败: ${e.message}`, 'error')
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
      toast?.('节点已更新', 'success')
    } else {
      data.node_type = form.value.node_type
      await api.createNode(data)
      toast?.('节点已创建', 'success')
    }
    showModal.value = false
    await loadNodes()
  } catch (e) {
    toast?.(`保存失败: ${e.message}`, 'error')
  }
}

async function deleteNode(nid, name) {
  if (!confirm(`确定删除节点 \"${name}\" 吗？`)) return
  try {
    await api.deleteNode(nid)
    toast?.('节点已删除', 'success')
    await loadNodes()
  } catch (e) {
    toast?.(`删除失败: ${e.message}`, 'error')
  }
}

function copyToken() {
  if (!detailNode.value?.node_token) return
  navigator.clipboard.writeText(detailNode.value.node_token)
  toast?.('Token 已复制', 'success')
}

function copyInstallCommand() {
  if (!installCmd.value) return
  navigator.clipboard.writeText(installCmd.value)
  toast?.('部署命令已复制', 'success')
}

function timeAgo(dateStr) {
  if (!dateStr) return '从未'
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}
</script>

<template>
  <div class="p-6 lg:p-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold">节点管理</h1>
      <button class="btn-primary" @click="openCreate">+ 添加节点</button>
    </div>

    <div v-if="!loading && nodes.length === 0" class="glass-card p-16 text-center text-text-muted">
      还没有节点。
    </div>

    <div v-else-if="nodes.length > 0" class="glass-card overflow-hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>状态</th>
            <th>名称</th>
            <th>类型</th>
            <th>入口</th>
            <th>版本</th>
            <th>区域</th>
            <th>最后在线</th>
            <th>操作</th>
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
                <span class="text-xs text-text-secondary">{{ n.is_online ? (n.last_apply_status === 'failed' ? '异常' : '在线') : '离线' }}</span>
              </div>
            </td>
            <td class="font-medium">{{ n.name }}</td>
            <td>
              <span class="text-[10px] px-2 py-0.5 rounded font-semibold" :class="n.node_type === 'vps' ? 'bg-accent/10 text-accent' : 'bg-worker/10 text-worker'">
                {{ n.node_type === 'vps' ? 'VPS' : 'Worker' }}
              </span>
            </td>
            <td class="font-mono text-xs text-text-secondary">{{ n.entry_domain_cdn || n.entry_domain_direct || n.entry_domain || n.entry_ip || '-' }}</td>
            <td>
              <span v-if="n.target_version > 0" class="text-xs font-mono text-text-secondary">v{{ n.applied_version || 0 }}/v{{ n.target_version }}</span>
              <span v-else class="text-xs text-text-muted">未部署</span>
            </td>
            <td class="text-sm">{{ n.region || '-' }}</td>
            <td class="text-xs text-text-muted">{{ timeAgo(n.last_seen) }}</td>
            <td>
              <div class="flex gap-1">
                <button @click="openDetail(n.id)" class="px-2 py-1 rounded text-xs text-text-secondary hover:bg-white/5 transition">详情</button>
                <button @click="openEdit(n.id)" class="px-2 py-1 rounded text-xs text-text-secondary hover:bg-white/5 transition">编辑</button>
                <button @click="deleteNode(n.id, n.name)" class="px-2 py-1 rounded text-xs text-danger hover:bg-danger/10 transition">删除</button>
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
            <h3 class="font-semibold text-lg">{{ editId ? '编辑节点' : '添加节点' }}</h3>
            <button @click="showModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">x</button>
          </div>

          <form @submit.prevent="saveNode" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">节点名称 *</label>
              <input v-model="form.name" class="form-input" required />
            </div>

            <div v-if="!editId">
              <label class="block text-xs font-medium text-text-secondary mb-1.5">节点类型 *</label>
              <select v-model="form.node_type" class="form-input">
                <option value="vps">VPS</option>
                <option value="cf_worker">Cloudflare Worker</option>
              </select>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">CDN 域名</label>
                <input v-model="form.entry_domain_cdn" class="form-input" placeholder="cdn.example.com" />
              </div>
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">直连域名（可选）</label>
                <input v-model="form.entry_domain_direct" class="form-input" placeholder="direct.example.com" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">入口 IP</label>
              <input v-model="form.entry_ip" class="form-input" placeholder="1.2.3.4" />
              <div class="text-[10px] text-text-muted mt-1">直连域名留空时自动回退 CDN 域名。</div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">区域</label>
                <input v-model="form.region" class="form-input" />
              </div>
              <div>
                <label class="block text-xs font-medium text-text-secondary mb-1.5">标签（逗号分隔）</label>
                <input v-model="form.tags" class="form-input" />
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">GitHub 镜像（可选）</label>
              <input v-model="form.github_mirror" class="form-input" />
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Cloudflare API Token（可选）</label>
              <input v-model="form.cf_api_token" class="form-input" />
            </div>

            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1.5">Cloudflare Zone ID（可选）</label>
              <input v-model="form.cf_zone_id" class="form-input" />
            </div>

            <label v-if="editId" class="flex items-center gap-2 py-2 cursor-pointer text-sm text-text-secondary">
              <input type="checkbox" v-model="form.rotate_token" class="accent-accent" />
              <span>轮换 Node Token</span>
            </label>

            <div class="flex justify-end gap-3 pt-4 border-t border-border">
              <button type="button" @click="showModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">取消</button>
              <button type="submit" class="btn-primary">{{ editId ? '保存' : '创建' }}</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showDetail && detailNode" class="modal-overlay" @mousedown.self="showDetail = false">
        <div class="modal-panel max-w-xl">
          <div class="flex items-center justify-between mb-6">
            <h3 class="font-semibold text-lg">节点详情 - {{ detailNode.name }}</h3>
            <button @click="showDetail = false" class="text-text-muted hover:text-text-primary text-xl leading-none">x</button>
          </div>

          <div class="grid grid-cols-2 gap-4 mb-5 text-sm">
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">节点 ID</div>
              <div class="font-mono text-xs">{{ detailNode.id }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">类型</div>
              <div class="text-xs">{{ detailNode.node_type === 'vps' ? 'VPS' : 'CF Worker' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">CDN 域名</div>
              <div class="text-xs">{{ detailNode.entry_domain_cdn || detailNode.entry_domain || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">直连域名</div>
              <div class="text-xs">{{ detailNode.entry_domain_direct || detailNode.entry_domain_cdn || detailNode.entry_domain || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">入口 IP</div>
              <div class="font-mono text-xs">{{ detailNode.entry_ip || '-' }}</div>
            </div>
            <div>
              <div class="text-[10px] text-text-muted mb-0.5">区域</div>
              <div class="text-xs">{{ detailNode.region || '-' }}</div>
            </div>
          </div>

          <div class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">Node Token</div>
            <div class="flex items-center gap-2 p-3 rounded-lg bg-bg-input border border-border">
              <code class="flex-1 text-xs font-mono text-text-secondary truncate">{{ detailNode.node_token }}</code>
              <button @click="copyToken" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition">复制</button>
            </div>
          </div>

          <div v-if="detailNode.node_type === 'vps'" class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">一键部署命令</div>
            <div class="p-3 rounded-lg bg-bg-input border border-border">
              <code class="text-[11px] font-mono text-text-secondary break-all">{{ installCmd || '加载中...' }}</code>
            </div>
            <div class="mt-2">
              <button @click="copyInstallCommand" :disabled="!installCmd" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition disabled:opacity-50">复制命令</button>
            </div>
          </div>

          <div class="mb-5" v-if="detailNode.capabilities">
            <div class="text-[10px] text-text-muted mb-1.5">能力 (Capabilities)</div>
            <div class="flex flex-wrap gap-1.5">
              <span v-for="p in (detailNode.capabilities.protocols || [])" :key="'p'+p" class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p }}</span>
              <span v-for="t in (detailNode.capabilities.transports || [])" :key="'t'+t" class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ t }}</span>
              <span v-for="m in (detailNode.capabilities.tls_modes || [])" :key="'m'+m" class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ m }}</span>
            </div>
          </div>

          <div v-if="detailNode.apply_history?.length" class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">应用历史</div>
            <div class="space-y-2">
              <div v-for="h in detailNode.apply_history.slice(0, 5)" :key="h.version + h.timestamp" class="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02]">
                <span class="status-dot" :class="h.status === 'success' ? 'status-dot-online' : 'status-dot-error'" />
                <div class="flex-1 min-w-0">
                  <div class="text-xs">
                    <span class="font-mono">v{{ h.version }}</span>
                    <span class="ml-2" :class="h.status === 'success' ? 'text-success' : 'text-danger'">
                      {{ h.status === 'success' ? '成功' : '失败' }}
                    </span>
                  </div>
                  <div v-if="Array.isArray(h.protocols) && h.protocols.length" class="mt-1 flex flex-wrap gap-1">
                    <span v-for="p in h.protocols" :key="`${h.version}-${p}`" class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-secondary">{{ p }}</span>
                  </div>
                  <div v-if="h.message" class="text-[10px] text-text-secondary break-all">{{ h.message }}</div>
                  <div class="text-[10px] text-text-muted">{{ new Date(h.timestamp).toLocaleString('zh-CN') }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="detailNode.last_apply_message" class="mb-5">
            <div class="text-[10px] text-text-muted mb-1.5">最近状态信息</div>
            <div class="text-xs text-text-secondary break-all p-2 rounded-lg bg-white/[0.02]">{{ detailNode.last_apply_message }}</div>
          </div>

          <div class="flex justify-end pt-4 mt-4 border-t border-border">
            <button @click="showDetail = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
