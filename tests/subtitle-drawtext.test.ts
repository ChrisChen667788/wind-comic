/**
 * Sprint B.2 — 字幕 drawtext filter 生成器单测
 *
 * 锁住四档样式 + 转义 + 链式串联的关键决策(无 ffmpeg 依赖, 纯字符串断言):
 *   · static  — 仅 enable 时间窗, 无 alpha
 *   · fade    — 0.3s 淡入淡出, alpha 是分段函数
 *   · typewriter — 慢入式 alpha (60% 入窗)
 *   · pop     — 0.15s snap-in + snap-out
 *   · 文本中的 ' / : / % 必须转义, \n 替换成空格
 *   · buildSubtitleFilterChain 把多个 entry 串成 [v0]→[v1]→[v2]→[vout]
 */

import { describe, it, expect } from 'vitest';
import {
  buildDrawtextFilter,
  buildSubtitleFilterChain,
  type SubtitleStyle,
} from '@/services/subtitle.service';

const mkEntry = (text: string, start = 1.0, end = 3.0) => ({ start, end, text });

describe('buildDrawtextFilter (Sprint B.2)', () => {
  it('static — enable window present, no alpha expression', () => {
    const out = buildDrawtextFilter({ entry: mkEntry('Hello'), style: 'static' });
    expect(out).toContain("drawtext=");
    expect(out).toContain("text='Hello'");
    expect(out).toContain("enable='between(t");
    expect(out).not.toContain('alpha=');
  });

  it('fade — alpha分段函数,起止处线性插值', () => {
    const out = buildDrawtextFilter({ entry: mkEntry('hi', 1.0, 5.0), style: 'fade' });
    expect(out).toContain('alpha=');
    // 应该出现 fade-in 段 (t < 1.300)
    expect(out).toContain('1.300');
    // 应该出现 fade-out 段 (t < 4.700, end - FADE)
    expect(out).toContain('4.700');
  });

  it('typewriter — 慢入式 alpha (60% 时长入窗)', () => {
    const out = buildDrawtextFilter({ entry: mkEntry('typing', 0, 5.0), style: 'typewriter' });
    expect(out).toContain('alpha=');
    // SLOW_IN = min(5*0.6, 5-0.05) = 3.000
    expect(out).toContain('3.000');
  });

  it('pop — 0.15s snap-in + snap-out', () => {
    const out = buildDrawtextFilter({ entry: mkEntry('!', 1.0, 3.0), style: 'pop' });
    expect(out).toContain('alpha=');
    expect(out).toContain('0.150'); // POP constant
  });

  it('escapes : and \\ and % and quotes in text', () => {
    const tricky = mkEntry("8:30 PM — it's 50% done\nNew line");
    const out = buildDrawtextFilter({ entry: tricky, style: 'static' });
    expect(out).toContain("8\\:30");
    expect(out).toContain("it\\'s");
    expect(out).toContain('50\\%');
    // newline 应被替换成空格
    expect(out).not.toMatch(/\r|\n/);
  });

  it('returns empty string for empty entry text', () => {
    expect(buildDrawtextFilter({ entry: mkEntry(''), style: 'fade' })).toBe('');
    expect(buildDrawtextFilter({ entry: mkEntry('   '), style: 'fade' })).toBe('');
  });

  it('respects custom fontFile + fontSize + color + yPos', () => {
    const out = buildDrawtextFilter({
      entry: mkEntry('x'),
      style: 'static',
      fontFile: '/path/to/font.ttf',
      fontSize: 48,
      color: '#E8C547',
      yPos: 100,
    });
    expect(out).toContain("fontfile='/path/to/font.ttf'");
    expect(out).toContain('fontsize=48');
    expect(out).toContain('fontcolor=#E8C547');
    expect(out).toContain('y=100');
  });

  it('clamps fade duration when subtitle is shorter than 2*FADE', () => {
    // duration=0.4s, FADE should be min(0.3, 0.4/2)=0.2
    const out = buildDrawtextFilter({ entry: mkEntry('!', 0, 0.4), style: 'fade' });
    // mid plateau end = 0.4 - 0.2 = 0.200
    expect(out).toContain('0.200');
  });

  it('falls back to static for an unknown style string', () => {
    const out = buildDrawtextFilter({
      entry: mkEntry('x'),
      style: 'wobble' as unknown as SubtitleStyle,
    });
    expect(out).toContain('enable=');
    expect(out).not.toContain('alpha=');
  });
});

describe('buildSubtitleFilterChain (Sprint B.2)', () => {
  it('returns a single copy when there are no subtitle entries', () => {
    const out = buildSubtitleFilterChain(
      { entries: [], format: 'srt' },
      'fade',
      'vmain',
      'vout',
    );
    expect(out).toEqual(['[vmain]copy[vout]']);
  });

  it('chains entries [in]→...→[out] with intermediate labels', () => {
    const out = buildSubtitleFilterChain(
      {
        entries: [mkEntry('first', 0, 1), mkEntry('second', 1, 2), mkEntry('third', 2, 3)],
        format: 'srt',
      },
      'fade',
      'vmain',
      'vout',
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^\[vmain\]drawtext=.*\[vmain_sub0\]$/);
    expect(out[1]).toMatch(/^\[vmain_sub0\]drawtext=.*\[vmain_sub1\]$/);
    expect(out[2]).toMatch(/^\[vmain_sub1\]drawtext=.*\[vout\]$/);
  });

  it('skips empty entries (filtered before chaining)', () => {
    const out = buildSubtitleFilterChain(
      { entries: [mkEntry('a', 0, 1), mkEntry('', 1, 2), mkEntry('b', 2, 3)], format: 'srt' },
      'static',
      'in',
      'out',
    );
    expect(out).toHaveLength(2); // empty middle dropped
  });
});
