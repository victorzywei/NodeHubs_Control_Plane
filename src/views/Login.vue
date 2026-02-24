<script setup>
import { ref, inject } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.js'

const router = useRouter()
const toast = inject('toast')
const adminKey = ref('')
const loading = ref(false)

async function login() {
    if (!adminKey.value.trim()) return
    loading.value = true
    try {
        await api.login(adminKey.value.trim())
        sessionStorage.setItem('admin_key', adminKey.value.trim())
        toast('登录成功', 'success')
        router.push('/dashboard')
    } catch (e) {
        toast(e.message || '密钥无效', 'error')
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <div class="min-h-screen flex items-center justify-center p-4" style="background: var(--color-bg-primary)">
        <!-- Ambient glow -->
        <div class="fixed top-0 left-0 w-96 h-96 rounded-full opacity-20 blur-3xl pointer-events-none"
             style="background: radial-gradient(circle, var(--color-accent) 0%, transparent 70%)" />

        <div class="glass-card p-8 w-full max-w-sm relative">
            <!-- Logo -->
            <div class="flex flex-col items-center mb-8">
                <div class="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl mb-3"
                     style="background: linear-gradient(135deg, var(--color-accent), #7c3aed)">
                    N
                </div>
                <h1 class="text-xl font-semibold text-accent">NodeHub</h1>
                <p class="text-xs text-text-muted mt-1">Unified Node Control Plane</p>
            </div>

            <form @submit.prevent="login">
                <label class="block text-xs font-medium text-text-secondary mb-2">管理密钥 (Admin Key)</label>
                <input
                    v-model="adminKey"
                    type="password"
                    class="form-input mb-5"
                    placeholder="请输入管理密钥..."
                    autofocus
                />
                <button
                    type="submit"
                    :disabled="loading || !adminKey.trim()"
                    class="btn-primary w-full py-3 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {{ loading ? '验证中...' : '登 录' }}
                </button>
            </form>

            <p class="text-center text-[10px] text-text-muted mt-6">
                NodeHub Control Plane v1.0 · Pages Functions + KV
            </p>
        </div>
    </div>
</template>
