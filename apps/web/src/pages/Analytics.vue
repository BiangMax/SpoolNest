<script setup lang="ts">
import { computed } from 'vue';
import { z } from 'zod';
import { ChartNoAxesCombined, ArrowDownRight, Coins, Scale, CalendarDays } from 'lucide-vue-next';
import MetricCard from '../components/MetricCard.vue';
import PageHeading from '../components/PageHeading.vue';
import { useWorkspace } from '../lib/store';
import { useViewPreference } from '../lib/view-preferences';
import { grams, weight, money, dayKey, date, shortId } from '../lib/format';
import { type Transaction, transactionLabels } from '../../../../packages/shared/src';
import EmptyState from '../components/EmptyState.vue';
const store = useWorkspace(),
  dimension = useViewPreference(
    'analytics.dimension',
    z
      .enum(['material', 'brand', 'printer', 'color', 'spool', 'day', 'week', 'month', 'year'])
      .catch('material'),
  ),
  from = useViewPreference('analytics.from', z.iso.date().catch('')),
  to = useViewPreference('analytics.to', z.iso.date().catch(''));
const records = computed(() =>
  store.transactions.filter(
    (t) =>
      t.jobId &&
      (!from.value || dayKey(t.createdAt, store.data?.settings.timezone) >= from.value) &&
      (!to.value || dayKey(t.createdAt, store.data?.settings.timezone) <= to.value),
  ),
);
const total = computed(() => -records.value.reduce((s, t) => s + t.deltaMg, 0));
const cost = computed(() =>
  records.value.some((t) => t.costCents === null)
    ? null
    : records.value.reduce((s, t) => s + (t.costCents || 0), 0),
);
function key(t: Transaction) {
  const day = dayKey(t.createdAt, store.data?.settings.timezone);
  if (dimension.value === 'day') return day;
  if (dimension.value === 'month') return day.slice(0, 7);
  if (dimension.value === 'year') return day.slice(0, 4);
  if (dimension.value === 'week') {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10) + ' 周';
  }
  if (dimension.value === 'brand') return t.brand;
  if (dimension.value === 'printer') return t.printerName || '未关联打印机';
  if (dimension.value === 'color') return t.colorHex;
  if (dimension.value === 'spool') return `${t.brand} ${t.material} #${shortId(t.spoolId)}`;
  return t.material;
}
const groups = computed(() => {
  const map = new Map<string, { label: string; mg: number; cost: number | null; count: number }>();
  for (const t of records.value) {
    const label = key(t),
      g = map.get(label) || { label, mg: 0, cost: 0, count: 0 };
    g.mg -= t.deltaMg;
    g.cost = g.cost === null || t.costCents === null ? null : g.cost + t.costCents;
    g.count++;
    map.set(label, g);
  }
  return [...map.values()].sort((a, b) =>
    ['day', 'week', 'month', 'year'].includes(dimension.value)
      ? a.label.localeCompare(b.label)
      : b.mg - a.mg,
  );
});
const max = computed(() => Math.max(1, ...groups.value.map((g) => Math.abs(g.mg))));
const jobCosts = computed(() => {
  const ids = new Set(records.value.map((t) => t.jobId));
  return store.jobs
    .filter((j) => ids.has(j.id))
    .map((j) => {
      const ts = records.value.filter((t) => t.jobId === j.id);
      return {
        job: j,
        mg: -ts.reduce((s, t) => s + t.deltaMg, 0),
        cost: ts.some((t) => t.costCents === null)
          ? null
          : ts.reduce((s, t) => s + (t.costCents || 0), 0),
      };
    });
});
</script>
<template>
  <PageHeading title="数据统计" description="按记账时间查看耗材净消耗与材料成本。">
    <div class="date-range">
      <CalendarDays :size="16" /><input v-model="from" type="date" aria-label="统计开始日期" /><span
        >—</span
      ><input v-model="to" type="date" aria-label="统计结束日期" />
    </div>
  </PageHeading>
  <div class="stat-grid three">
    <MetricCard
      label="净打印消耗"
      :icon="Scale"
      :value="grams(total)"
      unit="g"
      note="已减去撤销和更正恢复"
    />
    <MetricCard
      label="耗材成本"
      :icon="Coins"
      :value="cost === null ? '数据不完整' : money(cost)"
      :note="cost === null ? '部分料卷未记录购买价格' : '按消耗时的单价快照计算'"
    />
    <MetricCard
      label="涉及打印任务"
      :icon="ChartNoAxesCombined"
      :value="jobCosts.length"
      unit="项"
      note="所选时间范围内有库存流水"
    />
  </div>
  <section class="panel analytics-panel">
    <div class="panel-heading">
      <div>
        <h2>耗材消耗分析</h2>
        <p>统计按记账时间归属，撤销可能产生负净消耗。</p>
      </div>
      <select v-model="dimension" aria-label="统计维度">
        <option value="material">按材料</option>
        <option value="brand">按品牌</option>
        <option value="printer">按打印机</option>
        <option value="color">按颜色</option>
        <option value="spool">按实体料卷</option>
        <option value="day">按天</option>
        <option value="week">按周</option>
        <option value="month">按月</option>
        <option value="year">按年份</option>
      </select>
    </div>
    <div v-if="groups.length" class="bar-chart">
      <div
        v-for="(g, i) in groups"
        :key="g.label"
        class="chart-row"
        :title="`${g.label}：${grams(g.mg)} g，${g.cost === null ? '成本数据缺失' : money(g.cost)}`"
      >
        <span class="chart-label"
          ><i v-if="dimension === 'color'" class="color-dot" :style="{ background: g.label }" />{{
            g.label
          }}</span
        >
        <div class="chart-track">
          <div
            :style="{
              width: (Math.abs(g.mg) / max) * 100 + '%',
              background:
                g.mg < 0
                  ? 'var(--success)'
                  : dimension === 'color'
                    ? g.label
                    : i % 2
                      ? 'var(--chart-2)'
                      : 'var(--accent)',
            }"
          />
        </div>
        <strong>{{ grams(g.mg) }} g</strong
        ><small>{{ g.cost === null ? '成本缺失' : money(g.cost) }}</small>
      </div>
    </div>
    <EmptyState
      :icon="ChartNoAxesCombined"
      v-else
      title="让数据跟着真实打印积累"
      description="核对第一项打印任务后，这里会呈现消耗与成本。未核对的建议重量不计入统计。"
    />
  </section>
  <section class="panel">
    <div class="panel-heading">
      <div>
        <h2>任务材料成本</h2>
        <p>消耗克数 ÷ 标称净重 × 单卷购入价格</p>
      </div>
    </div>
    <div v-if="jobCosts.length" class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>打印任务</th>
            <th>打印机</th>
            <th>净消耗</th>
            <th class="align-right">材料成本</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="j in jobCosts" :key="j.job.id">
            <td>
              <strong>{{ j.job.name }}</strong><small>{{
                date(j.job.startedAt, store.data?.settings.timezone)
              }}</small>
            </td>
            <td>{{ j.job.printerName || '—' }}</td>
            <td>{{ grams(j.mg) }} g</td>
            <td class="align-right">
              <span :class="j.cost === null ? 'warning-text' : ''">{{
                j.cost === null ? '价格数据缺失' : money(j.cost)
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="mini-empty"><p>还没有可计算成本的库存核对记录。</p></div>
  </section>
</template>
