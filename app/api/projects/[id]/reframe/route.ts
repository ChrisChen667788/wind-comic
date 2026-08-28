/**
 * POST /api/projects/[id]/reframe (v12.16.0 · Phase 3 双版本) —— 把成片重构图成另一比例。
 *
 * 一次生成 → 两版出片:不重生每镜,直接把已合成的成片重构图(blur-pad 无损 / crop 填满)。
 * 竖屏短剧(9:16)一键导出横屏(16:9)版投 B站/YouTube;反之亦然。结果存为 `final_video_alt` 资产。
 *
 * 安全:登录 + 属主/可编辑守卫。
 */
import { NextResponse } from 'next/server';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { canEditProject } from '@/lib/project-share';
import { upsertAsset } from '@/lib/repos/asset-repo';
import { normalizeVideoAspect } from '@/lib/video-aspect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function parse(raw: string | null | undefined): any { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT id, user_id, aspect FROM projects WHERE id = ?').get(id) as any;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const owns = proj.user_id === payload.sub || (await canEditProject(id, payload.sub));
  if (!owns) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: any = {}; try { body = await request.json(); } catch {}
  const target = normalizeVideoAspect(body?.aspect);
  const mode = body?.mode === 'crop' ? 'crop' : 'blur-pad';
  // 目标比例若与项目主比例相同则无意义
  if (target === normalizeVideoAspect(proj.aspect)) {
    return NextResponse.json({ error: `项目主比例已是 ${target},无需重构图` }, { status: 400 });
  }

  // 取成片 URL
  const fv = db.prepare(`SELECT persistent_url, media_urls, data FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`).get(id) as any;
  const finalUrl: string | undefined = fv?.persistent_url || parse(fv?.media_urls)?.[0] || parse(fv?.data)?.url || undefined;
  if (!finalUrl) return NextResponse.json({ error: '未找到成片,请先合成' }, { status: 404 });

  try {
    const { reframeVideo } = await import('@/services/video-composer');
    const { outputPath, w, h } = await reframeVideo(finalUrl, target, mode);
    const altUrl = `${serveFilePathUrl(outputPath)}`;
    await upsertAsset({
      projectId: id, type: 'final_video_alt', name: `成片·${target}`,
      data: { aspect: target, mode, w, h, source: 'reframe' },
      mediaUrls: [altUrl], persistentUrl: null,
    });
    return NextResponse.json({ ok: true, aspect: target, mode, width: w, height: h, videoUrl: altUrl });
  } catch (e) {
    // v12.353:把内部错误翻成可执行的话。实测撞到的就是这条 ——
    // 成片的库记录还在,磁盘文件却没了(v12.342 那次误删的后遗症),
    // 而原文是 `serve-file path not found: /api/serve-file?key=…`,
    // 用户看了不知道该干什么。**报错的价值在于告诉人下一步做什么。**
    const raw = e instanceof Error ? e.message : String(e);
    const missing = /path not found|ENOENT|no such file/i.test(raw);
    return NextResponse.json({
      error: missing
        ? '成片的本地文件已丢失(库里有记录、磁盘上没有),需要重新合成后再改画幅'
        : '重构图失败: ' + raw.slice(0, 160),
      ...(missing ? { code: 'source_missing' } : {}),
    }, { status: 502 });
  }
}
