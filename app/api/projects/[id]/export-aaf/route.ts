/**
 * GET /api/projects/[id]/export-aaf · v9.2.0 — 真 AAF 二进制导出 (对接 Avid Media Composer)
 *
 * 读项目剧本镜头序列 → AAF 组合模型 → 真二进制 CFB 容器 (.aaf), attachment 下载。
 * fps 取项目级格式 (v7.4 project-format), 缺省 24。
 *
 * 与 export-edl (EDL/FCPXML) 并列: AAF 给 Avid; EDL/FCPXML 给 DaVinci/Premiere。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildAAF } from '@/lib/aaf-export';
import { type EdlShot } from '@/lib/edl-export';
import { normalizeProjectFormat } from '@/lib/project-format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function firstUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a[0] : undefined; } catch { return undefined; }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shotsData: any[] = Array.isArray(script.shots) ? script.shots : [];
  if (!shotsData.length) return NextResponse.json({ error: '剧本/分镜尚未生成' }, { status: 404 });

  const videos = await listAssetsByType(projectId, 'video');
  const storyboards = await listAssetsByType(projectId, 'storyboard');
  const urlFor = (sn: number): string | undefined => {
    const v = videos.find((a) => a.shot_number === sn);
    if (v) return v.persistent_url || firstUrl(v.media_urls);
    const sb = storyboards.find((a) => a.shot_number === sn);
    return sb ? (sb.persistent_url || firstUrl(sb.media_urls)) : undefined;
  };

  const fmtRows = await listAssetsByType(projectId, 'project-format');
  let fmt: any = {};
  try { fmt = JSON.parse(fmtRows[0]?.data || '{}'); } catch { fmt = {}; }
  const fps = normalizeProjectFormat(fmt).fps;

  const shots: EdlShot[] = shotsData.map((s, i) => ({
    name: `Shot ${String(s.shotNumber ?? i + 1).padStart(2, '0')}${s.emotion ? ` (${s.emotion})` : ''}`,
    durationS: typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5,
    sourceUrl: urlFor(s.shotNumber ?? i + 1),
  }));

  const title = (script.title || `Wind Comic ${projectId.slice(0, 8)}`).toString().slice(0, 64);
  const aaf = buildAAF(shots, fps, title);

  return new Response(new Uint8Array(aaf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="wind-comic-${projectId.slice(0, 8)}.aaf"`,
      'Content-Length': String(aaf.length),
    },
  });
}
