<script setup>
import { ref, computed, onMounted, inject, watch } from 'vue'
import { api } from '../api.js'

const toast = inject('toast')
const profiles = ref([])
const registry = ref({ protocols: {}, transports: {}, tls_modes: {}, node_adapters: {} })
const loading = ref(true)
const showCreateModal = ref(false)
const showDetailModal = ref(false)
const detailProfile = ref(null)

// ── Create form (3x-ui style cascading) ──
const form = ref({
    name: '',
    description: '',
    protocol: '',
    transport: '',
    tls_mode: '',
    defaults: {},
})

onMounted(async () => {
    try {
        const [p, r] = await Promise.all([
            api.getProfiles(),
            api.getRegistry(),
        ])
        profiles.value = p
        registry.value = r
    } catch (e) {
        toast?.(`加载失败: ${e.message}`, 'error')
    }
    loading.value = false
})

const builtins = computed(() => profiles.value.filter(p => p.is_builtin))
const customs = computed(() => profiles.value.filter(p => !p.is_builtin))

// ── Cascade logic: protocol → transport → TLS ──
const availableTransports = computed(() => {
    const pReg = registry.value.protocols[form.value.protocol]
    if (!pReg) return []
    return pReg.compatible_transports.filter(t => registry.value.transports[t])
})

const availableTlsModes = computed(() => {
    const pReg = registry.value.protocols[form.value.protocol]
    if (!pReg) return []
    return pReg.compatible_tls.filter(t => registry.value.tls_modes[t])
})

// ── Dynamic fields based on protocol+transport+tls ──
const dynamicFields = computed(() => {
    const result = { protocol: [], transport: [], tls: [] }
    const pReg = registry.value.protocols[form.value.protocol]
    const tReg = registry.value.transports[form.value.transport]
    const sReg = registry.value.tls_modes[form.value.tls_mode]

    if (pReg) {
        result.protocol = Object.entries(pReg.fields).map(([k, v]) => ({ key: k, ...v }))
    }
    if (tReg) {
        result.transport = Object.entries(tReg.fields).map(([k, v]) => ({ key: k, ...v }))
    }
    if (sReg) {
        result.tls = Object.entries(sReg.fields).filter(([, v]) => !v.server_side)
            .map(([k, v]) => ({ key: k, ...v }))
    }
    return result
})

// ── Compatible node types for current selection ──
const compatibleNodes = computed(() => {
    const result = []
    for (const [type, adapter] of Object.entries(registry.value.node_adapters || {})) {
        if (adapter.supported_protocols.includes(form.value.protocol) &&
            adapter.supported_transports.includes(form.value.transport) &&
            adapter.supported_tls.includes(form.value.tls_mode)) {
            result.push({ type, name: adapter.name })
        }
    }
    return result
})

// Reset cascading selections when protocol changes
watch(() => form.value.protocol, () => {
    form.value.transport = ''
    form.value.tls_mode = ''
    form.value.defaults = {}
})

watch(() => form.value.transport, () => {
    form.value.tls_mode = ''
})

function getFieldValue(key) {
    return form.value.defaults[key]
}

function setFieldValue(key, val) {
    form.value.defaults = { ...form.value.defaults, [key]: val }
}

function openCreate() {
    form.value = { name: '', description: '', protocol: '', transport: '', tls_mode: '', defaults: {} }
    showCreateModal.value = true
}

function viewDetail(profile) {
    detailProfile.value = profile
    showDetailModal.value = true
}

async function createProfile() {
    if (!form.value.name.trim()) return toast('请输入配置名称', 'error')
    if (!form.value.protocol) return toast('请选择协议', 'error')
    if (!form.value.transport) return toast('请选择传输方式', 'error')
    if (!form.value.tls_mode) return toast('请选择 TLS 模式', 'error')

    try {
        await api.createProfile({
            name: form.value.name.trim(),
            protocol: form.value.protocol,
            transport: form.value.transport,
            tls_mode: form.value.tls_mode,
            description: form.value.description.trim(),
            defaults: form.value.defaults,
        })
        toast('协议配置已创建', 'success')
        showCreateModal.value = false
        profiles.value = await api.getProfiles()
    } catch (e) {
        toast(`创建失败: ${e.message}`, 'error')
    }
}

