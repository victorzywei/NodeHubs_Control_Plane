<script setup>
import { ref, inject, onMounted, computed } from 'vue'
import { api } from '../api.js'

const toast = inject('toast')
const subs = ref([])
const nodes = ref([])
const loading = ref(true)
const showModal = ref(false)
const editingToken = ref(null) // null=创建, 有值=编辑

const form = ref({ name: '', remark: '', selectedNodes: new Set() })

onMounted(() => loadData())

async function loadData() {
    loading.value = true
    try {
        const [s, n] = await Promise.all([api.getSubscriptions(), api.getNodes()])
        subs.value = s
        nodes.value = n
    } catch { }
    loading.value = false
}

const baseUrl = computed(() => window.location.origin)

const isEditing = computed(() => editingToken.value !== null)

const modalTitle = computed(() => isEditing.value ? '编辑订阅' : '创建订阅')

function subUrl(token, format) {
    return `${baseUrl.value}/sub/${token}?format=${format}`
}

function copy(text, label) {
    navigator.clipboard.writeText(text)
    toast(`${label} 已复制`, 'success')
}

function openCreate() {
    editingToken.value = null
    form.value = { name: '', remark: '', selectedNodes: new Set() }
    showModal.value = true
}

function openEdit(sub) {
    editingToken.value = sub.token
    form.value = {
        name: sub.name || '',
        remark: sub.remark || '',
        selectedNodes: new Set(sub.visible_node_ids || []),
    }
    showModal.value = true
}

function toggleFormNode(id) {
    form.value.selectedNodes.has(id) ? form.value.selectedNodes.delete(id) : form.value.selectedNodes.add(id)
    form.value.selectedNodes = new Set(form.value.selectedNodes)
}

function selectAllNodes() {
    if (form.value.selectedNodes.size === nodes.value.length) {
        form.value.selectedNodes = new Set()
    } else {
        form.value.selectedNodes = new Set(nodes.value.map(n => n.id))
    }
}

async function submitForm() {
    try {
        const payload = {
            name: form.value.name.trim() || undefined,
            visible_node_ids: [...form.value.selectedNodes],
            remark: form.value.remark.trim(),
        }

        if (isEditing.value) {
            await api.updateSubscription(editingToken.value, payload)
            toast('订阅已更新', 'success')
        } else {
            await api.createSubscription(payload)
            toast('订阅已创建', 'success')
        }

        showModal.value = false
        await loadData()
    } catch (e) {
        toast(`操作失败: ${e.message}`, 'error')
    }
}

async function toggleSub(token, enabled) {
    try {
        await api.updateSubscription(token, { enabled: !enabled })
        toast(`订阅已${enabled ? '禁用' : '启用'}`, 'success')
        await loadData()
    } catch (e) {
        toast(`操作失败: ${e.message}`, 'error')
    }
}

async function deleteSub(token, name) {
    if (!confirm(`确定删除订阅 "${name}"？`)) return
    try {
        await api.deleteSubscription(token)
        toast('订阅已删除', 'success')
        await loadData()
    } catch (e) {
        toast(`删除失败: ${e.message}`, 'error')
    }
}

function getNodeNames(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return '全部节点'
    return nodeIds
        .map(id => nodes.value.find(n => n.id === id)?.name || id)
        .join(', ')
}
</script>

