/**
 * v9.3.3 — lib/budget-guard 单测 (预算护栏: 软/硬上限 + 阈值告警 + 本次成本预判).
 */
import { describe, it, expect } from 'vitest';
import { evaluateBudgetGuard } from '@/lib/budget-guard';

describe('v9.3.3 · evaluateBudgetGuard', () => {
  it('无上限 (null / 0) → none, 放行, pctUsed null', () => {
    const a = evaluateBudgetGuard({ spentCny: 50, capCny: null });
    expect(a).toMatchObject({ allow: true, level: 'none', pctUsed: null, capCny: null, hardCapCny: null });
    expect(evaluateBudgetGuard({ spentCny: 50, capCny: 0 }).level).toBe('none');
  });

  it('ok: 用量低于告警阈值', () => {
    const r = evaluateBudgetGuard({ spentCny: 30, capCny: 100 });
    expect(r).toMatchObject({ allow: true, level: 'ok', pctUsed: 0.3, capCny: 100, hardCapCny: 100 });
    expect(r.message).toContain('¥30');
  });

  it('warn: 达到告警阈值(默认 0.8)但本次不越软上限', () => {
    const r = evaluateBudgetGuard({ spentCny: 85, capCny: 100 });
    expect(r).toMatchObject({ allow: true, level: 'warn', pctUsed: 0.85 });
    expect(r.message).toMatch(/85%/);
  });

  it('soft_over: 本次会触及/越过软上限但未破硬上限 → 放行 + 强提示', () => {
    const r = evaluateBudgetGuard({ spentCny: 90, capCny: 100, hardCapCny: 150, pendingCostCny: 20 });
    expect(r).toMatchObject({ allow: true, level: 'soft_over', projectedAfterCny: 110 });
    // spent==cap 但硬上限更高 → 仍 soft_over 放行
    expect(evaluateBudgetGuard({ spentCny: 100, capCny: 100, hardCapCny: 150 }).level).toBe('soft_over');
  });

  it('hard_block: 已达硬上限(软=硬时到 cap 即拦)→ 不放行', () => {
    const r = evaluateBudgetGuard({ spentCny: 100, capCny: 100 });
    expect(r).toMatchObject({ allow: false, level: 'hard_block', hardCapCny: 100 });
    expect(r.upgradeUrl).toBe('/dashboard/billing');
    expect(r.message).toMatch(/硬上限/);
  });

  it('hard_block: 本次预估会越过硬上限 → 拦截', () => {
    const r = evaluateBudgetGuard({ spentCny: 140, capCny: 100, hardCapCny: 150, pendingCostCny: 20 });
    expect(r).toMatchObject({ allow: false, level: 'hard_block', projectedAfterCny: 160 });
  });

  it('硬上限强制不低于软上限 (hardCap < cap 时取 cap)', () => {
    const r = evaluateBudgetGuard({ spentCny: 100, capCny: 100, hardCapCny: 50 });
    expect(r.hardCapCny).toBe(100);
    expect(r.level).toBe('hard_block');
  });

  it('自定义告警阈值', () => {
    expect(evaluateBudgetGuard({ spentCny: 60, capCny: 100, warnThreshold: 0.5 }).level).toBe('warn');
    expect(evaluateBudgetGuard({ spentCny: 40, capCny: 100, warnThreshold: 0.5 }).level).toBe('ok');
  });

  it('负值/缺省 pending 夹紧; projectedAfter = spent + pending', () => {
    expect(evaluateBudgetGuard({ spentCny: -10, capCny: 100, pendingCostCny: -5 }))
      .toMatchObject({ spentCny: 0, pendingCostCny: 0, projectedAfterCny: 0, level: 'ok' });
    expect(evaluateBudgetGuard({ spentCny: 30, capCny: 100, pendingCostCny: 15 }).projectedAfterCny).toBe(45);
  });
});
