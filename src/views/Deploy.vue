<script setup>
import { ref, inject, onMounted } from 'vue'
import { api } from '../api.js'

const toast = inject('toast')
const nodes = ref([])
const profiles = ref([])
const deploys = ref([])
const loading = ref(true)

const selectedNodes = ref(new Set())
const selectedProfiles = ref(new Set())
const deployParams = ref('{}')

onMounted(async () => {
    try {
        const [n, p, d] = await Promise.all([
            api.getNodes(),
            api.getProfiles(),
            api.getDeploys().catch(() => []),
        ])
        nodes.value = n
        profiles.value = p
        deploys.value = d
    } catch { }
    loading.value = false
})

function toggleNode(id) {
    selectedNodes.value.has(id) ? selectedNodes.value.delete(id) : selectedNodes.value.add(id)
    selectedNodes.value = new Set(selectedNodes.value)
}

function toggleProfile(id) {
    selectedProfiles.value.has(id) ? selectedProfiles.value.delete(id) : selectedProfiles.value.add(id)
    selectedProfiles.value = new Set(selectedProfiles.value)
}

function selectNodes(filter) {
    selectedNodes.value = new Set(
        filter === 'all' ? nodes.value.map(n => n.id) :
        nodes.value.filter(n => n.node_type === (filter === 'vps' ? 'vps' : 'cf_worker')).map(n => n.id)
    )
}

async function doDeploy() {
    if (selectedNodes.value.size === 0) return toast('请选择至少一个目标节点', 'error')
    if (selectedProfiles.value.size === 0) return toast('请选择至少一个协议配置', 'error')

    let params = {}
    try {
        const raw = deployParams.value.trim()
        if (raw) params = JSON.parse(raw)
    } catch {
        return toast('部署参数 JSON 格式错误', 'error')
    }

    if (!confirm(`确认发布到 ${selectedNodes.value.size} 个节点？`)) return

    try {
        const result = await api.deploy({
            node_ids: [...selectedNodes.value],
            profile_ids: [...selectedProfiles.value],
            params,
        })
        const ok = result.results?.filter(r => r.status === 'deployed').length || 0
        toast(`发布成功！版本 v${result.version}，${ok} 个节点已部署`, 'success')
        deploys.value = await api.getDeploys().catch(() => [])
    } catch (e) {
        toast(`发布失败: ${e.message}`, 'error')
    }
}

async function rollback(version, nodeIds) {
    if (!confirm(`确认回滚 ${nodeIds.length} 个节点到 v${version}？`)) return
    try {
        await api.rollback({ node_ids: nodeIds, target_version: version })
        toast(`已回滚到 v${version}`, 'success')
    } catch (e) {
        toast(`回滚失败: ${e.message}`, 'error')
    }
}
</script>

