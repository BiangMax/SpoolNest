<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  Plus,
  Printer,
  Link2,
  Unplug,
  Settings2,
  Clock3,
  Info,
  RefreshCw,
  Radio,
  Check,
  ChevronDown,
} from 'lucide-vue-next';
import {
  SelectRoot,
  SelectTrigger,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from 'reka-ui';
import a1MiniImage from '../assets/printers/a1-mini.webp';
import x2dImage from '../assets/printers/x2d.webp';
import PrinterTelemetryPanel from '../components/PrinterTelemetryPanel.vue';
import PageHeading from '../components/PageHeading.vue';
import { useWorkspace } from '../lib/store';
import { date, grams, shortId } from '../lib/format';
import { type Printer as PrinterType, type PrinterPresence } from '../../../../packages/shared/src';
import Modal from '../components/Modal.vue';
import EmptyState from '../components/EmptyState.vue';
import { api } from '../lib/api';
// Official product images from the A-series and X-series pages of the Bambu Lab Wiki.
const modelImages = new Map([
  ['A1 mini', a1MiniImage],
  ['X2D', x2dImage],
]);
const store = useWorkspace(),
  open = ref(false),
  editing = ref<PrinterType | null>(null),
  error = ref(''),
  saving = ref(false),
  binding = ref<{ id: string; name: string; spoolId: string | null } | null>(null),
  spoolId = ref(''),
  slotPrinter = ref<PrinterType | null>(null),
  history = ref<any[] | null>(null);
const bindingSpools = computed(() => store.spools.filter((spool) => spool.status !== 'archived'));
const selectedSpool = computed(() =>
  bindingSpools.value.find((spool) => spool.id === spoolId.value),
);
const presence = ref<PrinterPresence>({ checkedAt: null, online: {} });
const reading = ref(false),
  failed = ref(false);
const enabled = computed(() => !!(store.data?.sync.enabled && store.data.sync.configured));
const lookupKey = computed(() =>
  enabled.value
    ? JSON.stringify(store.printers.filter((p) => p.serial).map((p) => [p.id, p.serial]))
    : '[]',
);
let request: AbortController | undefined;
async function refresh() {
  if (document.hidden || lookupKey.value === '[]' || reading.value) return;
  const controller = new AbortController();
  request = controller;
  reading.value = true;
  try {
    const result = await api<PrinterPresence>('/printers/presence', { signal: controller.signal });
    if (!controller.signal.aborted) {
      presence.value = result;
      failed.value = false;
    }
  } catch {
    if (!controller.signal.aborted) {
      failed.value = true;
      presence.value = { checkedAt: null, online: {} };
    }
  } finally {
    if (!controller.signal.aborted) reading.value = false;
  }
}
function resetPresence() {
  request?.abort();
  presence.value = { checkedAt: null, online: {} };
  reading.value = false;
  failed.value = false;
  void refresh();
}
watch(lookupKey, resetPresence, { immediate: true });
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  timer = setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', resetPresence);
});
onUnmounted(() => {
  clearInterval(timer);
  request?.abort();
  document.removeEventListener('visibilitychange', resetPresence);
});
function status(p: PrinterType) {
  const online = presence.value.online[p.id];
  if (online === true) return '在线';
  if (online === false) return '离线';
  if (!enabled.value) return '云端未连接';
  if (!p.serial) return '未填序列号';
  if (reading.value) return '读取中';
  return failed.value ? '状态未知' : '云端未匹配';
}
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
  <PageHeading title="打印机管理" description="管理打印设备、供料来源和料卷绑定。">
    <button class="button" @click="showHistory"><Clock3 :size="16" />绑定历史</button
    ><button class="button primary" @click="add()"><Plus :size="16" />添加打印机</button>
  </PageHeading>
  <div class="printer-monitor" v-if="store.printers.length">
    <Radio :size="17" /><strong>设备状态</strong>
    <small role="status">{{
      failed
        ? '云端暂不可用'
        : presence.checkedAt
          ? '云端读取于 ' + date(presence.checkedAt, store.data?.settings.timezone)
          : enabled
            ? '按设备序列号匹配云端'
            : '拓竹云端未连接'
    }}</small>
    <button v-if="lookupKey !== '[]'" class="text-button" :disabled="reading" @click="refresh">
      <RefreshCw :size="14" />{{ reading ? '读取中' : '刷新状态' }}
    </button>
  </div>
  <div v-if="store.printers.length" class="printer-grid">
    <section v-for="p in store.printers" :key="p.id" class="panel printer-card">
      <header>
        <div class="grow">
          <span class="device-model">{{ p.model }}</span>
          <h2>{{ p.name }}</h2>
          <span class="presence-badge" :class="{ online: presence.online[p.id] === true }"
            ><i />{{ status(p) }}</span
          >
        </div>
        <img
          v-if="modelImages.has(p.model)"
          class="printer-product-photo"
          :src="modelImages.get(p.model)"
          alt=""
        />
        <button class="icon-button" aria-label="编辑打印机" @click="add(p)">
          <Settings2 :size="18" />
        </button>
      </header>
      <PrinterTelemetryPanel
        v-if="enabled && p.serial"
        :key="p.serial + p.model"
        :printer-id="p.id"
        :online="presence.online[p.id]"
        :checked-at="presence.checkedAt"
        :timezone="store.data?.settings.timezone"
      />
      <div class="printer-meta">
        <span
          >任务同步
          <strong>{{
            p.lastSyncAt ? date(p.lastSyncAt, store.data?.settings.timezone) : '尚无记录'
          }}</strong></span
        ><span
          >供料来源绑定
          <strong
            >{{ p.slots.filter((s) => s.spoolId).length }} / {{ p.slots.length }} 个来源</strong
          ></span
        >
      </div>
      <div v-if="p.extruders.length" class="extruder-list">
        <span v-for="e in p.extruders" :key="e.id"><i class="extruder-icon" />{{ e.name }}</span>
      </div>
      <div class="slots" v-if="p.slots.length">
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
      <div v-if="!p.slots.length" class="printer-empty">
        <Link2 :size="19" />
        <div>
          <strong>尚未添加供料来源</strong>
          <p>添加 AMS 或外置料架，并指定对应喷嘴。</p>
        </div>
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
  <p v-if="store.printers.length" class="printer-footnote">
    <Info :size="15" />供料位置与喷嘴映射由你维护，旧任务保留当时的绑定记录。
  </p>
  <EmptyState
    :icon="Printer"
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
    <div class="field">
      <span id="binding-spool-label">库存料卷</span>
      <SelectRoot
        :model-value="spoolId || 'unbound'"
        @update:model-value="spoolId = !$event || $event === 'unbound' ? '' : String($event)"
      >
        <SelectTrigger
          class="color-filter-trigger binding-spool-trigger"
          aria-labelledby="binding-spool-label"
        >
          <template v-if="selectedSpool">
            <span
              class="color-filter-swatch"
              :style="{ backgroundColor: selectedSpool.product.colorHex }"
              aria-hidden="true"
            />
            <span class="binding-spool-label">
              {{ selectedSpool.product.brand }} {{ selectedSpool.product.material }}
              {{ selectedSpool.product.colorName }} · #{{ shortId(selectedSpool.id) }}
            </span>
          </template>
          <span v-else>{{ spoolId ? '当前料卷不在可选库存中' : '解绑 / 暂无料卷' }}</span>
          <ChevronDown :size="14" aria-hidden="true" />
        </SelectTrigger>
        <SelectPortal>
          <SelectContent
            class="color-filter-options binding-spool-options"
            position="popper"
            :side-offset="6"
          >
            <SelectViewport>
              <SelectItem value="unbound" class="color-filter-option">
                <SelectItemText>解绑 / 暂无料卷</SelectItemText>
                <SelectItemIndicator class="color-filter-check"
                  ><Check :size="14"
                /></SelectItemIndicator>
              </SelectItem>
              <SelectItem
                v-for="spool in bindingSpools"
                :key="spool.id"
                :value="spool.id"
                class="color-filter-option"
              >
                <span
                  class="color-filter-swatch"
                  :style="{ backgroundColor: spool.product.colorHex }"
                  aria-hidden="true"
                />
                <SelectItemText class="binding-spool-label">
                  {{ spool.product.brand }} {{ spool.product.material }}
                  {{ spool.product.colorName }}
                  <small>
                    #{{ shortId(spool.id) }} · {{ grams(spool.remainingMg) }}&nbsp;g{{
                      spool.installed.length ? ' · 已安装' : ''
                    }}
                  </small>
                </SelectItemText>
                <SelectItemIndicator class="color-filter-check"
                  ><Check :size="14"
                /></SelectItemIndicator>
              </SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>
    </div>
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
