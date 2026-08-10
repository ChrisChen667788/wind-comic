/**
 * GET /api/projects/[id]/cost (v12.190;v12.207 加 ?export=csv) — 项目成本下钻。
 * v12.218:改属主校验(成本含商业敏感,不再免鉴权)。
 * ?export=csv → 逐条成本明细 CSV 下载(团队对账/报销基础)。
 */
import { listCostLogByProject } from '@/lib/repos/cost-log-repo';
import { rollupByEngine } from '@/lib/cost-rollup';
import { buildCogsReport } from '@/lib/cogs-report';
import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { attributeCost, costEventsFromCostLog } from '@/lib/cost-attribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** CSV 字段转义:含逗号/引号/换行的值加引号并转义内部引号。 */
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.218(安全止血):成本数据含商业敏感,从「免鉴权」改属主校验(与 decision-log 对齐)。
  const g = await requireProjectAccess(request, id, 'view');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });
  const rows = await listCostLogByProject(id);

  if (new URL(request.url).searchParams.get('export') === 'csv') {
    const header = ['createdAt', 'engine', 'resolution', 'durationSec', 'costCny', 'shotNumber'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const shot = (r.metadata as Record<string, unknown>)?.shotNumber ?? '';
      lines.push([r.createdAt, r.engine, r.resolution, r.durationSec, r.costCny, shot].map(csvCell).join(','));
    }
    const total = Number(rows.reduce((t, r) => t + (Number(r.costCny) || 0), 0).toFixed(2));
    lines.push(['', '', '', '', total, `合计 ${rows.length} 条`].map(csvCell).join(','));
    return new NextResponse('﻿' + lines.join('\n'), { // BOM 保 Excel 中文不乱码
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cost-${id}.csv"`,
      },
    });
  }

  const byEngine = rollupByEngine(rows);
  const totalCny = Number(rows.reduce((t, r) => t + (Number(r.costCny) || 0), 0).toFixed(2));

  // v12.224:?report=cogs → 单片 COGS 报告(逐引擎单价×用量 + 可选毛利)。?sale=X 给参考售价算毛利率。
  const sp = new URL(request.url).searchParams;
  if (sp.get('report') === 'cogs') {
    const saleRaw = sp.get('sale');
    const saleCny = saleRaw != null && saleRaw !== '' && Number.isFinite(Number(saleRaw)) ? Number(saleRaw) : null;
    const report = buildCogsReport(byEngine, { projectId: id, saleCny });
    return NextResponse.json(report);
  }

  // v12.311:**接上成本归因** —— `lib/cost-attribution` 的 costEventsFromCostLog/attributeCost
  // 一直存在且可用,但这个端点从没调过它,于是前端 `CostAttributionPanel` 读的
  // `body.attribution` 永远是 undefined:面板对**所有用户**恒显「暂无成本数据」,
  // 类目条形、省钱提示、预算护栏三块功能整体失效 —— 又一处「造好没接线」。
  const attribution = attributeCost(costEventsFromCostLog(rows));

  return NextResponse.json({ projectId: id, totalCny, entries: rows.length, byEngine, attribution });
}
