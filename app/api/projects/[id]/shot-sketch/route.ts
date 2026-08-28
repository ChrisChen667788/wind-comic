/**
 * /api/projects/[id]/shot-sketch (v12.136.0,issue #2 镜头语言草图锁 —— 草图来源层)。
 *
 * 为某镜准备一张「构图草图」,供 regenerate-storyboard 作构图约束(见 lib/storyboard-sketch)。两种来源:
 *   · mode:'generate' —— AI 按场景 + 机位出一张粗线稿黑白草图(对标腾讯智影/Dreamina 的分镜面板)。
 *   · mode:'set'      —— 用户上传/手绘草图的 http URL(需先走 /api/upload 落盘)。
 *   · mode:'stage'    —— v12.317:由**导演台舞台**渲一张布局草图。
 *     相比 'generate':免费、确定性、且天生与用户摆的位一致 —— AI 画的草图不保证画的
 *     正是你要的构图,而这张按 `projectScene` 的同一套几何画,与提示词里的站位描述必然一致。
 * 落 `storyboard-sketch` 资产(按 shot_number)。默认不改成片流程 —— 草图只在开启草图锁的重生里生效。
 * 鉴权:登录 + 属主/可编辑。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { db } from '@/lib/db';
import { canEditProject } from '@/lib/project-share';
import { createAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { buildSketchGenPrompt } from '@/lib/storyboard-sketch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT user_id, style_id FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (proj.user_id !== payload.sub && !(await canEditProject(id, payload.sub))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({} as any));
  const shotNumber = Number(body?.shotNumber);
  if (!Number.isInteger(shotNumber) || shotNumber <= 0) {
    return NextResponse.json({ error: 'shotNumber(正整数)必填' }, { status: 400 });
  }
  const mode: 'generate' | 'set' | 'stage' =
    body?.mode === 'set' ? 'set' : body?.mode === 'stage' ? 'stage' : 'generate';
  const sketchMeta = body?.sketchMeta && typeof body.sketchMeta === 'object' ? body.sketchMeta : undefined;
  const aspectRatio = typeof body?.aspectRatio === 'string' ? body.aspectRatio : '16:9';

  let sketchUrl: string | null = null;
  const stageMeta: Record<string, unknown> = {};

  if (mode === 'stage') {
    // 舞台渲草图:不花钱、不调引擎。没摆过位就明确说,而不是渲一张空白图糊弄。
    const { getStageScene } = await import('@/lib/stage-scene-store');
    const scene = await getStageScene(id, shotNumber);
    if (!scene) {
      return NextResponse.json(
        { error: `第 ${shotNumber} 镜还没在导演台摆过位 —— 先摆位(POST /api/projects/${id}/stage)再渲草图` },
        { status: 409 },
      );
    }
    const { renderStageSketch, sketchMetaFromScene } = await import('@/lib/stage-sketch');
    const { storagePut } = await import('@/lib/storage');
    const [w, h] = aspectRatio === '9:16' ? [540, 960] : aspectRatio === '1:1' ? [720, 720] : [960, 540];
    const png = renderStageSketch(scene, { width: w, height: h });
    const put = await storagePut(png, 'image/png', 'png');
    sketchUrl = put.url;
    // 镜头元数据也由舞台算出来 —— 与草图同源,不让用户再填一遍
    if (!body?.sketchMeta) Object.assign(stageMeta, sketchMetaFromScene(scene));
  } else if (mode === 'set') {
    const url = typeof body?.imageUrl === 'string' ? body.imageUrl : '';
    if (!url.startsWith('http')) {
      return NextResponse.json({ error: 'imageUrl 必须是 http URL(请先走 /api/upload 落盘)' }, { status: 400 });
    }
    sketchUrl = url;
  } else {
    // AI 生成:粗线稿黑白草图(只锁构图,压细节/配色)
    const sceneDescription = typeof body?.sceneDescription === 'string' ? body.sceneDescription : '';
    if (sceneDescription.trim().length < 5) {
      return NextResponse.json({ error: 'generate 模式需 sceneDescription(≥5 字,该镜场景/画面描述)' }, { status: 400 });
    }
    const sketchPrompt = buildSketchGenPrompt(sceneDescription, sketchMeta);
    try {
      const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
      const orchestrator = new HybridOrchestrator();
      if (proj.style_id) { try { orchestrator.setUserStyle(proj.style_id); } catch { /* ignore */ } }
      // 草图本身不套角色/风格参考(要的就是干净构图);走完整图像路由。
      sketchUrl = await (orchestrator as any).generateImage(sketchPrompt, { aspectRatio, label: `Shot ${shotNumber} 草图` });
    } catch (e) {
      return NextResponse.json({ error: `草图生成失败: ${e instanceof Error ? e.message.slice(0, 160) : e}` }, { status: 502 });
    }
    if (!sketchUrl || sketchUrl.startsWith('data:')) {
      return NextResponse.json({ error: '草图生成返回空/mock(引擎不可用)' }, { status: 502 });
    }
  }

  if (!sketchUrl) return NextResponse.json({ error: '未能得到草图 URL' }, { status: 500 });

  // 落 storyboard-sketch 资产(每镜留最新一张:先删该镜旧草图再建)
  const finalSketchUrl: string = sketchUrl;
  try {
    const existing = await listAssetsByType(id, 'storyboard-sketch');
    // 只删同镜号的旧草图(deleteAssetsByType 会删全部,故用逐条删同镜号)
    const { assetShotNumber } = await import('@/lib/heal-shots');
    for (const a of existing.filter((x: any) => assetShotNumber(x) === shotNumber)) {
      try { db.prepare('DELETE FROM project_assets WHERE id = ?').run((a as any).id); } catch { /* ignore */ }
    }
    // v12.347:草图 URL 可能是引擎外链,原本直接当 persistent_url 存 —— 库里 9 条假持久就是这么来的。
    const { persistAsset } = await import('@/lib/asset-storage');
    const sketchPersisted = await persistAsset(finalSketchUrl).catch(() => null);
    if (!sketchPersisted) console.warn(`[shot-sketch] 落盘失败,回退外链(会过期):${String(finalSketchUrl).slice(0, 80)}`);
    await createAsset({ projectId: id, type: 'storyboard-sketch', name: `Shot ${shotNumber} 构图草图`, data: { mode, sketchMeta: sketchMeta || (Object.keys(stageMeta).length ? stageMeta : null) }, mediaUrls: [sketchPersisted?.url || finalSketchUrl], shotNumber, persistentUrl: sketchPersisted?.url || null });
  } catch (e) {
    return NextResponse.json({ error: `草图落库失败: ${e instanceof Error ? e.message.slice(0, 120) : e}`, sketchUrl }, { status: 500 });
  }

  return NextResponse.json({
    shotNumber, mode, sketchUrl: finalSketchUrl,
    hint: '重生该镜分镜图时传 sketchLock:true 即用此草图锁构图(POST recompose/regenerate-storyboard)',
  });
}
