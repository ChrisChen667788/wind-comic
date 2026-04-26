/**
 * cameo-retry 多角色独立评分单测 · Sprint A.3 (v2.12 Phase 3)
 *
 * 锁住多角色场景下的关键决策路径(Phase 1/2 单角色行为已被 cameo-retry.test.ts 覆盖):
 *   · additionalReferences 留空 → 行为完全等同单角色 (backward compat)
 *   · 多角色:每个 ref 独立 vision scoring,综合分数取 min
 *   · min < 阈值 → 触发重生 (即使 primary 高,additional 低也会触发)
 *   · 重生后用 min 比较 → min 反而更差则回滚到原图
 *   · 任一 ref 第一次 vision-null → 仍用其他 ref 的 min 决策
 *   · 所有 ref 都 vision-null → 跳过重生 (vision-null 路径)
 *   · perCharacterScores 字段:多角色镜头才出现,按 [primary, ...additional] 顺序
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/cameo-vision', () => ({
  scoreShotConsistency: vi.fn(),
}));

import { evaluateAndRetry } from '@/services/cameo-retry';
import { scoreShotConsistency } from '@/lib/cameo-vision';

const mockScore = scoreShotConsistency as unknown as ReturnType<typeof vi.fn>;

const mkScore = (score: number, reasoning = 'mock') => ({
  score,
  dimensions: { face: score, outfit: score, identity: score },
  reasoning,
});

const baseInput = {
  shotImageUrl: 'http://x/shot.png',
  referenceImageUrl: 'http://x/A.png',
  characterName: '李长安',
  originalCw: 100,
  shotNumber: 5,
  regenerate: vi.fn(async () => 'http://x/regen.png'),
};

beforeEach(() => {
  mockScore.mockReset();
  // 必须 reset regenerate 否则跨 test 累积调用次数 + 旧的 mockResolvedValueOnce 还在队列里
  baseInput.regenerate.mockReset();
  baseInput.regenerate.mockResolvedValue('http://x/regen.png');
});

describe('Phase 3 — additionalReferences empty → backward compat', () => {
  it('without additionalReferences, perCharacterScores is omitted from outcome', async () => {
    mockScore.mockResolvedValueOnce(mkScore(85));
    const out = await evaluateAndRetry({ ...baseInput });
    expect(out.perCharacterScores).toBeUndefined();
    expect(out.finalScore).toBe(85);
    expect(out.retried).toBe(false);
    expect(mockScore).toHaveBeenCalledTimes(1);
  });

  it('explicit empty additionalReferences also omits perCharacterScores', async () => {
    mockScore.mockResolvedValueOnce(mkScore(60));
    mockScore.mockResolvedValueOnce(mkScore(80));
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: [] });
    expect(out.perCharacterScores).toBeUndefined();
    expect(out.retried).toBe(true);
    expect(out.finalScore).toBe(80);
  });
});

describe('Phase 3 — multi-character scoring', () => {
  const additionalRefs = [
    { url: 'http://x/B.png', name: '柳如烟' },
    { url: 'http://x/C.png', name: '混混' },
  ];

  it('all 3 chars pass threshold → no retry, perCharacterScores has 3 entries', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(90, 'A good'))
      .mockResolvedValueOnce(mkScore(85, 'B good'))
      .mockResolvedValueOnce(mkScore(80, 'C ok'));
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: additionalRefs });
    expect(out.retried).toBe(false);
    expect(out.skipReason).toBe('above-threshold');
    expect(out.finalScore).toBe(80); // min
    expect(out.firstScore).toBe(80); // min
    expect(out.perCharacterScores).toHaveLength(3);
    expect(out.perCharacterScores).toEqual([
      { name: '李长安', score: 90, reasoning: 'A good' },
      { name: '柳如烟', score: 85, reasoning: 'B good' },
      { name: '混混', score: 80, reasoning: 'C ok' },
    ]);
    expect(mockScore).toHaveBeenCalledTimes(3);
    expect(baseInput.regenerate).not.toHaveBeenCalled();
  });

  it('primary high but additional low → retry triggered by min', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(90)) // A primary - good
      .mockResolvedValueOnce(mkScore(55)) // B - bad
      .mockResolvedValueOnce(mkScore(85)) // C - good
      // Second-pass scoring after regen
      .mockResolvedValueOnce(mkScore(92))
      .mockResolvedValueOnce(mkScore(80))
      .mockResolvedValueOnce(mkScore(88));
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: additionalRefs });
    expect(out.retried).toBe(true);
    expect(out.firstScore).toBe(55); // min before retry
    expect(out.finalScore).toBe(80); // min after retry
    expect(out.attempts).toBe(2);
    expect(out.perCharacterScores).toEqual([
      { name: '李长安', score: 92, reasoning: 'mock' },
      { name: '柳如烟', score: 80, reasoning: 'mock' },
      { name: '混混', score: 88, reasoning: 'mock' },
    ]);
  });

  it('regen makes min worse → ROLLBACK to original (with first perCharacterScores preserved)', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(85))  // A first
      .mockResolvedValueOnce(mkScore(60))  // B first  (min)
      .mockResolvedValueOnce(mkScore(90))  // C first
      // After regen: min became worse
      .mockResolvedValueOnce(mkScore(70))
      .mockResolvedValueOnce(mkScore(50))  // B even lower → rollback trigger
      .mockResolvedValueOnce(mkScore(75));
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: additionalRefs });
    expect(out.retried).toBe(true);
    expect(out.finalImageUrl).toBe(baseInput.shotImageUrl); // rolled back
    expect(out.finalCw).toBe(baseInput.originalCw); // cw also rolled back
    expect(out.firstScore).toBe(60);
    expect(out.finalScore).toBe(60);
    expect(out.reasoning).toContain('回滚');
    // Rollback keeps the FIRST snapshot of per-char scores (the ones still showing)
    expect(out.perCharacterScores?.find(p => p.name === '柳如烟')?.score).toBe(60);
  });

  it('partial vision-null on first pass — uses min of valid scores', async () => {
    mockScore
      .mockResolvedValueOnce(mkScore(90))   // A - good
      .mockResolvedValueOnce(null)          // B - vision dead
      .mockResolvedValueOnce(mkScore(60));  // C - bad → triggers retry on min=60
    // regen + second-pass
    baseInput.regenerate.mockResolvedValueOnce('http://x/regen2.png');
    mockScore
      .mockResolvedValueOnce(mkScore(95))
      .mockResolvedValueOnce(mkScore(80))
      .mockResolvedValueOnce(mkScore(85));
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: additionalRefs });
    expect(out.retried).toBe(true);
    expect(out.firstScore).toBe(60); // C was min among valid scores (B null skipped)
    expect(out.finalScore).toBe(80);
    // perCharacterScores reflects post-regen state (B now has a score since vision worked second time)
    expect(out.perCharacterScores).toHaveLength(3);
    expect(out.perCharacterScores?.find(p => p.name === '柳如烟')?.score).toBe(80);
  });

  it('all vision-null on first pass → skip (vision-null path), perCharacterScores still present', async () => {
    mockScore
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const out = await evaluateAndRetry({ ...baseInput, additionalReferences: additionalRefs });
    expect(out.retried).toBe(false);
    expect(out.skipReason).toBe('vision-null');
    expect(out.finalScore).toBeNull();
    // We still log per-char to make debugging visible
    expect(out.perCharacterScores).toEqual([
      { name: '李长安', score: null, reasoning: '' },
      { name: '柳如烟', score: null, reasoning: '' },
      { name: '混混', score: null, reasoning: '' },
    ]);
    expect(baseInput.regenerate).not.toHaveBeenCalled();
  });

  it('threshold flip — 75 boundary on min: min === 75 passes, min === 74 retries', async () => {
    mockScore.mockResolvedValueOnce(mkScore(80)).mockResolvedValueOnce(mkScore(75));
    const pass = await evaluateAndRetry({
      ...baseInput,
      additionalReferences: [{ url: 'http://x/B.png', name: 'B' }],
    });
    expect(pass.retried).toBe(false);

    mockScore.mockReset();
    baseInput.regenerate.mockReset();
    baseInput.regenerate.mockResolvedValue('http://x/regen3.png');
    mockScore
      .mockResolvedValueOnce(mkScore(80))
      .mockResolvedValueOnce(mkScore(74))
      .mockResolvedValueOnce(mkScore(85))
      .mockResolvedValueOnce(mkScore(82));
    const retried = await evaluateAndRetry({
      ...baseInput,
      additionalReferences: [{ url: 'http://x/B.png', name: 'B' }],
    });
    expect(retried.retried).toBe(true);
    expect(retried.firstScore).toBe(74);
  });
});
