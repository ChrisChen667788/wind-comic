/**
 * lib/budget-enforce (v9.3.4) — 预算护栏服务端强制: 读用户预算 + 当月花费 → 裁决.
 *
 * 把 v9.3.3 的纯逻辑 evaluateBudgetGuard 接到服务端真实数据:
 *   - 用户预算: users.budget_cap_cny / budget_hard_cap_cny (v9.3.4 加列, null = 不设防)
 *   - 当月花费: cost_log 当月该用户 SUM(cost_cny)
 * 生成端点调 assertBudget() → 到硬上限拦截 (preview-shot 起接, 核心管线留后续)。
 *
 * 走 DbDriver 双驱动 (SQLite/PG); now 可注入保持可测。
 * 单测 tests/v9-3-4-budget-enforce.test.ts。
 */

import { getDbDriver } from './db-driver';
import { evaluateBudgetGuard, type BudgetGuardResult } from './budget-guard';

export interface UserBudget {
  capCny: number | null;
  hardCapCny: number | null;
}

/** 读用户月预算 (软/硬上限); 无记录或未设 → null。 */
export async function getUserBudget(userId: string): Promise<UserBudget> {
  const row = (await getDbDriver().get(
    'SELECT budget_cap_cny, budget_hard_cap_cny FROM users WHERE id = ?',
    [userId],
  )) as { budget_cap_cny: number | null; budget_hard_cap_cny: number | null } | undefined;
  return {
    capCny: row?.budget_cap_cny != null ? Number(row.budget_cap_cny) : null,
    hardCapCny: row?.budget_hard_cap_cny != null ? Number(row.budget_hard_cap_cny) : null,
  };
}

/** 设用户月预算; capCny/hardCapCny 传 null 即清除(不设防)。 */
export async function setUserBudget(
  userId: string,
  b: { capCny: number | null; hardCapCny?: number | null },
): Promise<void> {
  const cap = b.capCny != null && Number.isFinite(b.capCny) && b.capCny > 0 ? Number(b.capCny) : null;
  const hard = b.hardCapCny != null && Number.isFinite(b.hardCapCny) && b.hardCapCny > 0 ? Number(b.hardCapCny) : null;
  await getDbDriver().run(
    'UPDATE users SET budget_cap_cny = ?, budget_hard_cap_cny = ? WHERE id = ?',
    [cap, hard, userId],
  );
}

/** 当月该用户 cost_log 花费 (CNY)。 */
export async function monthSpentCny(userId: string, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const row = (await getDbDriver().get(
    'SELECT COALESCE(SUM(cost_cny), 0) AS spent FROM cost_log WHERE user_id = ? AND created_at >= ?',
    [userId, monthStart],
  )) as { spent: number | string } | undefined;
  return Number(row?.spent ?? 0);
}

/**
 * 生成前置护栏: 读预算 + 当月花费 → evaluateBudgetGuard 裁决。
 * 无预算上限 → 永远放行 (level 'none')。pendingCostCny = 本次操作预估成本。
 */
export async function assertBudget(
  opts: { userId: string; pendingCostCny?: number },
  now: Date = new Date(),
): Promise<{ allow: boolean; guard: BudgetGuardResult }> {
  const { capCny, hardCapCny } = await getUserBudget(opts.userId);
  // 无软上限直接放行, 省一次花费查询
  if (capCny == null || capCny <= 0) {
    const guard = evaluateBudgetGuard({ spentCny: 0, capCny: null, pendingCostCny: opts.pendingCostCny });
    return { allow: true, guard };
  }
  const spentCny = await monthSpentCny(opts.userId, now);
  const guard = evaluateBudgetGuard({ spentCny, capCny, hardCapCny, pendingCostCny: opts.pendingCostCny });
  return { allow: guard.allow, guard };
}
