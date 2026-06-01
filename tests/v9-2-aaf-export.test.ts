/**
 * v9.2.0 — lib/aaf-export 单测 (AAF 组合模型 + CFB 二进制容器).
 */
import { describe, it, expect } from 'vitest';
import {
  buildAafComposition, buildAafXml, buildAAF, writeCfb, isCfb,
  type EdlShot,
} from '@/lib/aaf-export';

const SHOTS: EdlShot[] = [
  { name: '开场·当街掌掴', durationS: 5, sourceUrl: 'https://x/s1.mp4' },
  { name: '反转·秘密身份', durationS: 8 },
  { name: '收尾·婚礼对峙', durationS: 3 },
];

describe('v9.2.0 · AAF 组合模型', () => {
  it('clips 累积排布 (startFrame/lengthFrame 按 fps), 总帧数正确', () => {
    const comp = buildAafComposition(SHOTS, 24, '测试片');
    expect(comp.fps).toBe(24);
    expect(comp.clips).toHaveLength(3);
    expect(comp.clips[0]).toMatchObject({ startFrame: 0, lengthFrame: 120 }); // 5s*24
    expect(comp.clips[1]).toMatchObject({ startFrame: 120, lengthFrame: 192 }); // 8s*24
    expect(comp.clips[2]).toMatchObject({ startFrame: 312, lengthFrame: 72 });  // 3s*24
    expect(comp.totalFrames).toBe(120 + 192 + 72);
    expect(comp.startTimecode).toBe('00:00:00:00');
  });

  it('时长兜底 5s / 名称兜底 / 不同 fps', () => {
    const comp = buildAafComposition([{ name: '', durationS: 0 }], 30);
    expect(comp.clips[0].name).toMatch(/Shot 1/);
    expect(comp.clips[0].lengthFrame).toBe(150); // 兜底 5s * 30
  });

  it('buildAafXml 含 MobName + 每镜 SourceClip + 长度 + 源链', () => {
    const xml = buildAafXml(buildAafComposition(SHOTS, 24, '我的短剧'));
    expect(xml).toContain('<MobName>我的短剧</MobName>');
    expect(xml).toContain('开场·当街掌掴');
    expect(xml).toContain('<Length>120</Length>');
    expect(xml).toContain('https://x/s1.mp4');
    expect((xml.match(/<SourceClip /g) || []).length).toBe(3);
    expect(xml).toContain('<EditRate>24/1</EditRate>');
  });
});

describe('v9.2.0 · CFB 二进制容器', () => {
  it('buildAAF → 合法 CFB (签名 + 512 对齐 + header 字段)', () => {
    const buf = buildAAF(SHOTS, 24, '片名');
    expect(isCfb(buf)).toBe(true);
    expect(buf.length % 512).toBe(0);
    expect(buf.length).toBeGreaterThanOrEqual(512 * 4); // header+FAT+dir+≥1 stream sector
    // header: major version 3 / sector shift 9 / mini cutoff 4096
    expect(buf.readUInt16LE(26)).toBe(3);
    expect(buf.readUInt16LE(30)).toBe(9);
    expect(buf.readUInt32LE(56)).toBe(4096);
    expect(buf.readUInt32LE(48)).toBe(1); // first dir sector
  });

  it('内嵌流 round-trip: 从 CFB 抽回 AAF-XML 与原文一致', () => {
    const comp = buildAafComposition(SHOTS, 24, '回读校验');
    const xml = buildAafXml(comp);
    const buf = buildAAF(SHOTS, 24, '回读校验');
    // 目录在 sector 1 → 文件偏移 (1+1)*512 = 1024; 流目录项 = idx 1 (偏移 +128)
    const dirOff = (1 + 1) * 512;
    const e1 = dirOff + 128;
    // 目录项名 (UTF-16LE)
    const nameLen = buf.readUInt16LE(e1 + 64);
    const name = buf.toString('utf16le', e1, e1 + nameLen - 2);
    expect(name).toBe('WindComicAAF');
    const startSector = buf.readUInt32LE(e1 + 116);
    const size = buf.readUInt32LE(e1 + 120);
    const streamOff = (startSector + 1) * 512; // sector N 在文件偏移 (N+1)*512
    const extracted = buf.toString('utf8', streamOff, streamOff + size);
    expect(extracted.trimEnd()).toBe(xml.trimEnd()); // 载荷补齐了尾随换行
    expect(extracted).toContain('回读校验');
    expect(size).toBeGreaterThanOrEqual(4096); // buildAAF 补齐到 ≥4096
  });

  it('writeCfb 短流补齐到 ≥4096 (避开 mini-stream)', () => {
    const buf = writeCfb([{ name: 'tiny', data: Buffer.from('hi') }]);
    expect(isCfb(buf)).toBe(true);
    // 流目录项 size 仍是原始 2 (补齐只发生在扇区分配, size 字段记真实长度)
    const e1 = (1 + 1) * 512 + 128;
    expect(buf.readUInt32LE(e1 + 120)).toBe(2);
  });

  it('空分镜 → 仍产出合法 CFB', () => {
    const buf = buildAAF([], 24);
    expect(isCfb(buf)).toBe(true);
    expect(buf.length % 512).toBe(0);
  });
});
