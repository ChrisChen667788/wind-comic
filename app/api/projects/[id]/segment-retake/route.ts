/**
 * /api/projects/[id]/segment-retake · v12.315 — 镜内片段重拍。
 *
 *   GET  ?shotNumber=N   → 该镜的重拍历史(新→旧,标出已采用的那条)
 *   POST { shotNumber, fromS, toS, dryRun: true }  → 只算计划(不花钱)
 *   POST { shotNumber, fromS, toS, prompt? }        → 生成补丁 + 缝合 + 记 take(v12.459 起真的缝合)
 *   POST { adoptTakeId }                            → 采用某条 take(采用「原片」即回退)
 *
 * 鉴权按 v12.312 立的规矩:**写操作要 editor 级**。片段重拍会真花钱(调视频引擎),
 * 更不能像 regenerate-shot 那样裸奔 —— 那条路由此前匿名可烧钱,正是上一版修掉的。
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { planSegmentRetake } from '@/lib/segment-retake';
import { listSegmentTakes, adoptSegmentTake } from '@/lib/shot-segment-retake';
import {
  runSegmentRetake, shotFinalDuration, projectFps, tryLockShot, SegmentRetakeError,
  type GeneratePatch,
} from '@/services/segment-retake-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 真重拍要等视频引擎出片(MiniMax 实测 30–120s)+ 一趟缝合;部署到有超时的平台时给足
export const maxDuration = 300;

const parseJson = (raw: string | null | undefined): any => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

/**
 * 线上的补丁生成:编排器单镜重生(与 regenerate-shot 同一条引擎链、同一套项目上下文 —— 画风、
 * 主体参考、锁定角色、导演台站位都带上)。首帧用**原片在切入点的那一帧**,补丁从原画面接着拍。
 */
function orchestratorPatch(projectId: string, videoProvider?: string): GeneratePatch {
  return async ({ shotNumber, durationS, firstFrameUrl, promptExtra }) => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const orchestrator = new HybridOrchestrator();
    try {
      const { db } = await import('@/lib/db');
      const { parseProjectContext, applyProjectContext, PROJECT_CONTEXT_COLUMNS } = await import('@/lib/orchestrator-project-context');
      const row = db.prepare(`SELECT ${PROJECT_CONTEXT_COLUMNS} FROM projects WHERE id = ?`).get(projectId) as any;
      applyProjectContext(orchestrator, parseProjectContext(row));
    } catch (e) {
      console.warn('[segment-retake] 项目上下文加载失败,补丁不带画风/角色参考:', e instanceof Error ? e.message : e);
    }
    const sb = (await listAssetsByType(projectId, 'storyboard')).find((r) => r.shot_number === shotNumber);
    const { pickEngineImageUrl } = await import('@/lib/first-frame');
    const description = sb ? String(parseJson(sb.data)?.description || '') : '';
    const storyboard = {
      shotNumber,
      imageUrl: firstFrameUrl || (sb && pickEngineImageUrl(sb)) || '',
      prompt: [description || `镜头 ${shotNumber}`, promptExtra].filter(Boolean).join('. '),
    };
    const result: any = await orchestrator.regenerateShot(shotNumber, storyboard, {
      duration: durationS,
      videoProvider: videoProvider || undefined,
      projectId,
    });
    return { videoUrl: String(result?.videoUrl || ''), isAnimatic: !!result?.isAnimatic };
  };
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

  // ── 采用某条 take(含「原片」= 回退)────────────────────────────────
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

  // 先算计划:不通过就把**人话原因**直接回给用户,不去花钱调引擎。
  // v12.459:预演与真跑用同一个项目帧率 —— 此前预演不传 fps(按 24 算),真跑若按项目帧率就可能差一帧。
  const fps = await projectFps(id);
  const plan = planSegmentRetake({ shotDurationS, fromS, toS, fps });
  if (!plan.ok) return NextResponse.json({ message: plan.reason, plan }, { status: 400 });

  // 预演模式:只回计划,不生成 —— 前端框选后先看「要生成 3s、补 2s、总长不变」再决定花不花钱
  if (body?.dryRun) return NextResponse.json({ plan, dryRun: true });

  // v12.459 起补丁由服务端自己生成(见 services/segment-retake-run)。旧的 patchUrl 入参不再接受:
  // 它会让调用方绕过缝合,把一段裸补丁记成整镜 —— 正是 C 条那个病。
  if (body?.patchUrl) {
    return NextResponse.json({ message: '不再接受 patchUrl:补丁由服务端生成并缝合(v12.459)', plan }, { status: 400 });
  }

  // 会真花钱:预算护栏(与 regenerate-shot 同一口径,按本次要生成的秒数估)
  const { assertBudget } = await import('@/lib/budget-enforce');
  const { estimatePipelineCostCny } = await import('@/lib/budget-estimate');
  const videoProvider = typeof body?.videoProvider === 'string' ? body.videoProvider : undefined;
  const pending = estimatePipelineCostCny({
    shotCount: 1, videoShots: 1, videoProvider, secondsPerShot: plan.generateDurationS, skipImages: true,
  });
  const b = await assertBudget({ userId: g.userId, pendingCostCny: pending });
  if (!b.allow) {
    return NextResponse.json({ message: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });
  }

  const unlock = tryLockShot(id, shotNumber);
  if (!unlock) {
    return NextResponse.json({ message: `镜 ${shotNumber} 已有一次片段重拍在进行中,等它结束再试` }, { status: 409 });
  }
  try {
    const r = await runSegmentRetake(
      { projectId: id, shotNumber, fromS, toS, prompt: body?.prompt ? String(body.prompt).slice(0, 500) : undefined },
      {
        generatePatch: orchestratorPatch(id, videoProvider),
        // 只有零成本联调模式(MOCK_ENGINES=1)才放行占位补丁;线上引擎全挂时如实报错
        allowAnimaticPatch: process.env.MOCK_ENGINES === '1',
      },
    );
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof SegmentRetakeError) {
      return NextResponse.json({ message: e.message, ...(e.detail || {}) }, { status: e.status });
    }
    // 原始报错(ffmpeg / ffprobe / 文件系统)常带服务器上的绝对路径 —— 只进日志,不回给前端
    console.error('[segment-retake] 片段重拍失败:', e);
    return NextResponse.json({ message: '片段重拍失败(服务端处理出错,详情见服务器日志),请稍后重试' }, { status: 500 });
  } finally {
    unlock();
  }
}
