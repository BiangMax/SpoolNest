<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { z } from 'zod';
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
  ChevronDown,
} from 'lucide-vue-next';
import PageHeading from '../components/PageHeading.vue';
import { useWorkspace } from '../lib/store';
import { useViewPreference } from '../lib/view-preferences';
import { grams, weight, date, shortId, money } from '../lib/format';
import { download, api } from '../lib/api';
import { type Spool, transactionLabels } from '../../../../packages/shared/src';
import SpoolForm from '../components/SpoolForm.vue';
import SpoolIcon from '../components/SpoolIcon.vue';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import ColorFilter from '../components/ColorFilter.vue';
const store = useWorkspace(),
  route = useRoute(),
  router = useRouter(),
  savedSearch = useViewPreference('inventory.search', z.string().catch('')),
  material = useViewPreference('inventory.material', z.string().catch('')),
  brand = useViewPreference('inventory.brand', z.string().catch('')),
  status = useViewPreference(
    'inventory.status',
    z.enum(['active', 'sealed', 'opened', 'empty', 'archived', 'all']).catch('active'),
  ),
  color = useViewPreference('inventory.color', z.string().catch('')),
  sort = useViewPreference(
    'inventory.sort',
    z.enum(['newest', 'changed', 'weight', 'brand']).catch('newest'),
  ),
  grouping = useViewPreference('inventory.grouping', z.enum(['brand', 'none']).catch('brand')),
  collapsedBrands = useViewPreference('inventory.collapsed-brands', z.array(z.string()).catch([])),
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
const linkedSearch = computed(() => (typeof route.query.q === 'string' ? route.query.q : null));
const search = computed({
  get: () => linkedSearch.value ?? savedSearch.value,
  set: (value: string) => {
    savedSearch.value = value;
    if (linkedSearch.value !== null) {
      const query = { ...route.query };
      delete query.q;
      void router.replace({ query });
    }
  },
});
const linkedSpool = computed(() => store.spools.find((spool) => spool.id === linkedSearch.value));
watch(
  linkedSearch,
  (value) => {
    if (value !== null && !linkedSpool.value) savedSearch.value = value;
  },
  { immediate: true },
);
const materials = computed(() => [...new Set(store.spools.map((s) => s.product.material))]);
const brands = computed(() => [...new Set(store.spools.map((s) => s.product.brand))]);
const colors = computed(() => [...new Set(store.spools.map((s) => s.product.colorHex))]);
watch(
  [materials, brands, colors],
  ([materials, brands, colors]) => {
    if (!materials.includes(material.value)) material.value = '';
    if (!brands.includes(brand.value)) brand.value = '';
    if (!colors.includes(color.value)) color.value = '';
  },
  { immediate: true },
);
const detail = computed(() => store.spools.find((s) => s.id === detailId.value));
const allWeight = computed(() =>
  store.spools.filter((s) => s.status !== 'archived').reduce((s, x) => s + x.remainingMg, 0),
);
const groupedByBrand = computed(() => grouping.value === 'brand' && sort.value !== 'changed');
const historicalChanges = computed(() => {
  const latest = new Map<string, string>();
  for (const transaction of store.transactions) {
    if (transaction.deltaMg === 0 && transaction.kind !== 'initial') continue;
    if (transaction.createdAt > (latest.get(transaction.spoolId) ?? ''))
      latest.set(transaction.spoolId, transaction.createdAt);
  }
  return latest;
});
function compareLatestChange(a: Spool, b: Spool) {
  const aBatch = a.lastChangeBatch ?? 0;
  const bBatch = b.lastChangeBatch ?? 0;
  if (aBatch !== bBatch) return bBatch - aBatch;
  if (aBatch === 0) {
    const aTime = historicalChanges.value.get(a.id) ?? a.createdAt;
    const bTime = historicalChanges.value.get(b.id) ?? b.createdAt;
    if (aTime !== bTime) return bTime.localeCompare(aTime);
  }
  return a.remainingMg - b.remainingMg || a.id.localeCompare(b.id);
}
const filtered = computed(() => {
  if (linkedSpool.value) return [linkedSpool.value];
  return store.spools
    .filter(
      (s) =>
        (status.value === 'all' ||
          (status.value === 'active' ? s.status !== 'archived' : s.status === status.value)) &&
        (!material.value || s.product.material === material.value) &&
        (!brand.value || s.product.brand === brand.value) &&
        (!color.value || s.product.colorHex === color.value) &&
        `${s.id} ${s.product.brand} ${s.product.name} ${s.product.material} ${s.product.colorName} ${s.location}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort.value === 'changed') return compareLatestChange(a, b);
      if (sort.value === 'weight') return a.remainingMg - b.remainingMg;
      if (sort.value === 'brand') return a.product.brand.localeCompare(b.product.brand);
      return b.createdAt.localeCompare(a.createdAt);
    });
});
const groups = computed(() => {
  if (!groupedByBrand.value || linkedSpool.value)
    return [{ brand: '', spools: filtered.value, remainingMg: 0 }];
  const byBrand = new Map<string, { brand: string; spools: Spool[]; remainingMg: number }>();
  for (const spool of filtered.value) {
    const key = spool.product.brand;
    let group = byBrand.get(key);
    if (!group) {
      group = { brand: key, spools: [], remainingMg: 0 };
      byBrand.set(key, group);
    }
    group.spools.push(spool);
    group.remainingMg += spool.remainingMg;
  }
  return [...byBrand.values()].sort((a, b) => a.brand.localeCompare(b.brand, 'zh-CN'));
});
function toggleBrand(brand: string) {
  collapsedBrands.value = collapsedBrands.value.includes(brand)
    ? collapsedBrands.value.filter((saved) => saved !== brand)
    : [...collapsedBrands.value, brand];
}
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
  <PageHeading
    title="耗材库存"
    description="按品牌、材料和颜色查找实体料卷。"
    :count="store.spools.filter((s) => s.status !== 'archived').length"
  >
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
  </PageHeading>
  <section class="inventory-controls" aria-label="库存概况与筛选">
    <div class="inventory-summary">
      <span
        ><span class="status-dot purple" />可用库存 <strong>{{ weight(allWeight) }}</strong></span
      ><span
        >产品规格
        <strong
          >{{
            new Set(store.spools.filter((s) => s.status !== 'archived').map((s) => s.productId))
              .size
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
        <option v-for="m in materials" :key="m" :value="m">
          {{ m }}
        </option></select
      ><select v-model="brand" aria-label="按品牌筛选">
        <option value="">所有品牌</option>
        <option v-for="b in brands" :key="b" :value="b">
          {{ b }}
        </option>
      </select>
      <ColorFilter v-model="color" :colors="colors" />
      <select v-model="status" aria-label="库存状态">
        <option value="active">在库耗材</option>
        <option value="sealed">未开封</option>
        <option value="opened">已开封</option>
        <option value="empty">已用尽</option>
        <option value="archived">已归档</option>
        <option value="all">全部状态</option></select
      ><select v-model="sort" aria-label="库存排序">
        <option value="newest">最近添加</option>
        <option value="changed">最新变动</option>
        <option value="weight">余量从低到高</option>
        <option value="brand">品牌排序</option>
      </select>
      <button
        type="button"
        class="brand-group-switch"
        role="switch"
        :aria-checked="groupedByBrand"
        :disabled="sort === 'changed'"
        :title="sort === 'changed' ? '最新变动按所有品牌一起排序' : undefined"
        @click="grouping = grouping === 'brand' ? 'none' : 'brand'"
      >
        <Boxes :size="14" aria-hidden="true" />按品牌分组
        <span class="brand-group-indicator" aria-hidden="true" />
      </button>
    </div>
  </section>
  <div v-if="filtered.length" class="inventory-groups">
    <section v-for="group in groups" :key="group.brand" class="inventory-group">
      <h2 v-if="groupedByBrand && !linkedSpool" class="inventory-group-heading">
        <button
          class="inventory-group-toggle"
          :aria-expanded="!collapsedBrands.includes(group.brand)"
          :aria-controls="`brand-spools-${encodeURIComponent(group.brand)}`"
          @click="toggleBrand(group.brand)"
        >
          <ChevronDown :size="18" :class="{ collapsed: collapsedBrands.includes(group.brand) }" />
          <span class="inventory-group-name">{{ group.brand || '未填写品牌' }}</span>
          <span class="badge neutral">{{ group.spools.length }} 卷</span>
          <span class="inventory-group-weight">剩余 {{ weight(group.remainingMg) }}</span>
        </button>
      </h2>
      <div
        v-show="!groupedByBrand || linkedSpool || !collapsedBrands.includes(group.brand)"
        :id="`brand-spools-${encodeURIComponent(group.brand)}`"
        class="spool-grid"
      >
        <button v-for="s in group.spools" :key="s.id" class="spool-card" @click="open(s)">
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
          <div class="spool-overview">
            <div class="spool-art" :style="{ '--filament': s.product.colorHex }">
              <SpoolIcon :color="s.product.colorHex" :size="74" />
            </div>
            <div class="spool-spec">
              <h3>
                {{ s.product.material }}
                <span>{{ s.product.colorName || s.product.colorHex }}</span>
              </h3>
              <p class="spool-product">{{ s.product.name }}</p>
              <div class="spool-quantity">
                <strong>{{ grams(s.remainingMg) }}<span> g</span></strong
                ><span>/ {{ grams(s.product.netMg) }} g</span>
              </div>
            </div>
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
          v-if="!groupedByBrand"
          class="add-spool-card"
          @click="
            editing = null;
            formOpen = true;
          "
        >
          <div><Plus :size="24" /></div>
          <strong>添加一卷耗材</strong>
        </button>
      </div>
    </section>
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
