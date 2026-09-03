/**
 * v12.408 — Kontext 局部重绘早就造好了,一次都没被调用过。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * `services/fal-flux.service.ts` 有 `editImage()`(走 `fal-ai/flux-kontext/max`,
 * 指令式局部重绘),但**全仓零调用方**。竞品复核那条 C7「已接入 provider 的
 * 特色能力大量闲置」说的就是这个:接入成本已经付过,能力一直躺着。
 *
 * 而现状是 Vision Audit 判低分 → rebirth-plan 排弱镜 → **一律整张重生**。
 * 整张重生有两个代价:贵;以及**会把这一镜里本来已经对的部分**(角色长相、
 * 光线、构图)一起重新掷骰子 —— 常见结果是「修好了动作,人却变样了」,
 * 于是又触发下一轮重生。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 锁分流**行为**,而不是「有没有调用 Kontext」。关键是那条保守规则:
 * 拿不准就整张重生 —— 猜错的代价(改半天没改对还多花一次钱)比直接重生更差。
 */
import { describe, it, expect } from 'vitest';
import { chooseRepairStrategy, planRepairs, buildEditPrompt, REGENERATE_BELOW } from '@/lib/repair-strategy';
import { decideIteration, planOneClickFilm } from '@/lib/oneclick-film';
import type { RebirthShot } from '@/lib/rebirth-plan';

const shot = (over: Partial<RebirthShot>): RebirthShot => ({
  shotNumber: 1, score: 62, priority: 1, weakestDimension: 'actionMatch',
  focusHint: '角色应当伸手去接',
  ...over,
} as RebirthShot);

describe('v12.408 · 局部重绘 vs 整张重生', () => {
  it('局部偏差(动作/情绪/构图)走局部重绘 —— 保住已经对的部分', () => {
    for (const dim of ['actionMatch', 'moodMatch', 'composition'] as const) {
      const d = chooseRepairStrategy(shot({ weakestDimension: dim }));
      expect(d.mode, `${dim} 应走局部重绘`).toBe('edit');
      expect(d.editPrompt, '走 edit 就必须给出指令').toBeTruthy();
    }
  });

  it('整体跑题(< 50 分)走整张重生 —— 局部改无从改起', () => {
    const d = chooseRepairStrategy(shot({ score: REGENERATE_BELOW - 1 }));
    expect(d.mode).toBe('regenerate');
    expect(d.editPrompt).toBeUndefined();
    expect(d.reason).toContain('整体跑题');
  });

  it('场景本身错了也走整张重生(sceneMatch 不是局部问题)', () => {
    expect(chooseRepairStrategy(shot({ weakestDimension: 'sceneMatch' })).mode).toBe('regenerate');
  });

  it('没有维度数据时保守走整张重生 —— 不猜', () => {
    const d = chooseRepairStrategy(shot({ weakestDimension: null }));
    expect(d.mode).toBe('regenerate');
    expect(d.reason, '要说清为什么不猜').toContain('不猜');
  });

  it('重绘指令必须显式要求保持其余不变 —— 否则退化成换个方式整张重生', () => {
    const p = buildEditPrompt(shot({ focusHint: '角色应当伸手去接' }));
    expect(p).toContain('角色应当伸手去接');
    expect(p).toMatch(/保持.*不变/);
    expect(p).toMatch(/只修改|其余.*保持原样/);
  });

  it('闭环裁决把分流结果带出来 —— 造好不接线正是这一版要治的病', () => {
    const plan = planOneClickFilm({ idea: '测试用故事' });
    const v = decideIteration(plan, {
      round: 1,
      audits: [
        { shotNumber: 1, score: 62, dimensions: { actionMatch: 40, sceneMatch: 90, moodMatch: 80, composition: 80 }, issues: ['动作不对'] },
        { shotNumber: 2, score: 30, dimensions: { sceneMatch: 20, actionMatch: 40, moodMatch: 40, composition: 40 }, issues: ['整体跑题'] },
      ],
      filmAudit: { avgScore: 46, failCount: 1, warnCount: 1, passCount: 0, weakestShots: [{ shotNumber: 2, score: 30 }] } as any,
      qualityScore: { overall: 46, continuity: 45, lighting: 44, face: 48 } as any,
    });

    // 窗口自证:先确认它确实进了 rebirth 分支,再谈分流
    expect(v.decision, '这组输入应当判为需要重修').toBe('rebirth');
    expect(v.repairs, 'repairs 没被带出来 = 又造好没接线').toHaveLength(2);

    const byShot = Object.fromEntries(v.repairs.map((r) => [r.shotNumber, r.mode]));
    expect(byShot[1], '局部偏差应走重绘').toBe('edit');
    expect(byShot[2], '整体跑题应走重生').toBe('regenerate');
    expect(v.message, '统计要写进消息,便于复盘').toMatch(/局部重绘 1/);
  });

  it('达标时不产生任何修复动作', () => {
    const plan = planOneClickFilm({ idea: '测试用故事' });
    const v = decideIteration(plan, {
      round: 1, audits: [],
      filmAudit: { avgScore: 90, failCount: 0, warnCount: 0, passCount: 5, weakestShots: [] } as any,
      qualityScore: { overall: 88, continuity: 85, lighting: 86, face: 90 } as any,
    });
    expect(v.decision).toBe('done');
    expect(v.repairs).toEqual([]);
  });

  it('批量分流的统计对得上', () => {
    const r = planRepairs([
      shot({ shotNumber: 1, weakestDimension: 'actionMatch' }),
      shot({ shotNumber: 2, weakestDimension: 'sceneMatch' }),
      shot({ shotNumber: 3, score: 20 }),
    ]);
    expect(r.editCount).toBe(1);
    expect(r.regenerateCount).toBe(2);
    expect(r.decisions).toHaveLength(3);
  });
});
