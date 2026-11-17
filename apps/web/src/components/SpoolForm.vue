<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { useWorkspace } from '../lib/store';
import { materialTypes, type Spool } from '../../../../packages/shared/src';
const props = defineProps<{ open: boolean; spool?: Spool | null }>(),
  emit = defineEmits<{ 'update:open': [boolean] }>(),
  store = useWorkspace(),
  saving = ref(false),
  error = ref('');
const form = reactive({
  brand: '',
  name: '',
  material: 'PLA',
  subtype: '',
  colorName: '',
  colorHex: '#E8E8E5',
  colorCode: '',
  netG: 1000,
  remainingG: 1000,
  emptyG: null as number | null,
  price: null as number | null,
  purchasedAt: '',
  openedAt: '',
  location: '',
  notes: '',
  status: 'opened',
  count: 1,
});
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    error.value = '';
    const s = props.spool;
    Object.assign(
      form,
      s
        ? {
            ...s.product,
            netG: s.product.netMg / 1000,
            remainingG: s.remainingMg / 1000,
            emptyG: s.emptyMg === null ? null : s.emptyMg / 1000,
            price: s.priceCents === null ? null : s.priceCents / 100,
            purchasedAt: s.purchasedAt || '',
            openedAt: s.openedAt || '',
            location: s.location,
            notes: s.notes,
            status: s.status,
            count: 1,
          }
        : {
            brand: '',
            name: '',
            material: 'PLA',
            subtype: '',
            colorName: '',
            colorHex: '#E8E8E5',
            colorCode: '',
            netG: 1000,
            remainingG: 1000,
            emptyG: null,
            price: null,
            purchasedAt: '',
            openedAt: '',
            location: '',
            notes: '',
            status: 'opened',
            count: 1,
          },
    );
  },
);
const nullable = (value: unknown, multiplier: number) =>
  value === '' || value === null ? null : Math.round(Number(value) * multiplier);
async function save() {
  saving.value = true;
  error.value = '';
  try {
    const body = {
      product: {
        brand: form.brand,
        name: form.name || `${form.brand} ${form.material} ${form.colorName}`,
        material: form.material,
        subtype: form.subtype,
        colorName: form.colorName,
        colorHex: form.colorHex,
        colorCode: form.colorCode,
        netMg: Math.round(form.netG * 1000),
      },
      remainingMg: Math.round(form.remainingG * 1000),
      emptyMg: nullable(form.emptyG, 1000),
      priceCents: nullable(form.price, 100),
      purchasedAt: form.purchasedAt || null,
      openedAt: form.openedAt || null,
      location: form.location,
      notes: form.notes,
      status: form.status,
      count: form.count,
      expectedVersion: props.spool?.version,
    };
    await store.mutate(
      props.spool ? `/spools/${props.spool.id}` : '/spools',
      body,
      props.spool ? 'PUT' : 'POST',
      props.spool ? '料卷信息已更新' : `已添加 ${form.count} 卷耗材`,
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
    :title="spool ? '编辑料卷' : '添加耗材'"
    description="产品规格可以相同，每一卷都会拥有独立编号与库存记录。"
    drawer
    @update:open="$emit('update:open', $event)"
    ><form id="spool-form" class="form-grid" @submit.prevent="save">
      <div class="form-section-title">产品规格</div>
      <label class="field"
        ><span>品牌 *</span
        ><input
          v-model="form.brand"
          placeholder="例如 SUNLU"
          required
          maxlength="100"
          list="brands"
        /><datalist id="brands">
          <option>SUNLU</option>
          <option>eSUN</option>
          <option>Polymaker</option>
          <option>Bambu Lab</option>
        </datalist></label
      ><label class="field"
        ><span>材料类型 *</span><input v-model="form.material" list="materials" required /><datalist
          id="materials"
        >
          <option v-for="m in materialTypes" :key="m">{{ m }}</option>
        </datalist></label
      ><label class="field full"
        ><span>产品名称 <small>选填，留空自动生成</small></span
        ><input v-model="form.name" placeholder="例如 PLA+ 2.0 白色" maxlength="160" /></label
      ><label class="field"
        ><span>材料子类型</span
        ><input v-model="form.subtype" placeholder="例如 High Speed" /></label
      ><label class="field"
        ><span>品牌色号</span><input v-model="form.colorCode" placeholder="选填" /></label
      ><label class="field"
        ><span>颜色名称</span><input v-model="form.colorName" placeholder="例如 奶油白" /></label
      ><label class="field"
        ><span>耗材颜色 *</span>
        <div class="color-input">
          <input v-model="form.colorHex" type="color" aria-label="选择耗材颜色" /><input
            v-model="form.colorHex"
            pattern="#[0-9a-fA-F]{6}"
            required
            aria-label="HEX 色值"
          /></div></label
      ><label class="field"
        ><span>标称净重（g）*</span
        ><input
          v-model.number="form.netG"
          type="number"
          min="0.001"
          max="100000"
          step="0.001"
          required /></label
      ><label class="field"
        ><span>单卷购入价格（¥）</span
        ><input v-model.number="form.price" type="number" min="0" step="0.01" placeholder="未记录"
      /></label>
      <div class="form-section-title">实体料卷</div>
      <label v-if="!spool" class="field"
        ><span>当前剩余（g）*</span
        ><input
          v-model.number="form.remainingG"
          type="number"
          min="0"
          max="100000"
          step="0.001"
          required /></label
      ><label v-if="!spool" class="field"
        ><span>新增卷数 *</span
        ><input v-model.number="form.count" type="number" min="1" max="100" required /><small
          >每卷分别记录上述剩余重量</small
        ></label
      ><label class="field"
        ><span>空盘重量（g）</span
        ><input
          v-model.number="form.emptyG"
          type="number"
          min="0"
          step="0.001"
          placeholder="选填" /></label
      ><label class="field"
        ><span>使用状态</span
        ><select v-model="form.status">
          <option value="sealed">未开封</option>
          <option value="opened">已开封</option>
          <option value="empty">已用尽</option>
          <option v-if="spool" value="archived">已归档</option>
        </select></label
      ><label class="field"
        ><span>购买日期</span><input v-model="form.purchasedAt" type="date" /></label
      ><label class="field"
        ><span>开封日期</span><input v-model="form.openedAt" type="date" /></label
      ><label class="field full"
        ><span>存放位置</span
        ><input
          v-model="form.location"
          placeholder="例如 干燥箱 A · 第二层"
          maxlength="160" /></label
      ><label class="field full"
        ><span>备注</span><textarea v-model="form.notes" rows="2" maxlength="2000" />
      </label>
      <div v-if="spool" class="callout full">
        重量调整请使用「校准重量」，每次变化都会保留流水。
      </div>
      <div v-if="error" class="error-banner full" role="alert">{{ error }}</div>
    </form>
    <template #footer
      ><button class="button" @click="$emit('update:open', false)">取消</button
      ><button class="button primary" form="spool-form" :disabled="saving">
        {{ saving ? '保存中…' : spool ? '保存修改' : '添加到仓库' }}
      </button></template
    ></Modal
  >
</template>
