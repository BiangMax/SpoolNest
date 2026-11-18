<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  ShieldCheck,
  Cloud,
  Database,
  Download,
  Unplug,
  ExternalLink,
  RefreshCw,
  Info,
  Settings2,
  LockKeyhole,
} from 'lucide-vue-next';
import { useWorkspace } from '../lib/store';
import { download } from '../lib/api';
import { date } from '../lib/format';
import Modal from '../components/Modal.vue';
const store = useWorkspace(),
  threshold = ref((store.data?.settings.lowStockMg || 150000) / 1000),
  timezone = ref(store.data?.settings.timezone || 'Asia/Shanghai'),
  enableOpen = ref(false),
  ack = ref(false),
  error = ref(''),
  saving = ref(false),
  backupBusy = ref(false),
  disconnectOpen = ref(false);
const statusLabels: Record<string, string> = {
  unavailable: '当前数据源未启用',
  ready: '已启用 · 待首次验证',
  syncing: '正在同步',
  success: '同步成功',
  partial: '部分同步成功',
  auth_expired: '认证失效',
  failed: '同步失败',
};
async function enable() {
  saving.value = true;
  error.value = '';
  try {
    await store.mutate(
      '/integration/enable',
      { acknowledgeExperimental: true },
      'POST',
      '实验云端接入已启用，点击同步读取任务',
    );
    enableOpen.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function disconnect() {
  try {
    await store.mutate('/integration/disconnect', {}, 'POST', '已断开连接并清除进程中的令牌');
    disconnectOpen.value = false;
  } catch (e) {
    store.toast((e as Error).message);
  }
}
async function backup() {
  backupBusy.value = true;
  try {
    await download('/backup', `spoolnest-${new Date().toISOString().slice(0, 10)}.db`);
    store.toast('数据库备份已下载');
  } catch (e) {
    store.toast((e as Error).message);
  } finally {
    backupBusy.value = false;
  }
}
async function preferences() {
  try {
    await store.mutate(
      '/settings',
      { lowStockMg: Math.round(threshold.value * 1000), timezone: timezone.value, locale: 'zh-CN' },
      'PUT',
      '偏好设置已保存',
    );
  } catch (e) {
    store.toast((e as Error).message);
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <div class="eyebrow">MAKE YOURSELF AT HOME</div>
      <h1>系统设置</h1>
      <p>管理数据连接、库存偏好与你的本地数据。</p>
    </div>
    <span class="badge subtle"><ShieldCheck :size="14" />单用户 · 自托管</span>
  </div>
  <div class="settings-layout">
    <section class="panel settings-panel">
      <div class="panel-heading">
        <div class="settings-title">
          <span class="settings-icon"><Cloud :size="22" /></span>
          <div>
            <h2>拓竹云端连接 <span class="badge warning">实验性</span></h2>
            <p>正常云端模式下读取历史任务，不发送打印控制指令。</p>
          </div>
        </div>
      </div>
      <div class="settings-body">
        <div class="integration-status">
          <span
            class="status-dot"
            :class="store.data?.sync.status === 'success' ? 'green' : 'amber'"
          /><strong>{{ statusLabels[store.data?.sync.status || 'unavailable'] }}</strong
          ><span>{{ store.data?.sync.region === 'cn' ? '中国区' : '全球区' }}</span>
        </div>
        <div class="detail-meta">
          <span
            >最近成功同步<strong>{{ date(store.data?.sync.lastSuccessAt || null) }}</strong></span
          ><span
            >授权配置<strong>{{
              store.data?.sync.configured ? '本机环境已配置' : '尚未配置'
            }}</strong></span
          >
        </div>
        <div v-if="store.data?.sync.error" class="error-banner">{{ store.data.sync.error }}</div>
        <div class="callout warning">
          <Info :size="18" />
          <p>
            此适配器依据社区研究的非公开接口实现，并非官方稳定 API。已完成源码与解析器验证；A1
            mini、X2D 的账户可访问范围、材料明细与喷嘴映射仍需你的真实任务验证。
          </p>
        </div>
        <div class="setup-steps">
          <div>
            <span>1</span>
            <p>
              在本机 <code>.env</code> 设置 <code>BAMBU_EXPERIMENTAL=true</code>、<code
                >BAMBU_REGION</code
              >
              与你授权的 <code>BAMBU_ACCESS_TOKEN</code>。
            </p>
          </div>
          <div>
            <span>2</span>
            <p>
              重启服务，阅读接入报告后启用。SpoolNest 不采集账户密码，不要求关闭打印机安全设置。
            </p>
          </div>
          <div>
            <span>3</span>
            <p>点击同步。核实真实返回的任务与材料信息后，再人工核对实体料卷。</p>
          </div>
        </div>
        <div class="actions">
          <button
            v-if="!store.data?.sync.enabled"
            class="button primary"
            @click="
              enableOpen = true;
              ack = false;
              error = '';
            "
          >
            了解并启用</button
          ><template v-else
            ><button class="button primary" :disabled="store.busy" @click="store.sync()">
              <RefreshCw :size="15" />同步最近任务</button
            ><button
              v-if="store.data.sync.cursor"
              class="button"
              :disabled="store.busy"
              @click="store.sync(true)"
            >
              继续历史批次</button
            ><button class="button" :disabled="store.busy" @click="store.syncSpools()">
              <RefreshCw :size="15" />同步云端库存</button
            ><button class="button" @click="disconnectOpen = true">
              <Unplug :size="15" />断开授权
            </button></template
          ><a
            href="https://github.com/BiangMax/SpoolNest/blob/main/docs/bambu-integration.md"
            target="_blank"
            rel="noreferrer"
            class="text-link"
            >技术边界与验证步骤<ExternalLink :size="14"
          /></a>
        </div>
        <div v-if="store.spoolSync" class="callout warning">
          <Info :size="18" />
          <div>
            <p v-if="store.spoolSync.differences.length">
              克重差异 {{ store.spoolSync.differences.length }}
              卷（本地数值未覆盖，请人工校准或核对后更正）：
            </p>
            <p v-else>云端库存与本地一致，无克重差异。</p>
            <ul v-if="store.spoolSync.differences.length" class="diff-list">
              <li v-for="d in store.spoolSync.differences.slice(0, 6)" :key="d.spoolId">
                {{ d.label }} · 云端 {{ Math.round(d.cloudRemainingMg / 1000) }}g / 本地
                {{ Math.round(d.localRemainingMg / 1000) }}g
              </li>
            </ul>
            <p v-if="store.spoolSync.differences.length > 6">
              …等共 {{ store.spoolSync.differences.length }} 卷，全部以后续同步结果为准。
            </p>
            <p v-if="store.spoolSync.warnings.length">{{ store.spoolSync.warnings.join('；') }}</p>
          </div>
        </div>
        <p class="help-text">
          每批最多读取 5 页、每页 50 项；重复任务按云端 ID
          去重。云端库存同步只新增本地没有的卷并回链同规格唯一卷，克重差异仅报告、永不覆盖你确认过的本地数值。云端接入不可用时，3MF
          与手动任务仍可正常使用。
        </p>
      </div>
    </section>
    <section class="panel settings-panel">
      <div class="panel-heading settings-title">
        <span class="settings-icon"><Settings2 :size="22" /></span>
        <div>
          <h2>工作室偏好</h2>
          <p>统一库存提醒与统计时区。</p>
        </div>
      </div>
      <form class="settings-body form-grid" @submit.prevent="preferences">
        <label class="field"
          ><span>低库存阈值（g）</span
          ><input v-model.number="threshold" type="number" min="0" step="0.001" required /></label
        ><label class="field"
          ><span>统计时区</span
          ><select v-model="timezone">
            <option value="Asia/Shanghai">Asia/Shanghai · 中国</option>
            <option value="UTC">UTC</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="Europe/London">Europe/London</option>
          </select></label
        >
        <div class="full"><button class="button">保存偏好</button></div>
      </form>
    </section>
    <section class="panel settings-panel">
      <div class="panel-heading settings-title">
        <span class="settings-icon"><Database :size="22" /></span>
        <div>
          <h2>数据与备份</h2>
          <p>数据库包含库存、核对、设备绑定和完整流水。</p>
        </div>
      </div>
      <div class="settings-body">
        <div class="settings-row">
          <div>
            <strong>下载完整 SQLite 备份</strong>
            <p>使用数据库在线备份 API，保证一致性。</p>
          </div>
          <button class="button" :disabled="backupBusy" @click="backup">
            <Download :size="16" />{{ backupBusy ? '备份中…' : '下载备份' }}
          </button>
        </div>
        <div class="settings-row">
          <div>
            <strong>从备份恢复</strong>
            <p>停止服务后，在终端运行恢复命令；原数据库会另存备份。</p>
            <code class="code-block">npm run restore -- /path/backup.db --server-stopped</code>
          </div>
        </div>
      </div>
    </section>
    <section class="security-note">
      <ShieldCheck :size="22" />
      <div>
        <h3>安全从本地开始</h3>
        <p>
          默认仅监听 127.0.0.1。对外监听必须配置强管理员令牌。令牌不会写入数据库或
          GitHub；请自行保护 .env 和数据库备份。
        </p>
      </div>
    </section>
  </div>
  <Modal
    v-model:open="enableOpen"
    title="启用实验性云端读取"
    description="这是非公开社区接口；仅在你了解并接受限制后启用。"
    ><div class="callout warning">
      接口可能变更、拒绝请求或失效。使用你自己的授权
      Token，访问与你账户相关的任务数据；重量属于报告值，不能视为打印机精确实测。
    </div>
    <label class="checkbox-label"
      ><input v-model="ack" type="checkbox" />我了解非公开接口风险，授权 SpoolNest
      使用本机配置的令牌只读获取任务。</label
    >
    <div v-if="error" class="error-banner">{{ error }}</div>
    <template #footer
      ><button class="button" @click="enableOpen = false">取消</button
      ><button class="button primary" :disabled="!ack || saving" @click="enable">
        启用读取
      </button></template
    ></Modal
  ><Modal
    v-model:open="disconnectOpen"
    title="断开云端授权？"
    description="保留历史任务和库存，禁用后续云端同步。"
    ><p>
      将清除当前进程的令牌。请同时删除本机 .env 中的 BAMBU_ACCESS_TOKEN；应用不会改写你的环境文件。
    </p>
    <template #footer
      ><button class="button" @click="disconnectOpen = false">取消</button
      ><button class="button primary" @click="disconnect">断开并清除内存凭据</button></template
    ></Modal
  >
</template>
