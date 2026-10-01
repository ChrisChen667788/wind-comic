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
import { getStageScene, saveStageScene, stageReport, stageDirectiveForShot, withProjectAspect } from '@/lib/stage-scene-store';
import { POSE_PRESETS, validateStagePayload } from '@/lib/stage-blocking';
import { getShotSketch, renderStageSketchForShot } from '@/lib/stage-sketch-store';

/** 姿态预设白名单 —— 不认识的 id 直接拒,而不是落库后由几何层静默忽略(facingDeg 就栽过这个) */
const isPosePresetId = (v: unknown): boolean =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(POSE_PRESETS, v);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProjectAccess(request, id, 'view');
  if (!gate.ok) return NextResponse.json({ message: gate.message }, { status: gate.status });

  const shot = Number(new URL(request.url).searchParams.get('shot'));
  if (!Number.isFinite(shot)) {
    return NextResponse.json({ error: '缺少镜号参数 shot' }, { status: 400 });
  }
  const scene = await getStageScene(id, shot);
  // v12.462:把这镜当前那张构图草图一起带回 —— 修前重开导演台草图就不见了,库里明明有
  const sketch = await getShotSketch(id, shot).catch(() => null);
  if (!scene) return NextResponse.json({ shotNumber: shot, scene: null, sketch });

  return NextResponse.json({
    shotNumber: shot,
    scene,
    ...stageReport(scene),
    // 把真正会进提示词的那句话回出去 —— 用户能看到自己摆的位最终变成了什么
    directive: stageDirectiveForShot(scene),
    sketch,
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
  if (!Number.isFinite(shotNumber)) {
    return NextResponse.json({ error: '缺少镜号 shotNumber' }, { status: 400 });
  }
  // v12.440 起逐字段校验;v12.462 收进纯函数并补上焦距 / 机高 / 人物名字与 id
  const checked = validateStagePayload(body, isPosePresetId);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const scene = checked.scene;

  // 体检与提示词按项目画幅算 —— 与 GET、编排器、草图同一口径(画幅不信请求体,以项目为准)
  const framed = await withProjectAspect(id, scene);
  const report = stageReport(framed);
  const directive = stageDirectiveForShot(framed);

  // 拖动预览:只算不存。否则每拖一帧写一次库。
  if (body?.dryRun) {
    return NextResponse.json({ shotNumber, dryRun: true, ...report, directive });
  }

  // **有问题也存**:出画/被挡有时是导演故意的(比如前景遮挡做纵深)。
  // 把问题报出去让人判断,而不是替人否决 —— 与 v12.294「只报不拦」同一取舍。
  const before = await getStageScene(id, shotNumber).catch(() => null);
  const beforeDirective = before ? stageDirectiveForShot(before) : '';
  await saveStageScene(id, { ...scene, shotNumber });
  const changed = directive !== beforeDirective;

  // 以下是**保存之后的附带动作**:站位已经落库,它们失败只记日志、不能把这次保存报成失败 ——
  // 否则用户看到「保存失败」重试,实际上已经存上了。
  // v12.462:站位真的变了(会进提示词的那句话不同了),这镜已经出过的分镜图 / 视频就是按旧站位出的 ——
  // 与改台账描述同一做法:标 stale(待重渲/复核,只是标记,不会自动花钱重拍)。只挪了画外的人、句子没变,就不打扰。
  let staleMarked = 0;
  if (changed) {
    try {
      const { setAssetsStaleByShots } = await import('@/lib/repos/asset-repo');
      staleMarked = await setAssetsStaleByShots(id, ['storyboard', 'video'], [shotNumber], true);
    } catch (e) {
      console.warn('[stage] 站位已存,但给已出的分镜图/视频标「待重渲」失败:', e);
    }
  }

  // v12.462:这镜当前草图若是导演台渲的,跟着新站位重渲(免费、确定性)。
  // 修前:渲过草图后再挪人、存站位,草图锁锁的还是旧构图,提示词里却是新站位 —— 两个口径打架。
  // AI 画的 / 用户上传的草图不动:那是用户自己的选择,导演台无权替换。
  let sketch: Awaited<ReturnType<typeof getShotSketch>> = null;
  let sketchRerendered = false;
  try {
    sketch = await getShotSketch(id, shotNumber);
    if (sketch?.mode === 'stage' && changed) {
      const r = await renderStageSketchForShot(id, shotNumber);
      if (r) { sketch = r.sketch; sketchRerendered = true; }
    }
  } catch (e) {
    console.warn('[stage] 站位已存,但草图读取/重渲失败 —— 草图可能仍是旧站位:', e);
  }
  return NextResponse.json({ shotNumber, saved: true, ...report, directive, changed, staleMarked, sketch, sketchRerendered });
}
