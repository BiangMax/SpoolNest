<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Plus,
  X,
  ArrowRight,
  AlertTriangle,
  Check,
  Link2,
  Printer,
  Clock3,
  ShieldCheck,
} from 'lucide-vue-next';
import Modal from './Modal.vue';
import { useWorkspace } from '../lib/store';
import { grams, date, shortId } from '../lib/format';
import { printLabels, sourceLabels, type Spool } from '../../../../packages/shared/src';
const store = useWorkspace(),
  rows = ref<
    {
      key: string;
      materialId: string;
      spoolId: string;
      grams: number | null;
      source: 'manual' | 'weighed';
    }[]
  >([]),
  notes = ref(''),
  error = ref(''),
  saving = ref(false),
  ackIncomplete = ref(false),
  ackFailure = ref(false),
  requestId = ref('');
const job = computed(() => store.reviewJob),
  correcting = computed(() => job.value?.reviewStatus === 'reviewed');
watch(
  () => store.reviewJob,
  (j) => {
    if (!j) return;
    error.value = '';
    notes.value = '';
    ackFailure.value = false;
    ackIncomplete.value = false;
    requestId.value = crypto.randomUUID();
    const last = j.reviews.at(-1);
    rows.value =
      correcting.value && last
        ? last.allocations.map((a) => ({
            key: crypto.randomUUID(),
            materialId: a.materialId,
            spoolId: a.spoolId,
            grams: a.amountMg / 1000,
            source: a.source,
          }))
        : j.materials.map((m) => ({
            key: crypto.randomUUID(),
            materialId: m.id,
            spoolId: '',
            grams:
              j.printStatus === 'completed' && m.suggestedMg !== null ? m.suggestedMg / 1000 : null,
            source: 'manual',
          }));
  },
);
function add(materialId: string) {
  rows.value.push({
    key: crypto.randomUUID(),
    materialId,
    spoolId: '',
    grams: null,
    source: 'manual',
  });
}
function available(materialId: string) {
  const material = job.value?.materials.find((m) => m.id === materialId);
  const score = (s: Spool) => {
    let value = 0;
    if (
      job.value?.slotSnapshot.some((b) => b.spoolId === s.id && b.slotName === material?.sourceSlot)
    )
      value += 100;
    if (s.product.material === material?.material) value += 30;
    if (s.product.colorHex.toLowerCase() === material?.colorHex?.toLowerCase()) value += 20;
    if (s.status === 'opened') value += 3;
    if (s.remainingMg >= (material?.suggestedMg || 0)) value += 2;
    return value;
  };
  return [...store.spools]
    .filter((s) => s.status !== 'archived')
    .sort((a, b) => score(b) - score(a));
}
const previews = computed(() => {
  const amounts = new Map<string, { restore: number; deduct: number }>();
  if (correcting.value) {
    for (const a of job.value?.reviews.at(-1)?.allocations || [])
      amounts.set(a.spoolId, {
        restore: (amounts.get(a.spoolId)?.restore || 0) + a.amountMg,
        deduct: 0,
      });
  }
  for (const r of rows.value) {
    if (!r.spoolId) continue;
    const item = amounts.get(r.spoolId) || { restore: 0, deduct: 0 };
    item.deduct += Math.round(Number(r.grams || 0) * 1000);
    amounts.set(r.spoolId, item);
  }
  return [...amounts.entries()].map(([id, change]) => {
    const spool = store.spools.find((s) => s.id === id)!;
    return { spool, ...change, after: spool.remainingMg + change.restore - change.deduct };
  });
});
const invalid = computed(
  () =>
    !rows.value.length ||
    rows.value.some(
      (r) =>
        !r.spoolId ||
        r.grams === null ||
        String(r.grams) === '' ||
        !Number.isFinite(Number(r.grams)) ||
        Number(r.grams) < 0,
    ) ||
    previews.value.some((p) => p.after < 0) ||
    (job.value?.incomplete && !ackIncomplete.value) ||
    (job.value?.printStatus !== 'completed' && !ackFailure.value) ||
    job.value?.printStatus === 'printing',
);
async function submit() {
  if (!job.value || invalid.value) return;
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      `/jobs/${job.value.id}/review`,
      {
        requestId: requestId.value,
        expectedVersion: job.value.version,
        mode: correcting.value ? 'correct' : 'confirm',
        allocations: rows.value.map((r) => ({
          materialId: r.materialId,
          spoolId: r.spoolId,
          amountMg: Math.round(Number(r.grams) * 1000),
          source: r.source,
        })),
        acknowledgeIncomplete: ackIncomplete.value,
        acknowledgeNonSuccess: ackFailure.value,
        notes: notes.value,
      },
      'POST',
      correcting.value ? '更正已保存，原扣减已恢复并重新记账' : '核对完成，库存已更新',
    );
    store.reviewJob = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <Modal
    :open="!!job"
    :title="correcting ? '更正耗材核对' : '核对耗材'"
    description="确认实际使用的料卷与用量，再更新你的库存。"
    drawer
    wide
    @update:open="
      (v) => {
        if (!v && !saving) store.reviewJob = null;
      }
    "
    ><template v-if="job"
      ><div class="review-job">
        <div class="review-job-symbol"><Printer :size="27" /></div>
        <div>
          <span class="eyebrow">PRINT REVIEW · {{ shortId(job.id) }}</span>
          <h2>{{ job.name }}</h2>
          <div class="inline-meta">
            <span>{{ job.printerName || '未关联打印机' }}</span><span>{{
              date(job.startedAt)
            }}</span
            ><span class="badge" :class="job.printStatus === 'completed' ? 'success' : 'warning'">{{
              printLabels[job.printStatus]
            }}</span>
          </div>
        </div>
      </div>
      <div class="review-step">
        <span>1</span><strong>匹配实体料卷</strong><small>推荐仅供参考，请确认具体编号</small>
      </div>
      <div v-if="job.incomplete || job.printStatus !== 'completed'" class="callout warning">
        <AlertTriangle :size="18" />
        <p>
          {{ job.incomplete ? '材料明细不完整，请自行分配实际用量。 ' : ''
          }}{{
            job.printStatus !== 'completed'
              ? '此任务并非已确认成功；不能默认扣除完整切片估算。'
              : ''
          }}
        </p>
      </div>
      <div v-if="job.printStatus === 'printing'" class="error-banner">
        打印尚未结束。请关闭核对，等待同步或更新打印状态。
      </div>
      <section
        v-for="(material, index) in job.materials"
        :key="material.id"
        class="material-review"
      >
        <header>
          <div
            class="material-color"
            :style="{ background: material.colorHex || 'var(--surface-soft)' }"
          />
          <div>
            <strong
              >{{ material.material || '材料待确认' }}
              <span class="muted">{{ material.colorName || material.colorHex || '' }}</span></strong
            ><small
              >{{ sourceLabels[material.source] }}
              <template v-if="material.sourceSlot"> · {{ material.sourceSlot }}</template
              ><template v-if="material.sourceNozzle">
                · {{ material.sourceNozzle }}</template
              ></small
            >
          </div>
          <div class="suggested">
            <strong>{{
              material.suggestedMg === null ? '—' : grams(material.suggestedMg) + ' g'
            }}</strong><small>来源建议用量</small>
          </div>
        </header>
        <div
          v-for="row in rows.filter((r) => r.materialId === material.id)"
          :key="row.key"
          class="allocation"
        >
          <label class="spool-select"
            ><span>库存料卷</span
            ><select v-model="row.spoolId" :aria-label="`材料 ${index + 1} 的库存料卷`">
              <option value="" disabled>选择品牌与具体料卷…</option>
              <option v-for="s in available(material.id)" :key="s.id" :value="s.id">
                {{ s.product.brand }} · {{ s.product.material }} ·
                {{ s.product.colorName || s.product.colorHex }} · #{{ shortId(s.id) }} ·
                {{ grams(s.remainingMg) }}g · {{ s.location || '位置未填'
                }}{{ s.installed.length ? ' · 已安装' : '' }}
              </option></select
            ><small v-if="row.spoolId">{{
              store.spools.find((s) => s.id === row.spoolId)?.installed.join(' / ') ||
              '当前未绑定设备'
            }}</small></label
          ><label class="usage-input"
            ><span>确认消耗</span>
            <div class="input-unit">
              <input
                v-model.number="row.grams"
                type="number"
                min="0"
                max="100000"
                step="0.001"
                :aria-label="`材料 ${index + 1} 确认消耗克数`"
                placeholder="0.000"
              /><span>g</span>
            </div></label
          ><button
            v-if="rows.filter((r) => r.materialId === material.id).length > 1"
            class="icon-button remove-row"
            aria-label="移除此用量分配"
            @click="rows = rows.filter((r) => r.key !== row.key)"
          >
            <X :size="16" /></button
          ><label class="source-select"
            ><span>确认依据</span
            ><select v-model="row.source">
              <option value="manual">手动确认</option>
              <option value="weighed">实际称重</option>
            </select></label
          >
        </div>
        <button class="text-button" @click="add(material.id)">
          <Plus :size="14" />拆分到另一卷 <span class="muted">· 自动续料时使用</span>
        </button>
      </section>
      <div class="review-step">
        <span>2</span><strong>确认库存变化</strong><small>同一料卷的用量已合并</small>
      </div>
      <div v-if="!previews.length" class="preview-placeholder">选择料卷后，在这里预览剩余重量</div>
      <div v-else class="deduction-preview">
        <div
          v-for="p in previews"
          :key="p.spool.id"
          class="preview-row"
          :class="{ insufficient: p.after < 0 }"
        >
          <span class="color-dot" :style="{ background: p.spool.product.colorHex }" />
          <div class="grow">
            <strong>{{ p.spool.product.brand }} {{ p.spool.product.material }}</strong
            ><small
              >#{{ shortId(p.spool.id)
              }}{{
                correcting
                  ? ` · 恢复 ${grams(p.restore)}g，扣减 ${grams(p.deduct)}g`
                  : ` · 扣减 ${grams(p.deduct)}g`
              }}</small
            >
          </div>
          <span>{{ grams(p.spool.remainingMg) }} g</span><ArrowRight :size="15" /><strong
            >{{ grams(p.after) }} g</strong
          ><small v-if="p.after < 0" class="danger-text">库存不足</small>
        </div>
      </div>
      <label v-if="job.incomplete" class="checkbox-label"
        ><input
          v-model="ackIncomplete"
          type="checkbox"
        />我已人工核实缺失数据，并分配了每种材料的用量。</label
      ><label v-if="job.printStatus !== 'completed'" class="checkbox-label"
        ><input
          v-model="ackFailure"
          type="checkbox"
        />我已核实本次实际消耗，不直接采用完整切片估算。</label
      ><label class="field"
        ><span>核对备注 <small>可选</small></span
        ><textarea
          v-model="notes"
          rows="2"
          maxlength="2000"
          placeholder="例如：中途续料，已将用量拆分到两卷…"
        />
      </label>
      <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      <p class="privacy-line">
        <ShieldCheck :size="14" />确认后会生成可追溯的库存流水，你可以随时更正或撤销。
      </p></template
    ><template #footer
      ><button class="button" :disabled="saving" @click="store.reviewJob = null">取消</button
      ><button class="button primary" :disabled="invalid || saving" @click="submit">
        <Check :size="16" />{{ saving ? '正在保存…' : correcting ? '确认更正' : '确认扣减' }}
      </button></template
    ></Modal
  >
</template>
