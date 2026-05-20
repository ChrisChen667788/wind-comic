/**
 * /api/projects/[id]/export-platform  · v3.5.1
 *
 * POST 把项目成片导出成目标平台版本 (横竖屏 + 平台字幕).
 * body: { aspect: '9:16'|'16:9'|'1:1'|'4:5', fit?, subtitlePlatform? }
 *
 * 读 final_video 资产 → 解析本地路径 → exportForPlatform → 返回 serve-file URL.
 * 这是 additive 后处理, 不动 composeVideo 主流程.
 *
 * Auth: 登录用户.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import { getUserFromRequest } from '../../../auth/lib';
import { db } from '@/lib/db';
import { exportForPlatform } from '@/services/video-export-service';
import type { ExportAspect, FitMode } from '@/lib/video-export';
import type { SubtitlePlatform } from '@/lib/subtitle-burn';

export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_ASPECTS: ExportAspect[] = ['16:9', '9:16', '1:1', '4:5'];
const VALID_FITS: FitMode[] = ['contain', 'cover', 'blur-pad'];

/** 从 media_urls 里抽出本地绝对路径 (serve-file?path=... 形式). */
function extractLocalPath(mediaUrls: string[]): string | null {
  for (const u of mediaUrls) {
    if (typeof u !== 'string') continue;
    if (u.startsWith('/api/serve-file')) {
      try {
        const parsed = new URL(u, 'http://localhost');
        const p = parsed.searchParams.get('path');
        if (p && fs.existsSync(p)) return p;
      } catch { /* ignore */ }
    }
    // 直接是本地路径
    if (u.startsWith('/') && !u.startsWith('/api/') && fs.existsSync(u)) return u;
  }
  return null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  const aspect = body?.aspect as ExportAspect;
  if (!VALID_ASPECTS.includes(aspect)) {
    return NextResponse.json({ error: `aspect 必须是 ${VALID_ASPECTS.join(' / ')}` }, { status: 400 });
  }
  const fit: FitMode = VALID_FITS.includes(body?.fit) ? body.fit : 'blur-pad';
  const subtitlePlatform = typeof body?.subtitlePlatform === 'string'
    ? (body.subtitlePlatform as SubtitlePlatform) : undefined;

  // 找 final_video 资产
  const finalRow = db
    .prepare(`SELECT data, media_urls FROM project_assets WHERE project_id = ? AND type = 'final_video' ORDER BY version DESC LIMIT 1`)
    .get(id) as any;
  if (!finalRow) {
    return NextResponse.json({ error: '该项目还没有成片, 无法导出' }, { status: 400 });
  }

  let mediaUrls: string[] = [];
  try { mediaUrls = JSON.parse(finalRow.media_urls || '[]'); } catch { /* ignore */ }
  const inputPath = extractLocalPath(mediaUrls);
  if (!inputPath) {
    return NextResponse.json({ error: '成片源文件不在本地 (可能是占位/外链), 无法平台导出' }, { status: 400 });
  }

  try {
    const result = await exportForPlatform({ inputPath, aspect, fit, subtitlePlatform });
    return NextResponse.json({
      projectId: id,
      aspect: result.aspect,
      width: result.width,
      height: result.height,
      url: `/api/serve-file?path=${encodeURIComponent(result.outputPath)}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 200) : 'export failed' },
      { status: 500 },
    );
  }
}
