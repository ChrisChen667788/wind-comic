/**
 * GET /api/projects/[id]/export-edl?format=edl|fcpxml · v8.0 — 导出剪辑表对接 DaVinci/Premiere
 *
 * 读项目剧本镜头序列 → CMX3600 EDL 或 FCP7 XML, 以 attachment 下载。
 * fps 取项目级格式 (v7.4 project-format), 缺省 24。
 */

import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildEDL, buildFCPXML, pacingReportToMarkers, type EdlShot, type EdlAudio, type EdlMarker , xfadeRecordStartsSec } from '@/lib/edl-export';
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

  // ── v12.277:以 **timeline 资产(成片终值)** 为准,script 仅作兜底 ──
  // 病根:此前只读 script 的 `s.duration`,那是**设计时长**;而成片时长会被
  // 卡点吸附(video-composer snapDurationsToBeatsClamped)与逐镜变速(durations[i] /= speed)改写。
  // 于是导出的剪辑线时间码与实际 mp4 对不上,且越往后偏得越多 —— 剪辑师拿到的是一份「看着像、对不上」的表。
  // 同时 timeline 还带 transition / voiceoverClips / musicUrl,此前全被忽略(EDL 只有一条硬切视频轨)。
  const timelineRows = await listAssetsByType(projectId, 'timeline');
  let tl: any = {};
  try { tl = JSON.parse(timelineRows[0]?.data || '{}'); } catch { tl = {}; }
  const tlShots: any[] = Array.isArray(tl?.timeline) ? tl.timeline : [];
  const tlBySn = new Map<number, any>();
  for (const t of tlShots) if (typeof t?.shotNumber === 'number') tlBySn.set(t.shotNumber, t);

  const shots: EdlShot[] = shotsData.map((s, i) => {
    const sn = s.shotNumber ?? i + 1;
    const t = tlBySn.get(sn);
    return {
      name: `Shot ${String(sn).padStart(2, '0')}${s.emotion ? ` (${s.emotion})` : ''}`,
      // 终值优先;无 timeline(未出片)时退回设计时长,行为与旧版一致
      durationS: (typeof t?.duration === 'number' && t.duration > 0)
        ? t.duration
        : (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5),
      sourceUrl: t?.videoUrl || urlFor(sn),
      transition: t?.transition,
      transitionDurationS: typeof t?.transitionDurationS === 'number' ? t.transitionDurationS : undefined,
    };
  });

  // v12.277:音轨 —— 逐镜配音按其在成片时间轴上的起点排布;BGM 覆盖全片。
  const audio: EdlAudio[] = [];
  {
    // v12.297:**起点走 xfade 压缩后的时间轴**,不能纯累加。
    // 原来 `cursor += sh.durationS` 忽略了每次溶解的重叠 —— 而 NLE 应用 D 事件后画面轨会压缩,
    // 音频轨却停在绝对位置,于是配音相对画面逐镜滞后,n 镜项目最大偏 (n−1)×转场时长。
    // 这与 v12.264/265 在成片里修过的病一模一样(见 lib/xfade-timeline 的注释)。
    const recStarts = xfadeRecordStartsSec(shots);   // 秒,不取整(取整是 v12.277 栽过的坑)
    const startBySn = new Map<number, number>();
    shots.forEach((sh, i) => {
      startBySn.set(Number(String(sh.name).replace(/^Shot 0*(\d+).*$/, '$1')), recStarts[i] ?? 0);
    });
    const cursor = (recStarts[shots.length - 1] ?? 0) + (shots[shots.length - 1]?.durationS ?? 0);
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
    if (tl?.musicUrl) {
      audio.push({ name: 'BGM', sourceUrl: tl.musicUrl, startS: 0, durationS: cursor || 1, kind: 'bgm' });
    }
  }

  // v12.278:把节奏审计结论作为标记带进剪辑线 —— 审计与 EDL 各自都是竞品空白,
  // 接起来更没有第二家:剪辑师在自己的时间轴上直接看到「第 3~5 镜是拖沓段」。
  // 需 script.pacingReport 已落库(v12.278 起 saveAsset 带上它;老项目无此字段则自然为空)。
  const markers: EdlMarker[] = (() => {
    try {
      // v12.297:标记位置同样走压缩时间轴 —— 否则「第 3~5 镜是拖沓段」会标到错误的时间码上
      return pacingReportToMarkers((script as any)?.pacingReport, xfadeRecordStartsSec(shots));
    } catch { return []; }
  })();

  const title = `wind-comic-${projectId}`;
  if (format === 'fcpxml') {
    return new Response(buildFCPXML(shots, fps, title, audio, markers), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${title}.xml"`,
      },
    });
  }
  return new Response(buildEDL(shots, fps, title, audio, markers), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${title}.edl"`,
    },
  });
}
