/**
 * /api/projects/[id]/publish-readiness · v9.4.1
 *
 * GET 成片「发布就绪」裁决 — 阶段十五「质量与一致性深化」把零散质量信号收成一个
 * 「能不能发/导出」的只读结论:
 *   - Vision 每镜质检 (shot_vision_audits → aggregateFilmAudit)
 *   - 成片 3 维评分 (project_quality_scores → getLatestQualityScore)
 * → evaluateQualityGate → { level: pass/warn/block, ready, reasons, weakestShots, failedDimensions }。
 *
 * 非破坏性:不改任何导出行为,只暴露裁决供前端「发布就绪徽章」展示。导出/发布端点
 * 的硬拦截 (block → 拦) 作为后续可选。
 *
 * Auth: 与 vision-audit GET 一致 (只读公开),不强制登录。
 */
import { NextResponse } from 'next/server';
import { getProjectAudits, aggregateFilmAudit } from '@/lib/vision-audit';
import { getLatestQualityScore } from '@/lib/quality-scores';
import { evaluateQualityGate } from '@/lib/quality-gate';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const audits = await getProjectAudits(id);
  const filmAudit = audits.length ? aggregateFilmAudit(audits) : null;
  const qualityScore = await getLatestQualityScore(id);

  const gate = evaluateQualityGate({ filmAudit, qualityScore });

  return NextResponse.json({
    projectId: id,
    gate,
    hasAudit: audits.length > 0,
    hasQualityScore: !!qualityScore,
  });
}
