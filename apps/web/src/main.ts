import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Dashboard from './pages/Dashboard.vue';
import Inventory from './pages/Inventory.vue';
import Jobs from './pages/Jobs.vue';
import Printers from './pages/Printers.vue';
import Analytics from './pages/Analytics.vue';
import Restock from './pages/Restock.vue';
import Settings from './pages/Settings.vue';
import './style.css';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard, meta: { title: '仪表盘' } },
    { path: '/inventory', component: Inventory, meta: { title: '耗材库存' } },
    { path: '/restock', component: Restock, meta: { title: '补货清单' } },
    { path: '/jobs', component: Jobs, meta: { title: '打印任务' } },
    { path: '/printers', component: Printers, meta: { title: '打印机管理' } },
    { path: '/analytics', component: Analytics, meta: { title: '数据统计' } },
    { path: '/settings', component: Settings, meta: { title: '系统设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
createApp(App).use(createPinia()).use(router).mount('#app');
