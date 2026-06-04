/**
 * v9.4.4b — 一键成片闭环「端到端编排」集成测试。
 *
 * 不是单测单个函数,而是把 planOneClickFilm + decideIteration 组合成 oneclick-film-panel 真跑的
 * 多轮闭环,验证编排逻辑端到端正确:每轮质检 → 裁决 → 重拍 → 复检 → 直到 done/blocked。
 * (真端点 fetch / 真生成消耗 token,需在浏览器环境验;这里锁死纯逻辑编排链。)
 */
import { describe, it, expect } from 'vitest';
import { planOneClickFilm, decideIteration, type IterationVerdict } from '@/lib/oneclick-film';
import type { FilmAuditLike } from '@/lib/quality-gate';
import type { AuditedShotLike } from '@/lib/rebirth-plan';

/** 模拟一轮「质检」结果:给定每镜分,算出 filmAudit 聚合(fail<50, 弱镜=最低 3)。 */
function fakeAudit(scores: number[]): { audits: AuditedShotLike[]; filmAudit: FilmAuditLike } {
  const audits: AuditedShotLike[] = scores.map((s, i) => ({ shotNumber: i + 1, score: s }));
  const failCount = scores.filter((s) => s < 50).length;
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const weakest = [...audits].sort((a, b) => a.score - b.score).slice(0, 3).map((a) => ({ shotNumber: a.shotNumber, score: a.score }));
  const verdict: FilmAuditLike['verdict'] = avg >= 85 ? 'excellent' : avg >= 70 ? 'good' : avg >= 50 ? 'needs-work' : 'poor';
  return { audits, filmAudit: { avgScore: avg, shotCount: scores.length, failCount, weakestShots: weakest, verdict } };
}

/**
 * 跑闭环:模拟"每轮重拍把弱镜提分"。返回每轮裁决 + 终态。
 * roundsScores[r] = 第 r 轮(1 起)的每镜分。
 */
function runLoop(roundsScores: number[][], maxRebirthRounds = 2): { verdicts: IterationVerdict[]; final: string } {
  const plan = planOneClickFilm({ idea: '唐朝少年剑客复仇', maxRebirthRounds });
  const verdicts: IterationVerdict[] = [];
  for (let round = 1; round <= maxRebirthRounds + 1; round++) {
    const scores = roundsScores[Math.min(round - 1, roundsScores.length - 1)];
    const { audits, filmAudit } = fakeAudit(scores);
    const v = decideIteration(plan, { round, audits, filmAudit });
    verdicts.push(v);
    if (v.decision !== 'rebirth') break;
  }
  return { verdicts, final: verdicts[verdicts.length - 1].decision };
}

describe('v9.4.4b · 一键成片闭环端到端编排', () => {
  it('round1 不达标(block)→ rebirth(重拍最弱镜)→ round2 达标 → done', () => {
    const { verdicts, final } = runLoop([
      [88, 30, 70, 48, 80, 76], // round1: 2 镜 <50 → block, 弱镜 2 & 4
      [88, 82, 80, 84, 86, 90], // round2(重拍后): 全 ≥75 → done
    ]);
    expect(verdicts[0].decision).toBe('rebirth');
    expect(verdicts[0].rebirthShots.map((s) => s.shotNumber)).toContain(2);
    expect(verdicts[0].rebirthShots[0].shotNumber).toBe(2); // 最低分先拍
    expect(verdicts[1].decision).toBe('done');
    expect(final).toBe('done');
    expect(verdicts).toHaveLength(2);
  });

  it('一轮就达标 → 直接 done(不浪费重拍)', () => {
    const { verdicts, final } = runLoop([[90, 88, 86, 92, 85, 89]]);
    expect(final).toBe('done');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].rebirthShots).toEqual([]);
  });

  it('始终不达标 → 自愈 2 轮后到顶 → blocked(交人工)', () => {
    const { verdicts, final } = runLoop([
      [40, 30, 35, 45, 38, 42], // round1 block
      [44, 35, 40, 48, 42, 46], // round2 仍 block(重拍没救回)
      [46, 38, 42, 49, 44, 48], // round3 仍 block → 到顶 blocked
    ]);
    expect(verdicts[0].decision).toBe('rebirth');
    expect(verdicts[1].decision).toBe('rebirth');
    expect(verdicts[2].decision).toBe('blocked');
    expect(final).toBe('blocked');
  });

  it('warn 档(可发布但有弱点)→ done(避免过度打磨)', () => {
    // 全 ≥50 无 fail、平均 66 → 门禁 warn(ready)→ done
    const { verdicts, final } = runLoop([[66, 64, 68, 70, 62, 66]]);
    expect(final).toBe('done');
    expect(verdicts[0].gate.level).toBe('warn');
  });
});
