/**
 * /api/projects/[id]/segment-retake · v12.315 — 镜内片段重拍。
 *
 *   GET  ?shotNumber=N   → 该镜的重拍历史(新→旧,标出已采用的那条)
 *   POST { shotNumber, fromS, toS, prompt? }        → 算计划 + 生成补丁 + 缝合 + 记 take
 *   POST { adoptTakeId }                            → 采用某条 take
 *
 * 鉴权按 v12.312 立的规矩:**写操作要 editor 级**。片段重拍会真花钱(调视频引擎),
 * 更不能像 regenerate-shot 那样裸奔 —— 那条路由此前匿名可烧钱,正是上一版修掉的。
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { planSegmentRetake } from '@/lib/segment-retake';
import { listSegmentTakes, adoptSegmentTake, recordSegmentTake } from '@/lib/shot-segment-retake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parseJson = (raw: string | null | undefined): any => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

/** 取该镜**成片终值**时长 —— 必须读 timeline(v12.298 起那里才是终值),不能读 script 设计值 */
async function shotFinalDuration(projectId: string, shotNumber: number): Promise<number> {
  const rows = await listAssetsByType(projectId, 'timeline');
  const tl = parseJson(rows[0]?.data) || {};
  const t = (Array.isArray(tl.timeline) ? tl.timeline : []).find((x: any) => x?.shotNumber === shotNumber);
  return Number(t?.duration) || 0;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireProjectAccess(request, id, 'view');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  const snRaw = new URL(request.url).searchParams.get('shotNumber');
  const sn = snRaw != null && snRaw !== '' ? Number(snRaw) : undefined;
  const takes = await listSegmentTakes(id, Number.isFinite(sn as number) ? (sn as number) : undefined);
  return NextResponse.json({ takes });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 写操作 + 会花钱 → editor 级
  const g = await requireProjectAccess(request, id, 'edit');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  let body: any = {};
  try { body = await request.json(); } catch { return NextResponse.json({ message: '非法 JSON' }, { status: 400 }); }

  // ── 采用某条 take ────────────────────────────────────────────────
  if (body?.adoptTakeId) {
    const r = await adoptSegmentTake(id, String(body.adoptTakeId));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  // ── 新建一次片段重拍 ─────────────────────────────────────────────
  const shotNumber = Number(body?.shotNumber);
  const fromS = Number(body?.fromS);
  const toS = Number(body?.toS);
  if (!Number.isFinite(shotNumber)) return NextResponse.json({ message: '缺少 shotNumber' }, { status: 400 });

  const shotDurationS = await shotFinalDuration(id, shotNumber);
  if (!shotDurationS) {
    return NextResponse.json({ message: `镜 ${shotNumber} 还没有成片时长(先出一次片再来重拍片段)` }, { status: 409 });
  }

  // 先算计划:不通过就把**人话原因**直接回给用户,不去花钱调引擎
  const plan = planSegmentRetake({ shotDurationS, fromS, toS });
  if (!plan.ok) return NextResponse.json({ message: plan.reason, plan }, { status: 400 });

  // 预演模式:只回计划,不生成 —— 前端框选时实时显示「要生成 3s、补 2s、总长不变」
  if (body?.dryRun) return NextResponse.json({ plan, dryRun: true });

  // 真正生成补丁素材需要引擎与本地文件,这一步交给出片链路的既有能力;
  // 本路由只负责编排与记账,不在这里重复实现引擎选路。
  const patchUrl = String(body?.patchUrl || '').trim();
  if (!patchUrl) {
    return NextResponse.json({
      message: '缺少 patchUrl —— 请先用视频引擎按 plan.generateDurationS 生成补丁素材,再提交缝合',
      plan,
    }, { status: 422 });
  }

  const { takeId } = await recordSegmentTake({
    projectId: id, shotNumber, fromS: plan.patchFromS, toS: plan.patchToS,
    videoUrl: patchUrl, prompt: body?.prompt ? String(body.prompt) : undefined,
    planSummary: plan,
  });
  return NextResponse.json({ ok: true, takeId, plan });
}
