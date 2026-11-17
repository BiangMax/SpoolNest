import { randomUUID } from 'node:crypto';
import type { Store } from '../apps/server/src/service';
export const spoolInput = (remainingMg = 800000, brand = 'SUNLU') => ({
  product: {
    brand,
    name: `${brand} PLA White 1kg`,
    material: 'PLA',
    colorHex: '#FFFFFF',
    colorName: '白色',
    netMg: 1000000,
  },
  remainingMg,
  priceCents: 6000,
});
export const jobInput = (weights: (number | null)[] = [55000], status = 'completed') => ({
  name: 'TEST ONLY · 模型测试',
  printStatus: status,
  totalMg: weights.reduce<number>((s, x) => s + (x || 0), 0),
  materials: weights.map((n, i) => ({
    material: i ? 'PETG' : 'PLA',
    colorHex: i ? '#000000' : '#FFFFFF',
    suggestedMg: n,
    source: 'slicer_estimate',
  })),
});
export function reviewInput(
  store: Store,
  jobId: string,
  spoolIds: string[],
  amounts = [55000],
  extra: Record<string, unknown> = {},
) {
  const job = store.job(jobId);
  return {
    requestId: randomUUID(),
    expectedVersion: job.version,
    allocations: job.materials.map((m, i) => ({
      materialId: m.id,
      spoolId: spoolIds[i],
      amountMg: amounts[i],
      source: 'manual',
    })),
    ...extra,
  };
}
function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Synthetic ZIP fixture writer: no sample archive or private print data is shipped.
export function zipFile(name: string, content: string) {
  const n = Buffer.from(name),
    b = Buffer.from(content),
    crc = crc32(b),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(b.length, 18);
  local.writeUInt32LE(b.length, 22);
  local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(b.length, 20);
  central.writeUInt32LE(b.length, 24);
  central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(local.length + n.length + b.length, 16);
  return Buffer.concat([local, n, b, central, n, end]);
}
export const sliceXml = `<?xml version="1.0"?><config><plate><metadata key="index" value="1"/><metadata key="prediction" value="3600"/><metadata key="weight" value="75"/><object name="TEST ONLY · 模型测试"/><filament id="1" type="PLA" color="#FFFFFF" used_g="55"/><filament id="2" type="PETG" color="#000000" used_g="20"/></plate></config>`;
