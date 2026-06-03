/**
 * v9.4.4(并入 v9.4.3 交付)— lib/oneclick-film 单测:一键成片闭环(计划 + 每轮自愈裁决)。
 */
import { describe, it, expect } from 'vitest';
import { planOneClickFilm, decideIteration } from '@/lib/oneclick-film';
import type { ReferenceElement } from '@/lib/reference-elements';
import type { FilmAuditLike } from '@/lib/quality-gate';
import type { AuditedShotLike } from '@/lib/rebirth-plan';

const charEl: ReferenceElement = { id: 'c', kind: 'image', url: 'http://x/c.png', name: '女主', elementRole: 'character' };

const GOOD_FILM: FilmAuditLike = { avgScore: 90, shotCount: 6, failCount: 0, weakestShots: [], verdict: 'excellent' };
const BLOCK_FILM: FilmAuditLike = { avgScore: 55, shotCount: 6, failCount: 2, weakestShots: [{ shotNumber: 2, score: 30 }], verdict: 'needs-work' }; // 2/6 fail > 10% → block
const WEAK_AUDITS: AuditedShotLike[] = [{ shotNumber: 2, score: 30 }, { shotNumber: 4, score: 64 }, { shotNumber: 1, score: 88 }];

describe('v9.4.3 · planOneClickFilm', () => {
  it('空 idea → 不 ready + 提示', () => {
    const p = planOneClickFilm({ idea: '  ' });
    expect(p.ready).toBe(false);
    expect(p.notes.join()).toMatch(/创意|idea/i);
  });

  it('idea + 角色元素 → ready + 绑定 cref + 完整度 + 闭环说明', () => {
    const p = planOneClickFilm({ idea: '一个唐朝少年剑客复仇', elements: [charEl] });
    expect(p.ready).toBe(true);
    expect(p.binding.crefImages).toEqual(['http://x/c.png']);
    expect(p.completenessScore).toBe(40);
    expect(p.rebirthThreshold).toBe(75);
    expect(p.maxRebirthRounds).toBe(2);
    expect(p.notes.join()).toMatch(/多参已绑定/);
    expect(p.notes.join()).toMatch(/闭环自愈/);
  });

  it('无元素 → 纯文本成片提示', () => {
    const p = planOneClickFilm({ idea: '故事' });
    expect(p.binding.routed).toBe(0);
    expect(p.notes.join()).toMatch(/纯文本成片/);
  });

  it('maxRebirthRounds 可配 + 夹紧非负', () => {
    expect(planOneClickFilm({ idea: 'x', maxRebirthRounds: 4 }).maxRebirthRounds).toBe(4);
    expect(planOneClickFilm({ idea: 'x', maxRebirthRounds: -1 }).maxRebirthRounds).toBe(0);
  });
});

describe('v9.4.3 · decideIteration(闭环自愈裁决)', () => {
  const plan = planOneClickFilm({ idea: '故事', maxRebirthRounds: 2 });

  it('门禁达标(pass/warn ready)→ done', () => {
    const v = decideIteration(plan, { round: 1, filmAudit: GOOD_FILM, audits: [] });
    expect(v.decision).toBe('done');
    expect(v.rebirthShots).toEqual([]);
  });

  it('门禁 block + 有弱镜 + 还有轮数 → rebirth(自动重拍弱镜)', () => {
    const v = decideIteration(plan, { round: 1, filmAudit: BLOCK_FILM, audits: WEAK_AUDITS });
    expect(v.decision).toBe('rebirth');
    expect(v.rebirthShots.length).toBeGreaterThan(0);
    expect(v.rebirthShots[0].shotNumber).toBe(2); // 最低分先拍
    expect(v.message).toMatch(/自动重拍/);
  });

  it('门禁 block + 已到最大轮数 → blocked(交人工)', () => {
    const v = decideIteration(plan, { round: 3, filmAudit: BLOCK_FILM, audits: WEAK_AUDITS });
    expect(v.decision).toBe('blocked');
    expect(v.message).toMatch(/人工/);
  });

  it('门禁 block 但无可修弱镜 → blocked', () => {
    // 成片综合分低触发 block, 但每镜都 ≥75(Vision 没弱镜可自动修)
    const v = decideIteration(plan, {
      round: 1,
      qualityScore: { overall: 40, continuity: 80, lighting: 80, face: 80 },
      audits: [{ shotNumber: 1, score: 90 }, { shotNumber: 2, score: 82 }],
    });
    expect(v.gate.level).toBe('block');
    expect(v.decision).toBe('blocked');
    expect(v.rebirthShots).toEqual([]);
  });
});
