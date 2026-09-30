/**
 * /api/projects/[id]/frame-strip · v12.328 — 逐帧检视。
 *
 * GET ?shot=N[&from=&to=&max=]
 *   → 规划该镜的逐帧时间戳并抽帧,返回每帧的 { frameIndex, atSec, url }。
 *
 * **权限 view 级**:只读、不调引擎、不花钱(与 segment-retake 的 POST 需要 edit
 * 形成对照 —— 那边会真花钱生成)。
 *
 * ── 它补的是哪条链 ────────────────────────────────────────────────
 * v12.315 的片段重拍要用户给 `fromS`/`toS`,但此前界面上没有任何东西让他**看清
 * 坏在哪一帧**,只能凭记忆估秒数。这里翻帧定位,响应里直接给出
 * `retakeHint` —— 把选中的帧区间换算成重拍可直接吃的秒区间,**同一套帧吸附口径**,
 * 不会出现「点了第 47 帧、却从 46 帧半切下去」。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { planFrameStrip, frameRangeToSeconds } from '@/lib/frame-strip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function parseJson(v: unknown): any {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}

/** 时长取 **timeline 终值**,不取 script 设计值(v12.298 的口径,与 segment-retake 一致) */
async function shotFinalDuration(projectId: string, shotNumber: number): Promise<number> {
  const rows = await listAssetsByType(projectId, 'timeline');
  const tl = parseJson(rows[0]?.data) || {};
  const t = (Array.isArray(tl.timeline) ? tl.timeline : []).find((x: any) => x?.shotNumber === shotNumber);
  return Number(t?.duration) || 0;
}

/** 该镜的成片文件(本地路径)—— 抽帧要的是文件,不是 URL */
async function shotVideoPath(projectId: string, shotNumber: number): Promise<string | null> {
  const rows = await listAssetsByType(projectId, 'video');
  const row = (rows || []).find((r: any) => Number(r.shot_number) === Number(shotNumber));
  if (!row) return null;
  const url = (row as any).persistent_url || parseJson((row as any).media_urls)?.[0] || '';
  if (!url) return null;
  // ⚠️ 这里**必须走验签入口**(v12.236:只给 HTTP 端点验签、漏了服务端读盘,?path= 可读任意文件)。
  // v12.459 起解析逻辑收口到 lib/media-local-path,与片段重拍共用一份;逐帧检视不下载远端,
  // 本来就只认站内文件,所以不开 allowRemote。
  const { resolveLocalMediaPath } = await import('@/lib/media-local-path');
  return (await resolveLocalMediaPath(url))?.path ?? null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireProjectAccess(request, id, 'view');
  if (!g.ok) return NextResponse.json({ message: g.message }, { status: g.status });

  const sp = new URL(request.url).searchParams;
  const shot = Number(sp.get('shot'));
  if (!Number.isFinite(shot)) return NextResponse.json({ error: '缺少镜号参数 shot' }, { status: 400 });

  const durationS = await shotFinalDuration(id, shot);
  if (durationS <= 0) {
    return NextResponse.json(
      { error: `第 ${shot} 镜还没有成片时长 —— 先出一次片再来逐帧看` },
      { status: 409 },
    );
  }

  const num = (k: string) => (sp.get(k) != null && sp.get(k) !== '' ? Number(sp.get(k)) : undefined);
  const plan = planFrameStrip({
    shotDurationS: durationS,
    fromS: num('from'),
    toS: num('to'),
    fps: num('fps'),
    maxFrames: num('max'),
  });
  // 规划不通过就直接说人话,不去做无谓的解码
  if (!plan.ok) return NextResponse.json({ error: plan.reason }, { status: 400 });

  const videoPath = await shotVideoPath(id, shot);
  if (!videoPath) {
    return NextResponse.json({ error: `找不到第 ${shot} 镜的成片文件` }, { status: 409 });
  }

  const { extractFrames } = await import('@/services/frame-strip.service');
  const { frames, failed } = await extractFrames({
    videoPath, timestamps: plan.timestamps, frameIndexes: plan.frameIndexes,
  });

  return NextResponse.json({
    shotNumber: shot,
    durationS,
    fps: plan.fps,
    /** 是否抽稀 —— 界面必须明说,否则用户以为看到的是每一帧 */
    thinned: plan.thinned,
    step: plan.step,
    frames,
    /** 逐帧失败的帧号:如实报出,不假装完整 */
    failedFrames: failed,
    /** 把「选中的帧区间」换算成重拍可直接吃的秒区间(同一帧吸附口径) */
    retakeHint: frames.length > 0
      ? frameRangeToSeconds(frames[0].frameIndex, frames[frames.length - 1].frameIndex, plan.fps)
      : null,
  });
}
