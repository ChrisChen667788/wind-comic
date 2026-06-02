/**
 * GET /api/usage/summary · v9.3.1 — 用量与成本可观测看板端点.
 *
 * 从 cost_log (双驱动) 取生成成本 → lib/cost-rollup 归集 →
 *   { cost: {totals, byEngine, byDay, byProject}, budget(当月), activeAlerts, failuresByProvider }
 *
 * scope: admin → 全量 (或 ?userId=); 创作者 → 限本人。demo 无登录回退首个用户 (与 /api/usage 一致)。
 * 过滤: ?days=(默认 30, 1..365) · ?projectId= · ?capCny=(预算上限, 缺省无上限)。
 * 预算用「当前自然月」算 (线性预测月末才有意义), 与展示窗口分离。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { getUserFromRequest } from '../../auth/lib';
import { buildCostSummary, computeBudget, totalCostCny, type CostLogRow } from '@/lib/cost-rollup';
import { evaluateBudgetGuard } from '@/lib/budget-guard';
import { getUserBudget } from '@/lib/budget-enforce';
import { listActiveQuotaAlerts } from '@/lib/api-usage-tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  const isAdmin = payload?.role === 'admin';
  const driver = getDbDriver();

  let userId = payload?.sub;
  if (!userId) {
    const first = (await driver.get('SELECT id FROM users ORDER BY created_at ASC LIMIT 1', [])) as { id: string } | undefined;
    userId = first?.id || 'demo-user';
  }

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const projectId = (url.searchParams.get('projectId') || '').trim();
  // admin 可看全量 (scopeUserId=null) 或指定 userId; 创作者锁本人
  const scopeUserId = isAdmin ? (url.searchParams.get('userId') || null) : userId;
  // v9.3.4: 预算从服务端 (users 列) 读, 不再走 ?capCny
  const { capCny, hardCapCny } = await getUserBudget(scopeUserId || userId);

  // ── 展示窗口: cost_log 卷积 ──
  const filters = ['created_at > ?'];
  const params: any[] = [since];
  if (scopeUserId) { filters.push('user_id = ?'); params.push(scopeUserId); }
  if (projectId) { filters.push('project_id = ?'); params.push(projectId); }
  const rows = (await driver.query(
    `SELECT engine, resolution, duration_sec, cost_cny, project_id, user_id, created_at
       FROM cost_log WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`,
    params,
  )) as any[];
  const costRows: CostLogRow[] = rows.map((r) => ({
    engine: r.engine,
    resolution: r.resolution,
    durationSec: Number(r.duration_sec) || 0,
    costCny: Number(r.cost_cny) || 0,
    projectId: r.project_id,
    userId: r.user_id,
    createdAt: r.created_at,
  }));
  const cost = buildCostSummary({ rows: costRows });

  // ── 预算: 当前自然月 (与窗口分离, 线性预测月末) ──
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const mFilters = ['created_at >= ?'];
  const mParams: any[] = [monthStart.toISOString()];
  if (scopeUserId) { mFilters.push('user_id = ?'); mParams.push(scopeUserId); }
  const monthRows = (await driver.query(
    `SELECT cost_cny, created_at FROM cost_log WHERE ${mFilters.join(' AND ')}`,
    mParams,
  )) as any[];
  const monthCostRows: CostLogRow[] = monthRows.map((r) => ({ engine: '', costCny: Number(r.cost_cny) || 0, createdAt: r.created_at }));
  const budget = computeBudget({
    spentCny: totalCostCny(monthCostRows),
    capCny,
    periodStartMs: monthStart.getTime(),
    nowMs: Date.now(),
    periodDays: daysInMonth,
  });

  // ── 预算护栏: 当月花费对软/硬上限裁决 (看板视角, 不含本次操作成本) ──
  const guard = evaluateBudgetGuard({ spentCny: budget.spentCny, capCny, hardCapCny });

  // ── 运维: 活跃配额告警 + 按 provider 失败计数 (窗口内) ──
  const activeAlerts = await listActiveQuotaAlerts({ windowMs: 60 * 60 * 1000 });
  const failRows = (await driver.query(
    `SELECT provider, COUNT(*) AS failed FROM api_usage_events
       WHERE success = 0 AND created_at > ? GROUP BY provider ORDER BY failed DESC`,
    [since],
  )) as any[];
  const failuresByProvider = failRows.map((r) => ({ provider: r.provider, failed: Number(r.failed) || 0 }));

  return NextResponse.json({
    scope: isAdmin ? (scopeUserId ? 'admin:user' : 'admin:all') : 'self',
    window: { days, since },
    cost,
    budget,
    guard,
    activeAlerts,
    failuresByProvider,
  });
}
