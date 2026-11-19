<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowUpRight,
  ArrowRight,
  Layers3,
  Weight,
  Flame,
  Clock3,
  Printer,
  Box,
  CheckCheck,
  CalendarDays,
  ChevronRight,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { weight, grams, date, dayKey } from '../lib/format';
import { printLabels } from '../../../../packages/shared/src';
import PageHeading from '../components/PageHeading.vue';
import MetricCard from '../components/MetricCard.vue';
import SpoolIcon from '../components/SpoolIcon.vue';
import EmptyState from '../components/EmptyState.vue';
const store = useWorkspace(),
  router = useRouter();
const active = computed(() => store.spools.filter((s) => s.status !== 'archived')),
  remaining = computed(() => active.value.reduce((s, x) => s + x.remainingMg, 0)),
  pending = computed(() =>
    store.jobs.filter((j) => ['pending', 'awaiting_data', 'error'].includes(j.reviewStatus)),
  );
const month = computed(() => {
  const month = dayKey(new Date().toISOString(), store.data?.settings.timezone).slice(0, 7);
  return -store.transactions
    .filter((t) => t.jobId && dayKey(t.createdAt, store.data?.settings.timezone).startsWith(month))
    .reduce((sum, t) => sum + t.deltaMg, 0);
});
const materials = computed(() => {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const s of active.value) {
    const group = map.get(s.product.material) || { name: s.product.material, amount: 0, count: 0 };
    group.amount += s.remainingMg;
    group.count++;
    map.set(s.product.material, group);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
});
const chartColor = (index: number) => `var(--chart-${(index % 6) + 1})`;
const distribution = computed(() => {
  if (!remaining.value) return 'var(--rail-border)';
  let offset = 0;
  const segments = materials.value.map((m, i) => {
    const start = offset;
    offset += (m.amount / remaining.value) * 100;
    return `${chartColor(i)} ${start}% ${offset}%`;
  });
  return `conic-gradient(${segments.join(', ')})`;
});
const greeting = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: store.data?.settings.timezone || 'Asia/Shanghai',
  }).format(new Date()),
);
</script>
<template>
  <PageHeading title="工作室一览">
    <template #meta
      ><div class="overview-date"><CalendarDays :size="15" />{{ greeting }}</div></template
    >
    <button class="button" @click="router.push('/jobs')"><Box :size="16" />查看打印任务</button>
    <button class="button primary" @click="router.push('/inventory')">
      <Layers3 :size="16" />管理耗材
    </button>
  </PageHeading>
  <RouterLink v-if="store.spoolSync" class="comparison-link" to="/settings#comparison">
    <div class="grow">
      <strong
        >库存对照 ·
        {{
          store.pendingDifferences ? store.pendingDifferences + ' 卷待处理' : '已处理完毕'
        }}</strong
      ><small>最近对照 {{ date(store.spoolSync.comparedAt, store.data?.settings.timezone) }}</small>
    </div>
    {{ store.pendingDifferences ? '继续处理' : '查看结果' }} <ArrowRight :size="16" />
  </RouterLink>
  <div class="stat-grid">
    <MetricCard
      label="在库耗材"
      :icon="Layers3"
      :value="active.length"
      unit="卷"
      :note="`${new Set(active.map((s) => s.product.brand)).size} 个品牌 · ${materials.length} 种材料`"
    />
    <MetricCard
      label="剩余总重量"
      :icon="Weight"
      :value="remaining >= 1000000 ? (remaining / 1000000).toFixed(2) : grams(remaining)"
      :unit="remaining >= 1000000 ? 'kg' : 'g'"
      note="全部在库料卷余量"
    />
    <MetricCard
      label="本月已消耗"
      :icon="Flame"
      :value="grams(month)"
      unit="g"
      note="含更正与撤销流水"
    />
    <MetricCard
      class="highlighted"
      label="待核对任务"
      :icon="Clock3"
      :value="pending.length"
      unit="项"
    >
      <RouterLink class="stat-link" to="/jobs">查看任务<ArrowRight :size="14" /></RouterLink>
    </MetricCard>
  </div>
  <div class="dashboard-grid">
    <div class="dashboard-column">
      <section class="panel pending-panel">
        <div class="panel-heading">
          <div>
            <h2>
              待核对任务<span class="heading-count">{{ pending.length }}</span>
            </h2>
            <p>选择实际使用的料卷，完成库存更新。</p>
          </div>
          <RouterLink to="/jobs" class="text-link">全部任务<ArrowUpRight :size="15" /></RouterLink>
        </div>
        <div v-if="pending.length" class="pending-list">
          <div v-for="j in pending.slice(0, 4)" :key="j.id" class="pending-row">
            <div class="model-thumbnail">
              <img
                v-if="j.thumbnail"
                :src="j.thumbnail"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              /><Box v-else :size="24" stroke-width="1.5" />
            </div>
            <div class="grow">
              <strong>{{ j.name }}</strong><small
                >{{ j.printerName || '设备未关联' }} <span>·</span>
                {{ date(j.startedAt, store.data?.settings.timezone) }}</small
              >
              <div class="inline-meta material-chips">
                <span v-for="m in j.materials" :key="m.id"
                  ><i class="color-dot" :style="{ background: m.colorHex || '#ccc' }" />{{
                    m.material || '待确认'
                  }}
                  <b>{{ m.suggestedMg === null ? '?' : grams(m.suggestedMg) }}g</b></span
                >
              </div>
            </div>
            <button class="button small review-button" @click="store.reviewJob = j">
              核对耗材<ArrowRight :size="14" />
            </button>
          </div>
        </div>
        <EmptyState
          :icon="CheckCheck"
          v-else
          :title="store.jobs.length ? '全部核对完成' : '尚无打印任务'"
          :description="
            store.jobs.length
              ? '已核对的耗材用量可在打印记录中查看。'
              : '导入切片文件或手动新增任务，再核对实际使用的料卷。'
          "
          ><RouterLink to="/jobs" class="button small"
            >{{ store.jobs.length ? '查看打印记录' : '添加打印任务'
            }}<ArrowRight :size="14" /></RouterLink
        ></EmptyState>
        <div class="panel-note"><CheckCheck :size="15" />只有你确认后，库存才会变化。</div>
      </section>
      <section class="panel recent-panel">
        <div class="panel-heading">
          <div>
            <h2>最近打印</h2>
            <p>最近添加的五项打印任务</p>
          </div>
          <RouterLink to="/jobs" class="text-link">查看全部<ArrowUpRight :size="15" /></RouterLink>
        </div>
        <div v-if="store.jobs.length" class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>任务名称</th>
                <th>打印机</th>
                <th>打印结果</th>
                <th class="align-right">报告用量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="j in store.jobs.slice(0, 5)" :key="j.id">
                <td>
                  <strong>{{ j.name }}</strong><small>{{
                    date(j.startedAt, store.data?.settings.timezone)
                  }}</small>
                </td>
                <td>{{ j.printerName || '—' }}</td>
                <td>
                  <span
                    class="badge"
                    :class="j.printStatus === 'completed' ? 'success' : 'neutral'"
                    >{{ printLabels[j.printStatus] }}</span
                  >
                </td>
                <td class="align-right">
                  {{ j.totalMg === null ? '待补充' : grams(j.totalMg) + ' g' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="mini-empty">
          <Box :size="25" />
          <p>还没有打印任务。</p>
        </div>
      </section>
    </div>
    <div class="dashboard-column">
      <section class="panel distribution-panel">
        <div class="panel-heading">
          <div>
            <h2>库存分布</h2>
            <p>按材料类型 · 剩余重量</p>
          </div>
          <Layers3 :size="18" class="muted" />
        </div>
        <div class="composition">
          <div class="material-ring" :style="{ background: distribution }">
            <div>
              <small>总余量</small><strong>{{ weight(remaining) }}</strong>
            </div>
          </div>
          <div v-if="materials.length" class="material-legend">
            <div v-for="(m, i) in materials" :key="m.name">
              <i class="legend-dot" :style="{ background: chartColor(i) }" />
              <span
                ><strong>{{ m.name }}</strong
                ><small>{{ m.count }} 卷</small></span
              >
              <b>{{ weight(m.amount) }}</b>
            </div>
          </div>
          <p v-else class="composition-empty">添加第一卷耗材后，可查看各类材料的剩余重量。</p>
        </div>
        <RouterLink to="/analytics" class="panel-bottom-link"
          >探索更多统计<ArrowRight :size="15"
        /></RouterLink>
      </section>
      <section class="panel low-panel">
        <div class="panel-heading">
          <div>
            <h2>
              待补货 <span class="heading-count">{{ store.neededRestock.length }}</span>
            </h2>
            <p>合计余量低于最低备货量的材料和颜色</p>
          </div>
          <RouterLink class="text-link" to="/restock"
            >补货清单 <ArrowRight :size="14"
          /></RouterLink>
        </div>
        <div v-if="store.neededRestock.length" class="low-list">
          <RouterLink
            v-for="s in store.neededRestock.slice(0, 4)"
            :key="s.material + s.colorHex"
            to="/restock"
            ><SpoolIcon :color="s.colorHex" :size="49" />
            <div class="grow">
              <strong>{{ s.material }}</strong><small>{{ s.colorName || s.colorHex }}</small>
            </div>
            <strong class="warning-text"
              >{{ grams(s.remainingMg) }}<small> g</small></strong
            ></RouterLink
          >
        </div>
        <div v-else class="mini-empty">
          <CheckCheck :size="26" class="success-text" />
          <p>
            {{ active.length ? '当前没有待补货规格。' : '添加料卷后，可按材料和颜色跟踪备货。' }}
          </p>
        </div>
      </section>
    </div>
  </div>
  <section class="device-strip">
    <div>
      <Printer :size="21" /><strong>打印设备</strong
      ><span>{{ store.printers.length }} 台已添加</span>
    </div>
    <template v-if="store.printers.length"
      ><RouterLink v-for="p in store.printers" :key="p.id" to="/printers" class="device-pill"
        ><span class="status-dot gray" /><strong>{{ p.name }}</strong
        ><span>{{ p.lastSyncAt ? '最近同步 ' + date(p.lastSyncAt) : '状态未验证' }}</span
        ><ChevronRight :size="14" /></RouterLink></template
    ><RouterLink v-else to="/printers" class="text-link"
      >添加 A1 mini、X2D 或其他设备<ArrowRight :size="15"
    /></RouterLink>
  </section>
</template>
