/**
 * lib/budget-guard (v9.3.3) — 预算护栏: 当月花费对软/硬上限的判定 + 本次操作放行裁决.
 *
 * 在 v9.3.0 computeBudget(状态展示)之上加「操作级护栏」:
 *   - 软上限 capCny(预算目标): 用量到 warnThreshold(默认 0.8)→ 告警; 触及/越过 → 强提示但放行
 *   - 硬上限 hardCapCny(绝对线, 缺省 = capCny, 且不低于软上限): 已达 / 本次会越过 → 拦截(plan-gate 风格)
 *   - pendingCostCny = 本次操作预估成本, 用于「这次生成会不会让你超」
 *
 * 与 lib/plan-gate(订阅档位 gate)正交: 借鉴其 allow + upgradeUrl 形态, 但按金额裁决。
 * 纯函数, 单测 tests/v9-3-3-budget-guard.test.ts。
 */

export type BudgetGuardLevel = 'none' | 'ok' | 'warn' | 'soft_over' | 'hard_block';

export interface BudgetGuardInput {
  /** 当月已花 (CNY) */
  spentCny: number;
  /** 软上限 / 预算目标 (CNY); null 或 <=0 = 不设防, 永远放行 */
  capCny: number | null;
  /** 硬上限 / 绝对线 (CNY); 缺省 = capCny; 内部强制不低于软上限 */
  hardCapCny?: number | null;
  /** 本次操作预估成本 (CNY), 默认 0 */
  pendingCostCny?: number;
  /** 软上限内的告警阈值 0..1, 默认 0.8 */
  warnThreshold?: number;
}

export interface BudgetGuardResult {
  /** 是否放行本次操作 */
  allow: boolean;
  level: BudgetGuardLevel;
  spentCny: number;
  pendingCostCny: number;
  /** spent + pending */
  projectedAfterCny: number;
  capCny: number | null;
  hardCapCny: number | null;
  /** spent / cap; 无上限 → null */
  pctUsed: number | null;
  /** 给用户的中文提示 */
  message: string;
  /** 引导(调预算 / 去计费), 借鉴 plan-gate */
  upgradeUrl: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function num(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

const UPGRADE_URL = '/dashboard/billing';

/** 评估当月花费 + 本次操作成本对预算护栏的裁决。 */
export function evaluateBudgetGuard(input: BudgetGuardInput): BudgetGuardResult {
  const spentCny = round2(Math.max(0, num(input.spentCny)));
  const pendingCostCny = round2(Math.max(0, num(input.pendingCostCny)));
  const projectedAfterCny = round2(spentCny + pendingCostCny);
  const cap = input.capCny == null ? null : num(input.capCny);
  const warnThreshold = input.warnThreshold && input.warnThreshold > 0 ? input.warnThreshold : 0.8;

  // 不设防
  if (cap == null || cap <= 0) {
    return {
      allow: true, level: 'none', spentCny, pendingCostCny, projectedAfterCny,
      capCny: null, hardCapCny: null, pctUsed: null,
      message: '未设预算上限', upgradeUrl: UPGRADE_URL,
    };
  }

  // 硬上限不低于软上限
  const rawHard = input.hardCapCny != null && input.hardCapCny > 0 ? num(input.hardCapCny) : cap;
  const hardCap = Math.max(cap, rawHard);
  const pctUsed = round2(spentCny / cap);

  let allow: boolean;
  let level: BudgetGuardLevel;
  let message: string;

  if (spentCny >= hardCap) {
    allow = false; level = 'hard_block';
    message = `本月已达硬上限 ¥${round2(hardCap)},已暂停消耗,请调高预算或前往计费`;
  } else if (projectedAfterCny > hardCap) {
    allow = false; level = 'hard_block';
    message = `本次预估 ¥${pendingCostCny} 将越过硬上限 ¥${round2(hardCap)}(当前 ¥${spentCny}),已拦截`;
  } else if (projectedAfterCny >= cap) {
    allow = true; level = 'soft_over';
    message = `本次将触及预算上限 ¥${round2(cap)}(预计 ¥${projectedAfterCny}),仍放行但请留意`;
  } else if (pctUsed >= warnThreshold) {
    allow = true; level = 'warn';
    message = `本月已用 ${Math.round(pctUsed * 100)}%(¥${spentCny}/¥${round2(cap)}),接近预算`;
  } else {
    allow = true; level = 'ok';
    message = `预算健康(¥${spentCny}/¥${round2(cap)})`;
  }

  return {
    allow, level, spentCny, pendingCostCny, projectedAfterCny,
    capCny: round2(cap), hardCapCny: round2(hardCap), pctUsed,
    message, upgradeUrl: UPGRADE_URL,
  };
}