async function deleteProfile(pid) {
    if (!confirm('确定要删除这个自定义协议配置吗？')) return
    try {
        await api.deleteProfile(pid)
        toast('已删除', 'success')
        profiles.value = await api.getProfiles()
    } catch (e) {
        toast(`删除失败: ${e.message}`, 'error')
    }
}

const protocolColors = {
    vless: 'text-accent', trojan: 'text-orange-400', vmess: 'text-blue-400',
    shadowsocks: 'text-violet-400', hysteria2: 'text-purple-400',
}
const protocolBg = {
    vless: 'bg-accent', trojan: 'bg-orange-400', vmess: 'bg-blue-400',
    shadowsocks: 'bg-violet-400', hysteria2: 'bg-purple-400',
}
</script>

<template>
    <div class="p-6 lg:p-8">
        <div class="flex items-center justify-between mb-6">
            <h1 class="text-xl font-semibold">协议配置</h1>
            <button class="btn-primary flex items-center gap-1.5" @click="openCreate">
                <span>+</span> 自定义协议
            </button>
        </div>

        <!-- Built-in Profiles -->
        <div class="mb-8">
            <h3 class="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-accent"></span>
                内置协议 ({{ builtins.length }})
            </h3>
            <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div v-for="p in builtins" :key="p.id"
                     class="glass-card p-5 hover:border-white/10 transition-all cursor-pointer group"
                     @click="viewDetail(p)">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full" :class="protocolBg[p.protocol] || 'bg-accent'" />
                            <span class="font-medium text-sm">{{ p.name }}</span>
                        </div>
                        <span class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted">内置</span>
                    </div>
                    <p class="text-xs text-text-muted mb-3 line-clamp-2">{{ p.description }}</p>
                    <div class="flex gap-1.5 flex-wrap mb-2">
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 font-medium"
                              :class="protocolColors[p.protocol] || 'text-text-secondary'">{{ p.protocol }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.transport }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.tls_mode }}</span>
                    </div>
                    <div class="flex gap-1 flex-wrap mt-2">
                        <span v-for="nt in (p.node_types || [])" :key="nt"
                              class="text-[9px] px-1.5 py-px rounded font-semibold"
                              :class="nt === 'vps' ? 'bg-accent/15 text-accent' : 'bg-worker/15 text-worker'">
                            {{ nt === 'vps' ? 'VPS' : 'Worker' }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Custom Profiles -->
        <div v-if="customs.length > 0" class="mb-8">
            <h3 class="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                自定义协议 ({{ customs.length }})
            </h3>
            <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div v-for="p in customs" :key="p.id"
                     class="glass-card p-5 hover:border-white/10 transition-all group">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2 cursor-pointer" @click="viewDetail(p)">
                            <span class="w-2 h-2 rounded-full" :class="protocolBg[p.protocol] || 'bg-white/30'" />
                            <span class="font-medium text-sm">{{ p.name }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span class="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 text-accent">自定义</span>
                            <button @click="deleteProfile(p.id)"
                                    class="opacity-0 group-hover:opacity-100 text-danger text-xs px-1.5 py-0.5 rounded hover:bg-danger/10 transition-all">
                                🗑️
                            </button>
                        </div>
                    </div>
                    <p class="text-xs text-text-muted mb-3">{{ p.description }}</p>
                    <div class="flex gap-1.5 flex-wrap">
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 font-medium"
                              :class="protocolColors[p.protocol] || 'text-text-secondary'">{{ p.protocol }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.transport }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.tls_mode }}</span>
                    </div>
                    <div class="flex gap-1 flex-wrap mt-2">
                        <span v-for="nt in (p.node_types || [])" :key="nt"
                              class="text-[9px] px-1.5 py-px rounded font-semibold"
                              :class="nt === 'vps' ? 'bg-accent/15 text-accent' : 'bg-worker/15 text-worker'">
                            {{ nt === 'vps' ? 'VPS' : 'Worker' }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- ━━━━━━━━ Create Modal (3x-ui style) ━━━━━━━━ -->
        <Teleport to="body">
            <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
                <div class="modal-panel max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="font-semibold text-lg">添加自定义协议</h3>
                        <button @click="showCreateModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">✕</button>
                    </div>

                    <form @submit.prevent="createProfile" class="space-y-5">
                        <!-- Name & Description -->
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-xs font-medium text-text-secondary mb-1.5">配置名称 *</label>
                                <input v-model="form.name" class="form-input" placeholder="例如: My-VLESS-WS" required />
                            </div>
                            <div>
                                <label class="block text-xs font-medium text-text-secondary mb-1.5">描述</label>
                                <input v-model="form.description" class="form-input" placeholder="简短描述..." />
                            </div>
                        </div>

                        <!-- Step 1: Protocol Selection -->
                        <div class="p-4 rounded-xl border border-border bg-white/[0.01]">
                            <label class="block text-xs font-semibold text-text-secondary mb-2.5">
                                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold mr-1.5">1</span>
                                选择协议
                            </label>
                            <div class="flex flex-wrap gap-2">
                                <button v-for="(pReg, pId) in registry.protocols" :key="pId" type="button"
                                        @click="form.protocol = pId"
                                        class="px-3.5 py-2 rounded-lg text-sm border transition-all cursor-pointer"
                                        :class="form.protocol === pId
                                            ? 'border-accent/50 bg-accent/10 text-accent shadow-sm shadow-accent/10'
                                            : 'border-border bg-white/[0.02] text-text-secondary hover:border-white/10'">
                                    <span class="font-medium">{{ pReg.name }}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Step 2: Transport Selection -->
                        <div v-if="form.protocol" class="p-4 rounded-xl border border-border bg-white/[0.01]">
                            <label class="block text-xs font-semibold text-text-secondary mb-2.5">
                                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold mr-1.5">2</span>
                                选择传输方式
                            </label>
                            <div class="flex flex-wrap gap-2">
                                <button v-for="tId in availableTransports" :key="tId" type="button"
                                        @click="form.transport = tId"
                                        class="px-3.5 py-2 rounded-lg text-sm border transition-all cursor-pointer"
                                        :class="form.transport === tId
                                            ? 'border-accent/50 bg-accent/10 text-accent shadow-sm shadow-accent/10'
                                            : 'border-border bg-white/[0.02] text-text-secondary hover:border-white/10'">
                                    {{ registry.transports[tId]?.name || tId }}
                                </button>
                            </div>
                        </div>

                        <!-- Step 3: TLS Mode Selection -->
                        <div v-if="form.transport" class="p-4 rounded-xl border border-border bg-white/[0.01]">
                            <label class="block text-xs font-semibold text-text-secondary mb-2.5">
                                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold mr-1.5">3</span>
                                选择 TLS 模式
                            </label>
                            <div class="flex flex-wrap gap-2">
                                <button v-for="sId in availableTlsModes" :key="sId" type="button"
                                        @click="form.tls_mode = sId"
                                        class="px-3.5 py-2 rounded-lg text-sm border transition-all cursor-pointer"
                                        :class="form.tls_mode === sId
                                            ? 'border-accent/50 bg-accent/10 text-accent shadow-sm shadow-accent/10'
                                            : 'border-border bg-white/[0.02] text-text-secondary hover:border-white/10'">
                                    {{ registry.tls_modes[sId]?.name || sId }}
                                </button>
                            </div>
                        </div>

                        <!-- Step 4: Dynamic Fields -->
                        <div v-if="form.tls_mode" class="p-4 rounded-xl border border-border bg-white/[0.01]">
                            <label class="block text-xs font-semibold text-text-secondary mb-2.5">
                                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold mr-1.5">4</span>
                                参数配置 (默认值)
                            </label>

                            <!-- Protocol fields -->
                            <div v-if="dynamicFields.protocol.length" class="mb-4">
                                <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">协议参数</div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div v-for="f in dynamicFields.protocol" :key="f.key">
                                        <label class="block text-[11px] text-text-secondary mb-1">{{ f.label }}</label>
                                        <select v-if="f.type === 'select'" class="form-input text-xs"
                                                :value="getFieldValue(f.key) ?? f.default"
                                                @change="setFieldValue(f.key, $event.target.value)">
                                            <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt || '(空)' }}</option>
                                        </select>
                                        <input v-else-if="f.type === 'number'" type="number" class="form-input text-xs"
                                               :value="getFieldValue(f.key) ?? f.default"
                                               @input="setFieldValue(f.key, Number($event.target.value))"
                                               :placeholder="String(f.default ?? '')" />
                                        <input v-else class="form-input text-xs"
                                               :value="getFieldValue(f.key) ?? f.default ?? ''"
                                               @input="setFieldValue(f.key, $event.target.value)"
                                               :placeholder="f.auto ? `(自动生成 ${f.auto})` : (String(f.default ?? ''))" />
                                        <div v-if="f.hint" class="text-[9px] text-text-muted mt-0.5">{{ f.hint }}</div>
                                    </div>
                                </div>
                            </div>

                            <!-- Transport fields -->
                            <div v-if="dynamicFields.transport.length" class="mb-4">
                                <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">传输参数</div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div v-for="f in dynamicFields.transport" :key="f.key">
                                        <label class="block text-[11px] text-text-secondary mb-1">{{ f.label }}</label>
                                        <select v-if="f.type === 'select'" class="form-input text-xs"
                                                :value="getFieldValue(f.key) ?? f.default"
                                                @change="setFieldValue(f.key, $event.target.value)">
                                            <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt || '(空)' }}</option>
                                        </select>
                                        <label v-else-if="f.type === 'boolean'" class="flex items-center gap-2 py-1 cursor-pointer">
                                            <input type="checkbox" class="accent-accent"
                                                   :checked="getFieldValue(f.key) ?? f.default"
                                                   @change="setFieldValue(f.key, $event.target.checked)" />
                                            <span class="text-xs text-text-secondary">{{ f.label }}</span>
                                        </label>
                                        <input v-else-if="f.type === 'number'" type="number" class="form-input text-xs"
                                               :value="getFieldValue(f.key) ?? f.default"
                                               @input="setFieldValue(f.key, Number($event.target.value))"
                                               :placeholder="String(f.default ?? '')" />
                                        <input v-else class="form-input text-xs"
                                               :value="getFieldValue(f.key) ?? f.default ?? ''"
                                               @input="setFieldValue(f.key, $event.target.value)"
                                               :placeholder="String(f.default ?? '')" />
                                    </div>
                                </div>
                            </div>

                            <!-- TLS fields -->
                            <div v-if="dynamicFields.tls.length">
                                <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">TLS 参数</div>
                                <div class="grid grid-cols-2 gap-3">
                                    <div v-for="f in dynamicFields.tls" :key="f.key">
                                        <label class="block text-[11px] text-text-secondary mb-1">{{ f.label }}</label>
                                        <select v-if="f.type === 'select'" class="form-input text-xs"
                                                :value="getFieldValue(f.key) ?? f.default"
                                                @change="setFieldValue(f.key, $event.target.value)">
                                            <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
                                        </select>
                                        <label v-else-if="f.type === 'boolean'" class="flex items-center gap-2 py-1 cursor-pointer">
                                            <input type="checkbox" class="accent-accent"
                                                   :checked="getFieldValue(f.key) ?? f.default"
                                                   @change="setFieldValue(f.key, $event.target.checked)" />
                                            <span class="text-xs text-text-secondary">{{ f.label }}</span>
                                        </label>
                                        <input v-else class="form-input text-xs"
                                               :value="getFieldValue(f.key) ?? f.default ?? ''"
                                               @input="setFieldValue(f.key, $event.target.value)"
                                               :placeholder="f.hint || String(f.default ?? '')" />
                                        <div v-if="f.hint" class="text-[9px] text-text-muted mt-0.5">{{ f.hint }}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Compatible nodes indicator -->
                        <div v-if="form.tls_mode" class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-border">
                            <span class="text-xs text-text-muted">适用节点：</span>
                            <div class="flex gap-2">
                                <span v-for="node in compatibleNodes" :key="node.type"
                                      class="text-[10px] px-2 py-0.5 rounded font-semibold"
                                      :class="node.type === 'vps' ? 'bg-accent/15 text-accent' : 'bg-worker/15 text-worker'">
                                    {{ node.name }}
                                </span>
                                <span v-if="compatibleNodes.length === 0" class="text-[10px] text-danger">⚠️ 无兼容节点类型</span>
                            </div>
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border">
                            <button type="button" @click="showCreateModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">取消</button>
                            <button type="submit" class="btn-primary"
                                    :disabled="!form.protocol || !form.transport || !form.tls_mode">
                                创建协议配置
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </Teleport>

        <!-- ━━━━━━━━ Detail Modal ━━━━━━━━ -->
        <Teleport to="body">
            <div v-if="showDetailModal && detailProfile" class="modal-overlay" @click.self="showDetailModal = false">
                <div class="modal-panel max-w-lg">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="font-semibold text-lg">{{ detailProfile.name }}</h3>
                        <button @click="showDetailModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">✕</button>
                    </div>

                    <div class="space-y-4">
                        <p class="text-sm text-text-muted">{{ detailProfile.description }}</p>

                        <div class="flex flex-wrap gap-2">
                            <span class="text-xs px-2.5 py-1 rounded-lg font-medium"
                                  :class="protocolColors[detailProfile.protocol] || 'text-text-secondary'"
                                  style="background: rgba(255,255,255,0.05);">
                                {{ detailProfile.protocol }}
                            </span>
                            <span class="text-xs px-2.5 py-1 rounded-lg bg-white/5 text-text-secondary">{{ detailProfile.transport }}</span>
                            <span class="text-xs px-2.5 py-1 rounded-lg bg-white/5 text-text-secondary">{{ detailProfile.tls_mode }}</span>
                        </div>

                        <div>
                            <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">适用节点类型</div>
                            <div class="flex gap-2">
                                <span v-for="nt in (detailProfile.node_types || [])" :key="nt"
                                      class="text-[10px] px-2 py-0.5 rounded font-semibold"
                                      :class="nt === 'vps' ? 'bg-accent/15 text-accent' : 'bg-worker/15 text-worker'">
                                    {{ nt === 'vps' ? '🖥️ VPS' : '⚡ CF Worker' }}
                                </span>
                            </div>
                        </div>

                        <div v-if="detailProfile.schema && Object.keys(detailProfile.schema).length > 0">
                            <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">参数 Schema</div>
                            <div class="bg-white/[0.02] rounded-lg p-3 space-y-1.5">
                                <div v-for="(def, key) in detailProfile.schema" :key="key"
                                     class="flex items-center justify-between text-xs">
                                    <span class="font-mono text-text-secondary">{{ key }}</span>
                                    <span class="text-text-muted">
                                        {{ def.type }}
                                        <template v-if="def.default !== undefined"> = {{ def.default }}</template>
                                        <template v-if="def.auto"> (auto:{{ def.auto }})</template>
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div v-if="detailProfile.defaults && Object.keys(detailProfile.defaults).length > 0">
                            <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">默认值覆盖</div>
                            <div class="bg-white/[0.02] rounded-lg p-3 space-y-1.5">
                                <div v-for="(val, key) in detailProfile.defaults" :key="key"
                                     class="flex items-center justify-between text-xs">
                                    <span class="font-mono text-text-secondary">{{ key }}</span>
                                    <span class="text-accent font-mono">{{ JSON.stringify(val) }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="flex justify-end pt-4 mt-4 border-t border-border">
                        <button @click="showDetailModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">关闭</button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
