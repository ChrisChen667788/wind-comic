/**
 * cameo-retry 单测 · Sprint A.1 (v2.12)
 *
 * 锁住一致性自动重生的关键决策路径:
 *   · 阈值 < 75 触发重生
 *   · 单次重生上限
 *   · cw 提升 +25, 上限 125 (锁脸已封顶时只加 sref)
 *   · 第二次反而更差 → 回滚到原图 (LLM 抖动保护)
 *   · 第二次 vision null → 信任新图 (花了钱, 默认它更好)
 *   · 没有 ref / 第一次 vision null → 完全跳过
 *
 * 这些行为变了, 用户感知会立刻不同 (重生频率/成片一致性), 必须有测试 lock。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 必须在 import retry 模块前 mock cameo-vision, 否则真实 LLM 会被调用
vi.mock('@/lib/cameo-vision', () => ({
  scoreShotConsistency: vi.fn(),
}));

import { evaluateAndRetry, CAMEO_RETRY_THRESHOLD, CAMEO_CW_MAX } from '@/services/cameo-retry';
import { scoreShotConsistency } from '@/lib/cameo-vision';

const mockScore = scoreShotConsistency as unknown as ReturnType<typeof vi.fn>;

const mkScore = (score: number, reasoning = 'mock') => ({
  score,
  dimensions: { face: score, outfit: score, identity: score },
  reasoning,
});

beforeEach(() => {
  mockScore.mockReset();
});

// ──────────────────────────────────────────────────
// 不进 retry 流程的早退路径
// ──────────────────────────────────────────────────
describe('evaluateAndRetry · 早退路径', () => {
  it('没有 referenceImageUrl → 跳过 (skipReason=no-ref)', async () => {
    const regen = vi.fn(async () => 'new-img');
    const out = await evaluateAndRetry({
      shotImageUrl: 'shot.png',
      referenceImageUrl: undefined,
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(false);
    expect(out.attempts).toBe(1);
    expect(out.skipReason).toBe('no-ref');
    expect(out.finalImageUrl).toBe('shot.png');
    expect(regen).not.toHaveBeenCalled();
    expect(mockScore).not.toHaveBeenCalled();
  });

  it('第一次 vision 返回 null → 跳过 (skipReason=vision-null)', async () => {
    mockScore.mockResolvedValueOnce(null);
    const regen = vi.fn(async () => 'new-img');
    const out = await evaluateAndRetry({
      shotImageUrl: 'shot.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(false);
    expect(out.skipReason).toBe('vision-null');
    expect(regen).not.toHaveBeenCalled();
  });

  it('第一次 vision 已达标 (>=75) → 不重生', async () => {
    mockScore.mockResolvedValueOnce(mkScore(85, 'looks great'));
    const regen = vi.fn(async () => 'new-img');
    const out = await evaluateAndRetry({
      shotImageUrl: 'shot.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(false);
    expect(out.skipReason).toBe('above-threshold');
    expect(out.finalScore).toBe(85);
    expect(out.firstScore).toBe(85);
    expect(out.reasoning).toBe('looks great');
    expect(regen).not.toHaveBeenCalled();
  });

  it('第一次 vision 恰好 75 → 不重生 (边界)', async () => {
    mockScore.mockResolvedValueOnce(mkScore(75));
    const out = await evaluateAndRetry({
      shotImageUrl: 'shot.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: vi.fn(),
    });
    expect(out.retried).toBe(false);
    expect(out.skipReason).toBe('above-threshold');
  });

  it('第一次 vision 74 → 触发重生 (边界)', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(74))
      .mockResolvedValueOnce(mkScore(85));
    const regen = vi.fn(async () => 'new-img');
    const out = await evaluateAndRetry({
      shotImageUrl: 'shot.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(regen).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────
// 主路径: 触发重生 + 各种结果
// ──────────────────────────────────────────────────
describe('evaluateAndRetry · 重生路径', () => {
  it('60 → 88 happy path: 重生成功, cw 100→125', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60, 'face slightly different'))
      .mockResolvedValueOnce(mkScore(88, 'much closer now'));
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      characterName: '林小满',
      originalCw: 100,
      regenerate: regen,
      shotNumber: 3,
    });
    expect(out.retried).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.finalImageUrl).toBe('regen.png');
    expect(out.finalScore).toBe(88);
    expect(out.firstScore).toBe(60);
    expect(out.finalCw).toBe(125);
    expect(out.reasoning).toBe('much closer now');
    // 重生函数收到 boost 后的 cw
    expect(regen).toHaveBeenCalledWith(125, expect.any(Array));
  });

  it('originalCw=125 (锁脸) → boost 仍封顶 125', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(82));
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 125,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(out.finalCw).toBe(CAMEO_CW_MAX);
    expect(out.finalCw).toBe(125);
    expect(regen).toHaveBeenCalledWith(125, expect.any(Array));
  });

  it('originalCw=80 (配角) → boost 到 105', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(80));
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 80,
      regenerate: regen,
    });
    expect(out.finalCw).toBe(105);
    expect(regen).toHaveBeenCalledWith(105, expect.any(Array));
  });

  it('额外 sref 链 (sameCharacterRecentShots) 取最近 2 张, 透给 regenerate', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(85));
    const regen = vi.fn(async () => 'regen.png');
    await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      sameCharacterRecentShots: ['s1.png', 's2.png', 's3.png', 's4.png'],
      regenerate: regen,
    });
    // 只取最后 2 张
    expect(regen).toHaveBeenCalledWith(125, ['s3.png', 's4.png']);
  });

  it('第二次 vision 返回 null → 信任新图 (finalScore=null)', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60, 'first reason'))
      .mockResolvedValueOnce(null);
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.finalImageUrl).toBe('regen.png'); // 信任新图
    expect(out.finalScore).toBe(null);
    expect(out.firstScore).toBe(60);
    expect(out.finalCw).toBe(125);
    expect(out.reasoning).toBe('first reason'); // 复用首评的解释
  });

  it('第二次 vision 反而更差 → 回滚到原图', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(45)); // 越改越差
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(out.finalImageUrl).toBe('orig.png'); // 回滚
    expect(out.finalScore).toBe(60); // 原始分数
    expect(out.finalCw).toBe(100); // 原始 cw (回滚一同回滚 cw 字段, 真实落库就不会写错)
    expect(out.reasoning).toContain('回滚');
  });

  it('第二次和第一次相同 → 不视为更差 (>= 不 <), 接受新图', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(60)); // 相同
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(out.finalImageUrl).toBe('regen.png'); // 接受
    expect(out.finalScore).toBe(60);
  });

  it('regenerate 抛错 → 用原图兜底, 但 outcome 标 retried=true', async () => {
    mockScore.mockResolvedValueOnce(mkScore(50));
    const regen = vi.fn(async () => { throw new Error('mj 抽风'); });
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    expect(out.retried).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.finalImageUrl).toBe('orig.png'); // 原图兜底
    expect(out.finalScore).toBe(50);
    expect(out.finalCw).toBe(100); // 重生失败, cw 不算被提升
  });
});

// ──────────────────────────────────────────────────
// 决策值锁
// ──────────────────────────────────────────────────
describe('evaluateAndRetry · 决策值', () => {
  it('阈值默认 75', () => {
    expect(CAMEO_RETRY_THRESHOLD).toBe(75);
  });

  it('cw 上限 125', () => {
    expect(CAMEO_CW_MAX).toBe(125);
  });

  it('自定义 threshold 可以提高到 85', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(80))
      .mockResolvedValueOnce(mkScore(90));
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
      threshold: 85, // 比默认 75 严
    });
    // 80 < 85 → 触发重生
    expect(out.retried).toBe(true);
    expect(out.finalScore).toBe(90);
  });

  it('单次重生上限 — vision 显示重生后仍不达标也不会再重生', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(60))
      .mockResolvedValueOnce(mkScore(70)); // 重生后仍 < 75 但 > 60
    const regen = vi.fn(async () => 'regen.png');
    const out = await evaluateAndRetry({
      shotImageUrl: 'orig.png',
      referenceImageUrl: 'ref.png',
      originalCw: 100,
      regenerate: regen,
    });
    // 接受新图, 但只重生一次 (regen 只调 1 次, mockScore 只调 2 次)
    expect(regen).toHaveBeenCalledTimes(1);
    expect(mockScore).toHaveBeenCalledTimes(2);
    expect(out.attempts).toBe(2);
    expect(out.finalScore).toBe(70);
  });
});
