<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'

const stats = ref({ nodes: 0, online: 0, profiles: 0, deploys: 0 })
const nodes = ref([])
const deploys = ref([])
const loading = ref(true)

onMounted(async () => {
    try {
        const [n, p, d] = await Promise.all([
            api.getNodes(),
            api.getProfiles(),
            api.getDeploys().catch(() => []),
        ])
        nodes.value = n
        deploys.value = d.slice(0, 5)
        stats.value = {
            nodes: n.length,
            online: n.filter(x => x.is_online).length,
            profiles: p.length,
            deploys: d.length,
        }
    } catch { }
    loading.value = false
})

function timeAgo(dateStr) {
    const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (s < 60) return `${s}秒前`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}小时前`
    return `${Math.floor(h / 24)}天前`
}

function desiredVersion(node) {
    return Number(node?.desired_version || 0)
}

function deployVersionLabel(deploy) {
    if (Number(deploy?.version || 0) > 0) return `v${deploy.version}`
    const min = Number(deploy?.version_min || 0)
    const max = Number(deploy?.version_max || 0)
    if (min > 0 && max > 0) return min === max ? `v${min}` : `v${min}~v${max}`
    return '-'
}

const statCards = [
    { key: 'nodes', label: '总节点数', icon: '🖥️', color: 'text-accent' },
    { key: 'online', label: '在线节点', icon: '⚡', color: 'text-success' },
    { key: 'profiles', label: '协议配置', icon: '📋', color: 'text-warning' },
    { key: 'deploys', label: '部署次数', icon: '🚀', color: 'text-[#a78bfa]' },
]
</script>

<template>
    <div class="p-6 lg:p-8">
        <h1 class="text-xl font-semibold mb-6">仪表盘</h1>

        <!-- Stats -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div v-for="c in statCards" :key="c.key" class="glass-card p-5 flex items-center gap-4">
                <span class="text-2xl">{{ c.icon }}</span>
                <div>
                    <div class="text-2xl font-bold" :class="c.color">{{ stats[c.key] }}</div>
                    <div class="text-xs text-text-muted">{{ c.label }}</div>
                </div>
            </div>
        </div>

        <!-- Node Status + Recent Deploys -->
        <div class="grid lg:grid-cols-2 gap-4">
            <!-- Nodes -->
            <div class="glass-card p-5">
                <h3 class="font-semibold text-sm mb-4">节点状态</h3>
                <div v-if="nodes.length === 0" class="text-center py-10">
                    <div class="text-3xl mb-2">🖥️</div>
                    <div class="text-text-muted text-sm">还没有节点</div>
                    <router-link to="/nodes" class="text-accent text-xs hover:underline mt-1 inline-block">前往添加 →</router-link>
                </div>
                <div v-else class="space-y-3">
                    <div v-for="n in nodes" :key="n.id" class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <span class="status-dot" :class="n.is_online ? 'status-dot-online' : 'status-dot-offline'" />
                            <span class="text-sm font-medium">{{ n.name }}</span>
                            <span
                                class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                :class="n.node_type === 'vps'
                                    ? 'bg-accent/10 text-accent'
                                    : 'bg-worker/10 text-worker'"
                            >
                                {{ n.node_type === 'vps' ? 'VPS' : 'WKR' }}
                            </span>
                        </div>
                        <span class="text-xs text-text-muted font-mono">
                            v{{ n.applied_version || 0 }} → v{{ desiredVersion(n) }}
                        </span>
                    </div>
                </div>
            </div>

            <!-- Recent Deploys -->
            <div class="glass-card p-5">
                <h3 class="font-semibold text-sm mb-4">最近部署</h3>
                <div v-if="deploys.length === 0" class="text-center py-10">
                    <div class="text-3xl mb-2">🚀</div>
                    <div class="text-text-muted text-sm">还没有部署记录</div>
                </div>
                <div v-else class="space-y-3">
                    <div v-for="d in deploys" :key="d.id" class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <span class="text-xs font-mono px-2 py-1 rounded bg-white/5 text-text-secondary">{{ deployVersionLabel(d) }}</span>
                            <span class="text-xs text-text-muted">{{ new Date(d.created_at).toLocaleString('zh-CN') }}</span>
                        </div>
                        <span class="text-xs text-text-secondary">
                            {{ d.results?.filter(r => r.status === 'deployed').length || 0 }}/{{ d.results?.length || 0 }} 节点
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
