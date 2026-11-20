import { z } from 'zod';
export const id = z.string().min(1).max(160);
export const weight = z.number().int().min(0).max(100_000_000);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const materialTypes = ['PLA', 'PLA+', 'PLA Matte', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PC'];
export const weightSource = z.enum(['cloud_report', 'slicer_estimate', 'manual', 'weighed']);
export const printStatus = z.enum(['printing', 'completed', 'failed', 'cancelled', 'unknown']);
export const productSchema = z.object({
  brand: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  material: z.string().trim().min(1).max(80),
  subtype: z.string().max(80).default(''),
  colorName: z.string().max(80).default(''),
  colorHex: color,
  colorCode: z.string().max(80).default(''),
  netMg: weight.refine((n) => n > 0),
});
export const spoolSchema = z.object({
  product: productSchema,
  remainingMg: weight,
  emptyMg: weight.nullable().default(null),
  priceCents: z.number().int().min(0).max(100_000_000).nullable().default(null),
  purchasedAt: z.string().max(30).nullable().default(null),
  openedAt: z.string().max(30).nullable().default(null),
  location: z.string().max(160).default(''),
  notes: z.string().max(2000).default(''),
  status: z.enum(['sealed', 'opened', 'empty', 'archived']).default('opened'),
  count: z.number().int().min(1).max(100).default(1),
});
export const spoolEditSchema = spoolSchema
  .omit({ remainingMg: true, count: true })
  .extend({ expectedVersion: z.number().int().min(0) });
export const allocationSchema = z.object({
  materialId: id,
  spoolId: id,
  amountMg: weight,
  source: z.enum(['manual', 'weighed']).default('manual'),
});
export const reviewSchema = z.object({
  requestId: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  mode: z.enum(['confirm', 'correct']).default('confirm'),
  allocations: z.array(allocationSchema).min(1).max(200),
  acknowledgeIncomplete: z.boolean().default(false),
  acknowledgeNonSuccess: z.boolean().default(false),
  notes: z.string().max(2000).default(''),
});
export const undoSchema = z.object({
  requestId: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  notes: z.string().max(2000).default(''),
});
export const materialSchema = z.object({
  material: z.string().max(80).nullable().default(null),
  colorHex: color.nullable().default(null),
  colorName: z.string().max(80).nullable().default(null),
  suggestedMg: weight.nullable().default(null),
  source: weightSource,
  sourceSlot: z.string().max(120).nullable().default(null),
  sourceNozzle: z.string().max(120).nullable().default(null),
});
export const jobSchema = z.object({
  name: z.string().trim().min(1).max(300),
  printerId: id.nullable().default(null),
  startedAt: z.iso.datetime().nullable().default(null),
  finishedAt: z.iso.datetime().nullable().default(null),
  durationSeconds: z.number().int().min(0).nullable().default(null),
  printStatus: printStatus.default('unknown'),
  totalMg: weight.nullable().default(null),
  materials: z.array(materialSchema).max(100),
  incomplete: z.boolean().default(false),
  notes: z.string().max(2000).default(''),
});
export const printerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  serial: z.string().max(100).nullable().default(null),
  connection: z.enum(['manual', 'cloud', 'lan']).default('manual'),
});
export const sourceLabels: Record<string, string> = {
  manual: '手动输入',
  weighed: '实际称重',
  cloud_report: '云端任务报告',
  slicer_estimate: '切片估算',
  bambu_cloud: '拓竹云端 · 实验性',
  three_mf: '3MF 切片文件',
};
export const printLabels: Record<string, string> = {
  printing: '打印中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
};
export const reviewLabels: Record<string, string> = {
  pending: '待核对',
  reviewed: '已核对',
  ignored: '已忽略',
  awaiting_data: '待获取数据',
  error: '存在异常',
};
export const transactionLabels: Record<string, string> = {
  initial: '新增库存',
  consumption: '打印消耗',
  manual: '手动扣减',
  calibration: '重量校准',
  restore: '库存恢复',
  correction: '打印任务更正',
};
export type Product = z.infer<typeof productSchema> & { id: string };
export type Spool = Omit<z.infer<typeof spoolSchema>, 'product' | 'count'> & {
  id: string;
  productId: string;
  product: Product;
  version: number;
  createdAt: string;
  installed: string[];
  cloudSpoolId: number | null;
  lastChangeBatch: number | null;
};
export type Material = z.infer<typeof materialSchema> & { id: string; jobId: string };
export type Allocation = z.infer<typeof allocationSchema>;
export type Review = {
  id: string;
  jobId: string;
  kind: string;
  createdAt: string;
  notes: string;
  allocations: Allocation[];
};
export type Job = Omit<z.infer<typeof jobSchema>, 'materials'> & {
  id: string;
  source: string;
  externalId: string | null;
  externalDeviceId: string;
  reviewStatus: string;
  version: number;
  createdAt: string;
  materials: Material[];
  reviews: Review[];
  printerName: string | null;
  slotSnapshot: SlotBinding[];
  thumbnail: string | null;
};
export type SlotBinding = {
  slotId: string;
  slotName: string;
  spoolId: string;
  extruderId: string | null;
  assignedAt: string;
  unassignedAt: string | null;
};
export type PrinterPresence = {
  checkedAt: string | null;
  online: Record<string, boolean>;
};
export type Printer = z.infer<typeof printerSchema> & {
  id: string;
  lastSyncAt: string | null;
  status: string;
  extruders: { id: string; name: string; mappingVerified: number }[];
  slots: {
    id: string;
    name: string;
    kind: string;
    extruderId: string | null;
    spoolId: string | null;
  }[];
};
export type Transaction = {
  id: string;
  spoolId: string;
  jobId: string | null;
  reviewId: string | null;
  kind: string;
  deltaMg: number;
  beforeMg: number;
  afterMg: number;
  source: string;
  notes: string;
  createdAt: string;
  productName: string;
  brand: string;
  material: string;
  colorHex: string;
  printerName: string | null;
  costCents: number | null;
  jobName: string | null;
};
export type SyncState = {
  status: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  cursor: string | null;
  configured: boolean;
  enabled: boolean;
  region: string;
};
export const spoolComparisonSchema = z.object({
  id: z.string(),
  comparedAt: z.string().datetime(),
  added: z.number().int(),
  linkedCount: z.number().int(),
  localCount: z.number().int(),
  cloudCount: z.number().int(),
  warnings: z.array(z.string()),
  localOnly: z.array(
    z.object({
      spoolId: z.string(),
      label: z.string(),
      localRemainingMg: z.number(),
      expectedVersion: z.number(),
      reason: z.enum(['unlinked', 'not_returned']),
      kept: z.boolean(),
    }),
  ),
  differences: z.array(
    z.object({
      spoolId: z.string(),
      label: z.string(),
      localRemainingMg: z.number(),
      expectedVersion: z.number(),
      cloudRemainingMg: z.number(),
    }),
  ),
});
export type SpoolComparison = z.infer<typeof spoolComparisonSchema>;
export const restockInput = z.object({
  material: z.string().min(1).max(80),
  colorHex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((x) => x.toUpperCase()),
  minimumMg: z.number().int().min(0).max(1_000_000_000).nullable(),
  ordered: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});
export type RestockItem = {
  material: string;
  colorHex: string;
  colorName: string;
  remainingMg: number;
  sealed: number;
  count: number;
  minimumMg: number | null;
  ordered: boolean;
  version: number;
};
export type BackupCounts = { spools: number; jobs: number; transactions: number };
export type BackupPreview = {
  capturedAt: string | null;
  current: BackupCounts;
  incoming: BackupCounts;
  ticket: string;
};
export type Overview = {
  spoolComparison?: SpoolComparison | null;
  restock?: RestockItem[];
  hasPreviousBackup?: boolean;
  backupFormat?: 'db' | 'sql';
  spools: Spool[];
  jobs: Job[];
  printers: Printer[];
  transactions: Transaction[];
  sync: SyncState;
  settings: { lowStockMg: number; locale: string; timezone: string };
};
export const mg = (grams: number) => Math.round(grams * 1000);
export const grams = (value: number) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format((value || 0) / 1000);

export type PrinterTemperature = {
  name: string;
  current: number | null;
  target: number | null;
};
export type PrinterTelemetry = {
  reportedAt: string;
  state: string;
  progress: number | null;
  remainingMinutes: number | null;
  layer: number | null;
  layers: number | null;
  temperatures: PrinterTemperature[];
};
