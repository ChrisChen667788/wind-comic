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
