<script setup>
import { ref, provide } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from './components/AppLayout.vue'
import ToastContainer from './components/ToastContainer.vue'

const route = useRoute()

// Toast system
const toasts = ref([])
let toastId = 0

function toast(message, type = 'success') {
    const id = ++toastId
    toasts.value.push({ id, message, type })
    setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }, 3000)
}

provide('toast', toast)
</script>

<template>
    <AppLayout v-if="route.meta.guest !== true && $route.name !== 'login'">
        <router-view v-slot="{ Component }">
            <transition name="page" mode="out-in">
                <component :is="Component" />
            </transition>
        </router-view>
    </AppLayout>
    <router-view v-else />
    <ToastContainer :toasts="toasts" />
</template>
