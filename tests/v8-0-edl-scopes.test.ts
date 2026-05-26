/**
 * v8.0 — lib/edl-export + lib/scopes 单测 (专业出片对接)
 */

import { describe, it, expect } from 'vitest';
import { framesToTimecode, secondsToTimecode, buildEDL, buildFCPXML } from '@/lib/edl-export';
import { lumaOf, computeHistogram, computeColumns, scopeStats } from '@/lib/scopes';

describe('edl-export · timecode', () => {
  it('framesToTimecode @24fps', () => {
    expect(framesToTimecode(0, 24)).toBe('00:00:00:00');
    expect(framesToTimecode(24, 24)).toBe('00:00:01:00');
    expect(framesToTimecode(25, 24)).toBe('00:00:01:01');
    expect(framesToTimecode(24 * 65, 24)).toBe('00:01:05:00');
    expect(framesToTimecode(24 * 3661, 24)).toBe('01:01:01:00');
  });
  it('secondsToTimecode', () => {
    expect(secondsToTimecode(5, 24)).toBe('00:00:05:00');
    expect(secondsToTimecode(0, 24)).toBe('00:00:00:00');
  });
});

describe('edl-export · buildEDL (CMX3600)', () => {
  const shots = [{ name: 'Shot 01', durationS: 5 }, { name: 'Shot 02', durationS: 4 }];
  it('含标题 + 事件 + 累计 record 时间码 + 片段名', () => {
    const edl = buildEDL(shots, 24, 'MY TL');
    expect(edl).toContain('TITLE: MY TL');
    expect(edl).toContain('FCM: NON-DROP FRAME');
    expect(edl).toContain('001  AX       V     C        00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00');
    expect(edl).toContain('* FROM CLIP NAME: Shot 01');
    // 第 2 事件 record in 接在第 1 之后, out 到 9s
    expect(edl).toContain('002  AX       V     C        00:00:00:00 00:00:04:00 00:00:05:00 00:00:09:00');
    expect(edl).toContain('* FROM CLIP NAME: Shot 02');
  });
  it('时长缺省兜底 5s; 空列表不崩', () => {
    expect(buildEDL([{ name: 'X', durationS: 0 }], 24)).toContain('00:00:05:00');
    expect(buildEDL([], 24)).toContain('TITLE:');
  });
});

describe('edl-export · buildFCPXML (xmeml)', () => {
  const shots = [{ name: 'A & B', durationS: 5 }, { name: 'Shot 02', durationS: 4 }];
  it('合法 xmeml 头 + 2 clipitem + 总时长 + 名称转义', () => {
    const xml = buildFCPXML(shots, 24, 'Seq');
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain('<xmeml version="5">');
    expect((xml.match(/<clipitem /g) || []).length).toBe(2);
    expect(xml).toContain(`<duration>${(5 + 4) * 24}</duration>`); // sequence total
    expect(xml).toContain('A &amp; B'); // XML 转义
    expect(xml).toContain('<timebase>24</timebase>');
    // 第 2 clip start = 第 1 clip 帧数 (5*24=120)
    expect(xml).toContain('<start>120</start>');
  });
});

describe('scopes · 像素分析', () => {
  it('lumaOf 标准权重', () => {
    expect(lumaOf(255, 255, 255)).toBe(255);
    expect(lumaOf(0, 0, 0)).toBe(0);
    expect(lumaOf(255, 0, 0)).toBe(54); // 0.2126*255
  });
  it('computeHistogram 计数正确 (2 白 1 黑)', () => {
    const data = [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255];
    const h = computeHistogram(data);
    expect(h.luma[255]).toBe(2);
    expect(h.luma[0]).toBe(1);
    expect(h.r[255]).toBe(2);
    expect(h.r[0]).toBe(1);
    expect(h.r.reduce((a, n) => a + n, 0)).toBe(3);
  });
  it('computeColumns: 2x1 黑→白 渐变 → [0, 255]', () => {
    const data = [0, 0, 0, 255, 255, 255, 255, 255]; // 2 像素
    expect(computeColumns(data, 2, 1, 2, 'luma')).toEqual([0, 255]);
  });
  it('computeColumns 空/异常 → 零数组', () => {
    expect(computeColumns([], 0, 0, 4)).toEqual([0, 0, 0, 0]);
  });
  it('scopeStats: 均值/裁切比例', () => {
    const h = computeHistogram([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    const st = scopeStats(h);
    expect(st.avgLuma).toBe(170); // (255*2+0)/3
    expect(st.maxLuma).toBe(255);
    expect(st.minLuma).toBe(0);
    expect(st.clippedHighlights).toBeCloseTo(0.667, 2);
    expect(st.clippedShadows).toBeCloseTo(0.333, 2);
  });
});
