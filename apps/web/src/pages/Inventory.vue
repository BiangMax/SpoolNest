<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Plus,
  Search,
  SlidersHorizontal,
  Download,
  Upload,
  MapPin,
  ArrowUpDown,
  Boxes,
  Scale,
  History,
  Archive,
  ArrowRight,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { grams, weight, date, shortId, money } from '../lib/format';
import { download, api } from '../lib/api';
import { type Spool, transactionLabels } from '../../../../packages/shared/src';
import SpoolForm from '../components/SpoolForm.vue';
import SpoolIcon from '../components/SpoolIcon.vue';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
const store = useWorkspace(),
  route = useRoute(),
  search = ref(String(route.query.q || '')),
  material = ref(''),
  brand = ref(''),
  location = ref(''),
  status = ref('active'),
  color = ref(''),
  sort = ref('newest'),
  formOpen = ref(false),
  editing = ref<Spool | null>(null),
  detailId = ref<string | null>(null),
  csvInput = ref<HTMLInputElement | null>(null),
  importing = ref(false),
  calibration = ref<number | null>(null),
  reason = ref(''),
  calSource = ref('weighed'),
  error = ref(''),
  saving = ref(false);
watch(
  () => route.query.q,
  (q) => (search.value = String(q || '')),
);
const detail = computed(() => store.spools.find((s) => s.id === detailId.value));
const allWeight = computed(() =>
  store.spools.filter((s) => s.status !== 'archived').reduce((s, x) => s + x.remainingMg, 0),
);
const filtered = computed(() =>
  store.spools
    .filter(
      (s) =>
        (status.value === 'all' ||
          (status.value === 'active' ? s.status !== 'archived' : s.status === status.value)) &&
        (!material.value || s.product.material === material.value) &&
        (!brand.value || s.product.brand === brand.value) &&
        (!location.value || s.location === location.value) &&
        (!color.value || s.product.colorHex === color.value) &&
        `${s.id} ${s.product.brand} ${s.product.name} ${s.product.material} ${s.product.colorName} ${s.location}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .sort((a, b) =>
      sort.value === 'weight'
        ? a.remainingMg - b.remainingMg
        : sort.value === 'brand'
          ? a.product.brand.localeCompare(b.product.brand)
          : b.createdAt.localeCompare(a.createdAt),
    ),
);
function open(s: Spool) {
  detailId.value = s.id;
  calibration.value = s.remainingMg / 1000;
  reason.value = '';
  error.value = '';
}
async function calibrate() {
  if (!detail.value) return;
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      `/spools/${detail.value.id}/calibrate`,
      {
        remainingMg: Math.round(Number(calibration.value) * 1000),
        expectedVersion: detail.value.version,
        source: calSource.value,
        notes: reason.value,
      },
      'POST',
      '重量已校准，流水已保存',
    );
    reason.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function csv(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importing.value = true;
  try {
    const data = new FormData();
    data.append('file', file);
    const result = await api<{ created: number }>('/import/csv', { method: 'POST', body: data });
    await store.load();
    store.toast(`CSV 已导入 ${result.created} 卷耗材`);
  } catch (e) {
    store.toast((e as Error).message);
  } finally {
    importing.value = false;
    (event.target as HTMLInputElement).value = '';
  }
}
async function exportCsv() {
  try {
    await download('/export/spools.csv', 'spoolnest-spools.csv');
  } catch (e) {
    store.toast((e as Error).message);
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">YOUR FILAMENT LIBRARY</div>
      <h1>
        耗材库存<span class="heading-count">{{
          store.spools.filter((s) => s.status !== 'archived').length
        }}</span>
      </h1>
      <p>每一种色彩，每一卷余量，都井井有条。</p>
    </div>
    <div class="actions">
      <button class="button" @click="exportCsv"><Download :size="16" />导出</button
      ><button
        class="button primary"
        @click="
          editing = null;
          formOpen = true;
        "
      >
        <Plus :size="17" />添加耗材
      </button>
    </div>
  </div>
  <div class="inventory-summary">
    <span
      ><span class="status-dot purple" />可用库存 <strong>{{ weight(allWeight) }}</strong></span
    ><span
      >产品规格
      <strong
        >{{
          new Set(store.spools.filter((s) => s.status !== 'archived').map((s) => s.productId)).size
        }}
        种</strong
      ></span
    ><span
      >低库存
      <strong
        >{{
          store.spools.filter(
            (s) =>
              s.status !== 'archived' && s.remainingMg < (store.data?.settings.lowStockMg || 0),
          ).length
        }}
        卷</strong
      ></span
    ><button class="text-button" :disabled="importing" @click="csvInput?.click()">
      <Upload :size="14" />{{ importing ? '正在导入…' : 'CSV 批量导入' }}</button
    ><input ref="csvInput" type="file" accept=".csv" hidden @change="csv" />
  </div>
  <div class="toolbar">
    <div class="search-field">
      <Search :size="17" /><input
        v-model="search"
        placeholder="搜索品牌、材质、颜色或编号…"
        aria-label="搜索耗材"
      />
    </div>
    <select v-model="material" aria-label="按材质筛选">
      <option value="">所有材质</option>
      <option v-for="m in [...new Set(store.spools.map((s) => s.product.material))]" :key="m">
        {{ m }}
      </option></select
    ><select v-model="brand" aria-label="按品牌筛选">
      <option value="">所有品牌</option>
      <option v-for="b in [...new Set(store.spools.map((s) => s.product.brand))]" :key="b">
        {{ b }}
      </option></select
    ><select v-model="location" aria-label="按位置筛选">
      <option value="">所有位置</option>
      <option
        v-for="l in [...new Set(store.spools.map((s) => s.location))].filter(Boolean)"
        :key="l"
      >
        {{ l }}
      </option></select
    ><select v-model="color" aria-label="按颜色筛选">
      <option value="">所有颜色</option>
      <option v-for="c in [...new Set(store.spools.map((s) => s.product.colorHex))]" :key="c">
        {{ c }}
      </option></select
    ><select v-model="status" aria-label="库存状态">
      <option value="active">在库耗材</option>
      <option value="sealed">未开封</option>
      <option value="opened">已开封</option>
      <option value="empty">已用尽</option>
      <option value="archived">已归档</option>
      <option value="all">全部状态</option></select
    ><select v-model="sort" aria-label="库存排序">
      <option value="newest">最近添加</option>
      <option value="weight">余量从低到高</option>
      <option value="brand">品牌排序</option>
    </select>
  </div>
  <div v-if="filtered.length" class="spool-grid">
    <button v-for="s in filtered" :key="s.id" class="spool-card" @click="open(s)">
      <div class="spool-card-top">
        <span class="spool-brand">{{ s.product.brand }}</span><span
          class="badge"
          :class="
            s.status === 'sealed'
              ? 'neutral'
              : s.remainingMg < (store.data?.settings.lowStockMg || 0)
                ? 'warning'
                : 'subtle'
          "
          >{{
            s.status === 'sealed'
              ? '未开封'
              : s.status === 'archived'
                ? '已归档'
                : s.status === 'empty'
                  ? '已用尽'
                  : s.remainingMg < (store.data?.settings.lowStockMg || 0)
                    ? '余量偏低'
                    : '使用中'
          }}</span
        >
      </div>
      <div class="spool-art">
        <div class="spool-glow" :style="{ background: s.product.colorHex }" />
        <SpoolIcon :color="s.product.colorHex" :size="120" />
      </div>
      <h3>
        {{ s.product.material }} <span>{{ s.product.colorName || s.product.colorHex }}</span>
      </h3>
      <p class="spool-product">{{ s.product.name }}</p>
      <div class="spool-quantity">
        <strong>{{ grams(s.remainingMg) }}<span> g</span></strong
        ><span>/ {{ grams(s.product.netMg) }} g</span>
      </div>
      <div class="progress">
        <span
          :style="{
            width: Math.min(100, (s.remainingMg / s.product.netMg) * 100) + '%',
            background: s.product.colorHex,
          }"
        />
      </div>
      <div class="spool-card-bottom">
        <span><MapPin :size="13" />{{ s.location || '未设位置' }}</span
        ><span>{{ Math.round((s.remainingMg / s.product.netMg) * 100) }}%</span>
      </div>
      <div class="spool-id">
        #{{ shortId(s.id) }}<span v-if="s.installed.length" class="installed-dot">已安装</span>
      </div></button
    ><button
      class="add-spool-card"
      @click="
        editing = null;
        formOpen = true;
      "
    >
      <div><Plus :size="24" /></div>
      <strong>让新色彩加入仓库</strong><span>添加一卷耗材</span>
    </button>
  </div>
  <EmptyState
    v-else
    :title="store.spools.length ? '没有匹配的料卷' : '你的耗材仓库，从第一卷开始'"
    :description="
      store.spools.length
        ? '尝试调整筛选条件或搜索关键词。'
        : '添加品牌、颜色和当前余量。每一卷都将拥有独立的库存记录。'
    "
    ><button
      v-if="!store.spools.length"
      class="button primary"
      @click="
        editing = null;
        formOpen = true;
      "
    >
      <Plus :size="16" />添加第一卷耗材
    </button></EmptyState
  ><SpoolForm v-model:open="formOpen" :spool="editing" /><Modal
    :open="!!detail"
    title="料卷详情"
    description="查看料卷信息、校准重量及完整库存流水。"
    drawer
    @update:open="
      (v) => {
        if (!v) detailId = null;
      }
    "
    ><template v-if="detail"
      ><div class="spool-detail-hero">
        <SpoolIcon :color="detail.product.colorHex" :size="106" />
        <div>
          <span class="eyebrow">#{{ shortId(detail.id) }}</span>
          <h2>{{ detail.product.brand }} {{ detail.product.material }}</h2>
          <p>{{ detail.product.colorName }} · {{ detail.location || '位置未设置' }}</p>
          <strong class="big-weight">{{ grams(detail.remainingMg) }} <small>g</small></strong>
        </div>
      </div>
      <div class="detail-meta">
        <span
          >购入价格<strong>{{ money(detail.priceCents) }}</strong></span
        ><span
          >标称净重<strong>{{ grams(detail.product.netMg) }} g</strong></span
        ><span
          >安装位置<strong>{{ detail.installed.join(' / ') || '未安装' }}</strong></span
        >
      </div>
      <button
        class="button"
        @click="
          editing = detail;
          detailId = null;
          formOpen = true;
        "
      >
        编辑料卷 / 归档
      </button>
      <div class="form-section-title"><Scale :size="17" />校准重量</div>
      <form class="form-grid" @submit.prevent="calibrate">
        <label class="field"
          ><span>当前净剩余重量（g）</span
          ><input v-model.number="calibration" type="number" required min="0" step="0.001" /></label
        ><label class="field"
          ><span>调整来源</span
          ><select v-model="calSource">
            <option value="weighed">实际称重校准</option>
            <option value="manual">手动调整</option>
          </select></label
        ><label class="field full"
          ><span>调整原因 *</span
          ><input
            v-model="reason"
            required
            placeholder="例如：称重扣除空盘后的净重"
            maxlength="2000"
        /></label>
        <div v-if="error" class="error-banner full">{{ error }}</div>
        <div class="full"><button class="button" :disabled="saving">保存校准</button></div>
      </form>
      <div class="form-section-title"><History :size="17" />库存流水</div>
      <div class="ledger">
        <div
          v-for="t in store.transactions.filter((t) => t.spoolId === detail!.id)"
          :key="t.id"
          class="ledger-row"
        >
          <div>
            <strong>{{ transactionLabels[t.kind] }}</strong><small
              >{{ date(t.createdAt) }} · {{ t.jobName || t.notes }}</small
            >
          </div>
          <div>
            <strong :class="t.deltaMg < 0 ? 'danger-text' : 'success-text'"
              >{{ t.deltaMg > 0 ? '+' : '' }}{{ grams(t.deltaMg) }} g</strong
            ><small>{{ grams(t.beforeMg) }} → {{ grams(t.afterMg) }} g</small>
          </div>
        </div>
      </div></template
    ></Modal
  >
</template>
