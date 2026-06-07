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
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { dialogueLinesFromShots, buildLipSyncPlan } from '@/lib/lipsync-plan';
import type { ScriptShot } from '@/types/agents';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const audits = await getProjectAudits(id);
  const filmAudit = audits.length ? aggregateFilmAudit(audits) : null;
  const qualityScore = await getLatestQualityScore(id);

  // v9.6.4 融门禁:口型就绪度作为「增强」维度并入门禁(只升 warn, 不硬拦发布)。
  let lipSync: { lines: number; readiness: number; level: 'none' | 'pass' | 'warn' | 'block' } | null = null;
  try {
    const scriptRows = await listAssetsByType(id, 'script');
    let script: { shots?: ScriptShot[] } = {};
    try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
    const shots: ScriptShot[] = Array.isArray(script.shots) ? script.shots : [];
    const plan = buildLipSyncPlan(dialogueLinesFromShots(shots));
    lipSync = { lines: plan.lines, readiness: plan.readiness, level: plan.level };
  } catch { /* 口型为增强信号,失败不影响门禁主体 */ }

  // v9.7.14:实测口型-音频对齐分(面板/批量 QC 存的)并入门禁(增强维度,只升 warn)。
  let lipAudioAlign: { measuredShots: number; weakShots: number; avgScore: number } | null = null;
  try {
    const alignRows = await listAssetsByType(id, 'lipsync-align');
    const scores: Record<string, number> = JSON.parse(alignRows[0]?.data || '{}')?.scores || {};
    const vals = Object.values(scores).map(Number).filter((n) => Number.isFinite(n));
    if (vals.length) {
      lipAudioAlign = {
        measuredShots: vals.length,
        weakShots: vals.filter((s) => s < 60).length,
        avgScore: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      };
    }
  } catch { /* 对齐为增强信号,失败不影响门禁主体 */ }

  const gate = evaluateQualityGate({ filmAudit, qualityScore, lipSync, lipAudioAlign });

  return NextResponse.json({
    projectId: id,
    gate,
    hasAudit: audits.length > 0,
    hasQualityScore: !!qualityScore,
    hasLipSync: !!lipSync && lipSync.lines > 0,
    lipSync,
    hasLipAudioAlign: !!lipAudioAlign,
    lipAudioAlign,
  });
}
