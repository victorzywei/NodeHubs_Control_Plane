<script setup>
defineProps({
    toasts: { type: Array, required: true }
})
</script>

<template>
    <div class="toast-container">
        <TransitionGroup name="toast">
            <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.type}`">
                {{ t.message }}
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
.toast-enter-active {
    animation: slide-in-right 0.3s ease;
}
.toast-leave-active {
    transition: all 0.2s ease;
}
.toast-leave-to {
    opacity: 0;
    transform: translateX(100%);
}
</style>
