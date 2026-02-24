import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

// Lazy loaded views
const Login = () => import('./views/Login.vue')
const Dashboard = () => import('./views/Dashboard.vue')
const Nodes = () => import('./views/Nodes.vue')
const Profiles = () => import('./views/Profiles.vue')
const Deploy = () => import('./views/Deploy.vue')
const Subscriptions = () => import('./views/Subscriptions.vue')

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', redirect: '/dashboard' },
        { path: '/login', name: 'login', component: Login, meta: { guest: true } },
        { path: '/dashboard', name: 'dashboard', component: Dashboard },
        { path: '/nodes', name: 'nodes', component: Nodes },
        { path: '/profiles', name: 'profiles', component: Profiles },
        { path: '/deploy', name: 'deploy', component: Deploy },
        { path: '/subscriptions', name: 'subscriptions', component: Subscriptions },
    ],
})

router.beforeEach((to) => {
    const key = sessionStorage.getItem('admin_key')
    if (!to.meta.guest && !key) return { name: 'login' }
    if (to.name === 'login' && key) return { name: 'dashboard' }
})

const app = createApp(App)
app.use(router)
app.mount('#app')
