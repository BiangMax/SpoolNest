<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PrinterTelemetry } from '../../../../packages/shared/src';
import { api } from '../lib/api';

const props = defineProps<{
  printerId: string;
  online?: boolean;
  checkedAt: string | null;
  timezone?: string;
}>();
const report = ref<PrinterTelemetry | null>(null);
const failed = ref(false);
const expired = ref(false);
const loading = ref(false);

watch(
  () => [props.checkedAt, props.online] as const,
  async (_, __, onCleanup) => {
    loading.value = false;
    if (!props.online || !props.checkedAt || document.hidden) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    loading.value = true;
    try {
      const next = await api<PrinterTelemetry>(`/printers/${props.printerId}/telemetry`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        report.value = next;
        failed.value = false;
      }
    } catch {
      if (!controller.signal.aborted) failed.value = true;
    } finally {
      if (!controller.signal.aborted) loading.value = false;
    }
  },
  { immediate: true },
);

watch(report, (value, _, onCleanup) => {
  if (!value) return;
  const remaining = Date.parse(value.reportedAt) + 90_000 - Date.now();
  expired.value = remaining <= 0;
  const timer = setTimeout(
    () => {
      expired.value = true;
    },
    Math.max(0, remaining),
  );
  onCleanup(() => clearTimeout(timer));
});
const stale = computed(() => !props.online || !props.checkedAt || failed.value || expired.value);
const states: Record<string, string> = {
  IDLE: '空闲',
  RUNNING: '打印中',
  PAUSE: '已暂停',
  PREPARE: '准备中',
  FINISH: '已完成',
  FAILED: '打印失败',
  SLICING: '切片中',
};
const active = computed(
  () => report.value && ['RUNNING', 'PAUSE', 'PREPARE', 'SLICING'].includes(report.value.state),
);
const time = computed(() =>
  report.value
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: props.timezone || 'Asia/Shanghai',
      }).format(new Date(report.value.reportedAt))
    : '',
);
</script>

<template>
  <section v-if="online || report" class="device-telemetry" aria-label="打印状态与温度">
    <header>
      <strong
        ><template v-if="stale && report">上次状态 · </template
        >{{ report ? states[report.state] || '状态待识别' : '设备遥测' }}</strong
      >
      <small v-if="report">{{ stale ? '上次读数' : '采样于' }} {{ time }}</small>
    </header>
    <template v-if="report">
      <div v-if="active" class="print-progress">
        <div>
          <strong v-if="report.progress !== null">{{ report.progress }}%</strong>
          <span v-if="report.layer !== null && report.layers"
            >第 {{ report.layer }} / {{ report.layers }} 层</span
          >
          <span v-if="report.remainingMinutes !== null"
            >预计剩余 {{ report.remainingMinutes }} 分钟</span
          >
        </div>
        <progress
          v-if="report.progress !== null"
          :value="report.progress"
          max="100"
          aria-label="打印进度"
        />
      </div>
      <dl>
        <div v-for="sensor in report.temperatures" :key="sensor.name">
          <dt>{{ sensor.name }}</dt>
          <dd>
            <strong>{{ sensor.current === null ? '—' : sensor.current + '°C' }}</strong>
            <small>{{
              sensor.target === 0
                ? '未加热'
                : sensor.target === null
                  ? '目标未知'
                  : '目标 ' + sensor.target + '°C'
            }}</small>
          </dd>
        </div>
      </dl>
    </template>
    <p v-else>{{ loading ? '正在读取设备快照…' : '暂未收到设备快照' }}</p>
  </section>
</template>
