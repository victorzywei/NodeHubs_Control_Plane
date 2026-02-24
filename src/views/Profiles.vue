<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'

const profiles = ref([])
const loading = ref(true)

onMounted(async () => {
    try { profiles.value = await api.getProfiles() } catch { }
    loading.value = false
})

const builtins = ref([])
const customs = ref([])

import { watchEffect } from 'vue'
watchEffect(() => {
    builtins.value = profiles.value.filter(p => p.is_builtin)
    customs.value = profiles.value.filter(p => !p.is_builtin)
})

const protocolColors = { vless: 'text-accent', trojan: 'text-orange-400', hysteria2: 'text-purple-400' }
</script>

<template>
    <div class="p-6 lg:p-8">
        <h1 class="text-xl font-semibold mb-6">协议配置</h1>

        <!-- Built-in Profiles -->
        <div class="mb-8">
            <h3 class="text-sm font-medium text-text-secondary mb-3">内置协议 ({{ builtins.length }})</h3>
            <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div v-for="p in builtins" :key="p.id" class="glass-card p-5 hover:border-white/10 transition-colors">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-2">
                            <span class="w-2 h-2 rounded-full" :class="p.protocol === 'trojan' ? 'bg-orange-400' : 'bg-accent'" />
                            <span class="font-medium text-sm">{{ p.name }}</span>
                        </div>
                        <span class="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted">内置</span>
                    </div>
                    <p class="text-xs text-text-muted mb-3">{{ p.description }}</p>
                    <div class="flex gap-1.5 flex-wrap mb-2">
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 font-medium"
                              :class="protocolColors[p.protocol] || 'text-text-secondary'">{{ p.protocol }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.transport }}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-text-secondary">{{ p.tls_mode }}</span>
                    </div>
                    <div v-if="p.schema" class="text-[10px] text-text-muted font-mono mt-2">
                        参数: {{ Object.keys(p.schema).join(', ') }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Custom Profiles -->
        <div v-if="customs.length > 0">
            <h3 class="text-sm font-medium text-text-secondary mb-3">自定义协议 ({{ customs.length }})</h3>
            <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div v-for="p in customs" :key="p.id" class="glass-card p-5">
                    <div class="flex items-center justify-between mb-3">
                        <span class="font-medium text-sm">{{ p.name }}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded border border-accent/20 text-accent">自定义</span>
                    </div>
                    <p class="text-xs text-text-muted">{{ p.description }}</p>
                </div>
            </div>
        </div>
    </div>
</template>
