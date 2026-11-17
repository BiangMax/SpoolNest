import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { jobSchema, mg } from '../../shared/src';
import type { ImportedJob } from './index';
const arr = (value: any): any[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
function grams(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? mg(n) : null;
}
async function readSliceInfo(buffer: Buffer): Promise<string> {
  if (buffer.length > 32 * 1024 * 1024) throw new Error('文件超过 32 MB 限制');
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('不是有效的 3MF / ZIP 文件'));
      let done = false,
        count = 0;
      const fail = (e: Error) => {
        if (done) return;
        done = true;
        zip.close();
        reject(e);
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (!done)
          fail(
            new Error(
              '此 3MF 不包含 Metadata/slice_info.config 切片统计，请导出已切片的 3MF 或手动录入',
            ),
          );
      });
      zip.on('entry', (entry) => {
        if (++count > 10000) return fail(new Error('文件条目过多'));
        if (entry.fileName !== 'Metadata/slice_info.config') {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > 2 * 1024 * 1024)
          return fail(new Error('切片元数据超过 2 MB 限制'));
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(new Error('无法读取切片元数据'));
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              stream.destroy();
              fail(new Error('切片元数据过大'));
            } else chunks.push(chunk);
          });
          stream.on('error', fail);
          stream.on('end', () => {
            if (done) return;
            done = true;
            zip.close();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        });
      });
      zip.readEntry();
    });
  });
}
export async function parse3mf(buffer: Buffer, filename: string): Promise<ImportedJob[]> {
  const xml = await readSliceInfo(buffer);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持含 DTD 或实体声明的 XML');
  if (XMLValidator.validate(xml) !== true) throw new Error('切片 XML 格式无效');
  const data = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    processEntities: false,
  }).parse(xml);
  const plates = arr(data?.config?.plate);
  if (!plates.length) throw new Error('未找到切片板统计');
  if (plates.length > 100) throw new Error('切片板数量过多');
  const digest = createHash('sha256').update(buffer).digest('hex');
  const usedIndices = new Set<string>();
  return plates.map((plate, index) => {
    const meta = Object.fromEntries(arr(plate.metadata).map((m) => [m.key, m.value]));
    const plateId = String(meta.index ?? index + 1);
    if (usedIndices.has(plateId)) throw new Error('重复的切片板标识');
    usedIndices.add(plateId);
    const materials = arr(plate.filament).map((f) => ({
      material: typeof f.type === 'string' ? f.type : null,
      colorHex: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : null,
      colorName: null,
      suggestedMg: grams(f.used_g),
      source: 'slicer_estimate' as const,
      sourceSlot: f.id ? `切片材料 ${f.id}（非物理槽位）` : null,
      sourceNozzle: null,
    }));
    const totalMg = grams(meta.weight);
    const objects = arr(plate.object)
      .map((o) => o.name)
      .filter(Boolean)
      .join(' / ');
    return {
      ...jobSchema.parse({
        name: `${objects || filename.replace(/\.3mf$/i, '')} · 板 ${plateId}`,
        printStatus: 'unknown',
        totalMg,
        materials,
        incomplete:
          !materials.length ||
          materials.some((m) => m.suggestedMg === null) ||
          (totalMg !== null &&
            Math.abs(materials.reduce((s, m) => s + (m.suggestedMg || 0), 0) - totalMg) > 1000),
        durationSeconds:
          Number.isFinite(Number(meta.prediction)) && Number(meta.prediction) >= 0
            ? Math.round(Number(meta.prediction))
            : null,
        notes: '切片估算：导入不证明已完成打印；请核实打印结果与实际使用的料卷。',
      }),
      externalId: `${digest}:${plateId}`,
      externalDeviceId: '',
      thumbnail: null,
    };
  });
}
