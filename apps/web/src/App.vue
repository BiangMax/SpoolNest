<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  LayoutDashboard,
  Layers3,
  Printer,
  ChartNoAxesCombined,
  Settings2,
  Search,
  Sun,
  Moon,
  Menu,
  ChevronDown,
  ArrowUpRight,
  Check,
  RefreshCw,
  Box,
  PanelLeftClose,
  ShieldCheck,
} from 'lucide-vue-next';
import { useWorkspace } from './lib/store';
import { setToken } from './lib/api';
import ReviewDrawer from './components/ReviewDrawer.vue';
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  mobileOpen = ref(false),
  dark = ref(localStorage.getItem('spoolnest-theme') === 'dark'),
  search = ref(''),
  token = ref('');
const nav = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/inventory', label: '耗材库存', icon: Layers3 },
  { path: '/jobs', label: '打印任务', icon: Box },
  { path: '/printers', label: '打印机管理', icon: Printer },
  { path: '/analytics', label: '数据统计', icon: ChartNoAxesCombined },
];
function theme() {
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
  localStorage.setItem('spoolnest-theme', dark.value ? 'dark' : 'light');
}
onMounted(() => {
  theme();
  void store.load();
});
function find() {
  void router.push({ path: '/inventory', query: { q: search.value } });
}
function unlock() {
  setToken(token.value);
  token.value = '';
  void store.load();
}
</script>
<template>
  <div class="app-shell">
    <div v-if="mobileOpen" class="sidebar-scrim" @click="mobileOpen = false" />
    <aside class="sidebar" :class="{ visible: mobileOpen }">
      <RouterLink to="/" class="brand"
        ><img src="/favicon.svg" alt="" /><span
          >SpoolNest<span class="brand-dot">.</span></span
        ></RouterLink
      ><button
        class="workspace-picker"
        @click="
          router.push('/settings');
          mobileOpen = false;
        "
      >
        <span class="workspace-avatar">S</span
        ><span><strong>我的打印工作室</strong><small>个人工作空间</small></span
        ><ChevronDown :size="14" />
      </button>
      <div class="nav-label">工作空间</div>
      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          @click="mobileOpen = false"
          ><component :is="item.icon" :size="19" stroke-width="1.7" /><span>{{ item.label }}</span
          ><span
            v-if="
              item.path === '/jobs' &&
              store.jobs.filter((j) => ['pending', 'awaiting_data'].includes(j.reviewStatus)).length
            "
            class="nav-count"
            >{{
              store.jobs.filter((j) => ['pending', 'awaiting_data'].includes(j.reviewStatus)).length
            }}</span
          ></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <div class="local-note">
          <ShieldCheck :size="18" /><strong>你的数据，留在本地</strong>
          <p>每一次库存变化<br />都经过你的确认。</p>
        </div>
        <RouterLink
          to="/settings"
          class="nav-item"
          :class="{ active: route.path === '/settings' }"
          @click="mobileOpen = false"
          ><Settings2 :size="19" />系统设置</RouterLink
        >
        <div class="profile">
          <span class="profile-avatar">S</span>
          <div><strong>本地工作空间</strong><small>SpoolNest v0.1</small></div>
          <span class="status-dot green" />
        </div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button class="icon-button mobile-menu" aria-label="打开导航" @click="mobileOpen = true">
            <Menu :size="21" /></button
          ><span class="breadcrumb">工作空间</span><span class="breadcrumb slash">/</span
          ><strong>{{ route.meta.title }}</strong>
        </div>
        <div class="topbar-right">
          <form class="global-search" @submit.prevent="find">
            <Search :size="16" /><input
              v-model="search"
              aria-label="全局搜索库存"
              placeholder="搜索你的耗材…"
            /><kbd>↵</kbd>
          </form>
          <RouterLink to="/settings" class="connection-label"
            ><span class="status-dot" :class="store.data?.sync.enabled ? 'green' : 'gray'" />{{
              store.data?.sync.enabled ? '云端已启用' : '本地模式'
            }}</RouterLink
          ><span class="top-divider" /><button
            class="icon-button"
            :aria-label="dark ? '切换浅色主题' : '切换深色主题'"
            @click="
              dark = !dark;
              theme();
            "
          >
            <Sun v-if="dark" :size="19" /><Moon v-else :size="19" />
          </button>
        </div>
      </header>
      <main class="main-content">
        <div v-if="store.authRequired" class="auth-card panel">
          <ShieldCheck :size="32" />
          <h1>打开你的工作空间</h1>
          <p class="muted">此服务已开启访问保护，请输入本机配置的管理员令牌。</p>
          <form @submit.prevent="unlock">
            <input
              v-model="token"
              type="password"
              placeholder="管理员访问令牌"
              required
              autocomplete="off"
              aria-label="管理员访问令牌"
            /><button class="button primary">解锁工作空间</button>
          </form>
        </div>
        <div v-else-if="store.error" class="error-banner" role="alert">
          {{ store.error }}<button class="button small" @click="store.load()">重新连接</button>
        </div>
        <div
          v-else-if="!store.data && store.loading"
          class="skeleton-grid"
          aria-label="加载工作空间"
        >
          <div v-for="n in 6" :key="n" class="skeleton" />
        </div>
        <RouterView v-else-if="store.data" />
      </main>
      <footer class="app-footer">
        <span>SpoolNest · 3D Printing Filament Manager</span><span>让每一克，都有迹可循。</span>
      </footer>
    </div>
    <Transition name="toast"
      ><div v-if="store.notice" class="toast" role="status">
        <Check :size="17" />{{ store.notice }}
      </div></Transition
    ><ReviewDrawer />
  </div>
</template>
