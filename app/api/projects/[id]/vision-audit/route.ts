/**
 * /api/projects/[id]/vision-audit  · v3.4
 *
 * GET  返回该项目所有镜头的 Vision Audit 结果 + 全片聚合 summary.
 * POST 落一批审核结果 (body: { audits: ShotAuditResult[] }) — 给离线/worker
 *      算完后回写用. 真正的 LLM 评分跑在 lib/vision-audit.auditShotVsScript.
 *
 * 注: 评分本身需要成片关键帧 + 剧本, 由 orchestrator / 离线任务调 lib 跑,
 * 这个 API 只管读 + 回写持久层, 保持 route 轻量.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import {
  getProjectAudits,
  saveShotAudit,
  aggregateFilmAudit,
  normalizeAuditResult,
  type ShotAuditResult,
} from '@/lib/vision-audit';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const audits = await getProjectAudits(id);
  const summary = aggregateFilmAudit(audits);
  return NextResponse.json({ projectId: id, audits, summary });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const rawAudits = Array.isArray(body?.audits) ? body.audits : null;
  if (!rawAudits) {
    return NextResponse.json({ error: 'body.audits 必填 (ShotAuditResult[])' }, { status: 400 });
  }

  // normalize 每条防脏数据, shot_number 缺失则跳过
  const saved: ShotAuditResult[] = [];
  for (const raw of rawAudits) {
    const shotNumber = Number(raw?.shotNumber);
    if (!Number.isFinite(shotNumber)) continue;
    const norm = normalizeAuditResult(raw, shotNumber);
    await saveShotAudit(id, norm);
    saved.push(norm);
  }

  const audits = await getProjectAudits(id);
  return NextResponse.json({
    projectId: id,
    savedCount: saved.length,
    summary: aggregateFilmAudit(audits),
  });
}
