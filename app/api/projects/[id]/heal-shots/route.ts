/**
 * /api/projects/[id]/heal-shots (v12.125.0) — 缺失/降级镜自愈。
 *
 * 病根:成片有缺失镜(missing-video)/兜底镜(kenburns/broll)/烤字镜(video-baked-text)时,
 * quality_report 如实记账但补救靠人工。本端点读报告识别可自愈镜:
 *   · 默认(诊断):返回 healable 列表 + 是否有分镜图可补,不动数据。
 *   · heal:true:对有分镜图的可自愈镜逐个 orchestrator.regenerateShot(I2V 首帧锚定)→ 持久化 video 资产;
 *     recompose:true 时补拍完自向 recompose 重合成。供给恢复后一键补齐。
 * 鉴权:登录 + 属主/可编辑(改项目素材)。
 */
import { NextResponse } from 'next/server';
import { persistAsset } from '@/lib/asset-storage';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { db } from '@/lib/db';
import { canEditProject } from '@/lib/project-share';
import { listAssetsByType, updateAssetBySelector, createAsset } from '@/lib/repos/asset-repo';
import { identifyHealableShots } from '@/lib/heal-shots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function parse(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** 取某镜分镜图(persistent_url 优先,重生常在几天后 CDN 已过期)。 */
function storyboardImage(projectId: string, shot: number): string {
  try {
    const row = db.prepare(
      `SELECT media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = 'storyboard' AND shot_number = ? ORDER BY updated_at DESC LIMIT 1`,
    ).get(projectId, shot) as any;
    if (!row) return '';
    return row.persistent_url || (parse(row.media_urls) || [])[0] || '';
  } catch { return ''; }
}

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
  const doHeal = body?.heal === true;
  const doRecompose = body?.recompose === true;
  const videoProvider: string | undefined = typeof body?.videoProvider === 'string' ? body.videoProvider : undefined;

  // 读最新质检报告
  const qrRow = db.prepare(
    `SELECT data FROM project_assets WHERE project_id = ? AND type = 'quality_report' ORDER BY version DESC LIMIT 1`,
  ).get(id) as any;
  const report = parse(qrRow?.data);
  if (!report) return NextResponse.json({ error: '没有质检报告(先合成成片)', healable: [] }, { status: 400 });

  // 有分镜图的镜号
  const sbRows = await listAssetsByType(id, 'storyboard');
  const { assetShotNumber } = await import('@/lib/heal-shots');
  const storyboardShots = [...new Set(sbRows.map((r: any) => assetShotNumber(r)).filter((n: any) => Number.isInteger(n) && n > 0))]; // v12.138:蛇形行兼容

  const healable = identifyHealableShots(report, storyboardShots as number[]);

  // 诊断模式:只报告不动数据
  if (!doHeal) {
    return NextResponse.json({
      diagnose: true,
      healthScore: report.healthScore ?? null,
      summary: report.summary ?? '',
      healable,
      healableCount: healable.length,
      withStoryboard: healable.filter((h) => h.hasStoryboard).length,
      hint: healable.length
        ? '供给恢复后带 heal:true 重发即可一键补拍(可选 recompose:true 自动重合成)'
        : '无可自愈镜,成片质量良好',
    });
  }

  // 自愈模式:逐镜补拍(仅有分镜图的镜;无图的只能整片重跑,不在此端点范围)
  const targets = healable.filter((h) => h.hasStoryboard);
  if (targets.length === 0) {
    return NextResponse.json({ healed: [], skipped: healable, message: '可自愈镜均无分镜图可锚定,建议整片重生' });
  }

  const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
  const orchestrator = new HybridOrchestrator();
  // v12.132(issue #2 Bug B):补拍也贯通角色参考(此前只 setUserStyle,漏 char ref → 补的镜丢角色)
  try {
    const { parseProjectContext, applyProjectContext, PROJECT_CONTEXT_COLUMNS } = await import('@/lib/orchestrator-project-context');
    const row = db.prepare(`SELECT ${PROJECT_CONTEXT_COLUMNS} FROM projects WHERE id = ?`).get(id) as any;
    applyProjectContext(orchestrator, parseProjectContext(row));
  } catch { /* ignore */ }

  // 取剧本拿每镜 prompt/时长
  const scriptRow = (await listAssetsByType(id, 'script'))[0];
  const shots = parse(scriptRow?.data)?.shots || [];
  const shotMeta = (n: number) => shots.find((s: any) => (s.shotNumber ?? 0) === n) || {};

  const healed: any[] = [];
  const failed: any[] = [];
  for (const h of targets) {
    const imageUrl = storyboardImage(id, h.shot);
    const meta = shotMeta(h.shot);
    try {
      const clip = await orchestrator.regenerateShot(
        h.shot,
        { shotNumber: h.shot, imageUrl, prompt: meta.visualPrompt || meta.description || '' } as any,
        { duration: meta.duration || 5, videoProvider },
      );
      if (!clip?.videoUrl || clip.videoUrl.startsWith('data:')) throw new Error('regen returned no usable video url');
      // v12.347:注释写着「持久化」,做的却只是写 DB 行 —— **文件从没落过盘**,
      // 存进去的是引擎外链,几天后 403(owner 那批老素材正是这样批量失效的)。
      // 补渲的意义是「把坏掉的镜治好」,治完几天又坏等于没治。
      const persisted = await persistAsset(clip.videoUrl).catch(() => null);
      if (!persisted) console.warn(`[heal-shots] 落盘失败,回退外链(会过期):${String(clip.videoUrl).slice(0, 80)}`);
      const savedUrl = persisted?.url || clip.videoUrl;

      const sel = { type: 'video', shotNumber: h.shot };
      const changes = await updateAssetBySelector(id, sel, {
        mediaUrls: [savedUrl], persistentUrl: persisted?.url || null,
      });
      if (changes === 0) {
        await createAsset({ projectId: id, type: 'video', name: `视频 ${h.shot}`, data: { duration: clip.duration || 5, healed: true }, mediaUrls: [savedUrl], persistentUrl: persisted?.url || null, shotNumber: h.shot });
      }
      healed.push({ shot: h.shot, reasons: h.healable, videoUrl: savedUrl });
    } catch (e) {
      failed.push({ shot: h.shot, error: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // 自动重合成(可选)
  let recomposed: any = null;
  if (doRecompose && healed.length > 0) {
    try {
      const origin = new URL(request.url).origin;
      const r = await fetch(`${origin}/api/projects/${id}/recompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') || '', Cookie: request.headers.get('cookie') || '' },
        body: JSON.stringify({ aspect: body?.aspect || '9:16', captionStyle: body?.captionStyle || 'karaoke' }),
      });
      recomposed = { status: r.status, ...(await r.json().catch(() => ({}))) };
    } catch (e) {
      recomposed = { error: e instanceof Error ? e.message.slice(0, 120) : String(e) };
    }
  }

  return NextResponse.json({
    healed,
    healedCount: healed.length,
    failed,
    skipped: healable.filter((h) => !h.hasStoryboard),
    recomposed,
  });
}
