import { describe, it, expect } from 'vitest';
import { parse3mf, parseCloudTask, parseCloudFilament } from '../packages/printer-adapters/src';
import { zipFile, sliceXml } from './helpers';
describe('来源解析 — 合成测试数据，并非设备验证', () => {
  it('读取逐板逐材料切片估算，保留未知打印结果', async () => {
    const jobs = await parse3mf(zipFile('Metadata/slice_info.config', sliceXml), 'synthetic.3mf');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].materials.map((m) => m.suggestedMg)).toEqual([55000, 20000]);
    expect(
      jobs[0].materials.every((m) => m.source === 'slicer_estimate' && m.sourceNozzle === null),
    ).toBe(true);
    expect(jobs[0].printStatus).toBe('unknown');
    expect(jobs[0].incomplete).toBe(false);
  });
  it('多板分开、同文件相同外部ID', async () => {
    const xml = sliceXml.replace(
      '</config>',
      '<plate><metadata key="index" value="2"/><metadata key="weight" value="9"/><filament id="1" type="TPU" used_g="9"/></plate></config>',
    );
    const buffer = zipFile('Metadata/slice_info.config', xml);
    const a = await parse3mf(buffer, 'test.3mf'),
      b = await parse3mf(buffer, 'renamed.3mf');
    expect(a).toHaveLength(2);
    expect(a.map((j) => j.externalId)).toEqual(b.map((j) => j.externalId));
    expect(a[1].materials[0].colorHex).toBeNull();
  });
  it('普通 3MF 明确拒绝；实体声明不允许；缺重量为空', async () => {
    await expect(parse3mf(zipFile('3D/3dmodel.model', '<model/>'), 'model.3mf')).rejects.toThrow(
      '不包含',
    );
    await expect(
      parse3mf(zipFile('Metadata/slice_info.config', '<!DOCTYPE foo>' + sliceXml), 'bad.3mf'),
    ).rejects.toThrow('DTD');
    const data = await parse3mf(
      zipFile('Metadata/slice_info.config', sliceXml.replace('used_g="55"', '')),
      'incomplete.3mf',
    );
    expect(data[0].incomplete).toBe(true);
    expect(data[0].materials[0].suggestedMg).toBeNull();
  });
  it('云端字段保守解析，AMS 无映射不能编造喷嘴', () => {
    const j = parseCloudTask({
      id: 123,
      deviceId: 'test-device',
      title: 'TEST ONLY',
      status: 2,
      weight: 75,
      amsDetailMapping: [
        { ams: 0, weight: 55, filamentType: 'PLA', sourceColor: 'FFFFFFFF' },
        { ams: 1, weight: 20, filamentType: 'PETG', sourceColor: '000000FF' },
      ],
      amsMapping2: [{ amsId: 2, slotId: 1 }],
    });
    expect(j.externalId).toBe('123');
    expect(j.materials[0].sourceSlot).toBe('AMS 2 / slot 1');
    expect(j.materials[1].sourceSlot).toContain('未验证');
    expect(j.materials.every((m) => m.sourceNozzle === null)).toBe(true);
    expect(j.materials[0].colorHex).toBe('#FFFFFF');
    expect(j.printStatus).toBe('completed');
  });
  it('云端只有总重不捏造分配，未知状态不宣称完成', () => {
    const j = parseCloudTask({ id: 'x', deviceId: 'a', weight: 100, status: 999 });
    expect(j.materials).toEqual([]);
    expect(j.incomplete).toBe(true);
    expect(j.printStatus).toBe('unknown');
    // 实机对照（2026-11-18 cn 区）：3=已取消；旧社区注释的 4=完成与实测矛盾，归 unknown。
    expect(parseCloudTask({ id: 'c', deviceId: 'a', weight: 1, status: 3 }).printStatus).toBe(
      'cancelled',
    );
    expect(parseCloudTask({ id: 'd', deviceId: 'a', weight: 1, status: 4 }).printStatus).toBe(
      'unknown',
    );
    expect(() => parseCloudTask({ title: 'missing reliable ID' })).toThrow();
  });
  it('云端库存条目解析：颜色规范化、克重换算、未知字段不抛错', () => {
    const f = parseCloudFilament({
      id: 727066,
      filamentVendor: '科雷迪',
      filamentName: 'PLA Basic',
      filamentType: 'PLA',
      color: '#FFFFFFFF',
      netWeight: 661,
      totalNetWeight: 1000,
      inPrinter: true,
      devId: 'test-device',
      amsId: 0,
      slotId: '1',
      unknownFutureField: { nested: true },
    });
    expect(f).not.toBe(null);
    expect(f!.vendor).toBe('科雷迪');
    expect(f!.name).toBe('PLA Basic');
    expect(f!.color).toBe('#FFFFFF');
    expect(f!.remainingMg).toBe(661000);
    expect(f!.totalNetWeightMg).toBe(1000000);
    expect(f!.deviceId).toBe('test-device');
    expect(f!.slot).toBe('1');
    expect(parseCloudFilament({ nope: true })).toBe(null);
    expect(parseCloudFilament({ id: 'not-a-number' })).toBe(null);
  });
});
