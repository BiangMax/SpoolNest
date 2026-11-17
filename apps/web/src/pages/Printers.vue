<script setup lang="ts">
import { ref, reactive } from 'vue';
import { Plus, Printer, Link2, Unplug, Settings2, Clock3, Info } from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { date, grams, shortId } from '../lib/format';
import { type Printer as PrinterType } from '../../../../packages/shared/src';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import { api } from '../lib/api';
const store = useWorkspace(),
  open = ref(false),
  editing = ref<PrinterType | null>(null),
  error = ref(''),
  saving = ref(false),
  binding = ref<{ id: string; name: string; spoolId: string | null } | null>(null),
  spoolId = ref(''),
  slotPrinter = ref<PrinterType | null>(null),
  history = ref<any[] | null>(null);
const form = reactive({ name: '', model: 'A1 mini', serial: '', connection: 'manual' }),
  slot = reactive({ name: '', kind: 'ams', extruderId: '' });
function add(p: PrinterType | null = null) {
  editing.value = p;
  Object.assign(
    form,
    p
      ? { name: p.name, model: p.model, serial: p.serial || '', connection: p.connection }
      : { name: '', model: 'A1 mini', serial: '', connection: 'manual' },
  );
  error.value = '';
  open.value = true;
}
async function save() {
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      editing.value ? `/printers/${editing.value.id}` : '/printers',
      { ...form, serial: form.serial || null },
      editing.value ? 'PUT' : 'POST',
    );
    open.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function bind() {
  if (!binding.value) return;
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      `/slots/${binding.value.id}/assignment`,
      { spoolId: spoolId.value || null },
      'PUT',
      '槽位绑定已更新，历史已保存',
    );
    binding.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function addSlot() {
  if (!slotPrinter.value) return;
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      `/printers/${slotPrinter.value.id}/slots`,
      { ...slot, extruderId: slot.extruderId || null },
      'POST',
      '手动供料来源已添加',
    );
    slotPrinter.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function showHistory() {
  try {
    history.value = await api<any[]>('/assignments');
  } catch (e) {
    store.toast((e as Error).message);
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">A HOME FOR YOUR PRINTERS</div>
      <h1>打印机管理</h1>
      <p>连接你的创作设备，为每个供料来源绑定实体料卷。</p>
    </div>
    <div class="actions">
      <button class="button" @click="showHistory"><Clock3 :size="16" />绑定历史</button
      ><button class="button primary" @click="add()"><Plus :size="16" />添加打印机</button>
    </div>
  </div>
  <div class="callout">
    <Info :size="18" />
    <p>
      设备卡片中的料位为人工维护。X2D
      喷嘴与云端材料索引的自动映射尚未实机验证；当前绑定不会替代旧任务的历史快照。
    </p>
  </div>
  <div v-if="store.printers.length" class="printer-grid">
    <section v-for="p in store.printers" :key="p.id" class="panel printer-card">
      <header>
        <div class="printer-illustration"><Printer :size="39" stroke-width="1.2" /></div>
        <div class="grow">
          <span class="eyebrow">BAMBU LAB · {{ p.model }}</span>
          <h2>{{ p.name }}</h2>
          <span class="connection-label"
            ><span class="status-dot gray" />{{
              p.connection === 'manual' ? '手动维护 · 连接未验证' : '连接状态未验证'
            }}</span
          >
        </div>
        <button class="icon-button" aria-label="编辑打印机" @click="add(p)">
          <Settings2 :size="18" />
        </button>
      </header>
      <div class="printer-meta">
        <span
          >最近同步 <strong>{{ date(p.lastSyncAt) }}</strong></span
        ><span
          >已绑定
          <strong
            >{{ p.slots.filter((s) => s.spoolId).length }} / {{ p.slots.length }} 个来源</strong
          ></span
        >
      </div>
      <div v-if="p.extruders.length" class="extruder-list">
        <span v-for="e in p.extruders" :key="e.id"><i class="extruder-icon" />{{ e.name }}</span
        ><small>硬件标识 · 协议映射未验证</small>
      </div>
      <div class="slots">
        <button
          v-for="(s, i) in p.slots"
          :key="s.id"
          class="slot-row"
          @click="
            binding = s;
            spoolId = s.spoolId || '';
            error = '';
          "
        >
          <span class="slot-number">{{ s.kind === 'external' ? 'E' : i + 1 }}</span>
          <div class="grow">
            <strong>{{ s.name }}</strong><small>{{
              p.extruders.find((e) => e.id === s.extruderId)?.name || '未指定喷嘴'
            }}</small>
          </div>
          <template v-if="s.spoolId"
            ><span
              class="color-dot"
              :style="{
                background: store.spools.find((x) => x.id === s.spoolId)?.product.colorHex,
              }"
            />
            <div class="slot-spool">
              <strong
                >{{ store.spools.find((x) => x.id === s.spoolId)?.product.brand }}
                {{ store.spools.find((x) => x.id === s.spoolId)?.product.material }}</strong
              ><small>#{{ shortId(s.spoolId) }}</small>
            </div></template
          ><span v-else class="muted">绑定料卷</span><Link2 :size="15" class="muted" />
        </button>
      </div>
      <div v-if="!p.slots.length" class="mini-empty">
        <p>按你的实际配置添加 AMS 或外置供料来源，并手动指定喷嘴。</p>
      </div>
      <button
        class="printer-add-slot"
        @click="
          slotPrinter = p;
          Object.assign(slot, { name: '', kind: 'ams', extruderId: '' });
          error = '';
        "
      >
        <Plus :size="15" />添加手动供料来源
      </button>
    </section>
  </div>
  <EmptyState
    v-else
    title="为你的工作室添加一台打印机"
    description="先记录设备和料卷绑定。无需连接云端，也可以管理库存与打印任务。"
    ><button class="button primary" @click="add()">
      <Plus :size="16" />添加打印机
    </button></EmptyState
  ><Modal
    v-model:open="open"
    :title="editing ? '编辑打印机' : '添加打印机'"
    description="序列号用于匹配云端设备；可暂时留空。"
    ><form id="printer-form" class="form-grid" @submit.prevent="save">
      <label class="field full"
        ><span>设备名称 *</span
        ><input
          v-model="form.name"
          required
          maxlength="100"
          placeholder="例如 工作台 A1 mini" /></label
      ><label class="field"
        ><span>机型 *</span
        ><input
          v-model="form.model"
          list="printer-models"
          required
          :disabled="!!editing"
        /><datalist id="printer-models">
          <option v-for="m in ['A1 mini', 'X2D', 'A1', 'P1S', 'P2S', 'X1 Carbon', 'H2D']" :key="m">
            {{ m }}
          </option>
        </datalist></label
      ><label class="field"
        ><span>连接方式</span
        ><select v-model="form.connection">
          <option value="manual">手动维护</option>
          <option value="cloud">云端 · 实验性</option>
          <option value="lan" disabled>LAN 只读 · 待接入</option>
        </select></label
      ><label class="field full"
        ><span>序列号（可选）</span><input v-model="form.serial" maxlength="100" autocomplete="off"
      /></label>
      <div v-if="form.model === 'X2D'" class="callout full">
        会创建左主喷嘴与右辅助喷嘴；AMS / 外置映射由你根据设备实际配置添加，不预设未验证协议。
      </div>
      <div v-if="error" class="error-banner full">{{ error }}</div>
    </form>
    <template #footer
      ><button class="button" @click="open = false">取消</button
      ><button class="button primary" form="printer-form" :disabled="saving">
        保存设备
      </button></template
    ></Modal
  ><Modal
    :open="!!binding"
    title="绑定实体料卷"
    description="保存安装时间，不会自动更改任务或库存重量。"
    @update:open="
      (v) => {
        if (!v) binding = null;
      }
    "
    ><h3>{{ binding?.name }}</h3>
    <label class="field"
      ><span>库存料卷</span
      ><select v-model="spoolId">
        <option value="">解绑 / 暂无料卷</option>
        <option
          v-for="s in store.spools.filter((s) => s.status !== 'archived')"
          :key="s.id"
          :value="s.id"
        >
          {{ s.product.brand }} {{ s.product.material }} {{ s.product.colorName }} · #{{
            shortId(s.id)
          }}
          · {{ grams(s.remainingMg) }}g{{ s.installed.length ? ' · 已安装' : '' }}
        </option>
      </select></label
    >
    <div v-if="error" class="error-banner">{{ error }}</div>
    <template #footer
      ><button class="button" @click="binding = null">取消</button
      ><button class="button primary" :disabled="saving" @click="bind">保存绑定</button></template
    ></Modal
  ><Modal
    :open="!!slotPrinter"
    title="添加供料来源"
    description="这是你声明的设备配置，不代表已验证的协议自动映射。"
    @update:open="
      (v) => {
        if (!v) slotPrinter = null;
      }
    "
    ><form id="slot-form" class="form-grid" @submit.prevent="addSlot">
      <label class="field full"
        ><span>来源名称 *</span
        ><input v-model="slot.name" required placeholder="例如 AMS 1 · 槽位 1" /></label
      ><label class="field"
        ><span>类型</span
        ><select v-model="slot.kind">
          <option value="ams">AMS</option>
          <option value="ams_lite">AMS lite</option>
          <option value="external">外置料卷</option>
          <option value="unknown">其他 / 待确认</option>
        </select></label
      ><label class="field"
        ><span>手动指定喷嘴</span
        ><select v-model="slot.extruderId">
          <option value="">未确认</option>
          <option v-for="e in slotPrinter?.extruders" :key="e.id" :value="e.id">
            {{ e.name }}
          </option>
        </select></label
      >
      <div v-if="error" class="error-banner full">{{ error }}</div>
    </form>
    <template #footer
      ><button class="button" @click="slotPrinter = null">取消</button
      ><button class="button primary" form="slot-form" :disabled="saving">
        添加来源
      </button></template
    ></Modal
  ><Modal
    :open="!!history"
    title="料卷绑定历史"
    description="记录每一次安装和卸载，保留过去的设备用料信息。"
    drawer
    @update:open="
      (v) => {
        if (!v) history = null;
      }
    "
    ><div v-for="h in history" :key="h.id" class="review-history">
      <strong>{{ h.printerName }} · {{ h.slotName }}</strong>
      <p>#{{ shortId(h.spoolId) }}</p>
      <small
        >安装 {{ date(h.assignedAt) }} →
        {{ h.unassignedAt ? date(h.unassignedAt) : '仍在使用' }}</small
      >
    </div>
    <p v-if="!history?.length" class="muted">暂无绑定记录。</p></Modal
  >
</template>
