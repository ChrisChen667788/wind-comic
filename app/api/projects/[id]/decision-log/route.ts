/**
 * GET /api/projects/[id]/decision-log · 阶段三十 v12.37.0
 *
 * 逐镜可审计决策日志:用了哪个引擎 / 花多少钱 / prompt / 九宫格选定 / 一致性分 + 项目质量分 + 成本汇总。
 * 给甲方/导演一份「为什么这么出片」的可复查账。登录 + 属主守卫。
 *
 * 200 → { ok, projectId, shots[], totals{totalCostCny,shotCount,byEngine[]}, nonShotCosts[], quality }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { listCostLogByProject } from '@/lib/repos/cost-log-repo';
import { listProjectAssets } from '@/lib/repos/asset-repo';
import { getLatestQualityScore } from '@/lib/quality-scores';
import { buildDecisionLog } from '@/lib/decision-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const p = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(id) as { user_id?: string } | undefined;
    if (p?.user_id && p.user_id !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } catch { /* demo / 无 user_id → 放行 */ }

  const [costRows, assets, quality] = await Promise.all([
    listCostLogByProject(id),
    listProjectAssets(id),
    getLatestQualityScore(id),
  ]);

  const log = buildDecisionLog({
    costRows,
    assets: assets as unknown as Array<{ type: string; shot_number?: number | null; data?: unknown }>,
    quality: quality as unknown as Record<string, unknown> | null,
  });
  return NextResponse.json({ ok: true, projectId: id, ...log });
}
