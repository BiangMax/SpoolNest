import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, json } from './api';
import type { Overview, Job } from '../../../../packages/shared/src';
export const useWorkspace = defineStore('workspace', () => {
  const data = ref<Overview | null>(null),
    loading = ref(false),
    error = ref(''),
    authRequired = ref(false),
    notice = ref(''),
    busy = ref(false),
    reviewJob = ref<Job | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout>;
  const spools = computed(() => data.value?.spools ?? []),
    jobs = computed(() => data.value?.jobs ?? []),
    printers = computed(() => data.value?.printers ?? []),
    transactions = computed(() => data.value?.transactions ?? []);
  function toast(text: string) {
    notice.value = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = ''), 5000);
  }
  async function load() {
    loading.value = true;
    try {
      data.value = await api<Overview>('/overview');
      error.value = '';
      authRequired.value = false;
    } catch (e) {
      error.value = (e as Error).message;
      authRequired.value = (e as any).status === 401;
    } finally {
      loading.value = false;
    }
  }
  async function mutate(path: string, body: unknown, method = 'POST', message = '已保存') {
    const result = await api(path, json(method, body));
    await load();
    toast(message);
    return result;
  }
  async function sync(resume = false) {
    busy.value = true;
    try {
      const result = await api<{ created: number; duplicates: number }>(
        '/sync',
        json('POST', { resume }),
      );
      await load();
      toast(`同步完成 · 新增 ${result.created} 条，已存在 ${result.duplicates} 条`);
    } catch (e) {
      await load();
      toast((e as Error).message);
    } finally {
      busy.value = false;
    }
  }
  const spoolSync = ref<{
    added: number;
    linkedCount: number;
    differences: {
      spoolId: string;
      label: string;
      cloudRemainingMg: number;
      localRemainingMg: number;
    }[];
    warnings: string[];
  } | null>(null);
  async function syncSpools() {
    busy.value = true;
    try {
      const result = await api<NonNullable<typeof spoolSync.value>>(
        '/sync/spools',
        json('POST', {}),
      );
      await load();
      spoolSync.value = result;
      const parts = [`新增 ${result.added} 卷`, `关联 ${result.linkedCount} 卷`];
      if (result.differences.length)
        parts.push(`克重差异 ${result.differences.length} 卷（本地数值未覆盖）`);
      if (result.warnings.length) parts.push(`提示 ${result.warnings.length} 条`);
      toast(`云端库存同步完成 · ${parts.join('，')}`);
    } catch (e) {
      await load();
      toast((e as Error).message);
    } finally {
      busy.value = false;
    }
  }
  return {
    data,
    loading,
    error,
    authRequired,
    notice,
    busy,
    reviewJob,
    spools,
    jobs,
    printers,
    transactions,
    spoolSync,
    load,
    toast,
    mutate,
    sync,
    syncSpools,
  };
});
