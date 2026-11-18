<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, Sun, Moon, Menu, Check, ShieldCheck, X, CircleAlert } from 'lucide-vue-next';
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from 'reka-ui';
import WorkspaceNav from './components/WorkspaceNav.vue';
import { useWorkspace } from './lib/store';
import { setToken } from './lib/api';
import ReviewDrawer from './components/ReviewDrawer.vue';
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  mobileOpen = ref(false),
  dark = ref(localStorage.getItem('spoolnest-theme') !== 'light'),
  search = ref(''),
  token = ref(''),
  menuTrigger = ref<HTMLButtonElement>();
const mobileViewport = window.matchMedia('(max-width: 760px)');
function closeDesktopMenu() {
  if (!mobileViewport.matches) mobileOpen.value = false;
}
onUnmounted(() => mobileViewport.removeEventListener('change', closeDesktopMenu));
document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
function toggleTheme() {
  dark.value = !dark.value;
  const theme = dark.value ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('spoolnest-theme', theme);
}
onMounted(() => {
  mobileViewport.addEventListener('change', closeDesktopMenu);
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
    <aside class="sidebar desktop-sidebar"><WorkspaceNav /></aside>
    <DialogRoot v-model:open="mobileOpen">
      <DialogPortal>
        <DialogOverlay class="sidebar-scrim" />
        <DialogContent
          class="sidebar mobile-sidebar"
          :aria-describedby="undefined"
          @close-auto-focus.prevent="menuTrigger?.focus()"
        >
          <DialogTitle class="sr-only">工作空间导航</DialogTitle>
          <DialogClose class="icon-button nav-close" aria-label="关闭导航"
            ><X :size="18"
          /></DialogClose>
          <WorkspaceNav @navigate="mobileOpen = false" />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <div class="main-shell">
      <header class="topbar">
        <div class="topbar-left">
          <button
            ref="menuTrigger"
            class="icon-button mobile-menu"
            aria-haspopup="dialog"
            :aria-expanded="mobileOpen"
            aria-label="打开导航"
            @click="mobileOpen = true"
          >
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
              store.data?.sync.enabled ? '拓竹同步已启用' : '拓竹同步未启用'
            }}</RouterLink
          ><span class="top-divider" /><button
            class="icon-button"
            :aria-label="dark ? '切换浅色主题' : '切换深色主题'"
            @click="toggleTheme"
          >
            <Sun v-if="dark" :size="19" /><Moon v-else :size="19" />
          </button>
        </div>
      </header>
      <main class="main-content">
        <div v-if="store.authRequired" class="auth-card panel">
          <ShieldCheck :size="32" />
          <h1>打开你的工作空间</h1>
          <p class="muted">此服务已开启访问保护，请输入服务配置的管理员令牌。</p>
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
          <CircleAlert :size="18" /><span class="grow">{{ store.error }}</span
          ><button class="button small" @click="store.load()">重新连接</button>
        </div>
        <div
          v-else-if="!store.data && store.loading"
          class="skeleton-grid"
          role="status"
          aria-label="加载工作空间"
          aria-busy="true"
        >
          <div v-for="n in 6" :key="n" class="skeleton" />
        </div>
        <RouterView v-else-if="store.data" />
      </main>
    </div>
    <Transition name="toast"
      ><div v-if="store.notice" class="toast" role="status">
        <Check :size="17" />{{ store.notice }}
      </div></Transition
    ><ReviewDrawer />
  </div>
</template>
