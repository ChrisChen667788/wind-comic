/**
 * POST /api/projects/[id]/export-jianying · 阶段三十 v12.38.0
 *
 * 把成片(各镜片段 + 配音 + BGM + 字幕)导出成剪映 draft_content.json + draft_meta_info.json,
 * 国内团队下载后放进剪映草稿目录即可二剪。登录 + 属主守卫。
 *
 * body: { name?, width?, height?, fps?, clips:[{name?,path,durationSec}], voiceovers?, bgm?, subtitles? }
 * 200 → { ok, draftContent, draftMeta, notes }
 *
 * 诚实:剪映 ≤5.9(6+ 加密);path 需本地可达;schema 社区逆向,导入前请在真剪映验证(见 lib/jianying-export 注释)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../../auth/lib';
import { buildJianYingDraft, buildJianYingMeta, type JyClip, type JyAudio, type JySubtitle } from '@/lib/jianying-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const p = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(id) as { user_id?: string } | undefined;
    if (p?.user_id && p.user_id !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } catch { /* demo → 放行 */ }

  let body: {
    name?: string; width?: number; height?: number; fps?: number;
    clips?: JyClip[]; voiceovers?: JyAudio[]; bgm?: { path: string; durationSec?: number }; subtitles?: JySubtitle[];
  };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const clips = (body.clips || []).filter((c) => c && typeof c.path === 'string' && c.path.length > 0);
  if (clips.length === 0) return NextResponse.json({ error: 'clips required(至少一个含 path 的片段)' }, { status: 400 });

  const draftContent = buildJianYingDraft({
    name: body.name, width: body.width, height: body.height, fps: body.fps,
    clips, voiceovers: body.voiceovers, bgm: body.bgm, subtitles: body.subtitles,
  });
  const draftMeta = buildJianYingMeta(
    String(draftContent.name || 'Wind Comic 导出'),
    String(draftContent.id || ''),
    Number(draftContent.duration || 0),
  );

  return NextResponse.json({
    ok: true,
    draftContent,
    draftMeta,
    notes: [
      '剪映 5.9 及以下可直接读(6+ 加密不支持)',
      'path 为素材本地路径:导入前把素材下载到本地并确保 path 指向本地文件',
      '把 draftContent 存为 draft_content.json、draftMeta 存为 draft_meta_info.json,放进剪映草稿文件夹',
      'schema 系社区逆向,首次导入请在剪映里校验时间轴',
    ],
  });
}

/**
 * v12.349:GET —— 服务端直接从项目资产组装草稿并下载。
 *
 * 原来只有 POST,而且要调用方自己把 `clips[{path,durationSec}]` 拼好。**没有任何前端调它** ——
 * 端点造好了两个月没接线。不接线的原因也很实在:调用方拿不到「剪映打得开的路径」,
 * 它手里只有 `/api/serve-file?key=…`,那是 HTTP URL,剪映不认。
 *
 * 关键在于**本项目是本机跑的** —— 素材就在 `data/storage/assets/` 下,
 * 剪映和本应用在同一台机器上,所以**绝对路径直接可用**。这一步只有服务端做得了。
 *
 * `?file=content` → draft_content.json;`?file=meta` → draft_meta_info.json。
 * 两次下载,与既有 EDL/AAF 的 Content-Disposition 模式一致(不引入打包依赖)。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const proj = db.prepare('SELECT user_id, title FROM projects WHERE id = ?').get(id) as
    { user_id?: string; title?: string } | undefined;
  if (!proj) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  if (proj.user_id && proj.user_id !== payload.sub) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const which = request.nextUrl.searchParams.get('file') === 'meta' ? 'meta' : 'content';
  const { resolveByKey } = await import('@/lib/asset-storage');

  /** serve-file URL / 本地路径 → 剪映打得开的**绝对路径**;拿不到返回 null。 */
  const toLocalPath = (u: string | null | undefined): string | null => {
    if (!u) return null;
    const m = String(u).match(/key=([0-9a-zA-Z_-]+)/);
    if (m) return resolveByKey(m[1])?.absPath || null;
    const p = String(u).match(/[?&]path=([^&]+)/);
    if (p) { try { return decodeURIComponent(p[1]); } catch { return null; } }
    return String(u).startsWith('/') && !String(u).startsWith('/api/') ? String(u) : null;
  };

  const rows = db.prepare(
    `SELECT type, name, shot_number, data, persistent_url, media_urls FROM project_assets
      WHERE project_id = ? AND type IN ('video', 'shot-audio', 'music')
      ORDER BY shot_number`).all(id) as Array<{
        type: string; name: string; shot_number: number | null;
        data: string; persistent_url: string | null; media_urls: string;
      }>;
  const j = (x: string) => { try { return JSON.parse(x || '{}'); } catch { return {}; } };
  const firstUrl = (r: { persistent_url: string | null; media_urls: string }) =>
    r.persistent_url || (Array.isArray(j(r.media_urls)) ? j(r.media_urls)[0] : null);

  const clips: JyClip[] = [];
  const voiceovers: JyAudio[] = [];
  let bgm: { path: string; durationSec?: number } | undefined;
  const skipped: string[] = [];
  let cursor = 0;

  for (const r of rows) {
    const local = toLocalPath(firstUrl(r));
    const dur = Number(j(r.data)?.duration) || 5;
    if (!local) { skipped.push(`${r.type}${r.shot_number != null ? ` #${r.shot_number}` : ''}`); continue; }
    if (r.type === 'video') {
      clips.push({ name: r.name || `Shot ${r.shot_number ?? clips.length + 1}`, path: local, durationSec: dur });
      cursor += dur;
    } else if (r.type === 'shot-audio') {
      voiceovers.push({ name: r.name, path: local, startSec: 0, durationSec: dur });
    } else if (r.type === 'music' && !bgm) {
      bgm = { path: local, durationSec: cursor || undefined };
    }
  }

  if (clips.length === 0) {
    return NextResponse.json({
      error: '没有可导出的成片片段 —— 视频素材未生成,或本地文件已丢失',
      skipped,
    }, { status: 409 });
  }

  const draftContent = buildJianYingDraft({ name: proj.title?.split('\n')[0]?.slice(0, 40) || 'Wind Comic 导出', clips, voiceovers, bgm });
  const draftMeta = buildJianYingMeta(
    String(draftContent.name || 'Wind Comic 导出'),
    String(draftContent.id || ''),
    Number(draftContent.duration || 0),
  );
  const body = which === 'meta' ? draftMeta : draftContent;
  const filename = which === 'meta' ? 'draft_meta_info.json' : 'draft_content.json';

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // 诚实:把限制随文件一起交出去,而不是只写在代码注释里
      'X-JianYing-Notes': encodeURIComponent(
        `剪映 ≤5.9 可用(6+ 草稿加密);共 ${clips.length} 镜、配音 ${voiceovers.length} 条${bgm ? '、含 BGM' : ''}` +
        (skipped.length ? `;已跳过缺本地文件的 ${skipped.length} 项` : '') +
        ';schema 为社区逆向,导入前请在真剪映验证',
      ),
    },
  });
}
