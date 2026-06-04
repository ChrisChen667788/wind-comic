/**
 * /api/projects/[id]/consistency · v9.4.5
 *
 * GET 项目级一致性报告 —— 聚合跨迭代轮次的成片 3 维评分(连贯/光影/脸,project_quality_scores)
 * → 最新各维 + 跨轮趋势 + 最弱维 + 时间序列(`lib/consistency-report`)。只读,供「一致性」视图。
 */
import { NextResponse } from 'next/server';
import { listQualityScores } from '@/lib/quality-scores';
import { buildConsistencyReport } from '@/lib/consistency-report';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scores = await listQualityScores(id); // newest-first
  const report = buildConsistencyReport(scores);
  return NextResponse.json({ projectId: id, report });
}
