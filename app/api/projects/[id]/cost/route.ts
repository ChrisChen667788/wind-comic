/**
 * /api/projects/[id]/cost · v9.6.5 (阶段十六 T3 性能成本)
 *
 * GET 项目级成本归因 —— 从 cost_log 取本项目全部计费行 → 按 engine 归类(LLM/图像/视频/TTS/口型)
 * → `attributeCost` 得 总价 + 各类目占比(降序)+ 最贵类目 + 省钱提示。只读,供「成本」视图。
 * 与 /api/usage/summary(全局/月度卷积)正交:这是单项目「这一单钱花在哪、怎么省」。
 */
import { NextResponse } from 'next/server';
import { getDbDriver } from '@/lib/db-driver';
import { costEventsFromCostLog, attributeCost, evaluateCostGuard } from '@/lib/cost-attribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const driver = getDbDriver();

  const rows = (await driver.query(
    `SELECT engine, cost_cny FROM cost_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 5000`,
    [id],
  )) as Array<{ engine?: string | null; cost_cny?: number | string | null }>;

  const events = costEventsFromCostLog(
    rows.map((r) => ({ engine: r.engine, costCny: Number(r.cost_cny) || 0 })),
  );
  const attribution = attributeCost(events);

  // v9.7.17 预算护栏:?cap= 设上限 → ok/warn/over
  const capRaw = new URL(request.url).searchParams.get('cap');
  const capCny = capRaw != null && capRaw !== '' ? Number(capRaw) : null;
  const guard = evaluateCostGuard({ totalCny: attribution.totalCny, capCny });

  return NextResponse.json({ projectId: id, attribution, events: events.length, guard });
}
