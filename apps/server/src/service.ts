import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Database, DomainError, required } from './database';
import {
  spoolSchema,
  spoolEditSchema,
  jobSchema,
  printerSchema,
  reviewSchema,
  undoSchema,
  type Spool,
  type Job,
  type Printer,
  type Material,
  type Allocation,
  type Transaction,
  type Review,
  type SlotBinding,
} from '../../../packages/shared/src';
const now = () => new Date().toISOString();
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const camel = (row: any): any =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()), v]),
  );
export class Store {
  constructor(readonly db: Database) {}
  spools(): Spool[] {
    return this.db.all<any>('SELECT * FROM spool ORDER BY created_at DESC,id').map((row) => ({
      ...camel(row),
      product: camel(
        required(this.db.one('SELECT * FROM filament_product WHERE id=?', row.product_id)),
      ),
      installed: this.db
        .all<any>(
          'SELECT p.name AS printer, s.name FROM slot_assignment a JOIN printer_slot s ON s.id=a.slot_id JOIN printer p ON p.id=s.printer_id WHERE a.spool_id=? AND a.unassigned_at IS NULL',
          row.id,
        )
        .map((x) => `${x.printer} · ${x.name}`),
    }));
  }
  spool(id: string) {
    return required(
      this.spools().find((s) => s.id === id),
      '料卷不存在',
    );
  }
  private product(input: z.infer<typeof spoolSchema>['product']) {
    const signature = hash(input);
    const existing = this.db.one<any>(
      'SELECT id FROM filament_product WHERE signature=?',
      signature,
    );
    if (existing) return existing.id as string;
    const id = randomUUID();
    this.db.run(
      'INSERT INTO filament_product VALUES(?,?,?,?,?,?,?,?,?,?)',
      id,
      input.brand,
      input.name,
      input.material,
      input.subtype,
      input.colorName,
      input.colorHex,
      input.colorCode,
      input.netMg,
      signature,
    );
    return id;
  }
  private change(
    spoolId: string,
    deltaMg: number,
    kind: string,
    source: string,
    notes: string,
    jobId: string | null = null,
    reviewId: string | null = null,
    costOverride?: number | null,
    productOverride?: string,
  ) {
    const s = required(
      this.db.one<any>(
        'SELECT s.*,p.net_mg FROM spool s JOIN filament_product p ON p.id=s.product_id WHERE s.id=?',
        spoolId,
      ),
      '料卷不存在',
    );
    const after = s.remaining_mg + deltaMg;
    if (after < 0) throw new DomainError('库存不足，所有扣减已回滚', 409);
    this.db.run('UPDATE spool SET remaining_mg=?,version=version+1 WHERE id=?', after, spoolId);
    const cost =
      costOverride !== undefined
        ? costOverride
        : s.price_cents === null
          ? null
          : (-deltaMg / s.net_mg) * s.price_cents;
    this.db.run(
      'INSERT INTO inventory_transaction VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      randomUUID(),
      spoolId,
      jobId,
      reviewId,
      kind,
      deltaMg,
      s.remaining_mg,
      after,
      source,
      notes,
      now(),
      kind === 'initial' || kind === 'calibration' || kind === 'manual' ? null : cost,
      productOverride ?? s.product_id,
    );
  }
  addSpools(raw: unknown) {
    const input = spoolSchema.parse(raw);
    return this.db.transaction(() => this.insertSpools(input));
  }
  private insertSpools(input: z.infer<typeof spoolSchema>) {
    const productId = this.product(input.product);
    const ids: string[] = [];
    for (let i = 0; i < input.count; i++) {
      const id = randomUUID();
      this.db.run(
        'INSERT INTO spool(id,product_id,remaining_mg,empty_mg,price_cents,purchased_at,opened_at,location,notes,status,created_at) VALUES(?,?,0,?,?,?,?,?,?,?,?)',
        id,
        productId,
        input.emptyMg,
        input.priceCents,
        input.purchasedAt,
        input.openedAt,
        input.location,
        input.notes,
        input.status,
        now(),
      );
      this.change(id, input.remainingMg, 'initial', 'manual', '录入实体料卷');
      ids.push(id);
    }
    return ids.map((id) => this.spool(id));
  }
  importSpools(rows: unknown[]) {
    const inputs = z.array(spoolSchema).min(1).max(1000).parse(rows);
    return this.db.transaction(() => inputs.flatMap((input) => this.insertSpools(input)));
  }
  // 实验性云端库存同步（Bambu）。合并策略：只新增本地没有的卷、对同规格唯一候选回链
  // 云端 ID、克重差异只报告；用户逐卷确认后，可通过校准接口采用云端报告值。
  syncCloudSpools(raw: unknown[]) {
    const hits = z
      .array(
        z
          .object({
            id: z.number().int().safe(),
            vendor: z.string().max(100).nullable().optional(),
            name: z.string().max(160).nullable().optional(),
            material: z.string().max(80).nullable().optional(),
            color: z.string().max(40).nullable().optional(),
            remainingMg: z.number().int().min(0).max(100_000_000).nullable().optional(),
            totalNetWeightMg: z.number().int().min(0).max(100_000_000).nullable().optional(),
            note: z.string().max(2000).nullable().optional(),
          })
          .passthrough(),
      )
      .max(1000)
      .parse(raw);
    return this.db.transaction(() => {
      let added = 0;
      const linked: { spoolId: string; label: string }[] = [];
      const differences: {
        spoolId: string;
        label: string;
        cloudRemainingMg: number;
        localRemainingMg: number;
        expectedVersion: number;
      }[] = [];
      const warnings: string[] = [];
      for (const hit of hits) {
        const vendor = (hit.vendor || '').trim();
        const name = (hit.name || '').trim();
        const material = (hit.material || '').trim();
        const hex = (hit.color || '').slice(0, 7);
        const remainMg = hit.remainingMg ?? null;
        const totalMg = hit.totalNetWeightMg ?? null;
        if (!vendor || !name || !material || !/^#[0-9a-fA-F]{6}$/.test(hex) || remainMg === null) {
          warnings.push(`云端卷 ${hit.id} 缺少品牌/名称/材质/颜色/剩余量，未导入`);
          continue;
        }
        const label = `${vendor} ${name} ${material} ${hex}`;
        const linkedAlready = this.db.one<any>(
          'SELECT id FROM spool WHERE cloud_spool_id=?',
          hit.id,
        );
        if (linkedAlready) {
          const s = this.spool(linkedAlready.id as string);
          if (s.status !== 'archived') this.reportDrift(s, label, remainMg, differences);
          continue;
        }
        if (totalMg === null || totalMg <= 0) {
          warnings.push(`云端卷 ${hit.id}（${label}）缺少标称克重，未导入`);
          continue;
        }
        const productInput = {
          brand: vendor,
          name,
          material,
          subtype: '',
          colorName: '',
          colorHex: hex,
          colorCode: '',
          netMg: totalMg,
        };
        const productId = this.findProduct(productInput);
        const candidates = productId
          ? this.db.all<any>(
              "SELECT id,remaining_mg FROM spool WHERE product_id=? AND cloud_spool_id IS NULL AND status<>'archived' ORDER BY created_at",
              productId,
            )
          : [];
        let chosen: string | null = null;
        if (candidates.length === 1) chosen = candidates[0].id as string;
        else if (candidates.length > 1) {
          // 同规格多卷：优先按剩余克重（±1g）唯一命中回链；完全等价的多卷（如同克重
          // 未拆封官方卷）物理上无法区分，按本地添加顺序确定性对应——它们库存语义等价，
          // 且同步永不覆盖本地数值，误配仅影响差异报告指向的卷名。
          const byWeight = candidates.filter(
            (c) => Math.abs((c.remaining_mg as number) - remainMg) <= 1000,
          );
          if (byWeight.length >= 1) chosen = byWeight[0].id as string;
        }
        if (chosen) {
          this.db.run(
            'UPDATE spool SET cloud_spool_id=?,cloud_keep_local=0,version=version+1 WHERE id=?',
            hit.id,
            chosen,
          );
          const s = this.spool(chosen);
          if (!this.reportDrift(s, label, remainMg, differences))
            linked.push({ spoolId: chosen, label: `${label} ${remainMg}g` });
          continue;
        }
        if (candidates.length > 1) {
          warnings.push(
            `云端卷 ${hit.id}（${label}）在本地有 ${candidates.length} 卷同规格料卷且剩余克重都无法对应（可能均为云端报告漂移），请人工校准后重试`,
          );
          continue;
        }
        const id = randomUUID();
        this.db.run(
          'INSERT INTO spool(id,product_id,remaining_mg,empty_mg,price_cents,purchased_at,opened_at,location,notes,status,cloud_spool_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          this.product(productInput),
          0,
          null,
          null,
          null,
          null,
          '',
          hit.note || '拓竹云端库存同步；剩余量为云端报告值，可人工校准',
          remainMg <= 0 ? 'empty' : remainMg >= totalMg ? 'sealed' : 'opened',
          hit.id,
          now(),
        );
        this.change(id, remainMg, 'initial', 'cloud_report', '拓竹云端库存同步（报告值）');
        added++;
      }
      const cloudIds = new Set(hits.map((h) => h.id));
      const active = this.spools().filter((s) => s.status !== 'archived');
      const localOnly = active
        .filter((s) => s.cloudSpoolId == null || !cloudIds.has(s.cloudSpoolId))
        .map((s) => ({
          spoolId: s.id,
          label: `${s.product.brand} ${s.product.name} ${s.product.material} ${s.product.colorHex}`,
          localRemainingMg: s.remainingMg,
          expectedVersion: s.version,
          reason: s.cloudSpoolId == null ? 'unlinked' : 'not_returned',
          kept: !!this.db.one<any>('SELECT cloud_keep_local FROM spool WHERE id=?', s.id)
            ?.cloud_keep_local,
        }));
      return {
        added,
        linkedCount: linked.length,
        linked,
        differences,
        localOnly,
        localCount: active.length,
        cloudCount: cloudIds.size,
        warnings,
      };
    });
  }
  decideCloudSpool(id: string, raw: unknown) {
    const input = z
      .object({ decision: z.enum(['keep', 'archive']), expectedVersion: z.number().int().min(0) })
      .parse(raw);
    return this.db.transaction(() => {
      const s = this.spool(id);
      if (s.version !== input.expectedVersion)
        throw new DomainError('料卷已更新，请重新读取云端库存后裁定', 409);
      if (s.status === 'archived') throw new DomainError('料卷已归档，请重新对照', 409);
      if (input.decision === 'archive' && s.installed.length)
        throw new DomainError('请先解绑已安装的料卷，再归档', 409);
      this.db.run(
        'UPDATE spool SET cloud_keep_local=?,status=?,version=version+1 WHERE id=?',
        input.decision === 'keep' ? 1 : 0,
        input.decision === 'archive' ? 'archived' : s.status,
        id,
      );
      return this.spool(id);
    });
  }
  private reportDrift(
    s: Spool,
    label: string,
    cloudRemainMg: number,
    differences: {
      spoolId: string;
      label: string;
      cloudRemainingMg: number;
      localRemainingMg: number;
      expectedVersion: number;
    }[],
  ) {
    if (Math.abs(s.remainingMg - cloudRemainMg) <= 1000) return false;
    differences.push({
      spoolId: s.id,
      label,
      cloudRemainingMg: cloudRemainMg,
      localRemainingMg: s.remainingMg,
      expectedVersion: s.version,
    });
    return true;
  }
  private findProduct(input: z.infer<typeof spoolSchema>['product']) {
    const signature = hash(input);
    const existing = this.db.one<any>(
      'SELECT id FROM filament_product WHERE signature=?',
      signature,
    );
    return existing ? (existing.id as string) : null;
  }
  editSpool(id: string, raw: unknown) {
    const input = spoolEditSchema.parse(raw);
    return this.db.transaction(() => {
      const old = this.spool(id);
      if (old.version !== input.expectedVersion)
        throw new DomainError('料卷已更新，请刷新后重试', 409);
      if (input.status === 'archived' && old.installed.length)
        throw new DomainError('请先解绑已安装的料卷');
      const productId = this.product(input.product);
      this.db.run(
        'UPDATE spool SET product_id=?,empty_mg=?,price_cents=?,purchased_at=?,opened_at=?,location=?,notes=?,status=?,version=version+1 WHERE id=?',
        productId,
        input.emptyMg,
        input.priceCents,
        input.purchasedAt,
        input.openedAt,
        input.location,
        input.notes,
        input.status,
        id,
      );
      return this.spool(id);
    });
  }
  calibrate(id: string, raw: unknown) {
    const input = z
      .object({
        remainingMg: z.number().int().min(0).max(100_000_000),
        expectedVersion: z.number().int(),
        source: z.enum(['weighed', 'manual', 'cloud_report']),
        notes: z.string().min(1).max(2000),
      })
      .parse(raw);
    return this.db.transaction(() => {
      const s = this.spool(id);
      if (s.version !== input.expectedVersion)
        throw new DomainError('料卷已更新，请刷新后重试', 409);
      if (input.source === 'cloud_report' && s.cloudSpoolId == null)
        throw new DomainError('料卷未关联云端库存，请重新同步云端库存后重试', 409);
      this.change(
        id,
        input.remainingMg - s.remainingMg,
        input.source === 'manual' ? 'manual' : 'calibration',
        input.source,
        input.notes,
      );
      return this.spool(id);
    });
  }
  jobs(): Job[] {
    return this.db
      .all<any>(
        'SELECT j.*,p.name AS printer_name FROM print_job j LEFT JOIN printer p ON p.id=j.printer_id ORDER BY j.created_at DESC,j.id',
      )
      .map((row) => ({
        ...camel(row),
        incomplete: !!row.incomplete,
        slotSnapshot: JSON.parse(row.slot_snapshot),
        materials: this.db
          .all<any>('SELECT * FROM print_job_material WHERE job_id=? ORDER BY rowid', row.id)
          .map(camel),
        reviews: this.db
          .all<any>('SELECT * FROM job_review WHERE job_id=? ORDER BY rowid', row.id)
          .map((r) => ({
            id: r.id,
            jobId: r.job_id,
            kind: r.kind,
            createdAt: r.created_at,
            notes: r.notes,
            allocations: this.db
              .all<any>(
                'SELECT material_id,spool_id,amount_mg,source FROM review_allocation WHERE review_id=? ORDER BY rowid',
                r.id,
              )
              .map(camel),
          })),
      }));
  }
  job(id: string) {
    return required(
      this.jobs().find((j) => j.id === id),
      '打印任务不存在',
    );
  }
  snapshot(printerId: string | null, startedAt: string | null): SlotBinding[] {
    if (!printerId || !startedAt) return [];
    return this.db
      .all<any>(
        'SELECT a.slot_id,s.name AS slot_name,a.spool_id,s.extruder_id,a.assigned_at,a.unassigned_at FROM slot_assignment a JOIN printer_slot s ON s.id=a.slot_id WHERE s.printer_id=? AND a.assigned_at<=? AND (a.unassigned_at IS NULL OR a.unassigned_at>?)',
        printerId,
        startedAt,
        startedAt,
      )
      .map(camel);
  }
  addJob(
    raw: unknown,
    source = 'manual',
    externalId: string | null = null,
    externalDeviceId = '',
    thumbnail: string | null = null,
  ) {
    const input = jobSchema.parse(raw);
    return this.db.transaction(() => {
      if (input.printerId)
        required(this.db.one('SELECT id FROM printer WHERE id=?', input.printerId), '打印机不存在');
      if (externalId) {
        const exists = this.db.one<any>(
          'SELECT id FROM print_job WHERE source=? AND external_device_id=? AND external_id=?',
          source,
          externalDeviceId,
          externalId,
        );
        if (exists) {
          const old = this.job(exists.id);
          if (old.reviews.length === 0 && old.reviewStatus !== 'ignored') {
            const differs =
              old.printStatus !== input.printStatus ||
              old.totalMg !== input.totalMg ||
              JSON.stringify(old.materials.map(({ id, jobId, ...rest }) => rest)) !==
                JSON.stringify(input.materials);
            if (!old.printerId && input.printerId) {
              // 序列号后补：设备关联属于来源快照的一部分，未核对任务允许回填
              this.db.run(
                'UPDATE print_job SET printer_id=?,slot_snapshot=?,version=version+1 WHERE id=?',
                input.printerId,
                JSON.stringify(this.snapshot(input.printerId, input.startedAt)),
                old.id,
              );
            }
            if (differs) {
              this.db.run(
                'UPDATE print_job SET print_status=?,total_mg=?,finished_at=?,duration_seconds=?,incomplete=?,review_status=?,version=version+1 WHERE id=?',
                input.printStatus,
                input.totalMg,
                input.finishedAt,
                input.durationSeconds,
                input.incomplete ||
                  !input.materials.length ||
                  input.materials.some((m) => m.suggestedMg === null)
                  ? 1
                  : 0,
                input.materials.length ? 'pending' : 'awaiting_data',
                old.id,
              );
              this.db.run('DELETE FROM print_job_material WHERE job_id=?', old.id);
              this.insertMaterials(
                old.id,
                input.materials.length
                  ? input.materials
                  : [
                      {
                        material: null,
                        colorHex: null,
                        colorName: null,
                        suggestedMg: null,
                        source: source === 'bambu_cloud' ? 'cloud_report' : 'manual',
                        sourceSlot: null,
                        sourceNozzle: null,
                      },
                    ],
              );
            }
          }
          return { job: this.job(old.id), created: false };
        }
      }
      const id = randomUUID();
      const incomplete =
        input.incomplete ||
        !input.materials.length ||
        input.materials.some((m) => m.suggestedMg === null);
      this.db.run(
        'INSERT INTO print_job(id,name,printer_id,source,external_id,external_device_id,started_at,finished_at,duration_seconds,print_status,review_status,total_mg,incomplete,notes,slot_snapshot,thumbnail,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id,
        input.name,
        input.printerId,
        source,
        externalId,
        externalDeviceId,
        input.startedAt,
        input.finishedAt,
        input.durationSeconds,
        input.printStatus,
        input.materials.length ? 'pending' : 'awaiting_data',
        input.totalMg,
        incomplete ? 1 : 0,
        input.notes,
        JSON.stringify(this.snapshot(input.printerId, input.startedAt)),
        thumbnail,
        now(),
      );
      this.insertMaterials(
        id,
        input.materials.length
          ? input.materials
          : [
              {
                material: null,
                colorHex: null,
                colorName: null,
                suggestedMg: null,
                source:
                  source === 'bambu_cloud'
                    ? 'cloud_report'
                    : source === 'three_mf'
                      ? 'slicer_estimate'
                      : 'manual',
                sourceSlot: null,
                sourceNozzle: null,
              },
            ],
      );
      return { job: this.job(id), created: true };
    });
  }
  private insertMaterials(jobId: string, materials: z.infer<typeof jobSchema>['materials']) {
    for (const m of materials)
      this.db.run(
        'INSERT INTO print_job_material VALUES(?,?,?,?,?,?,?,?,?)',
        randomUUID(),
        jobId,
        m.material,
        m.colorHex,
        m.colorName,
        m.suggestedMg,
        m.source,
        m.sourceSlot,
        m.sourceNozzle,
      );
  }
  private replay(requestId: string, jobId: string, input: unknown) {
    const old = this.db.one<any>('SELECT * FROM job_review WHERE request_id=?', requestId);
    if (old) {
      if (old.job_id !== jobId || old.payload_hash !== hash(input))
        throw new DomainError('幂等键已用于不同请求', 409);
      return JSON.parse(old.result);
    }
    return null;
  }
  private restore(job: Job, reviewId: string) {
    const previous = job.reviews.at(-1);
    if (!previous || previous.kind === 'undo') return;
    const txs = this.db.all<any>(
      "SELECT * FROM inventory_transaction WHERE review_id=? AND kind IN ('consumption','correction')",
      previous.id,
    );
    for (const t of txs)
      this.change(
        t.spool_id,
        -t.delta_mg,
        'restore',
        'manual',
        '恢复上次核对影响',
        job.id,
        reviewId,
        t.cost_cents === null ? null : -t.cost_cents,
        t.product_id,
      );
  }
  review(id: string, raw: unknown) {
    const input = reviewSchema.parse(raw);
    return this.db.transaction(() => {
      const replay = this.replay(input.requestId, id, input);
      if (replay) return replay;
      const job = this.job(id);
      if (job.version !== input.expectedVersion)
        throw new DomainError('任务已变更，请刷新后重新核对', 409);
      if (input.mode === 'confirm' && job.reviewStatus === 'reviewed')
        throw new DomainError('任务已核对，请使用更正', 409);
      if (input.mode === 'correct' && job.reviewStatus !== 'reviewed')
        throw new DomainError('只有已核对任务可以更正', 409);
      if (job.reviewStatus === 'ignored') throw new DomainError('请先恢复待核对状态');
      if (job.printStatus === 'printing')
        throw new DomainError('打印尚未结束，请等待任务结束或更正打印状态');
      if (job.printStatus !== 'completed' && !input.acknowledgeNonSuccess)
        throw new DomainError('请确认已手动核实非成功任务的消耗');
      if (job.incomplete && !input.acknowledgeIncomplete)
        throw new DomainError('来源数据不完整，请确认已手动分配用量');
      const materials = new Set(job.materials.map((m) => m.id));
      const covered = new Set(input.allocations.map((a) => a.materialId));
      if (materials.size !== covered.size || [...covered].some((id) => !materials.has(id)))
        throw new DomainError('必须明确分配每一种材料，未消耗请填写 0g');
      const reviewId = randomUUID(),
        kind = input.mode === 'correct' ? 'correct' : 'confirm';
      const result = { id: reviewId, jobId: id, version: job.version + 1 };
      this.db.run(
        'INSERT INTO job_review VALUES(?,?,?,?,?,?,?,?)',
        reviewId,
        id,
        input.requestId,
        hash(input),
        kind,
        input.notes,
        now(),
        JSON.stringify(result),
      );
      if (kind === 'correct') this.restore(job, reviewId);
      const totals = new Map<string, number>();
      for (const a of input.allocations) {
        const s = this.spool(a.spoolId);
        if (s.status === 'archived') throw new DomainError('不能从已归档料卷扣减');
        totals.set(a.spoolId, (totals.get(a.spoolId) || 0) + a.amountMg);
      }
      for (const [spoolId, total] of totals)
        if (this.spool(spoolId).remainingMg < total)
          throw new DomainError('所选料卷库存不足，请修正重量或拆分到其他料卷', 409);
      for (const a of input.allocations) {
        this.db.run(
          'INSERT INTO review_allocation VALUES(?,?,?,?,?,?)',
          randomUUID(),
          reviewId,
          a.materialId,
          a.spoolId,
          a.amountMg,
          a.source,
        );
        this.change(
          a.spoolId,
          -a.amountMg,
          kind === 'correct' ? 'correction' : 'consumption',
          a.source,
          input.notes,
          id,
          reviewId,
        );
      }
      this.db.run("UPDATE print_job SET review_status='reviewed',version=version+1 WHERE id=?", id);
      return result;
    });
  }
  undo(id: string, raw: unknown) {
    const input = undoSchema.parse(raw);
    return this.db.transaction(() => {
      const replay = this.replay(input.requestId, id, input);
      if (replay) return replay;
      const job = this.job(id);
      if (job.version !== input.expectedVersion || job.reviewStatus !== 'reviewed')
        throw new DomainError('任务已变更或尚未核对', 409);
      const reviewId = randomUUID();
      const result = { id: reviewId, jobId: id, version: job.version + 1 };
      this.db.run(
        'INSERT INTO job_review VALUES(?,?,?,?,?,?,?,?)',
        reviewId,
        id,
        input.requestId,
        hash(input),
        'undo',
        input.notes,
        now(),
        JSON.stringify(result),
      );
      this.restore(job, reviewId);
      this.db.run("UPDATE print_job SET review_status='pending',version=version+1 WHERE id=?", id);
      return result;
    });
  }
  setJobStatus(id: string, raw: unknown) {
    const input = z
      .object({
        expectedVersion: z.number().int(),
        reviewStatus: z.enum(['pending', 'ignored']).optional(),
        printStatus: z.enum(['completed', 'failed', 'cancelled', 'unknown']).optional(),
      })
      .parse(raw);
    return this.db.transaction(() => {
      const job = this.job(id);
      if (job.version !== input.expectedVersion || job.reviewStatus === 'reviewed')
        throw new DomainError('请先撤销核对或刷新任务', 409);
      this.db.run(
        'UPDATE print_job SET review_status=?,print_status=?,version=version+1 WHERE id=?',
        input.reviewStatus ?? job.reviewStatus,
        input.printStatus ?? job.printStatus,
        id,
      );
      return this.job(id);
    });
  }
  printers(): Printer[] {
    return this.db.all<any>('SELECT * FROM printer ORDER BY name').map((p) => ({
      ...camel(p),
      extruders: this.db
        .all<any>('SELECT * FROM printer_extruder WHERE printer_id=?', p.id)
        .map(camel),
      slots: this.db
        .all<any>(
          'SELECT s.*,a.spool_id FROM printer_slot s LEFT JOIN slot_assignment a ON a.slot_id=s.id AND a.unassigned_at IS NULL WHERE s.printer_id=? ORDER BY s.rowid',
          p.id,
        )
        .map(camel),
    }));
  }
  addPrinter(raw: unknown) {
    const input = printerSchema.parse(raw);
    return this.db.transaction(() => {
      const id = randomUUID();
      this.db.run(
        'INSERT INTO printer(id,name,model,serial,connection) VALUES(?,?,?,?,?)',
        id,
        input.name,
        input.model,
        input.serial || null,
        input.connection,
      );
      if (input.model === 'A1 mini') {
        const extruder = randomUUID();
        this.db.run('INSERT INTO printer_extruder VALUES(?,?,?,0)', extruder, id, '喷嘴');
        for (let i = 1; i <= 4; i++)
          this.db.run(
            'INSERT INTO printer_slot VALUES(?,?,?,?,?)',
            randomUUID(),
            id,
            extruder,
            `AMS lite · ${i}`,
            'ams_lite',
          );
        this.db.run(
          'INSERT INTO printer_slot VALUES(?,?,?,?,?)',
          randomUUID(),
          id,
          extruder,
          '外置料卷',
          'external',
        );
      } else if (input.model === 'X2D') {
        for (const name of ['左主喷嘴 · 直驱', '右辅助喷嘴 · 远程挤出'])
          this.db.run('INSERT INTO printer_extruder VALUES(?,?,?,0)', randomUUID(), id, name);
      }
      return required(this.printers().find((p) => p.id === id));
    });
  }
  editPrinter(id: string, raw: unknown) {
    const input = printerSchema.parse(raw);
    const existing = required(this.db.one<any>('SELECT model FROM printer WHERE id=?', id));
    if (existing.model !== input.model)
      throw new DomainError('已有设备不能改变机型，请新增正确机型的设备');
    this.db.run(
      'UPDATE printer SET name=?,model=?,serial=?,connection=? WHERE id=?',
      input.name,
      input.model,
      input.serial || null,
      input.connection,
      id,
    );
    return this.printers();
  }
  addSlot(printerId: string, raw: unknown) {
    const input = z
      .object({
        name: z.string().min(1).max(100),
        kind: z.enum(['ams', 'ams_lite', 'external', 'unknown']),
        extruderId: z.string().nullable(),
      })
      .parse(raw);
    required(this.db.one('SELECT id FROM printer WHERE id=?', printerId));
    if (input.extruderId)
      required(
        this.db.one(
          'SELECT id FROM printer_extruder WHERE id=? AND printer_id=?',
          input.extruderId,
          printerId,
        ),
        '喷嘴不属于此设备',
      );
    this.db.run(
      'INSERT INTO printer_slot VALUES(?,?,?,?,?)',
      randomUUID(),
      printerId,
      input.extruderId,
      input.name,
      input.kind,
    );
    return this.printers();
  }
  assign(slotId: string, raw: unknown) {
    const input = z.object({ spoolId: z.string().nullable() }).parse(raw);
    return this.db.transaction(() => {
      required(this.db.one('SELECT id FROM printer_slot WHERE id=?', slotId));
      if (input.spoolId) {
        const spool = this.spool(input.spoolId);
        if (spool.status === 'archived') throw new DomainError('已归档料卷不能绑定');
        const installed = this.db.one<any>(
          'SELECT slot_id FROM slot_assignment WHERE spool_id=? AND unassigned_at IS NULL',
          input.spoolId,
        );
        if (installed && installed.slot_id !== slotId)
          throw new DomainError('此料卷已安装在其他槽位，请先解绑');
      }
      const time = now();
      this.db.run(
        'UPDATE slot_assignment SET unassigned_at=? WHERE slot_id=? AND unassigned_at IS NULL',
        time,
        slotId,
      );
      if (input.spoolId)
        this.db.run(
          'INSERT INTO slot_assignment VALUES(?,?,?,?,NULL)',
          randomUUID(),
          slotId,
          input.spoolId,
          time,
        );
      return this.printers();
    });
  }
  assignments() {
    return this.db
      .all<any>(
        'SELECT a.*,s.name AS slot_name,p.name AS printer_name FROM slot_assignment a JOIN printer_slot s ON s.id=a.slot_id JOIN printer p ON p.id=s.printer_id ORDER BY a.assigned_at DESC',
      )
      .map(camel);
  }
  transactions(): Transaction[] {
    return this.db
      .all<any>(
        'SELECT t.*,p.name AS product_name,p.brand,p.material,p.color_hex,j.name AS job_name,pr.name AS printer_name FROM inventory_transaction t JOIN spool s ON s.id=t.spool_id JOIN filament_product p ON p.id=t.product_id LEFT JOIN print_job j ON j.id=t.job_id LEFT JOIN printer pr ON pr.id=j.printer_id ORDER BY t.rowid DESC',
      )
      .map(camel);
  }
  preferences() {
    return JSON.parse(
      required(this.db.one<any>("SELECT value FROM settings WHERE id='preferences'")).value,
    );
  }
  setPreferences(raw: unknown) {
    const input = z
      .object({
        lowStockMg: z.number().int().min(0).max(100_000_000),
        locale: z.literal('zh-CN'),
        timezone: z.string().refine((s) => {
          try {
            new Intl.DateTimeFormat('zh-CN', { timeZone: s });
            return true;
          } catch {
            return false;
          }
        }, '无效时区'),
      })
      .parse(raw);
    this.db.run("UPDATE settings SET value=? WHERE id='preferences'", JSON.stringify(input));
    return input;
  }
  syncState() {
    return camel(required(this.db.one("SELECT * FROM sync_state WHERE id='bambu_cloud'")));
  }
}
