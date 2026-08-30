/**
 * GET /api/projects/[id]/export-aaf · v9.2.0 — 真 AAF 二进制导出 (对接 Avid Media Composer)
 *
 * 读项目剧本镜头序列 → AAF 组合模型 → 真二进制 CFB 容器 (.aaf), attachment 下载。
 * fps 取项目级格式 (v7.4 project-format), 缺省 24。
 *
 * 与 export-edl (EDL/FCPXML) 并列: AAF 给 Avid; EDL/FCPXML 给 DaVinci/Premiere。
 */

import { NextRequest, NextResponse } from 'next/server';
import { pickScriptAsset } from '@/lib/script-asset';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildAAF } from '@/lib/aaf-export';
import { type EdlShot, type EdlAudio } from '@/lib/edl-export';
import { normalizeProjectFormat } from '@/lib/project-format';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function firstUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a[0] : undefined; } catch { return undefined; }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,未系统复扫
  // projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, projectId, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });


  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = {};
  try { script = JSON.parse(pickScriptAsset(scriptRows).row?.data || '{}'); } catch { script = {}; }
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

  // v12.277:与 export-edl 同修 —— 以 timeline 资产(成片终值)为准,script 仅兜底。
  // 此前读 script 的设计时长,而成片时长会被卡点吸附与逐镜变速改写 → Avid 里对不上成片。
  const timelineRows = await listAssetsByType(projectId, 'timeline');
  let tl: any = {};
  try { tl = JSON.parse(timelineRows[0]?.data || '{}'); } catch { tl = {}; }
  const tlBySn = new Map<number, any>();
  for (const t of (Array.isArray(tl?.timeline) ? tl.timeline : [])) {
    if (typeof t?.shotNumber === 'number') tlBySn.set(t.shotNumber, t);
  }
  const shots: EdlShot[] = shotsData.map((s, i) => {
    const sn = s.shotNumber ?? i + 1;
    const t = tlBySn.get(sn);
    return {
      name: `Shot ${String(sn).padStart(2, '0')}${s.emotion ? ` (${s.emotion})` : ''}`,
      durationS: (typeof t?.duration === 'number' && t.duration > 0)
        ? t.duration
        : (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5),
      sourceUrl: t?.videoUrl || urlFor(sn),
      transition: t?.transition,
    };
  });

  // v12.279:补音轨 —— v12.277 给 EDL/FCPXML 加了配音与 BGM,**AAF 漏了同步**,
  // 同一份成片导 EDL 有声、导 AAF 是哑的。这里与 export-edl 同源组装。
  const audio: EdlAudio[] = [];
  {
    let cursor = 0;
    const startBySn = new Map<number, number>();
    shotsData.forEach((s: any, i: number) => {
      const sn = s.shotNumber ?? i + 1;
      startBySn.set(sn, cursor);
      cursor += shots[i]?.durationS ?? 5;
    });
    for (const vo of (Array.isArray(tl?.voiceoverClips) ? tl.voiceoverClips : [])) {
      const sn = Number(vo?.shotNumber);
      if (!Number.isFinite(sn) || !vo?.audioUrl) continue;
      const t = tlBySn.get(sn);
      audio.push({
        name: `VO Shot ${String(sn).padStart(2, '0')}${t?.speaker ? ` — ${t.speaker}` : ''}`,
        sourceUrl: vo.audioUrl,
        startS: startBySn.get(sn) ?? 0,
        durationS: (typeof t?.duration === 'number' && t.duration > 0) ? t.duration : 5,
        kind: 'vo',
      });
    }
    if (tl?.musicUrl) audio.push({ name: 'BGM', sourceUrl: tl.musicUrl, startS: 0, durationS: cursor || 1, kind: 'bgm' });
  }

  const title = (script.title || `Wind Comic ${projectId.slice(0, 8)}`).toString().slice(0, 64);
  const aaf = buildAAF(shots, fps, title, audio);

  return new Response(new Uint8Array(aaf), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="wind-comic-${projectId.slice(0, 8)}.aaf"`,
      'Content-Length': String(aaf.length),
    },
  });
}
