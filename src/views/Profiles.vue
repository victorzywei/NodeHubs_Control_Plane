<script setup>
import { ref, computed, onMounted, inject, watch } from 'vue'
import { api } from '../api.js'

const toast = inject('toast')
const profiles = ref([])
const registry = ref({ protocols: {}, transports: {}, tls_modes: {}, node_adapters: {} })
const loading = ref(true)

// ── Modals ──
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDetailModal = ref(false)
const detailProfile = ref(null)
const editingProfile = ref(null)

// ── Create form (3x-ui style cascading) ──
const form = ref({
    name: '', description: '',
    protocol: '', transport: '', tls_mode: '',
    defaults: {},
})

// ── Edit form ──
const editForm = ref({
    defaults: {},
    description: '',
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

// ── Dynamic fields based on current create form ──
const dynamicFields = computed(() => {
    return buildFieldGroups(form.value.protocol, form.value.transport, form.value.tls_mode)
})

// ── Dynamic fields for editing profile ──
const editFields = computed(() => {
    if (!editingProfile.value) return { common: [], protocol: [], transport: [], tls: [] }
    return buildFieldGroups(
        editingProfile.value.protocol,
        editingProfile.value.transport,
        editingProfile.value.tls_mode,
    )
})

function buildFieldGroups(protocol, transport, tlsMode) {
    const result = { common: [], protocol: [], transport: [], tls: [] }
    // Common: port
    result.common = [{ key: 'port', type: 'number', default: 443, label: '端口', hint: '监听/连接端口' }]

    const pReg = registry.value.protocols[protocol]
    const tReg = registry.value.transports[transport]
    const sReg = registry.value.tls_modes[tlsMode]

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
}

// ── Compatible node types for current creation ──
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

watch(() => form.value.protocol, () => {
    form.value.transport = ''
    form.value.tls_mode = ''
    form.value.defaults = {}
})
watch(() => form.value.transport, () => {
    form.value.tls_mode = ''
})

// ── Helpers ──
function getFieldValue(obj, key) { return obj[key] }
function setFieldValue(obj, key, val) { obj[key] = val }

function openCreate() {
    form.value = { name: '', description: '', protocol: '', transport: '', tls_mode: '', defaults: {} }
    showCreateModal.value = true
}

function openEdit(profile) {
    editingProfile.value = { ...profile }
    // Extract current defaults: merge profile.defaults + schema defaults
    const defaults = {}
    if (profile.schema) {
        for (const [key, def] of Object.entries(profile.schema)) {
            defaults[key] = profile.defaults?.[key] ?? def.default ?? ''
        }
    }
    if (profile.defaults) {
        for (const [key, val] of Object.entries(profile.defaults)) {
            defaults[key] = val
        }
    }
    editForm.value = {
        defaults: { ...defaults },
        description: profile.description || '',
    }
    showEditModal.value = true
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

async function saveEdit() {
    if (!editingProfile.value) return
    try {
        const data = {
            defaults: editForm.value.defaults,
            description: editForm.value.description,
        }
        // For custom profiles, also allow updating name
        if (!editingProfile.value.is_builtin && editForm.value.name) {
            data.name = editForm.value.name
        }
        await api.updateProfile(editingProfile.value.id, data)
        toast('协议配置已保存', 'success')
        showEditModal.value = false
        profiles.value = await api.getProfiles()
    } catch (e) {
        toast(`保存失败: ${e.message}`, 'error')
    }
}

async function resetProfile(pid) {
    if (!confirm('确定要重置为默认参数？自定义的修改将被清除。')) return
    try {
        await api.deleteProfile(pid) // DELETE on built-in = reset
        toast('已重置为默认值', 'success')
        showEditModal.value = false
        profiles.value = await api.getProfiles()
    } catch (e) {
        toast(`重置失败: ${e.message}`, 'error')
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
                <div v-for="p in builtins" :key="p.id" class="glass-card overflow-hidden group">
                    <!-- ★ Top banner: node types (prominent) -->
                    <div class="flex gap-0">
                        <div v-for="nt in (p.node_types || [])" :key="nt"
                             class="flex-1 text-center text-[10px] py-1 font-bold tracking-wider"
                             :class="nt === 'vps'
                                 ? 'bg-accent/20 text-accent'
                                 : 'bg-worker/20 text-worker'">
                            {{ nt === 'vps' ? '🖥️ VPS' : '⚡ WORKER' }}
                        </div>
                    </div>

                    <div class="p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full" :class="protocolBg[p.protocol] || 'bg-accent'" />
                                <span class="font-medium text-sm">{{ p.name }}</span>
                            </div>
                            <div class="flex items-center gap-1">
                                <span v-if="p._has_override" class="text-[9px] px-1.5 py-0.5 rounded bg-orange-400/15 text-orange-400">已修改</span>
                                <span class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted">内置</span>
                            </div>
                        </div>
                        <p class="text-xs text-text-muted mb-3 line-clamp-2">{{ p.description }}</p>
                        <div class="flex gap-1.5 flex-wrap mb-3">
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 font-medium"
                                  :class="protocolColors[p.protocol] || 'text-text-secondary'">{{ p.protocol }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.transport }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.tls_mode }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-muted font-mono">:{{ p.defaults?.port || 443 }}</span>
                        </div>
                        <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button @click="openEdit(p)" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition">✏️ 编辑</button>
                            <button @click="viewDetail(p)" class="text-[10px] px-2.5 py-1 rounded bg-white/5 text-text-secondary hover:text-text-primary transition">🔍 详情</button>
                        </div>
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
                <div v-for="p in customs" :key="p.id" class="glass-card overflow-hidden group">
                    <!-- ★ Top banner: node types (prominent) -->
                    <div class="flex gap-0">
                        <div v-for="nt in (p.node_types || [])" :key="nt"
                             class="flex-1 text-center text-[10px] py-1 font-bold tracking-wider"
                             :class="nt === 'vps'
                                 ? 'bg-accent/20 text-accent'
                                 : 'bg-worker/20 text-worker'">
                            {{ nt === 'vps' ? '🖥️ VPS' : '⚡ WORKER' }}
                        </div>
                    </div>

                    <div class="p-5">
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full" :class="protocolBg[p.protocol] || 'bg-white/30'" />
                                <span class="font-medium text-sm">{{ p.name }}</span>
                            </div>
                            <span class="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 text-accent">自定义</span>
                        </div>
                        <p class="text-xs text-text-muted mb-3">{{ p.description }}</p>
                        <div class="flex gap-1.5 flex-wrap mb-3">
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 font-medium"
                                  :class="protocolColors[p.protocol] || 'text-text-secondary'">{{ p.protocol }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.transport }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.tls_mode }}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-muted font-mono">:{{ p.defaults?.port || 443 }}</span>
                        </div>
                        <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button @click="openEdit(p)" class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition">✏️ 编辑</button>
                            <button @click="viewDetail(p)" class="text-[10px] px-2.5 py-1 rounded bg-white/5 text-text-secondary hover:text-text-primary transition">🔍 详情</button>
                            <button @click="deleteProfile(p.id)" class="text-[10px] px-2.5 py-1 rounded bg-danger/10 text-danger hover:bg-danger/20 transition">🗑️ 删除</button>
                        </div>
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

                        <!-- Step 1: Protocol -->
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

                        <!-- Step 2: Transport -->
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

                        <!-- Step 3: TLS -->
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

                        <!-- Step 4: Dynamic param fields -->
                        <template v-if="form.tls_mode">
                            <div class="p-4 rounded-xl border border-border bg-white/[0.01]">
                                <label class="block text-xs font-semibold text-text-secondary mb-2.5">
                                    <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold mr-1.5">4</span>
                                    参数配置 (默认值)
                                </label>
                                <component :is="'div'"
                                    v-for="(fields, groupName) in {
                                        '🔌 通用': dynamicFields.common,
                                        '📡 协议参数': dynamicFields.protocol,
                                        '🔀 传输参数': dynamicFields.transport,
                                        '🔒 TLS 参数': dynamicFields.tls,
                                    }" :key="groupName">
                                    <template v-if="fields.length">
                                        <div class="text-[10px] text-text-muted mb-2 mt-3 uppercase tracking-wide">{{ groupName }}</div>
                                        <div class="grid grid-cols-2 gap-3">
                                            <div v-for="f in fields" :key="f.key">
                                                <label class="block text-[11px] text-text-secondary mb-1">{{ f.label }}</label>
                                                <select v-if="f.type === 'select'" class="form-input text-xs"
                                                        :value="form.defaults[f.key] ?? f.default"
                                                        @change="form.defaults[f.key] = $event.target.value">
                                                    <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt || '(空)' }}</option>
                                                </select>
                                                <label v-else-if="f.type === 'boolean'" class="flex items-center gap-2 py-1 cursor-pointer">
                                                    <input type="checkbox" class="accent-accent"
                                                           :checked="form.defaults[f.key] ?? f.default"
                                                           @change="form.defaults[f.key] = $event.target.checked" />
                                                    <span class="text-xs text-text-secondary">{{ f.label }}</span>
                                                </label>
                                                <input v-else-if="f.type === 'number'" type="number" class="form-input text-xs"
                                                       :value="form.defaults[f.key] ?? f.default"
                                                       @input="form.defaults[f.key] = Number($event.target.value)"
                                                       :placeholder="String(f.default ?? '')" />
                                                <input v-else class="form-input text-xs"
                                                       :value="form.defaults[f.key] ?? f.default ?? ''"
                                                       @input="form.defaults[f.key] = $event.target.value"
                                                       :placeholder="f.auto ? `(自动生成 ${f.auto})` : (String(f.default ?? ''))" />
                                                <div v-if="f.hint" class="text-[9px] text-text-muted mt-0.5">{{ f.hint }}</div>
                                            </div>
                                        </div>
                                    </template>
                                </component>
                            </div>

                            <!-- Compatible nodes -->
                            <div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-border">
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
                        </template>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border">
                            <button type="button" @click="showCreateModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">取消</button>
                            <button type="submit" class="btn-primary" :disabled="!form.protocol || !form.transport || !form.tls_mode">
                                创建协议配置
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </Teleport>

        <!-- ━━━━━━━━ Edit Modal ━━━━━━━━ -->
        <Teleport to="body">
            <div v-if="showEditModal && editingProfile" class="modal-overlay" @click.self="showEditModal = false">
                <div class="modal-panel max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between mb-6">
                        <div>
                            <h3 class="font-semibold text-lg">编辑协议参数</h3>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="text-xs font-medium" :class="protocolColors[editingProfile.protocol]">{{ editingProfile.name }}</span>
                                <span class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted">
                                    {{ editingProfile.protocol }}+{{ editingProfile.transport }}+{{ editingProfile.tls_mode }}
                                </span>
                                <span v-if="editingProfile.is_builtin" class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted">内置</span>
                                <span v-else class="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">自定义</span>
                            </div>
                        </div>
                        <button @click="showEditModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">✕</button>
                    </div>

                    <form @submit.prevent="saveEdit" class="space-y-5">
                        <!-- Description (editable) -->
                        <div>
                            <label class="block text-xs font-medium text-text-secondary mb-1.5">描述</label>
                            <input v-model="editForm.description" class="form-input" :placeholder="editingProfile.description" />
                        </div>

                        <!-- Param fields by group -->
                        <div class="p-4 rounded-xl border border-border bg-white/[0.01]">
                            <component :is="'div'"
                                v-for="(fields, groupName) in {
                                    '🔌 通用': editFields.common,
                                    '📡 协议参数': editFields.protocol,
                                    '🔀 传输参数': editFields.transport,
                                    '🔒 TLS 参数': editFields.tls,
                                }" :key="groupName">
                                <template v-if="fields.length">
                                    <div class="text-[10px] text-text-muted mb-2 mt-3 first:mt-0 uppercase tracking-wide">{{ groupName }}</div>
                                    <div class="grid grid-cols-2 gap-3">
                                        <div v-for="f in fields" :key="f.key">
                                            <label class="block text-[11px] text-text-secondary mb-1">{{ f.label }}</label>
                                            <select v-if="f.type === 'select'" class="form-input text-xs"
                                                    :value="editForm.defaults[f.key] ?? f.default"
                                                    @change="editForm.defaults[f.key] = $event.target.value">
                                                <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt || '(空)' }}</option>
                                            </select>
                                            <label v-else-if="f.type === 'boolean'" class="flex items-center gap-2 py-1 cursor-pointer">
                                                <input type="checkbox" class="accent-accent"
                                                       :checked="editForm.defaults[f.key] ?? f.default"
                                                       @change="editForm.defaults[f.key] = $event.target.checked" />
                                                <span class="text-xs text-text-secondary">{{ f.label }}</span>
                                            </label>
                                            <input v-else-if="f.type === 'number'" type="number" class="form-input text-xs"
                                                   :value="editForm.defaults[f.key] ?? f.default"
                                                   @input="editForm.defaults[f.key] = Number($event.target.value)"
                                                   :placeholder="String(f.default ?? '')" />
                                            <input v-else class="form-input text-xs"
                                                   :value="editForm.defaults[f.key] ?? f.default ?? ''"
                                                   @input="editForm.defaults[f.key] = $event.target.value"
                                                   :placeholder="f.auto ? `(自动 ${f.auto})` : (String(f.default ?? ''))" />
                                            <div v-if="f.hint" class="text-[9px] text-text-muted mt-0.5">{{ f.hint }}</div>
                                        </div>
                                    </div>
                                </template>
                            </component>
                        </div>

                        <div class="flex items-center justify-between pt-4 border-t border-border">
                            <div>
                                <button v-if="editingProfile.is_builtin && editingProfile._has_override"
                                        type="button" @click="resetProfile(editingProfile.id)"
                                        class="text-xs px-3 py-1.5 rounded-lg text-orange-400 bg-orange-400/10 hover:bg-orange-400/20 transition flex items-center gap-1">
                                    ↩️ 重置默认值
                                </button>
                            </div>
                            <div class="flex gap-3">
                                <button type="button" @click="showEditModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">取消</button>
                                <button type="submit" class="btn-primary">保存修改</button>
                            </div>
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
                                  style="background: rgba(255,255,255,0.05);">{{ detailProfile.protocol }}</span>
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
                        <div v-if="detailProfile.defaults && Object.keys(detailProfile.defaults).length > 0">
                            <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">当前参数值</div>
                            <div class="bg-white/[0.02] rounded-lg p-3 space-y-1.5">
                                <div v-for="(val, key) in detailProfile.defaults" :key="key"
                                     class="flex items-center justify-between text-xs">
                                    <span class="font-mono text-text-secondary">{{ key }}</span>
                                    <span class="text-accent font-mono">{{ JSON.stringify(val) }}</span>
                                </div>
                            </div>
                        </div>
                        <div v-if="detailProfile.schema && Object.keys(detailProfile.schema).length > 0">
                            <div class="text-[10px] text-text-muted mb-2 uppercase tracking-wide">完整 Schema</div>
                            <div class="bg-white/[0.02] rounded-lg p-3 space-y-1.5 max-h-60 overflow-y-auto">
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
                    </div>
                    <div class="flex justify-end pt-4 mt-4 border-t border-border">
                        <button @click="showDetailModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">关闭</button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
