/**
 * v9.3.0 — lib/cost-rollup 单测 (成本归集: 引擎/天/项目卷积 + 预算数学).
 */
import { describe, it, expect } from 'vitest';
import {
  totalCostCny, rollupByEngine, rollupByDay, rollupByProject,
  computeBudget, buildCostSummary, type CostLogRow,
} from '@/lib/cost-rollup';

const ROWS: CostLogRow[] = [
  { engine: 'kling3', costCny: 1.5, durationSec: 5, projectId: 'p1', userId: 'u1', createdAt: '2026-06-01T10:00:00Z' },
  { engine: 'kling3', costCny: 2.5, durationSec: 8, projectId: 'p1', createdAt: '2026-06-01T12:00:00Z' },
  { engine: 'seedance2', costCny: 0.8, durationSec: 3, projectId: 'p2', createdAt: '2026-06-02T09:00:00Z' },
  { engine: 'seedance2', costCny: 0.2, durationSec: 1, createdAt: '2026-06-02T09:30:00Z' }, // 无 project
];

const DAY = 86_400_000;

describe('v9.3.0 · 卷积', () => {
  it('totalCostCny 求和 + 2 位舍入', () => {
    expect(totalCostCny(ROWS)).toBe(5);
    expect(totalCostCny([{ engine: 'x', costCny: 0.1, createdAt: '2026-06-01' }, { engine: 'x', costCny: 0.2, createdAt: '2026-06-01' }])).toBe(0.3);
    expect(totalCostCny([])).toBe(0);
  });

  it('rollupByEngine: 分组 + 计数 + 成本/时长求和 + 成本降序', () => {
    const e = rollupByEngine(ROWS);
    expect(e).toHaveLength(2);
    expect(e[0]).toEqual({ engine: 'kling3', count: 2, costCny: 4, durationSecTotal: 13 });
    expect(e[1]).toEqual({ engine: 'seedance2', count: 2, costCny: 1, durationSecTotal: 4 });
  });

  it('rollupByEngine: 缺省 engine → unknown', () => {
    const e = rollupByEngine([{ engine: '', costCny: 1, createdAt: '2026-06-01' }]);
    expect(e[0].engine).toBe('unknown');
  });

  it('rollupByDay: 按 YYYY-MM-DD 桶 + 升序; 空日期跳过', () => {
    const d = rollupByDay([...ROWS, { engine: 'x', costCny: 9, createdAt: '' }]);
    expect(d).toEqual([
      { day: '2026-06-01', count: 2, costCny: 4 },
      { day: '2026-06-02', count: 2, costCny: 1 },
    ]);
  });

  it('rollupByProject: 跳过无 projectId 的行 + 成本降序', () => {
    const p = rollupByProject(ROWS);
    expect(p).toEqual([
      { projectId: 'p1', count: 2, costCny: 4 },
      { projectId: 'p2', count: 1, costCny: 0.8 },
    ]);
  });
});

describe('v9.3.0 · computeBudget', () => {
  it('无上限 → status none, pctUsed/remaining null', () => {
    const b = computeBudget({ spentCny: 50, periodStartMs: 0, nowMs: 15 * DAY });
    expect(b.status).toBe('none');
    expect(b.pctUsed).toBeNull();
    expect(b.remainingCny).toBeNull();
  });

  it('ok / warn / over 阈值 (默认 warn 0.8)', () => {
    const base = { periodStartMs: 0, nowMs: 30 * DAY, capCny: 100 };
    expect(computeBudget({ ...base, spentCny: 50 }).status).toBe('ok');
    expect(computeBudget({ ...base, spentCny: 80 }).status).toBe('warn');
    expect(computeBudget({ ...base, spentCny: 100 }).status).toBe('over');
    expect(computeBudget({ ...base, spentCny: 120 }).status).toBe('over');
    const w = computeBudget({ ...base, spentCny: 90 });
    expect(w.pctUsed).toBe(0.9);
    expect(w.remainingCny).toBe(10);
  });

  it('线性预测: 半周期花了 X → 预计周期末 2X; 满/超周期 → ≈ 已用', () => {
    const half = computeBudget({ spentCny: 30, capCny: 100, periodStartMs: 0, nowMs: 15 * DAY, periodDays: 30 });
    expect(half.projectedPeriodEndCny).toBe(60); // 30 / 0.5
    const full = computeBudget({ spentCny: 30, capCny: 100, periodStartMs: 0, nowMs: 30 * DAY, periodDays: 30 });
    expect(full.projectedPeriodEndCny).toBe(30);
    const over = computeBudget({ spentCny: 30, capCny: 100, periodStartMs: 0, nowMs: 60 * DAY, periodDays: 30 });
    expect(over.projectedPeriodEndCny).toBe(30); // fraction clamp 到 1
  });

  it('自定义 warn 阈值', () => {
    const b = computeBudget({ spentCny: 60, capCny: 100, periodStartMs: 0, nowMs: 30 * DAY, warnThreshold: 0.5 });
    expect(b.status).toBe('warn'); // 0.6 >= 0.5
  });
});

describe('v9.3.0 · buildCostSummary', () => {
  it('汇总 totals + 三视图; 传 budget → spentCny 自动取总成本', () => {
    const s = buildCostSummary({ rows: ROWS, budget: { capCny: 10, periodStartMs: 0, nowMs: 15 * DAY } });
    expect(s.totals).toEqual({ count: 4, costCny: 5 });
    expect(s.byEngine).toHaveLength(2);
    expect(s.byDay).toHaveLength(2);
    expect(s.byProject).toHaveLength(2);
    expect(s.budget?.spentCny).toBe(5);     // 自动 = totalCostCny
    expect(s.budget?.status).toBe('ok');    // 5/10 = 0.5 < 0.8
    expect(s.budget?.projectedPeriodEndCny).toBe(10); // 5 / 0.5
  });

  it('无 budget 输入 → summary.budget 缺省', () => {
    const s = buildCostSummary({ rows: ROWS });
    expect(s.budget).toBeUndefined();
    expect(s.totals.costCny).toBe(5);
  });
});
