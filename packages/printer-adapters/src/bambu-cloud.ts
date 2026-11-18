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
const filamentHit = z
  .object({
    id: z.number().int().safe(),
    filamentVendor: z.string().max(100).nullable().optional(),
    filamentName: z.string().max(160).nullable().optional(),
    filamentType: z.string().max(80).nullable().optional(),
    color: z.string().max(40).nullable().optional(),
    netWeight: z.union([z.number(), z.string()]).nullable().optional(),
    totalNetWeight: z.union([z.number(), z.string()]).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    inPrinter: z.boolean().nullable().optional(),
    depleted: z.boolean().nullable().optional(),
    devId: z.string().max(120).nullable().optional(),
    amsId: z.number().int().nullable().optional(),
    slotId: z.union([z.number().int().safe(), z.string()]).nullable().optional(),
  })
  .passthrough();
export type CloudFilament = {
  id: number;
  vendor: string | null;
  name: string | null;
  material: string | null;
  color: string | null;
  remainingMg: number | null;
  totalNetWeightMg: number | null;
  note: string | null;
  inPrinter: boolean;
  depleted: boolean;
  deviceId: string | null;
  amsId: number | null;
  slot: string | null;
};
export function parseCloudFilament(raw: unknown): CloudFilament | null {
  const r = filamentHit.safeParse(raw);
  if (!r.success) return null;
  const h = r.data;
  return {
    id: h.id,
    vendor: h.filamentVendor?.trim() || null,
    name: h.filamentName?.trim() || null,
    material: h.filamentType?.trim() || null,
    color: hex(h.color),
    remainingMg: amount(h.netWeight),
    totalNetWeightMg: amount(h.totalNetWeight),
    note: h.note?.trim() || null,
    inPrinter: !!h.inPrinter,
    depleted: !!h.depleted,
    deviceId: h.devId?.trim() || null,
    amsId: h.amsId ?? null,
    slot: h.slotId === undefined || h.slotId === null || h.slotId === '' ? null : String(h.slotId),
  };
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
      // 实机对照（cn 区 2026-11-18，账号实测 8 条，与 Bambu Studio 打印历史逐条核对）：
      // status 2=成功、3=已取消。5=失败来自社区源码注释，本账号数据未出现，保留候选；
      // 旧社区注释的 4=完成与本账号实测矛盾，一律归入 unknown，不猜。
      printStatus:
        t.status === 2
          ? 'completed'
          : t.status === 3
            ? 'cancelled'
            : t.status === 5
              ? 'failed'
              : 'unknown',
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
  async filament() {
    // cn 区实机验证（2026-11-18）：该端点返回账户全部云端登记料卷（含手动录入的非
    // RFID 卷）；netWeight 为云端报告的剩余克数，非打印机实测。
    const data = z
      .object({ hits: z.array(z.unknown()).max(1000) })
      .parse(await this.get('/v1/design-user-service/my/filament/v2'));
    const spools: CloudFilament[] = [];
    const warnings: string[] = [];
    for (const raw of data.hits) {
      const parsed = parseCloudFilament(raw);
      if (parsed) spools.push(parsed);
      else warnings.push('一条云端库存条目结构不兼容，已跳过');
    }
    return { spools, warnings };
  }
}
