/**
 * Tests for v2.16 P1.1 — lib/bgm-multi-act
 *
 * 锁:
 *   - computeActDurations 三幕切分判断 (canSplit 阈值)
 *   - moodPromptForAct 三幕产出文本各不相同 + 含关键词
 *   - concatActBgms 输入校验 (<2 段 throw, 不存在的本地文件 throw)
 */

import { describe, it, expect } from 'vitest';
import {
  computeActDurations,
  moodPromptForAct,
  concatActBgms,
} from '@/lib/bgm-multi-act';

describe('computeActDurations', () => {
  it('canSplit=false when timeline has no act fields', () => {
    const r = computeActDurations([
      { duration: 5, act: null },
      { duration: 5, act: null },
      { duration: 5, act: null },
    ]);
    expect(r.canSplit).toBe(false);
  });

  it('canSplit=true when ≥50% shots have valid act 1+2+3', () => {
    const r = computeActDurations([
      { duration: 5, act: 1 },
      { duration: 6, act: 1 },
      { duration: 8, act: 2 },
      { duration: 8, act: 2 },
      { duration: 6, act: 3 },
      { duration: 5, act: 3 },
    ]);
    expect(r.canSplit).toBe(true);
    expect(r.act1).toBe(15);     // 5+6 = 11, but Math.max(15, 11) = 15
    expect(r.act2).toBe(16);     // 8+8 = 16
    expect(r.act3).toBe(15);     // 6+5 = 11 → max(15, 11) = 15
  });

  it('canSplit=false when only 2 of 3 acts have shots', () => {
    const r = computeActDurations([
      { duration: 5, act: 1 },
      { duration: 5, act: 2 },
      { duration: 5, act: 2 },
    ]);
    // Act 3 = 0 → canSplit false (要求三幕都 > 0)
    expect(r.canSplit).toBe(false);
  });

  it('canSplit=false when only minority (<50%) shots tagged', () => {
    const r = computeActDurations([
      { duration: 5, act: 1 },
      { duration: 5, act: null },
      { duration: 5, act: null },
      { duration: 5, act: null },
    ]);
    expect(r.canSplit).toBe(false);
  });

  it('treats invalid act values (4, 0, "1") as null', () => {
    const r = computeActDurations([
      { duration: 5, act: 4 as any },
      { duration: 5, act: 0 as any },
      { duration: 5, act: '1' as any },
      { duration: 5, act: 1 },
      { duration: 5, act: 2 },
      { duration: 5, act: 3 },
    ]);
    // 只有 3 个有效 act, 占 50%, 满足 >= ceil(6 * 0.5) = 3
    expect(r.canSplit).toBe(true);
  });
});

describe('moodPromptForAct', () => {
  it('act 1 prompt mentions 平静/铺垫/开篇', () => {
    const p = moodPromptForAct(1, '紧张', '武侠');
    expect(p).toMatch(/平静|铺垫|开篇/);
    expect(p).toContain('武侠');
    expect(p).toContain('紧张');
  });

  it('act 2 prompt mentions 冲突/张力/推进', () => {
    const p = moodPromptForAct(2, '愤怒', '都市');
    expect(p).toMatch(/冲突|张力|推进|升级/);
  });

  it('act 3 prompt mentions 高潮/释放/宣泄', () => {
    const p = moodPromptForAct(3, '决战', '科幻');
    expect(p).toMatch(/高潮|释放|宣泄/);
  });

  it('uses "现代剧情" when genre is empty', () => {
    expect(moodPromptForAct(1, 'x', '')).toContain('现代剧情');
  });

  it('uses sensible default emotion when given empty', () => {
    const p = moodPromptForAct(1, '', '武侠');
    expect(p).toContain('平静');
  });

  it('three acts produce distinct prompts (sanity)', () => {
    const a1 = moodPromptForAct(1, '紧张', '武侠');
    const a2 = moodPromptForAct(2, '紧张', '武侠');
    const a3 = moodPromptForAct(3, '紧张', '武侠');
    expect(a1).not.toBe(a2);
    expect(a2).not.toBe(a3);
    expect(a1).not.toBe(a3);
  });
});

describe('concatActBgms — input guards', () => {
  it('throws when fewer than 2 segments', async () => {
    await expect(
      concatActBgms([{ url: 'http://x/1.mp3', durationSec: 30, act: 1 }]),
    ).rejects.toThrow(/至少需要 2 段/);

    await expect(concatActBgms([])).rejects.toThrow(/至少需要 2 段/);
  });

  it('throws when local file URL doesnt exist', async () => {
    await expect(
      concatActBgms([
        { url: '/tmp/this-does-not-exist-bgm-1.mp3', durationSec: 30, act: 1 },
        { url: '/tmp/this-does-not-exist-bgm-2.mp3', durationSec: 30, act: 2 },
      ]),
    ).rejects.toThrow();
  });
});
