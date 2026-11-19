<script setup lang="ts">
import { ref } from 'vue';
import { api, download } from '../lib/api';
import { useWorkspace } from '../lib/store';
import type { BackupPreview } from '../../../../packages/shared/src';
import Modal from './Modal.vue';
const store = useWorkspace(),
  file = ref<File | null>(null),
  preview = ref<BackupPreview | null>(null),
  busy = ref(false),
  confirm = ref(false),
  error = ref('');
function select(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
  preview.value = null;
  error.value = '';
}
async function upload(restore: boolean) {
  if (!file.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const data = new FormData();
    data.append('file', file.value);
    if (restore && preview.value) {
      await api('/backup/restore', {
        method: 'POST',
        headers: { 'x-restore-ticket': preview.value.ticket },
        body: data,
      });
      preview.value = null;
      await store.load();
      store.toast('工作空间已恢复，恢复前备份可下载');
    } else
      preview.value = await api<BackupPreview>('/backup/verify', { method: 'POST', body: data });
  } catch (e) {
    error.value = (e as Error).message;
    preview.value = null;
  } finally {
    busy.value = false;
    confirm.value = false;
  }
}
async function previous() {
  try {
    await download('/backup/previous', 'spoolnest-before-restore.sql');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>
<template>
  <section class="restore-tools">
    <h3>验证与恢复云端备份</h3>
    <p class="muted">
      选择导出的 SQL 文件（最多 16 MiB）。系统先在隔离库试读，验证成功后可预览并确认恢复。
    </p>
    <div class="actions">
      <input
        type="file"
        accept=".sql,application/sql"
        aria-label="选择云端备份"
        :disabled="busy"
        @change="select"
      /><button class="button" :disabled="!file || busy" @click="upload(false)">验证备份</button>
    </div>
    <p v-if="busy" role="status">正在处理备份…</p>
    <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
    <template v-if="preview">
      <p>
        验证通过 ·
        {{
          preview.capturedAt
            ? new Date(preview.capturedAt).toLocaleString('zh-CN')
            : '旧备份未记录导出日期'
        }}
      </p>
      <table>
        <thead>
          <tr>
            <th>数据</th>
            <th>当前工作空间</th>
            <th>备份中</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(name, key) in { spools: '料卷', jobs: '任务', transactions: '库存流水' }"
            :key="key"
          >
            <td>{{ name }}</td>
            <td>{{ preview.current[key] }}</td>
            <td>{{ preview.incoming[key] }}</td>
          </tr>
        </tbody>
      </table>
      <button class="button" :disabled="busy" @click="confirm = true">恢复此备份…</button>
    </template>
    <button v-if="store.data?.hasPreviousBackup" class="text-button" @click="previous">
      下载上次恢复前的备份
    </button>
    <Modal
      v-model:open="confirm"
      title="替换当前工作空间？"
      description="料卷、任务、流水和偏好将恢复到备份中的状态。系统会先保存当前工作空间，替换上一次恢复前备份。"
    >
      <p>备份文件：{{ file?.name }}</p>
      <template #footer
        ><button class="button" :disabled="busy" @click="confirm = false">取消</button
        ><button class="button primary" :disabled="busy" @click="upload(true)">
          确认恢复
        </button></template
      >
    </Modal>
  </section>
</template>
