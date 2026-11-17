<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { Plus, Trash2 } from 'lucide-vue-next';
import Modal from './Modal.vue';
import { useWorkspace } from '../lib/store';
const props = defineProps<{ open: boolean }>(),
  emit = defineEmits<{ 'update:open': [boolean] }>(),
  store = useWorkspace(),
  error = ref(''),
  saving = ref(false);
const blank = () => ({
  material: 'PLA',
  colorHex: '#E8E8E5',
  colorName: '',
  grams: null as number | null,
  source: 'manual',
  sourceSlot: '',
  sourceNozzle: '',
});
const form = reactive({
  name: '',
  printerId: '',
  printStatus: 'completed',
  startedAt: '',
  duration: 0,
  total: null as number | null,
  incomplete: false,
  materials: [blank()],
  notes: '',
});
watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = '';
      Object.assign(form, {
        name: '',
        printerId: '',
        printStatus: 'completed',
        startedAt: '',
        duration: 0,
        total: null,
        incomplete: false,
        materials: [blank()],
        notes: '',
      });
    }
  },
);
async function save() {
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      '/jobs',
      {
        name: form.name,
        printerId: form.printerId || null,
        printStatus: form.printStatus,
        startedAt: form.startedAt ? new Date(form.startedAt).toISOString() : null,
        durationSeconds: form.duration ? Math.round(form.duration * 60) : null,
        totalMg:
          form.total === null || String(form.total) === ''
            ? null
            : Math.round(Number(form.total) * 1000),
        incomplete: form.incomplete,
        notes: form.notes,
        materials: form.materials.map((m) => ({
          material: m.material || null,
          colorHex: m.colorHex,
          colorName: m.colorName || null,
          suggestedMg:
            m.grams === null || String(m.grams) === '' ? null : Math.round(Number(m.grams) * 1000),
          source: m.source,
          sourceSlot: m.sourceSlot || null,
          sourceNozzle: m.sourceNozzle || null,
        })),
      },
      'POST',
      '打印任务已添加，等待核对耗材',
    );
    emit('update:open', false);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <Modal
    :open="open"
    title="添加打印任务"
    description="记录已知信息；添加任务不会扣减库存。"
    drawer
    @update:open="$emit('update:open', $event)"
    ><form id="job-form" class="form-grid" @submit.prevent="save">
      <label class="field full"
        ><span>任务名称 *</span
        ><input v-model="form.name" required maxlength="300" placeholder="例如 桌面收纳盒" /></label
      ><label class="field"
        ><span>打印机</span
        ><select v-model="form.printerId">
          <option value="">暂不关联</option>
          <option v-for="p in store.printers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select></label
      ><label class="field"
        ><span>打印结果</span
        ><select v-model="form.printStatus">
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
          <option value="printing">打印中</option>
          <option value="unknown">未知</option>
        </select></label
      ><label class="field"
        ><span>开始时间（当前浏览器时区）</span
        ><input v-model="form.startedAt" type="datetime-local" /></label
      ><label class="field"
        ><span>打印时长（分钟）</span
        ><input v-model.number="form.duration" type="number" min="0" step="1" /></label
      ><label class="field"
        ><span>报告总用量（g，可选）</span
        ><input
          v-model.number="form.total"
          type="number"
          min="0"
          step="0.001"
          placeholder="未记录" /></label
      ><label class="checkbox-label"
        ><input v-model="form.incomplete" type="checkbox" />材料明细不完整</label
      >
      <div class="form-section-title">材料用量 <small>可以只录入已知信息</small></div>
      <section v-for="(m, index) in form.materials" :key="index" class="manual-material full">
        <header>
          <strong>材料 {{ index + 1 }}</strong
          ><button
            v-if="form.materials.length > 1"
            type="button"
            class="icon-button"
            aria-label="删除材料"
            @click="form.materials.splice(index, 1)"
          >
            <Trash2 :size="16" />
          </button>
        </header>
        <div class="form-grid">
          <label class="field"
            ><span>材质</span><input v-model="m.material" placeholder="未知时可留空" /></label
          ><label class="field"
            ><span>建议用量（g）</span
            ><input
              v-model.number="m.grams"
              type="number"
              min="0"
              step="0.001"
              placeholder="未知" /></label
          ><label class="field"
            ><span>颜色</span>
            <div class="color-input">
              <input v-model="m.colorHex" type="color" aria-label="材料颜色" /><input
                v-model="m.colorName"
                placeholder="颜色名称"
              /></div></label
          ><label class="field"
            ><span>重量来源</span
            ><select v-model="m.source">
              <option value="manual">手动输入</option>
              <option value="slicer_estimate">切片估算</option>
              <option value="weighed">实际称重</option>
            </select></label
          ><label class="field"
            ><span>来源槽位（可选）</span
            ><input v-model="m.sourceSlot" placeholder="以实际记录为准" /></label
          ><label class="field"
            ><span>喷嘴（可选）</span><input v-model="m.sourceNozzle" placeholder="例如 左主喷嘴"
          /></label>
        </div>
      </section>
      <button type="button" class="button full" @click="form.materials.push(blank())">
        <Plus :size="16" />添加另一种材料</button
      ><label class="field full"
        ><span>任务备注</span><textarea v-model="form.notes" rows="2" maxlength="2000" />
      </label>
      <div v-if="error" class="error-banner full" role="alert">{{ error }}</div>
    </form>
    <template #footer
      ><button class="button" @click="$emit('update:open', false)">取消</button
      ><button form="job-form" class="button primary" :disabled="saving">
        {{ saving ? '保存中…' : '添加任务' }}
      </button></template
    ></Modal
  >
</template>
