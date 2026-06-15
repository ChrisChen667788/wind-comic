/**
 * v12.2.8 — cameo 重生升级(阶段二十一 B):2 次重生 + keep-best + needsHumanReview 人审标记。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/cameo-vision', () => ({ scoreShotConsistency: vi.fn() }));
import { evaluateAndRetry, CAMEO_RETRY_MAX_ATTEMPTS } from '@/services/cameo-retry';
import { scoreShotConsistency } from '@/lib/cameo-vision';

const mockScore = scoreShotConsistency as unknown as ReturnType<typeof vi.fn>;
const mk = (score: number) => ({ score, dimensions: { face: score, outfit: score, identity: score }, reasoning: `s${score}` });
beforeEach(() => mockScore.mockReset());

describe('v12.2.8 · cameo 重生升级', () => {
  it('MAX_ATTEMPTS 已升到 2', () => {
    expect(CAMEO_RETRY_MAX_ATTEMPTS).toBe(2);
  });

  it('两次重生都不达标 → needsHumanReview=true,attempts=3,取最优分', async () => {
    mockScore.mockResolvedValueOnce(mk(50)).mockResolvedValueOnce(mk(60)).mockResolvedValueOnce(mk(65));
    const regen = vi.fn().mockResolvedValueOnce('r1').mockResolvedValueOnce('r2');
    const out = await evaluateAndRetry({ shotImageUrl: 'shot.png', referenceImageUrl: 'ref.png', originalCw: 100, regenerate: regen });
    expect(out.attempts).toBe(3);
    expect(regen).toHaveBeenCalledTimes(2);
    expect(out.needsHumanReview).toBe(true);
    expect(out.finalScore).toBe(65);              // keep-best(逐次升高)
    expect(out.finalImageUrl).toBe('r2');
  });

  it('第 1 次重生即达标 → 停在 attempts=2,不跑第 2 次,不标人审', async () => {
    mockScore.mockResolvedValueOnce(mk(50)).mockResolvedValueOnce(mk(82));
    const regen = vi.fn().mockResolvedValueOnce('r1').mockResolvedValueOnce('r2');
    const out = await evaluateAndRetry({ shotImageUrl: 'shot.png', referenceImageUrl: 'ref.png', originalCw: 100, regenerate: regen });
    expect(out.attempts).toBe(2);
    expect(regen).toHaveBeenCalledTimes(1);        // 达标即停
    expect(out.needsHumanReview).toBe(false);
    expect(out.finalScore).toBe(82);
  });

  it('第 2 次才达标 → attempts=3,不标人审', async () => {
    mockScore.mockResolvedValueOnce(mk(50)).mockResolvedValueOnce(mk(60)).mockResolvedValueOnce(mk(78));
    const regen = vi.fn().mockResolvedValueOnce('r1').mockResolvedValueOnce('r2');
    const out = await evaluateAndRetry({ shotImageUrl: 'shot.png', referenceImageUrl: 'ref.png', originalCw: 100, regenerate: regen });
    expect(out.attempts).toBe(3);
    expect(out.needsHumanReview).toBe(false);
    expect(out.finalScore).toBe(78);
    expect(out.finalImageUrl).toBe('r2');
  });

  it('两次重生都比原图差 → 回滚保原图(keep-best),仍 < 阈值 → 人审', async () => {
    mockScore.mockResolvedValueOnce(mk(60)).mockResolvedValueOnce(mk(40)).mockResolvedValueOnce(mk(45));
    const regen = vi.fn().mockResolvedValueOnce('r1').mockResolvedValueOnce('r2');
    const out = await evaluateAndRetry({ shotImageUrl: 'shot.png', referenceImageUrl: 'ref.png', originalCw: 100, regenerate: regen });
    expect(out.finalImageUrl).toBe('shot.png');    // 回滚原图
    expect(out.finalScore).toBe(60);
    expect(out.needsHumanReview).toBe(true);
  });

  it('首评达标 → 不重生、不标人审', async () => {
    mockScore.mockResolvedValueOnce(mk(90));
    const regen = vi.fn();
    const out = await evaluateAndRetry({ shotImageUrl: 'shot.png', referenceImageUrl: 'ref.png', originalCw: 100, regenerate: regen });
    expect(out.retried).toBe(false);
    expect(out.attempts).toBe(1);
    expect(regen).not.toHaveBeenCalled();
    expect(out.needsHumanReview).toBe(false);
  });
});