<template>
    <div class="p-6 lg:p-8">
        <div class="flex items-center justify-between mb-6">
            <h1 class="text-xl font-semibold">订阅管理</h1>
            <button class="btn-primary flex items-center gap-1.5" @click="openCreate">
                <span>+</span> 创建订阅
            </button>
        </div>

        <!-- Empty -->
        <div v-if="!loading && subs.length === 0" class="glass-card p-16 text-center">
            <div class="text-4xl mb-3">🔗</div>
            <div class="text-text-muted">还没有订阅</div>
            <div class="text-xs text-text-muted mt-1">点击上方"创建订阅"生成订阅链接</div>
        </div>

        <!-- Subs List -->
        <div v-else class="space-y-3">
            <div v-for="sub in subs" :key="sub.token" class="glass-card p-5">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <span class="font-medium text-sm">{{ sub.name || '未命名' }}</span>
                        <div class="flex items-center gap-1.5">
                            <span class="status-dot" :class="sub.enabled ? 'status-dot-online' : 'status-dot-offline'" />
                            <span class="text-[10px]" :class="sub.enabled ? 'text-success' : 'text-text-muted'">{{ sub.enabled ? '启用' : '禁用' }}</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button @click="openEdit(sub)"
                                class="text-xs px-3 py-1.5 rounded-lg border border-accent/20 text-accent hover:bg-accent/10 transition">
                            编辑
                        </button>
                        <button @click="toggleSub(sub.token, sub.enabled)"
                                class="text-xs px-3 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-white/5 transition">
                            {{ sub.enabled ? '禁用' : '启用' }}
                        </button>
                        <button @click="deleteSub(sub.token, sub.name)"
                                class="text-xs px-3 py-1.5 rounded-lg border border-danger/20 text-danger hover:bg-danger/10 transition">
                            删除
                        </button>
                    </div>
                </div>

                <div class="text-xs text-text-muted mb-3">
                    可见节点: {{ getNodeNames(sub.visible_node_ids) }} ·
                    {{ sub.remark ? `备注: ${sub.remark} · ` : '' }}
                    创建: {{ new Date(sub.created_at).toLocaleString('zh-CN') }}
                    <template v-if="sub.updated_at && sub.updated_at !== sub.created_at">
                        · 更新: {{ new Date(sub.updated_at).toLocaleString('zh-CN') }}
                    </template>
                </div>

                <!-- URLs -->
                <div class="space-y-2">
                    <div v-for="fmt in ['v2ray', 'clash', 'singbox']" :key="fmt"
                         class="flex items-center gap-2 p-2.5 rounded-lg bg-bg-input border border-border">
                        <span class="text-[10px] text-text-muted flex-shrink-0 w-12">{{ fmt }}:</span>
                        <span class="flex-1 text-xs font-mono text-accent/80 truncate">{{ subUrl(sub.token, fmt) }}</span>
                        <button @click="copy(subUrl(sub.token, fmt), fmt)"
                                class="text-[10px] px-2.5 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition flex-shrink-0">
                            复制
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Create/Edit Modal -->
        <Teleport to="body">
            <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
                <div class="modal-panel">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="font-semibold text-lg">{{ modalTitle }}</h3>
                        <button @click="showModal = false" class="text-text-muted hover:text-text-primary text-xl leading-none">✕</button>
                    </div>

                    <form @submit.prevent="submitForm" class="space-y-4">
                        <div>
                            <label class="block text-xs font-medium text-text-secondary mb-1.5">订阅名称</label>
                            <input v-model="form.name" class="form-input" placeholder="例如: 我的订阅, 家庭组" />
                        </div>

                        <div>
                            <label class="block text-xs font-medium text-text-secondary mb-1.5">
                                可见节点
                                <span class="ml-1 text-text-muted">(不选=全部可见)</span>
                            </label>
                            <div class="mb-2">
                                <button type="button" @click="selectAllNodes"
                                    class="text-[10px] px-2.5 py-1 rounded border border-border text-text-secondary hover:bg-white/5 transition">
                                    {{ form.selectedNodes.size === nodes.length ? '取消全选' : '全选' }}
                                </button>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <button
                                    v-for="n in nodes" :key="n.id"
                                    type="button"
                                    @click="toggleFormNode(n.id)"
                                    class="px-3 py-1.5 rounded-lg text-xs border transition-all"
                                    :class="form.selectedNodes.has(n.id)
                                        ? 'border-accent/40 bg-accent/10 text-accent'
                                        : 'border-border text-text-secondary hover:border-white/10'"
                                >
                                    <span class="mr-1">{{ form.selectedNodes.has(n.id) ? '✓' : '' }}</span>
                                    {{ n.name }}
                                    <span class="ml-1 opacity-50">{{ n.node_type === 'cf_worker' ? '⚡' : '🖥️' }}</span>
                                </button>
                            </div>
                            <div v-if="form.selectedNodes.size > 0" class="mt-2 text-[10px] text-text-muted">
                                已选 {{ form.selectedNodes.size }} 个节点
                            </div>
                        </div>

                        <div>
                            <label class="block text-xs font-medium text-text-secondary mb-1.5">备注</label>
                            <input v-model="form.remark" class="form-input" placeholder="可选备注信息" />
                        </div>

                        <div class="flex justify-end gap-3 pt-4 border-t border-border">
                            <button type="button" @click="showModal = false" class="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-white/5 transition">取消</button>
                            <button type="submit" class="btn-primary">{{ isEditing ? '保存' : '创建' }}</button>
                        </div>
                    </form>
                </div>
            </div>
        </Teleport>
    </div>
</template>