<template>
    <div class="p-6 lg:p-8">
        <h1 class="text-xl font-semibold mb-6">发布部署</h1>

        <!-- Deploy Form -->
        <div class="glass-card p-6 mb-5">
            <h3 class="font-semibold text-sm mb-4 flex items-center gap-2">
                <span>🚀</span> 新建发布
            </h3>

            <!-- Node Selection -->
            <div class="mb-5">
                <label class="block text-xs font-medium text-text-secondary mb-2">选择目标节点</label>
                <div class="flex flex-wrap gap-2 mb-2">
                    <button
                        v-for="n in nodes" :key="n.id"
                        @click="toggleNode(n.id)"
                        class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-all cursor-pointer"
                        :class="selectedNodes.has(n.id)
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-border bg-white/[0.02] text-text-secondary hover:border-white/10'"
                    >
                        <span v-if="selectedNodes.has(n.id)" class="text-xs">✓</span>
                        <span>{{ n.name }}</span>
                        <span class="text-[9px] px-1 py-px rounded font-semibold"
                              :class="n.node_type === 'vps' ? 'bg-accent/15 text-accent' : 'bg-worker/15 text-worker'">
                            {{ n.node_type === 'vps' ? 'VPS' : 'WKR' }}
                        </span>
                    </button>
                </div>
                <div class="flex gap-2">
                    <button @click="selectNodes('all')" class="text-[10px] px-2.5 py-1 rounded bg-white/5 text-text-muted hover:text-text-secondary transition">全选</button>
                    <button @click="selectNodes('vps')" class="text-[10px] px-2.5 py-1 rounded bg-white/5 text-text-muted hover:text-text-secondary transition">仅 VPS</button>
                    <button @click="selectNodes('worker')" class="text-[10px] px-2.5 py-1 rounded bg-white/5 text-text-muted hover:text-text-secondary transition">仅 Worker</button>
                </div>
            </div>

            <!-- Profile Selection -->
            <div class="mb-5">
                <label class="block text-xs font-medium text-text-secondary mb-2">选择协议配置</label>
                <div class="flex flex-wrap gap-2">
                    <button
                        v-for="p in profiles" :key="p.id"
                        @click="toggleProfile(p.id)"
                        class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-all cursor-pointer"
                        :class="selectedProfiles.has(p.id)
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-border bg-white/[0.02] text-text-secondary hover:border-white/10'"
                    >
                        <span v-if="selectedProfiles.has(p.id)" class="text-xs">✓</span>
                        <span>{{ p.name }}</span>
                    </button>
                </div>
            </div>

            <!-- Params -->
            <div class="mb-5">
                <label class="block text-xs font-medium text-text-secondary mb-2">部署参数 (JSON, 可选)</label>
                <textarea
                    v-model="deployParams"
                    class="form-input font-mono text-xs resize-y"
                    rows="3"
                    placeholder='{"listen_port": 443, "uuid": "..."}'
                />
                <div class="text-[10px] text-text-muted mt-1">可指定共享 UUID、密码、端口等参数，留空使用默认值</div>
            </div>

            <button @click="doDeploy" class="btn-primary flex items-center gap-2">
                <span>🚀</span> 执行发布
            </button>
        </div>

        <!-- Deploy History -->
        <div class="glass-card p-6">
            <h3 class="font-semibold text-sm mb-4 flex items-center gap-2">
                <span>📜</span> 部署历史
            </h3>

            <div v-if="deploys.length === 0" class="text-center py-10">
                <div class="text-3xl mb-2">📜</div>
                <div class="text-text-muted text-sm">还没有部署记录</div>
            </div>

            <table v-else class="data-table">
                <thead>
                    <tr>
                        <th>版本</th>
                        <th>时间</th>
                        <th>节点数</th>
                        <th>配置</th>
                        <th>结果</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="d in deploys" :key="d.id">
                        <td>
                            <span class="text-xs font-mono px-2 py-1 rounded bg-white/5 text-text-secondary">v{{ d.version }}</span>
                        </td>
                        <td class="text-xs text-text-muted">{{ new Date(d.created_at).toLocaleString('zh-CN') }}</td>
                        <td class="text-xs">{{ d.results?.length || 0 }} 节点</td>
                        <td class="text-xs text-text-muted font-mono">{{ (d.profile_ids || []).join(', ') }}</td>
                        <td>
                            <div class="flex items-center gap-1.5">
                                <span class="status-dot" :class="(d.results?.filter(r => r.status === 'deployed').length || 0) === (d.results?.length || 0) ? 'status-dot-online' : 'status-dot-warning'" />
                                <span class="text-xs">{{ d.results?.filter(r => r.status === 'deployed').length || 0 }}/{{ d.results?.length || 0 }}</span>
                            </div>
                        </td>
                        <td>
                            <button @click="rollback(d.version, d.node_ids)" class="text-xs px-2.5 py-1 rounded bg-white/5 text-text-secondary hover:text-text-primary transition">
                                ↩️ 回滚
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
