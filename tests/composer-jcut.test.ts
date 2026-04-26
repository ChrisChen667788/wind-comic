/**
 * Sprint B.1 — j-cut / l-cut 音轨偏移单测
 *
 * 锁住决策路径(无 ffmpeg 依赖,纯函数 + 字符串断言):
 *   · 第一个镜头永远不做 j-cut(没有 prev)
 *   · prev clip 不是 j-cut → adelay 保持原值(byte-identical 旧行为)
 *   · prev clip 是 j-cut → adelay 减 LEAD_MS(400ms)
 *   · clamp:adelay 永远 >= 0,不让 ffmpeg 看到负数
 *   · l-cut 不影响 adelay 计算(它是"画面切但音延续",由 voiceover 自然播完实现)
 */

import { describe, it, expect } from 'vitest';
import { computeJCutAdelay, COMPOSER_LEAD_MS, COMPOSER_LAG_MS } from '@/services/video-composer';

describe('computeJCutAdelay (Sprint B.1)', () => {
  it('returns baseStartMs unchanged for the first clip (no prev)', () => {
    expect(computeJCutAdelay({
      clips: [{ transition: 'j-cut' }, { transition: 'fade' }],
      shotIndex: 0,
      baseStartMs: 1500,
    })).toBe(1500);
  });

  it('returns baseStartMs unchanged when prev transition is not j-cut', () => {
    for (const t of ['fade', 'dissolve', 'cut', 'l-cut', 'whip-pan', 'match-cut']) {
      expect(computeJCutAdelay({
        clips: [{ transition: t }, { transition: 'fade' }],
        shotIndex: 1,
        baseStartMs: 5000,
      })).toBe(5000);
    }
  });

  it('shifts adelay backward by COMPOSER_LEAD_MS when prev is j-cut', () => {
    const result = computeJCutAdelay({
      clips: [{ transition: 'j-cut' }, { transition: 'fade' }],
      shotIndex: 1,
      baseStartMs: 5000,
    });
    expect(result).toBe(5000 - COMPOSER_LEAD_MS);
    expect(result).toBe(4600);
  });

  it('clamps adelay to 0 when shift would make it negative', () => {
    const result = computeJCutAdelay({
      clips: [{ transition: 'j-cut' }, { transition: 'fade' }],
      shotIndex: 1,
      baseStartMs: 100, // smaller than LEAD_MS=400
    });
    expect(result).toBe(0);
  });

  it('handles missing prev clip gracefully (returns base unchanged)', () => {
    expect(computeJCutAdelay({
      clips: [],
      shotIndex: 1,
      baseStartMs: 2000,
    })).toBe(2000);
  });

  it('exposes the documented LEAD_MS / LAG_MS constants for downstream tools', () => {
    expect(COMPOSER_LEAD_MS).toBe(400);
    expect(COMPOSER_LAG_MS).toBe(400);
  });

  it('l-cut on the current clip does not affect adelay (handled by natural overflow)', () => {
    // current clip transition irrelevant — only PREV's transition matters for adelay shift
    expect(computeJCutAdelay({
      clips: [{ transition: 'fade' }, { transition: 'l-cut' }],
      shotIndex: 1,
      baseStartMs: 3000,
    })).toBe(3000);
  });
});
