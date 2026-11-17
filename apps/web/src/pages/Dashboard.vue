<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  Plus,
  ArrowUpRight,
  ArrowRight,
  Layers3,
  Weight,
  Flame,
  Clock3,
  Printer,
  Box,
  CheckCheck,
  Sparkles,
  ChevronRight,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { weight, grams, date, dayKey } from '../lib/format';
import { printLabels } from '../../../../packages/shared/src';
import SpoolIcon from '../components/SpoolIcon.vue';
import EmptyState from '../components/EmptyState.vue';
const store = useWorkspace(),
  router = useRouter();
const active = computed(() => store.spools.filter((s) => s.status !== 'archived')),
  remaining = computed(() => active.value.reduce((s, x) => s + x.remainingMg, 0)),
  pending = computed(() =>
    store.jobs.filter((j) => ['pending', 'awaiting_data', 'error'].includes(j.reviewStatus)),
  ),
  low = computed(() =>
    active.value
      .filter((s) => s.remainingMg < (store.data?.settings.lowStockMg || 0))
      .sort((a, b) => a.remainingMg - b.remainingMg),
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
const palette = ['#7567e9', '#67b7aa', '#e9b36b', '#8bade1', '#d487a9', '#a4afbd'];
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
  <div class="page-heading">
    <div>
      <div class="eyebrow">{{ greeting }}</div>
      <h1>工作室一览<span class="greeting-dot" /></h1>
      <p>让每一卷耗材，都用在恰到好处的地方。</p>
    </div>
    <div class="actions">
      <button class="button" @click="router.push('/jobs')"><Box :size="16" />查看打印任务</button
      ><button class="button primary" @click="router.push('/inventory')">
        <Plus :size="17" />管理耗材
      </button>
    </div>
  </div>
  <div class="stat-grid">
    <div class="stat-card">
      <span>在库耗材<Layers3 :size="18" /></span
      ><strong>{{ active.length }}<small>卷</small></strong>
      <div class="stat-foot">
        {{ new Set(active.map((s) => s.product.brand)).size }} 个品牌 <span>·</span>
        {{ new Set(active.map((s) => s.product.material)).size }} 种材料
      </div>
    </div>
    <div class="stat-card">
      <span>剩余总重量<Weight :size="18" /></span
      ><strong
        >{{ remaining >= 1000000 ? (remaining / 1000000).toFixed(2) : grams(remaining)
        }}<small>{{ remaining >= 1000000 ? 'kg' : 'g' }}</small></strong
      >
      <div class="stat-foot">来自每卷独立库存记录</div>
    </div>
    <div class="stat-card">
      <span>本月已消耗<Flame :size="18" /></span><strong>{{ grams(month) }}<small>g</small></strong>
      <div class="stat-foot">已核对流水 · 含更正与恢复</div>
    </div>
    <div class="stat-card highlighted">
      <span>待核对任务<Clock3 :size="18" /></span
      ><strong>{{ pending.length }}<small>项</small></strong
      ><button class="stat-link" @click="router.push('/jobs')">
        {{ pending.length ? '为打印补上最后一步' : '库存记录已是最新' }}<ArrowRight :size="15" />
      </button>
    </div>
  </div>
  <div class="dashboard-grid">
    <section class="panel pending-panel">
      <div class="panel-heading">
        <div>
          <h2>
            <span class="section-marker" />待核对任务<span class="heading-count">{{
              pending.length
            }}</span>
          </h2>
          <p>选择实际使用的料卷，完成库存更新。</p>
        </div>
        <RouterLink to="/jobs" class="text-link">全部任务<ArrowUpRight :size="15" /></RouterLink>
      </div>
      <div v-if="pending.length" class="pending-list">
        <div v-for="j in pending.slice(0, 4)" :key="j.id" class="pending-row">
          <div class="model-thumbnail"><Box :size="26" stroke-width="1.3" /></div>
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
        v-else
        :title="store.jobs.length ? '全部核对完成' : '准备好记录第一次打印了吗？'"
        :description="
          store.jobs.length
            ? '所有库存变化都已记录。继续创造你的下一个作品。'
            : '导入切片文件或手动新增任务，再核对实际使用的料卷。'
        "
        ><RouterLink to="/jobs" class="button small"
          >{{ store.jobs.length ? '查看打印记录' : '添加打印任务'
          }}<ArrowRight :size="14" /></RouterLink
      ></EmptyState>
      <div class="panel-note"><CheckCheck :size="15" />只有你确认后，库存才会变化。</div>
    </section>
    <section class="panel distribution-panel">
      <div class="panel-heading">
        <div>
          <h2>库存分布</h2>
          <p>按材料类型 · 剩余重量</p>
        </div>
        <Layers3 :size="18" class="muted" />
      </div>
      <template v-if="materials.length"
        ><div class="distribution-total">
          <span>总余量</span><strong>{{ weight(remaining) }}</strong>
        </div>
        <div class="segmented-bar">
          <span
            v-for="(m, i) in materials"
            :key="m.name"
            :style="{ flex: remaining ? m.amount : 1, background: palette[i % palette.length] }"
            :title="`${m.name} ${weight(m.amount)}`"
          />
        </div>
        <div class="material-legend">
          <div v-for="(m, i) in materials" :key="m.name">
            <span
              class="legend-dot"
              :style="{ background: palette[i % palette.length] }"
            /><strong>{{ m.name }}</strong
            ><small>{{ m.count }} 卷</small><b>{{ weight(m.amount) }}</b>
          </div>
        </div></template
      >
      <div v-else class="distribution-empty">
        <div class="empty-ring"><Layers3 :size="25" /></div>
        <strong>等待你的第一卷耗材</strong>
        <p>录入库存后，这里将展现材料分布。</p>
      </div>
      <RouterLink to="/analytics" class="panel-bottom-link"
        >探索更多统计<ArrowRight :size="15"
      /></RouterLink>
    </section>
    <section class="panel recent-panel">
      <div class="panel-heading">
        <div>
          <h2>最近打印</h2>
          <p>工作室的创作足迹</p>
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
        <p>还没有打印记录，你的下一件作品值得被记录。</p>
      </div>
    </section>
    <section class="panel low-panel">
      <div class="panel-heading">
        <div>
          <h2>
            低库存提醒 <span class="heading-count">{{ low.length }}</span>
          </h2>
          <p>低于 {{ grams(store.data?.settings.lowStockMg || 0) }} g 的实体料卷</p>
        </div>
        <span class="status-dot amber" />
      </div>
      <div v-if="low.length" class="low-list">
        <RouterLink
          v-for="s in low.slice(0, 4)"
          :key="s.id"
          :to="{ path: '/inventory', query: { q: s.id } }"
          ><SpoolIcon :color="s.product.colorHex" :size="49" />
          <div class="grow">
            <strong>{{ s.product.brand }} {{ s.product.material }}</strong
            ><small>{{ s.product.colorName || s.product.colorHex }}</small>
          </div>
          <strong class="warning-text"
            >{{ grams(s.remainingMg) }}<small> g</small></strong
          ></RouterLink
        >
      </div>
      <div v-else class="mini-empty">
        <CheckCheck :size="26" class="success-text" />
        <p>{{ active.length ? '所有料卷余量充足。' : '添加耗材后，系统会关注每一卷的余量。' }}</p>
      </div>
    </section>
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
