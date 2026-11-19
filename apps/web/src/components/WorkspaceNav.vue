<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  LayoutDashboard,
  ShoppingCart,
  Layers3,
  Printer,
  ChartNoAxesCombined,
  Settings2,
  Box,
  Warehouse,
  ChevronRight,
  ShieldCheck,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
const route = useRoute(),
  store = useWorkspace();
const emit = defineEmits<{ navigate: [] }>();
const pendingCount = computed(
  () => store.jobs.filter((j) => ['pending', 'awaiting_data'].includes(j.reviewStatus)).length,
);
const nav = [
  { path: '/', label: '仪表盘', icon: LayoutDashboard },
  { path: '/inventory', label: '耗材库存', icon: Layers3 },
  { path: '/restock', label: '补货清单', icon: ShoppingCart },
  { path: '/jobs', label: '打印任务', icon: Box },
  { path: '/printers', label: '打印机管理', icon: Printer },
  { path: '/analytics', label: '数据统计', icon: ChartNoAxesCombined },
];
</script>
<template>
  <RouterLink to="/" class="brand" @click="emit('navigate')"
    ><img src="/favicon.svg?v=2" alt="" /><span
      >SpoolNest<span class="brand-dot">.</span></span
    ></RouterLink
  >
  <RouterLink to="/settings" class="workspace-picker" @click="emit('navigate')">
    <span class="workspace-avatar"><Warehouse :size="18" /></span>
    <span><strong>我的打印工作室</strong><small>个人工作空间</small></span>
    <ChevronRight :size="14" />
  </RouterLink>
  <div class="nav-label">工作空间</div>
  <nav aria-label="工作空间导航">
    <RouterLink
      v-for="item in nav"
      :key="item.path"
      :to="item.path"
      class="nav-item"
      :class="{ active: route.path === item.path }"
      @click="emit('navigate')"
      ><component :is="item.icon" :size="19" stroke-width="1.7" /><span>{{ item.label }}</span
      ><span v-if="item.path === '/jobs' && pendingCount" class="nav-count">{{
        pendingCount
      }}</span></RouterLink
    >
  </nav>
  <div class="sidebar-bottom">
    <RouterLink
      to="/settings"
      class="nav-item"
      :class="{ active: route.path === '/settings' }"
      @click="emit('navigate')"
      ><Settings2 :size="19" />系统设置</RouterLink
    >
    <div class="profile">
      <span class="profile-avatar"><ShieldCheck :size="17" /></span>
      <div><strong>工作空间</strong><small>单用户 · v0.1</small></div>
    </div>
  </div>
</template>
