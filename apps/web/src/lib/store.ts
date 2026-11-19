import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, json } from './api';
import type { Overview, Job, RestockItem } from '../../../../packages/shared/src';
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
  const restock = computed(() => data.value?.restock ?? []);
  const minimumFor = (row: RestockItem) => row.minimumMg ?? data.value?.settings.lowStockMg ?? 0;
  const neededRestock = computed(() =>
    restock.value
      .filter((row) => !row.ordered && row.remainingMg < minimumFor(row))
      .sort((a, b) => a.remainingMg - b.remainingMg),
  );
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
  const spoolSync = computed(() => data.value?.spoolComparison ?? null);
  const pendingDifferences = computed(() =>
    spoolSync.value
      ? spoolSync.value.differences.length + spoolSync.value.localOnly.filter((x) => !x.kept).length
      : 0,
  );
  const applyingCloudSpool = ref<string | null>(null),
    spoolSyncError = ref('');
  async function decideLocalSpool(
    d: NonNullable<typeof spoolSync.value>['localOnly'][number],
    decision: 'keep' | 'archive',
  ) {
    if (busy.value) return;
    busy.value = true;
    applyingCloudSpool.value = d.spoolId;
    spoolSyncError.value = '';
    try {
      await api(
        `/spools/${d.spoolId}/cloud-decision`,
        json('POST', {
          decision,
          comparisonId: spoolSync.value?.id,
          expectedVersion: d.expectedVersion,
        }),
      );
      await load();
      toast(
        decision === 'keep'
          ? '料卷已保留在库，后续对照会记住此决定'
          : '料卷已归档，历史和流水已保留，可在已归档库存恢复',
      );
    } catch (e) {
      spoolSyncError.value = (e as Error).message;
      await load();
    } finally {
      applyingCloudSpool.value = null;
      busy.value = false;
    }
  }
  async function applyCloudWeight(d: NonNullable<typeof spoolSync.value>['differences'][number]) {
    if (busy.value) return;
    busy.value = true;
    applyingCloudSpool.value = d.spoolId;
    spoolSyncError.value = '';
    try {
      await api(
        `/spools/${d.spoolId}/calibrate`,
        json('POST', {
          comparisonId: spoolSync.value?.id,
          remainingMg: d.cloudRemainingMg,
          expectedVersion: d.expectedVersion,
          source: 'cloud_report',
          notes: '用户确认采用云端库存对照重量（云端报告值，非称重实测）',
        }),
      );
      await load();
      toast('这一卷已同步云端重量，校准流水已保存');
    } catch (e) {
      spoolSyncError.value = `${d.label}：${(e as Error).message}。请重新读取云端库存后核对。`;
      await load();
    } finally {
      applyingCloudSpool.value = null;
      busy.value = false;
    }
  }
  async function syncSpools() {
    if (busy.value) return;
    busy.value = true;
    spoolSyncError.value = '';
    try {
      const result = await api<NonNullable<typeof spoolSync.value>>(
        '/sync/spools',
        json('POST', {}),
      );
      await load();

      const parts = [`新增 ${result.added} 卷`, `关联 ${result.linkedCount} 卷`];
      if (result.differences.length)
        parts.push(`克重差异 ${result.differences.length} 卷（库存余量未改动）`);
      if (result.warnings.length) parts.push(`提示 ${result.warnings.length} 条`);
      if (result.localOnly.some((s) => !s.kept))
        parts.push(`库存待处理 ${result.localOnly.filter((s) => !s.kept).length} 卷`);
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
    pendingDifferences,
    restock,
    minimumFor,
    neededRestock,
    applyingCloudSpool,
    spoolSyncError,
    applyCloudWeight,
    decideLocalSpool,
    load,
    toast,
    mutate,
    sync,
    syncSpools,
  };
});
