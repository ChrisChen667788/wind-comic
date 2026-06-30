/**
 * v12.54 — 词级动效字幕(ASS karaoke 扫光,从行级时长合成字级 \kf)。
 */
import { describe, it, expect } from 'vitest';
import { assTime, tokenizeForKaraoke, buildKaraokeLineText, buildKaraokeAss } from '@/lib/ass-karaoke';

describe('v12.54 · ASS karaoke 字幕', () => {
  it('assTime 厘秒格式', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(65.5)).toBe('0:01:05.50');
    expect(assTime(3661.999)).toBe('1:01:01.99'); // 进位不越界
  });

  it('tokenize:CJK 逐字、连续 ASCII 整词、空格并入前词', () => {
    expect(tokenizeForKaraoke('你好世界')).toEqual(['你', '好', '世', '界']);
    expect(tokenizeForKaraoke('AI 牛')).toEqual(['AI ', '牛']);
    expect(tokenizeForKaraoke('用 SK-II 吧')).toEqual(['用 ', 'SK', '-', 'II ', '吧']);
  });

  it('buildKaraokeLineText:每 token 带 \\kf,厘秒总和 == 时长*100,余数归末 token', () => {
    const t = buildKaraokeLineText('你好世', 3); // 300cs / 3 = 100 each
    expect(t).toBe('{\\kf100}你{\\kf100}好{\\kf100}世');
    const sum = [...t.matchAll(/\\kf(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(sum).toBe(300);
    // 不整除:5 字 / 300cs → 60,60,60,60,60
    const t2 = buildKaraokeLineText('一二三四五', 3.01); // 301cs / 5 = 60，末位 61
    const sum2 = [...t2.matchAll(/\\kf(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(sum2).toBe(301);
  });

  it('buildKaraokeAss:含 ScriptInfo/Styles/Events + Dialogue 行 + 扫光色', () => {
    const ass = buildKaraokeAss(
      [{ text: '再撑一下', startSec: 0, durSec: 2 }, { text: '没事', startSec: 2, durSec: 1.5 }],
      { w: 720, h: 1280, fontName: 'STHeiti', vertical: true },
    );
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 720');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('Style: Default,STHeiti,96,'); // 竖屏字号 = 1280*0.075 = 96(按高度百分比)
    expect(ass).toMatch(/Dialogue: 0,0:00:00.00,0:00:02.00,Default/);
    expect(ass).toContain('\\kf'); // 卡拉OK扫光
    expect((ass.match(/Dialogue:/g) || []).length).toBe(2);
  });

  it('空行被过滤', () => {
    const ass = buildKaraokeAss([{ text: '', startSec: 0, durSec: 1 }, { text: '有', startSec: 1, durSec: 1 }], { w: 720, h: 1280, fontName: 'F' });
    expect((ass.match(/Dialogue:/g) || []).length).toBe(1);
  });
});
