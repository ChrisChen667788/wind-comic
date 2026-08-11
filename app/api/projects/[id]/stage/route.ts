/**
 * /api/projects/[id]/stage · v12.316 — 导演台舞台场景。
 *
 * GET  ?shot=N  → 读该镜舞台 + 构图体检 + 会注入提示词的那句话(所见即所得)
 * POST          → 存舞台;`dryRun` 时只体检不落库(拖动时实时预览用,零副作用)
 *
 * 权限:读 view / 写 edit。写不涉及花钱,但它**会改变后续出片的提示词** ——
 * 让只读协作者改掉别人的构图是越权。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/auth-guard';
import { getStageScene, saveStageScene, stageReport, stageDirectiveForShot } from '@/lib/stage-scene-store';
import type { StageScene } from '@/lib/stage-blocking';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'view');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  const shot = Number(new URL(request.url).searchParams.get('shot'));
  if (!Number.isFinite(shot)) {
    return NextResponse.json({ error: '缺少镜号参数 shot' }, { status: 400 });
  }
  const scene = await getStageScene(id, shot);
  if (!scene) return NextResponse.json({ shotNumber: shot, scene: null });

  return NextResponse.json({
    shotNumber: shot,
    scene,
    ...stageReport(scene),
    // 把真正会进提示词的那句话回出去 —— 用户能看到自己摆的位最终变成了什么
    directive: stageDirectiveForShot(scene),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'edit');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const shotNumber = Number(body?.shotNumber);
  const scene: StageScene = { actors: body?.actors, camera: body?.camera };
  if (!Number.isFinite(shotNumber)) {
    return NextResponse.json({ error: '缺少镜号 shotNumber' }, { status: 400 });
  }
  if (!scene.camera || typeof scene.camera.yawDeg !== 'number' || !Array.isArray(scene.actors)) {
    return NextResponse.json({ error: '舞台数据不完整:需要 camera(含 yawDeg)与 actors 数组' }, { status: 400 });
  }

  const report = stageReport(scene);
  const directive = stageDirectiveForShot(scene);

  // 拖动预览:只算不存。否则每拖一帧写一次库。
  if (body?.dryRun) {
    return NextResponse.json({ shotNumber, dryRun: true, ...report, directive });
  }

  // **有问题也存**:出画/被挡有时是导演故意的(比如前景遮挡做纵深)。
  // 把问题报出去让人判断,而不是替人否决 —— 与 v12.294「只报不拦」同一取舍。
  await saveStageScene(id, { ...scene, shotNumber });
  return NextResponse.json({ shotNumber, saved: true, ...report, directive });
}
