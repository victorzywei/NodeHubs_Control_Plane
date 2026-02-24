<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const navItems = [
    { label: '概览', section: true },
    { name: 'dashboard', label: '仪表盘', icon: '📊' },
    { label: '管理', section: true },
    { name: 'nodes', label: '节点管理', icon: '🖥️' },
    { name: 'profiles', label: '协议配置', icon: '📋' },
    { name: 'deploy', label: '发布部署', icon: '🚀' },
    { name: 'subscriptions', label: '订阅管理', icon: '🔗' },
]

function logout() {
    sessionStorage.removeItem('admin_key')
    router.push('/login')
}
</script>

<template>
    <div class="flex h-screen overflow-hidden">
        <!-- Sidebar -->
        <aside
            class="w-60 flex-shrink-0 flex flex-col border-r border-border"
            style="background: var(--color-bg-sidebar)"
        >
            <!-- Logo -->
            <div class="px-5 py-5 flex items-center gap-3">
                <div
                    class="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                    style="background: linear-gradient(135deg, var(--color-accent), #7c3aed)"
                >
                    N
                </div>
                <div>
                    <div class="font-semibold text-sm text-text-primary">NodeHub</div>
                    <div class="text-xs text-text-muted">v1.0.0</div>
                </div>
            </div>

            <!-- Navigation -->
            <nav class="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
                <template v-for="item in navItems" :key="item.label">
                    <div v-if="item.section" class="text-[10px] font-medium text-text-muted uppercase tracking-wider px-3 pt-5 pb-1.5">
                        {{ item.label }}
                    </div>
                    <router-link
                        v-else
                        :to="{ name: item.name }"
                        class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150"
                        :class="route.name === item.name
                            ? 'bg-accent-glow text-accent font-medium border-l-2 border-accent -ml-px'
                            : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'"
                    >
                        <span class="text-base w-5 text-center">{{ item.icon }}</span>
                        <span>{{ item.label }}</span>
                    </router-link>
                </template>
            </nav>

            <!-- Logout -->
            <div class="px-3 py-4 border-t border-border">
                <button
                    @click="logout"
                    class="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:text-danger transition-colors w-full"
                >
                    <span class="text-base w-5 text-center">🚪</span>
                    <span>退出登录</span>
                </button>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 overflow-y-auto">
            <slot />
        </main>
    </div>
</template>
