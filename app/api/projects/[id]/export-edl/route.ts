/**
 * GET /api/projects/[id]/export-edl?format=edl|fcpxml · v8.0 — 导出剪辑表对接 DaVinci/Premiere
 *
 * 读项目剧本镜头序列 → CMX3600 EDL 或 FCP7 XML, 以 attachment 下载。
 * fps 取项目级格式 (v7.4 project-format), 缺省 24。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildEDL, buildFCPXML, type EdlShot } from '@/lib/edl-export';
import { normalizeProjectFormat } from '@/lib/project-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function firstUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a[0] : undefined; } catch { return undefined; }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const format = new URL(request.url).searchParams.get('format') === 'fcpxml' ? 'fcpxml' : 'edl';

  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shotsData: any[] = Array.isArray(script.shots) ? script.shots : [];
  if (!shotsData.length) return NextResponse.json({ error: '剧本/分镜尚未生成' }, { status: 404 });

  // 取每镜素材 URL (优先视频, 退分镜图)
  const videos = await listAssetsByType(projectId, 'video');
  const storyboards = await listAssetsByType(projectId, 'storyboard');
  const urlFor = (sn: number): string | undefined => {
    const v = videos.find((a) => a.shot_number === sn);
    if (v) return v.persistent_url || firstUrl(v.media_urls);
    const sb = storyboards.find((a) => a.shot_number === sn);
    return sb ? (sb.persistent_url || firstUrl(sb.media_urls)) : undefined;
  };

  // fps 取项目格式
  const fmtRows = await listAssetsByType(projectId, 'project-format');
  let fmt: any = {};
  try { fmt = JSON.parse(fmtRows[0]?.data || '{}'); } catch { fmt = {}; }
  const fps = normalizeProjectFormat(fmt).fps;

  const shots: EdlShot[] = shotsData.map((s, i) => ({
    name: `Shot ${String(s.shotNumber ?? i + 1).padStart(2, '0')}${s.emotion ? ` (${s.emotion})` : ''}`,
    durationS: typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5,
    sourceUrl: urlFor(s.shotNumber ?? i + 1),
  }));

  const title = `wind-comic-${projectId}`;
  if (format === 'fcpxml') {
    return new Response(buildFCPXML(shots, fps, title), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${title}.xml"`,
      },
    });
  }
  return new Response(buildEDL(shots, fps, title), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${title}.edl"`,
    },
  });
}
