import { z } from 'zod';
import { jobSchema, mg } from '../../shared/src';
import type { ImportedJob, PrinterAdapter } from './index';
const scalar = z.union([z.string().min(1), z.number().int().safe()]);
const detail = z
  .object({
    ams: scalar.optional(),
    weight: z.union([z.number(), z.string()]).nullable().optional(),
    filamentType: z.string().optional(),
    targetFilamentType: z.string().optional(),
    sourceColor: z.string().optional(),
    targetColor: z.string().optional(),
  })
  .passthrough();
const task = z
  .object({
    id: scalar,
    deviceId: scalar,
    title: z.string().optional(),
    designTitle: z.string().optional(),
    startTime: z
      .union([z.string().min(1), z.number().int().safe()])
      .nullable()
      .optional(),
    endTime: z
      .union([z.string().min(1), z.number().int().safe()])
      .nullable()
      .optional(),
    weight: z.union([z.number(), z.string()]).nullable().optional(),
    status: z.number().optional(),
    costTime: z.number().nullable().optional(),
    amsDetailMapping: z.array(detail).nullable().optional(),
    amsMapping2: z.array(z.unknown()).nullable().optional(),
    cover: z.string().nullable().optional(),
  })
  .passthrough();
function amount(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? mg(n) : null;
}
function date(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized =
    /^\d{4}-\d\d-\d\dT/.test(value) && !/(Z|[+-]\d\d:\d\d)$/.test(value) ? null : value;
  if (!normalized) return null;
  const d = new Date(normalized);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}
function hex(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/^#/, '').slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(cleaned) ? `#${cleaned}` : null;
}
export function parseCloudTask(raw: unknown): ImportedJob {
  const t = task.parse(raw);
  const materials = (t.amsDetailMapping || []).map((d) => {
    const index = Number(d.ams);
    const mapping =
      Number.isInteger(index) && index >= 0 && index < 254 ? t.amsMapping2?.[index] : null;
    const map = mapping as { amsId?: number; slotId?: number } | null;
    const sourceSlot =
      map && Number.isInteger(map.amsId) && Number.isInteger(map.slotId)
        ? `AMS ${map.amsId} / slot ${map.slotId}`
        : d.ams !== undefined
          ? `未验证来源索引 ${d.ams}`
          : null;
    return {
      material: d.filamentType || d.targetFilamentType || null,
      colorHex: hex(d.sourceColor || d.targetColor),
      colorName: null,
      suggestedMg: amount(d.weight),
      source: 'cloud_report' as const,
      sourceSlot,
      sourceNozzle: null,
    };
  });
  const totalMg = amount(t.weight);
  const incomplete =
    !materials.length ||
    materials.some((m) => m.suggestedMg === null) ||
    (totalMg !== null &&
      Math.abs(materials.reduce((sum, m) => sum + (m.suggestedMg || 0), 0) - totalMg) > 1000);
  return {
    ...jobSchema.parse({
      name: t.title || t.designTitle || `拓竹任务 ${t.id}`,
      startedAt: date(t.startTime),
      finishedAt: date(t.endTime),
      printStatus: t.status === 4 ? 'completed' : t.status === 5 ? 'failed' : 'unknown',
      totalMg,
      materials,
      incomplete,
      notes: '社区接口报告；重量不代表打印机实测。喷嘴与槽位映射未经本机验证。',
    }),
    externalId: String(t.id),
    externalDeviceId: String(t.deviceId),
    thumbnail: t.cover && /^https:\/\//.test(t.cover) ? t.cover : null,
  };
}
export class BambuCloudAdapter implements PrinterAdapter {
  readonly source = 'bambu_cloud';
  private token: string | undefined;
  constructor(
    token: string | undefined,
    readonly region: 'cn' | 'global' = 'cn',
  ) {
    this.token = token;
  }
  disconnect() {
    this.token = undefined;
  }
  get configured() {
    return !!this.token;
  }
  private async get(path: string) {
    if (!this.token) throw new Error('未配置授权令牌；请在本机环境变量配置后重启');
    const base = this.region === 'cn' ? 'https://api.bambulab.cn' : 'https://api.bambulab.com';
    const res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (res.status === 401 || res.status === 403)
      throw new Error('认证失效，请重新授权；未更改任何库存');
    if (!res.ok) throw new Error(`云端请求失败（HTTP ${res.status}）`);
    const text = await res.text();
    if (text.length > 8_000_000) throw new Error('云端响应过大');
    return JSON.parse(text);
  }
  async testConnection() {
    const data = z
      .object({ devices: z.array(z.unknown()) })
      .parse(await this.get('/v1/iot-service/api/user/bind'));
    return { devices: data.devices };
  }
  async history(offset = 0) {
    const data = z
      .object({ hits: z.array(z.unknown()).max(100), total: z.number().optional() })
      .parse(await this.get(`/v1/user-service/my/tasks?limit=50&offset=${offset}`));
    const jobs: ImportedJob[] = [];
    const warnings: string[] = [];
    for (const raw of data.hits) {
      try {
        jobs.push(parseCloudTask(raw));
      } catch {
        warnings.push('一条云端任务缺少可靠 ID 或结构不兼容，已跳过');
      }
    }
    return {
      jobs,
      warnings,
      nextOffset:
        data.hits.length === 50 &&
        (data.total === undefined || offset + data.hits.length < data.total)
          ? offset + data.hits.length
          : null,
    };
  }
}
