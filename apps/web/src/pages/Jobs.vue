<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Plus,
  Upload,
  RefreshCw,
  Search,
  Box,
  ArrowRight,
  CheckCheck,
  Clock3,
  Undo2,
  Copy,
  Info,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { date, grams, shortId, dayKey } from '../lib/format';
import { api } from '../lib/api';
import { printLabels, reviewLabels, sourceLabels, type Job } from '../../../../packages/shared/src';
import JobForm from '../components/JobForm.vue';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
const store = useWorkspace(),
  formOpen = ref(false),
  search = ref(''),
  review = ref('all'),
  printer = ref(''),
  status = ref(''),
  source = ref(''),
  material = ref(''),
  from = ref(''),
  to = ref(''),
  importOpen = ref(false),
  importPrinter = ref(''),
  importFile = ref<File | null>(null),
  importing = ref(false),
  error = ref(''),
  details = ref<Job | null>(null),
  undoJob = ref<Job | null>(null),
  saving = ref(false),
  newStatus = ref('unknown');
const filtered = computed(() =>
  store.jobs.filter(
    (j) =>
      (review.value === 'all' ||
        j.reviewStatus === review.value ||
        (review.value === 'pending' && j.reviewStatus === 'awaiting_data')) &&
      (!printer.value || j.printerId === printer.value) &&
      (!status.value || j.printStatus === status.value) &&
      (!source.value || j.source === source.value) &&
      (!material.value || j.materials.some((m) => m.material === material.value)) &&
      (!from.value ||
        (j.startedAt && dayKey(j.startedAt, store.data?.settings.timezone) >= from.value)) &&
      (!to.value ||
        (j.startedAt && dayKey(j.startedAt, store.data?.settings.timezone) <= to.value)) &&
      `${j.name} ${j.printerName || ''}`.toLowerCase().includes(search.value.toLowerCase()),
  ),
);
const pending = computed(
  () => store.jobs.filter((j) => ['pending', 'awaiting_data'].includes(j.reviewStatus)).length,
);
async function import3mf() {
  if (!importFile.value) return;
  importing.value = true;
  error.value = '';
  try {
    const data = new FormData();
    data.append('printerId', importPrinter.value);
    data.append('file', importFile.value);
    const r = await api<{ created: number; duplicates: number }>('/import/3mf', {
      method: 'POST',
      body: data,
    });
    await store.load();
    importOpen.value = false;
    store.toast(`已导入 ${r.created} 个切片板，跳过 ${r.duplicates} 个重复项`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    importing.value = false;
  }
}
async function undo() {
  if (!undoJob.value) return;
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      `/jobs/${undoJob.value.id}/undo`,
      {
        requestId: crypto.randomUUID(),
        expectedVersion: undoJob.value.version,
        notes: '用户从任务页撤销核对',
      },
      'POST',
      '已撤销核对，库存已恢复',
    );
    undoJob.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function changeJob(j: Job, body: unknown) {
  try {
    await store.mutate(
      `/jobs/${j.id}`,
      { expectedVersion: j.version, ...(body as object) },
      'PATCH',
    );
    details.value = store.jobs.find((x) => x.id === j.id) || null;
  } catch (e) {
    store.toast((e as Error).message);
  }
}
async function duplicate(j: Job) {
  try {
    await store.mutate(
      `/jobs/${j.id}/duplicate`,
      {},
      'POST',
      '已创建新一次打印记录，请更新状态并独立核对',
    );
  } catch (e) {
    store.toast((e as Error).message);
  }
}
function detail(j: Job) {
  details.value = j;
  newStatus.value = j.printStatus;
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">FROM PRINT TO INVENTORY</div>
      <h1>打印任务</h1>
      <p>同步每一次打印，由你确认每一克消耗。</p>
    </div>
    <div class="actions">
      <button class="button" :disabled="store.busy" @click="store.sync()">
        <RefreshCw :size="16" :class="{ spinning: store.busy }" />{{
          store.busy ? '正在同步…' : '同步任务'
        }}</button
      ><button
        class="button"
        @click="
          error = '';
          importFile = null;
          importOpen = true;
        "
      >
        <Upload :size="16" />导入 3MF</button
      ><button class="button primary" @click="formOpen = true"><Plus :size="16" />添加任务</button>
    </div>
  </div>
  <div class="stat-grid compact">
    <div class="stat-card">
      <span>任务总数<Box :size="17" /></span><strong>{{ store.jobs.length }}</strong
      ><small>全部打印记录</small>
    </div>
    <div class="stat-card">
      <span>待核对任务<Clock3 :size="17" /></span><strong class="accent-text">{{ pending }}</strong
      ><small>等待你确认实际料卷</small>
    </div>
    <div class="stat-card">
      <span>已核对任务<CheckCheck :size="17" /></span
      ><strong>{{ store.jobs.filter((j) => j.reviewStatus === 'reviewed').length }}</strong
      ><small>已记录库存流水</small>
    </div>
    <div class="stat-card">
      <span>异常 / 数据待补充<Info :size="17" /></span
      ><strong>{{
        store.jobs.filter((j) => j.reviewStatus === 'error' || j.reviewStatus === 'awaiting_data')
          .length
      }}</strong
      ><small>连接状态见系统设置</small>
    </div>
  </div>
  <div class="panel task-panel">
    <div class="tabs">
      <button :class="{ active: review === 'all' }" @click="review = 'all'">全部任务</button
      ><button :class="{ active: review === 'pending' }" @click="review = 'pending'">
        待核对 <span>{{ pending }}</span></button
      ><button :class="{ active: review === 'reviewed' }" @click="review = 'reviewed'">
        已核对</button
      ><button :class="{ active: review === 'ignored' }" @click="review = 'ignored'">已忽略</button>
    </div>
    <div class="toolbar padded">
      <div class="search-field">
        <Search :size="16" /><input
          v-model="search"
          placeholder="搜索打印任务…"
          aria-label="搜索打印任务"
        />
      </div>
      <select v-model="printer" aria-label="筛选打印机">
        <option value="">所有打印机</option>
        <option v-for="p in store.printers" :key="p.id" :value="p.id">{{ p.name }}</option></select
      ><select v-model="status" aria-label="筛选打印结果">
        <option value="">所有结果</option>
        <option v-for="(label, key) in printLabels" :key="key" :value="key">
          {{ label }}
        </option></select
      ><select v-model="source" aria-label="筛选数据源">
        <option value="">所有来源</option>
        <option value="manual">手动录入</option>
        <option value="three_mf">3MF 导入</option>
        <option value="bambu_cloud">拓竹云端</option></select
      ><select v-model="material" aria-label="筛选材料">
        <option value="">所有材质</option>
        <option
          v-for="m in [
            ...new Set(store.jobs.flatMap((j) => j.materials.map((m) => m.material))),
          ].filter(Boolean)"
          :key="m!"
        >
          {{ m }}
        </option></select
      ><input v-model="from" type="date" aria-label="开始日期" /><span class="muted">至</span
      ><input v-model="to" type="date" aria-label="结束日期" />
    </div>
    <div v-if="filtered.length" class="table-scroll">
      <table class="jobs-table">
        <thead>
          <tr>
            <th>打印任务</th>
            <th>打印机 / 时间</th>
            <th>材料 / 报告用量</th>
            <th>打印结果</th>
            <th>库存核对</th>
            <th class="align-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="j in filtered" :key="j.id">
            <td>
              <button class="job-name-button" @click="detail(j)">
                <div class="model-thumbnail">
                  <img
                    v-if="j.thumbnail"
                    :src="j.thumbnail"
                    alt="任务预览"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  /><Box v-else :size="25" stroke-width="1.3" />
                </div>
                <div>
                  <strong>{{ j.name }}</strong><small
                    >{{ sourceLabels[j.source] || j.source }}
                    <span v-if="j.incomplete" class="warning-text"> · 数据不完整</span></small
                  >
                </div>
              </button>
            </td>
            <td>
              <strong>{{ j.printerName || '未关联设备' }}</strong><small
                >{{ date(j.startedAt, store.data?.settings.timezone)
                }}<template v-if="j.durationSeconds !== null">
                  · {{ Math.round(j.durationSeconds / 60) }} 分钟</template
                ></small
              >
            </td>
            <td>
              <div class="inline-meta">
                <span
                  v-for="m in j.materials"
                  :key="m.id"
                  class="color-dot"
                  :style="{ background: m.colorHex || '#bbb' }"
                  :title="m.material || '未知材质'"
                /><strong>{{
                  j.totalMg !== null
                    ? grams(j.totalMg) + ' g'
                    : j.materials.every((m) => m.suggestedMg !== null)
                      ? grams(j.materials.reduce((s, m) => s + (m.suggestedMg || 0), 0)) + ' g'
                      : '用量待补充'
                }}</strong>
              </div>
              <small>{{
                [...new Set(j.materials.map((m) => m.material || '未知材质'))].join(' / ')
              }}</small>
            </td>
            <td>
              <span
                class="badge"
                :class="
                  j.printStatus === 'completed'
                    ? 'success'
                    : j.printStatus === 'failed'
                      ? 'danger'
                      : 'neutral'
                "
                >{{ printLabels[j.printStatus] }}</span
              >
            </td>
            <td>
              <span class="review-state" :class="j.reviewStatus"
                ><span class="status-dot" />{{ reviewLabels[j.reviewStatus] }}</span
              >
            </td>
            <td class="align-right">
              <div class="row-actions">
                <button
                  v-if="['pending', 'awaiting_data', 'error'].includes(j.reviewStatus)"
                  class="button small review-button"
                  @click="store.reviewJob = j"
                >
                  核对耗材<ArrowRight :size="13" /></button
                ><template v-if="j.reviewStatus === 'reviewed'"
                  ><button class="button small" @click="store.reviewJob = j">更正</button
                  ><button
                    class="icon-button"
                    title="撤销核对"
                    aria-label="撤销核对"
                    @click="
                      error = '';
                      undoJob = j;
                    "
                  >
                    <Undo2 :size="16" /></button></template
                ><button
                  class="icon-button"
                  title="任务详情"
                  aria-label="查看任务详情"
                  @click="detail(j)"
                >
                  <Info :size="17" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-else
      :title="store.jobs.length ? '没有符合条件的任务' : '下一次打印，从这里留下记录'"
      :description="
        store.jobs.length
          ? '调整筛选条件，查看其他打印任务。'
          : '导入已切片的 3MF，或手动添加任务。核对前不会改变库存。'
      "
      ><button
        v-if="!store.jobs.length"
        class="button"
        @click="
          error = '';
          importOpen = true;
        "
      >
        <Upload :size="16" />导入切片文件
      </button></EmptyState
    >
    <div class="table-footer">
      {{ filtered.length }} 条记录 <span>打印状态与库存核对状态独立记录</span>
    </div>
  </div>
  <JobForm v-model:open="formOpen" /><Modal
    v-model:open="importOpen"
    title="导入 3MF 切片文件"
    description="读取 Bambu Studio / OrcaSlicer 已切片的材料统计。"
    ><div class="callout">
      数据将标记为「切片估算」。普通模型 3MF 可能没有用量信息；每个切片板分别生成任务。
    </div>
    <label class="field"
      ><span>关联打印机</span
      ><select v-model="importPrinter">
        <option value="">暂不关联</option>
        <option v-for="p in store.printers" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select></label
    ><label class="file-drop"
      ><Upload :size="28" /><strong>{{ importFile?.name || '选择已切片的 .3mf 文件' }}</strong
      ><span>最大 32 MB · 不会自动扣减库存</span
      ><input
        type="file"
        accept=".3mf"
        @change="(e) => (importFile = (e.target as HTMLInputElement).files?.[0] || null)"
    /></label>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <template #footer
      ><button class="button" @click="importOpen = false">取消</button
      ><button class="button primary" :disabled="!importFile || importing" @click="import3mf">
        {{ importing ? '解析中…' : '导入任务' }}
      </button></template
    ></Modal
  ><Modal
    :open="!!undoJob"
    title="撤销这次核对？"
    description="原先扣减的所有料卷将恢复库存，并追加恢复流水。"
    @update:open="
      (v) => {
        if (!v) undoJob = null;
      }
    "
    ><p>{{ undoJob?.name }}</p>
    <p class="muted">任务会回到待核对状态，历史记录会完整保留。</p>
    <div v-if="error" class="error-banner">{{ error }}</div>
    <template #footer
      ><button class="button" @click="undoJob = null">取消</button
      ><button class="button primary" :disabled="saving" @click="undo">
        确认撤销并恢复
      </button></template
    ></Modal
  ><Modal
    :open="!!details"
    title="打印任务详情"
    description="来源信息、历史核对与任务状态。"
    drawer
    @update:open="
      (v) => {
        if (!v) details = null;
      }
    "
    ><template v-if="details"
      ><h2>{{ details.name }}</h2>
      <p class="muted">
        {{ details.printerName || '设备未关联' }} · {{ sourceLabels[details.source] }}
      </p>
      <p>{{ details.notes }}</p>
      <div v-for="m in details.materials" :key="m.id" class="detail-material">
        <span class="color-dot" :style="{ background: m.colorHex || '#bbb' }" /><strong>{{
          m.material || '材料待补充'
        }}</strong
        ><span>{{ m.suggestedMg === null ? '未知重量' : grams(m.suggestedMg) + 'g' }}</span
        ><small
          >{{ sourceLabels[m.source] }} · {{ m.sourceSlot || '槽位未知' }} ·
          {{ m.sourceNozzle || '喷嘴未知' }}</small
        >
      </div>
      <div v-if="details.reviewStatus !== 'reviewed'" class="form-section">
        <label class="field"
          ><span>更新打印状态</span
          ><select v-model="newStatus">
            <option
              v-for="(label, key) in printLabels"
              :key="key"
              :value="key"
              :disabled="key === 'printing'"
            >
              {{ label }}
            </option>
          </select></label
        ><button class="button" @click="changeJob(details, { printStatus: newStatus })">
          保存打印状态</button
        ><button
          class="text-button"
          @click="
            changeJob(details, {
              reviewStatus: details.reviewStatus === 'ignored' ? 'pending' : 'ignored',
            })
          "
        >
          {{ details.reviewStatus === 'ignored' ? '恢复为待核对' : '忽略此任务' }}
        </button>
      </div>
      <div class="form-section-title">再次使用这个切片</div>
      <p class="muted">如果实际再次打印了相同文件，请新建一次记录；重复导入相同文件会去重。</p>
      <button class="button" @click="duplicate(details)"><Copy :size="16" />创建新一次打印</button>
      <div class="form-section-title">核对历史</div>
      <div v-if="!details.reviews.length" class="muted">尚未核对，库存没有变化。</div>
      <div v-for="r in details.reviews" :key="r.id" class="review-history">
        <strong>{{
          r.kind === 'undo' ? '撤销核对' : r.kind === 'correct' ? '更正核对' : '确认扣减'
        }}</strong><small>{{ date(r.createdAt) }} · {{ r.notes || '手动操作' }}</small>
        <div v-for="(a, i) in r.allocations" :key="i">
          #{{ shortId(a.spoolId) }} · {{ grams(a.amountMg) }}g
        </div>
      </div></template
    ></Modal
  >
</template>
