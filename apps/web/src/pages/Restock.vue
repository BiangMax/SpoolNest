<script setup lang="ts">
import { computed, ref } from 'vue';
import { useWorkspace } from '../lib/store';
import { weight, grams } from '../lib/format';
import type { RestockItem } from '../../../../packages/shared/src';
import PageHeading from '../components/PageHeading.vue';
import Modal from '../components/Modal.vue';
const store = useWorkspace(),
  filter = ref('needed'),
  editing = ref<RestockItem | null>(null),
  minimum = ref(''),
  busy = ref(false),
  error = ref('');
const shown = computed(() =>
  filter.value === 'needed'
    ? store.neededRestock
    : filter.value === 'ordered'
      ? store.restock.filter((row) => row.ordered)
      : store.restock,
);
function edit(row: RestockItem) {
  error.value = '';
  minimum.value = row.minimumMg === null ? '' : String(row.minimumMg / 1000);
  editing.value = row;
}
async function save(row: RestockItem, minimumMg: number | null, ordered: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await store.mutate(
      '/restock',
      {
        material: row.material,
        colorHex: row.colorHex,
        expectedVersion: row.version,
        minimumMg,
        ordered,
      },
      'PUT',
      '补货清单已更新',
    );
    editing.value = null;
  } catch (e) {
    error.value = (e as Error).message;
    await store.load();
    if ((e as { status?: number }).status === 409) editing.value = null;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <PageHeading
    title="补货清单"
    description="按材料和颜色汇总在库余量。同规格不同品牌合计，已下单的规格单独跟踪。"
  />
  <section class="panel">
    <div class="tabs">
      <button
        v-for="item in [
          { key: 'needed', title: '待补货', count: store.neededRestock.length },
          { key: 'ordered', title: '已下单', count: store.restock.filter((r) => r.ordered).length },
          { key: 'all', title: '全部规格', count: store.restock.length },
        ]"
        :key="item.key"
        :class="{ active: filter === item.key }"
        :aria-pressed="filter === item.key"
        @click="filter = item.key"
      >
        {{ item.title }} <span>{{ item.count }}</span>
      </button>
    </div>
    <p v-if="error && !editing" class="error-banner" role="alert">{{ error }}</p>
    <div
      v-for="row in shown"
      :key="JSON.stringify([row.material, row.colorHex])"
      class="restock-row"
    >
      <div class="grow">
        <strong
          ><i class="color-dot" :style="{ background: row.colorHex }" /> {{ row.material }} ·
          {{ row.colorName || row.colorHex }}</strong
        >
        <p class="muted">
          <template v-if="row.colorName">{{ row.colorHex }} · </template>在库 {{ row.count }} 卷 ·
          未开封 {{ row.sealed }} 卷
        </p>
      </div>
      <div>
        <strong>{{ weight(row.remainingMg) }}</strong>
        <p class="muted">最低备货 {{ grams(store.minimumFor(row)) }} g</p>
      </div>
      <div class="actions">
        <button class="button small" @click="edit(row)">设置最低量</button>
        <button
          v-if="row.ordered || row.remainingMg < store.minimumFor(row)"
          class="button small"
          :disabled="busy"
          @click="save(row, row.minimumMg, !row.ordered)"
        >
          {{ row.ordered ? '结束订单跟踪' : '标为已下单' }}
        </button>
      </div>
    </div>
    <p v-if="!shown.length" class="mini-empty">
      {{
        filter === 'needed'
          ? '当前没有待补货规格。可在「全部规格」设置最低备货量。'
          : filter === 'ordered'
            ? '还没有跟踪中的订单。'
            : '添加料卷后，可以在这里管理备货。'
      }}
    </p>
  </section>
  <Modal
    :open="!!editing"
    title="设置最低备货量"
    :description="editing?.material + ' · ' + editing?.colorHex"
    @update:open="
      (open) => {
        if (!open) editing = null;
      }
    "
  >
    <form
      v-if="editing"
      id="restock-minimum"
      @submit.prevent="
        save(editing, minimum === '' ? null : Math.round(Number(minimum) * 1000), editing.ordered)
      "
    >
      <label class="field"
        ><span>最低备货量（g）</span
        ><input
          v-model="minimum"
          type="number"
          min="0"
          max="1000000"
          step="0.001"
          :placeholder="'跟随工作室阈值 ' + grams(store.data?.settings.lowStockMg ?? 0) + ' g'"
        /><small>留空跟随工作室阈值，填 0 可关闭此规格的补货提醒。</small></label
      >
      <p v-if="error" class="error-banner">{{ error }}</p>
    </form>
    <template #footer
      ><button class="button primary" form="restock-minimum" :disabled="busy">
        保存
      </button></template
    >
  </Modal>
</template>
