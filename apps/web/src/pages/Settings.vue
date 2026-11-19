<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
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
  ArrowRight,
  CheckCircle2,
} from 'lucide-vue-next';
import CloudRecovery from '../components/CloudRecovery.vue';
import PageHeading from '../components/PageHeading.vue';
import { useWorkspace } from '../lib/store';
import { download } from '../lib/api';
import { date, grams, shortId } from '../lib/format';
import Modal from '../components/Modal.vue';
const store = useWorkspace(),
  threshold = ref((store.data?.settings.lowStockMg ?? 150000) / 1000),
  timezone = ref(store.data?.settings.timezone || 'Asia/Shanghai'),
  enableOpen = ref(false),
  ack = ref(false),
  error = ref(''),
  saving = ref(false),
  backupBusy = ref(false),
  disconnectOpen = ref(false);
const backupFormat = computed(() => store.data?.backupFormat ?? 'db');
async function scrollToComparison() {
  if (location.hash === '#comparison') {
    await nextTick();
    document.getElementById('comparison')?.scrollIntoView();
  }
}
onMounted(scrollToComparison);
watch(() => store.spoolSync?.id, scrollToComparison);
watch(
  () => store.data?.settings.lowStockMg,
  (value) => {
    if (value !== undefined) threshold.value = value / 1000;
  },
);
watch(
  () => store.data?.settings.timezone,
  (value) => {
    if (value) timezone.value = value;
  },
);
const statusLabels: Record<string, string> = {
  unavailable: '当前数据源未启用',
  ready: '已启用 · 待首次验证',
  syncing: '正在同步',
  success: '同步成功',
  partial: '部分同步成功',
  auth_expired: '认证失效',
  failed: '同步失败',
};
const spoolSyncNeedsAttention = computed(
  () =>
    !!(
      store.spoolSync?.differences.length ||
      store.spoolSync?.localOnly.some((s) => !s.kept) ||
      store.spoolSync?.warnings.length ||
      store.spoolSyncError
    ),
);
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
    await download(
      '/backup',
      `spoolnest-${new Date().toISOString().slice(0, 10)}.${backupFormat.value}`,
    );
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
  <PageHeading title="系统设置" description="配置云端连接、库存提醒和数据备份。">
    <span class="badge subtle">
      <ShieldCheck :size="14" />单用户 · {{ backupFormat === 'sql' ? 'Cloudflare' : '自托管' }}
    </span>
  </PageHeading>
  <div class="settings-layout">
    <nav class="settings-index" aria-label="设置分区">
      <a href="#cloud"><Cloud :size="16" />云端连接</a>
      <a href="#preferences"><Settings2 :size="16" />工作室偏好</a>
      <a href="#backup"><Database :size="16" />数据与备份</a>
    </nav>
    <div class="settings-sections">
      <section id="cloud" class="panel settings-panel">
        <div class="panel-heading">
          <div class="settings-title">
            <span class="settings-icon"><Cloud :size="22" /></span>
            <div>
              <h2>拓竹云端连接 <span class="badge warning">实验性</span></h2>
              <p>从拓竹云端读取历史任务，不发送打印控制指令。</p>
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
                store.data?.sync.configured ? '已配置' : '尚未配置'
              }}</strong></span
            >
          </div>
          <div v-if="store.data?.sync.error" class="error-banner">{{ store.data.sync.error }}</div>
          <div class="setup-steps">
            <div>
              <span>1</span>
              <p>
                在服务环境中设置 <code>BAMBU_EXPERIMENTAL=true</code>、<code>BAMBU_REGION</code>
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
          <div
            id="comparison"
            v-if="store.spoolSync"
            class="callout cloud-sync-result"
            :class="spoolSyncNeedsAttention ? 'warning' : 'success'"
          >
            <Info v-if="spoolSyncNeedsAttention" :size="18" />
            <CheckCircle2 v-else :size="18" />
            <div class="cloud-diff-content">
              <p>
                最近对照 {{ date(store.spoolSync.comparedAt, store.data?.settings.timezone) }} ·
                {{ store.pendingDifferences }} 卷待处理
              </p>
              <p class="cloud-count-summary">
                在库 {{ store.spoolSync.localCount }} 卷 · 本次云端返回
                {{ store.spoolSync.cloudCount }} 卷
              </p>
              <p v-if="store.spoolSync.differences.length">
                克重差异 {{ store.spoolSync.differences.length }}
                卷，核对后点击“同步”，将该卷的库存余量更新为右侧云端报告值，并记录校准流水。
              </p>
              <p v-else-if="!store.spoolSync.localOnly.some((s) => !s.kept)">
                本次对照已无待处理的差异。
              </p>
              <div v-if="store.spoolSync.differences.length" class="cloud-diff-list">
                <article
                  v-for="d in store.spoolSync.differences"
                  :key="d.spoolId"
                  class="cloud-diff-row"
                >
                  <h3>
                    {{ d.label }} <span>#{{ shortId(d.spoolId) }}</span>
                  </h3>
                  <div class="cloud-diff-comparison">
                    <div>
                      <span>SpoolNest 库存余量</span
                      ><strong>{{ grams(d.localRemainingMg) }} <small>g</small></strong>
                    </div>
                    <ArrowRight :size="20" aria-hidden="true" />
                    <div>
                      <span>拓竹云端报告余量</span
                      ><strong>{{ grams(d.cloudRemainingMg) }} <small>g</small></strong>
                    </div>
                    <button
                      class="button primary"
                      :disabled="store.busy"
                      :aria-label="`同步 ${d.label} #${shortId(d.spoolId)} 的云端重量`"
                      @click="store.applyCloudWeight(d)"
                    >
                      {{ store.applyingCloudSpool === d.spoolId ? '同步中…' : '同步' }}
                    </button>
                  </div>
                </article>
              </div>
              <div v-if="store.spoolSync.localOnly.length" class="cloud-local-only">
                <h3>未与云端对应的库存料卷</h3>
                <p>
                  这些料卷未关联云端，或本次云端未返回。请逐卷选择保留在库或归档。归档会保留历史，可在“已归档”库存恢复。
                </p>
                <div class="cloud-diff-list">
                  <article
                    v-for="d in store.spoolSync.localOnly"
                    :key="d.spoolId"
                    class="cloud-diff-row"
                  >
                    <h3>
                      {{ d.label }} <span>#{{ shortId(d.spoolId) }}</span>
                    </h3>
                    <div class="cloud-local-decision">
                      <div>
                        <strong>{{ grams(d.localRemainingMg) }} g</strong>
                        <span>{{
                          d.reason === 'unlinked' ? '未关联云端料卷' : '本次云端未返回此料卷'
                        }}</span>
                      </div>
                      <div class="actions">
                        <button
                          class="button"
                          :disabled="store.busy || d.kept"
                          :aria-label="`保留库存料卷 #${shortId(d.spoolId)}`"
                          @click="store.decideLocalSpool(d, 'keep')"
                        >
                          {{ d.kept ? '已保留在库' : '保留在库' }}
                        </button>
                        <button
                          class="button"
                          :disabled="store.busy"
                          :aria-label="`归档料卷 #${shortId(d.spoolId)}`"
                          @click="store.decideLocalSpool(d, 'archive')"
                        >
                          归档
                        </button>
                      </div>
                    </div>
                  </article>
                </div>
              </div>
              <p v-if="store.spoolSyncError" role="alert">{{ store.spoolSyncError }}</p>
              <p v-if="store.spoolSync.warnings.length">
                {{ store.spoolSync.warnings.join('；') }}
              </p>
            </div>
          </div>
          <p class="help-text">
            每批最多读取 5 页、每页 50 项；重复任务按云端 ID
            去重。读取云端库存会新增缺失料卷并关联已有料卷；逐卷点击“同步”即可更新库存余量，不会修改云端，也不会核对历史打印任务。云端接入不可用时，3MF
            与手动任务仍可正常使用。
          </p>
        </div>
      </section>
      <section id="preferences" class="panel settings-panel">
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
      <section id="backup" class="panel settings-panel">
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
              <p v-if="backupFormat === 'sql'">导出数据库结构和数据，保存为 SQL 文件。</p>
              <p v-else>使用数据库在线备份 API，保证一致性。</p>
            </div>
            <button class="button" :disabled="backupBusy" @click="backup">
              <Download :size="16" />{{ backupBusy ? '备份中…' : '下载备份' }}
            </button>
          </div>
          <CloudRecovery v-if="backupFormat === 'sql'" />
          <div class="settings-row">
            <div>
              <strong>{{ backupFormat === 'sql' ? '在本机打开备份副本' : '从备份恢复' }}</strong>
              <template v-if="backupFormat === 'sql'">
                <p>在终端运行以下命令，将备份导入一个新的 SQLite 数据库文件。</p>
                <code class="code-block">sqlite3 -bail restored.db &lt; spoolnest-backup.sql</code>
              </template>
              <template v-else>
                <p>停止服务后，在终端运行恢复命令，原数据库会另存备份。</p>
                <code class="code-block">npm run restore -- /path/backup.db --server-stopped</code>
              </template>
            </div>
          </div>
        </div>
      </section>
      <section class="security-note">
        <ShieldCheck :size="22" />
        <div>
          <h3>访问与凭据安全</h3>
          <p v-if="backupFormat === 'sql'">
            工作空间由 Cloudflare Access
            保护。拓竹令牌通过服务端密钥配置，请妥善保管下载的数据库备份。
          </p>
          <p v-else>
            默认仅监听 127.0.0.1。对外监听必须配置强管理员令牌。令牌不会写入数据库或
            GitHub；请自行保护 .env 和数据库备份。
          </p>
        </div>
      </section>
      <div class="callout warning">
        <Info :size="18" />
        <p>
          此适配器依据社区研究的非公开接口实现，并非官方稳定 API。已完成源码与解析器验证；A1
          mini、X2D 的账户可访问范围、材料明细与喷嘴映射仍需你的真实任务验证。
        </p>
      </div>
    </div>
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
      使用服务配置的令牌只读获取任务。</label
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
      将清除当前进程的令牌。请从部署环境或 .env 中移除 BAMBU_ACCESS_TOKEN，以免服务重启后重新读取。
    </p>
    <template #footer
      ><button class="button" @click="disconnectOpen = false">取消</button
      ><button class="button primary" @click="disconnect">断开并清除内存凭据</button></template
    ></Modal
  >
</template>
