/**
 * v12.172 — 预算护栏全覆盖:动态估算纯函数 + 三路由接线锁 + 超限拒绝集成闭环。
 */
import { describe, it, expect } from 'vitest';
import { estimatePipelineCostCny } from '@/lib/budget-estimate';
import fs from 'fs';

describe('v12.172 · estimatePipelineCostCny', () => {
  it('按引擎单价与镜数缩放;未知引擎按最贵档保守', () => {
    const kling8 = estimatePipelineCostCny({ shotCount: 8, videoProvider: 'kling', secondsPerShot: 6 });
    expect(kling8).toBeGreaterThan(10);            // 8镜×6s×0.2 + 图 + 音 ≈ ¥14
    expect(kling8).toBeLessThan(20);
    const kling20 = estimatePipelineCostCny({ shotCount: 20, videoProvider: 'kling', secondsPerShot: 8 });
    expect(kling20).toBeGreaterThan(30);           // 审计说实际 ¥30-60 —— 落在区间
    const unknown = estimatePipelineCostCny({ shotCount: 8, videoProvider: 'mystery' });
    expect(unknown).toBeGreaterThanOrEqual(estimatePipelineCostCny({ shotCount: 8, videoProvider: 'minimax' }));
    // 补渲(不重出图)应低于全片
    expect(estimatePipelineCostCny({ shotCount: 8, skipImages: true })).toBeLessThan(estimatePipelineCostCny({ shotCount: 8 }));
    expect(estimatePipelineCostCny({})).toBeGreaterThan(6); // 默认估必须高于旧拍脑袋 ¥6
  });
  it('接线锁:create-stream/regenerate-shot/series 三口全走动态估;regenerate 超限 402', () => {
    // v13.6:三口改经 pipelineCostForBudget(零 key 演示估 0,其余逐字委托 estimatePipelineCostCny)—— 锁的仍是「动态估」
    const mc = fs.readFileSync('lib/mock-cost.ts', 'utf-8');
    expect(mc).toContain('mockPipelineIsFree() ? 0 : estimatePipelineCostCny(input)');
    const cs = fs.readFileSync('app/api/create-stream/route.ts', 'utf-8');
    expect(cs).toContain('pipelineCostForBudget({ videoProvider })');
    expect(cs).not.toContain('pendingCostCny: 6');
    const rg = fs.readFileSync('app/api/regenerate-shot/route.ts', 'utf-8');
    expect(rg).toContain('assertBudget');
    expect(rg).toContain("code: 'budget_exceeded'");
    expect(rg).toContain('dryRun !== true'); // dryRun 零成本免检
    const sg = fs.readFileSync('app/api/series/[id]/generate/route.ts', 'utf-8');
    expect(sg).toContain('targets.length * pipelineCostForBudget({})');
  });
  it('集成闭环:设 hard cap 后动态估算触发拒绝(同驱动)', async () => {
    const { getDbDriver } = await import('@/lib/db-driver');
    const { assertBudget } = await import('@/lib/budget-enforce');
    const uid = 'test-budget-' + Date.now();
    const drv = getDbDriver();
    await drv.run(
      `INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, created_at, budget_cap_cny, budget_hard_cap_cny) VALUES (?, ?, 'x', 'T', 'member', '', 'zh', ?, 1, 1)`,
      [uid, `${uid}@t.io`, new Date().toISOString()],
    );
    const pending = estimatePipelineCostCny({ videoProvider: 'kling' }); // > ¥1 硬上限
    const b = await assertBudget({ userId: uid, pendingCostCny: pending });
    expect(b.allow).toBe(false); // force 批量补渲同一路径 → 路由返回 402
    await drv.run('DELETE FROM users WHERE id = ?', [uid]);
  });
});
