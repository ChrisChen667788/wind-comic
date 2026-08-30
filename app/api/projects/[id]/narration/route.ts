import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { buildNarrationTrack } from '@/lib/narration-track';
import { synthesizeNarrationTrack } from '@/lib/narration-synth';
import { persistAsset } from '@/lib/asset-storage';
import { cuesToSrt, narrationToTimelineSegments, type RenderedNarrationLike } from '@/lib/narration-timeline';
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';

/** GET → 项目落库的解说音轨 (含落盘 audio + srt). 没有 → null. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const row = db.prepare(
    `SELECT data FROM project_assets WHERE project_id = ? AND type = 'narration' ORDER BY updated_at DESC LIMIT 1`,
  ).get(id) as { data: string } | undefined;
  if (!row?.data) return NextResponse.json({ narration: null });
  try {
    const data = JSON.parse(row.data);
    return NextResponse.json({ narration: data, timeline: narrationToTimelineSegments(data) });
  } catch {
    return NextResponse.json({ narration: null });
  }
}

/**
 * v6.2.4 — 解说音轨真出 + 落盘 + 串进项目时间线.
 * POST { text, mode, voiceId? } →
 *   1. 真出 TTS (无引擎则段无音频, 不阻塞)
 *   2. 每段音频 persistAsset 落盘 (data:/http → /api/serve-file?key=)
 *   3. 字幕生成 SRT + 落盘 (烧录用)
 *   4. 存 project_assets type='narration' → computeTracks 自动并进时间线
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'edit');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });

  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as { id: string } | undefined;
  if (!project) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({} as any));
  const text = typeof body?.text === 'string' ? body.text : '';
  const mode = typeof body?.mode === 'string' ? body.mode : 'narrator';
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
  if (!text.trim()) return NextResponse.json({ message: 'text 必填' }, { status: 400 });

  const plan = buildNarrationTrack({ text, mode, voiceId });
  if (!plan.enabled) {
    return NextResponse.json({ enabled: false, message: '该叙事模式不生成解说音轨' }, { status: 400 });
  }
  const rendered = await synthesizeNarrationTrack(plan, { concurrency: 4 });

  // 1) 每段音频落盘
  let persistedAudio = 0;
  const segments = await Promise.all(rendered.segments.map(async (s) => {
    let audioUrl: string | null = null;
    if (s.audioUrl) {
      const p = await persistAsset(s.audioUrl, { ext: '.mp3', contentType: 'audio/mpeg' });
      if (p) { audioUrl = p.url; persistedAudio++; }
    }
    return { index: s.index, text: s.text, start: s.start, end: s.end, audioUrl };
  }));

  // 2) 字幕 SRT 落盘
  const srt = cuesToSrt(rendered.subtitle);
  const srtPersisted = await persistAsset(
    `data:text/plain;base64,${Buffer.from(srt, 'utf8').toString('base64')}`,
    { ext: '.srt', contentType: 'text/plain' },
  );
  const srtUrl = srtPersisted?.url ?? null;

  // 3) 存为 project 解说资产 (一项目一条, 覆盖式)
  const data: RenderedNarrationLike & Record<string, unknown> = {
    mode: rendered.mode,
    voiceId: rendered.voiceId,
    voiceLabel: rendered.voiceLabel,
    totalDurationSec: rendered.totalDurationSec,
    rendered: rendered.rendered,
    okCount: rendered.okCount,
    segments,
    subtitle: rendered.subtitle,
    srtUrl,
  };
  const mediaUrls = segments.map((s) => s.audioUrl).filter(Boolean) as string[];

  // ── v12.384:两道闸,都必须挡在 delete **之前** ──────────────────────────
  //
  // ① 落盘全失败不能报成功。persistAsset 返回 null 时上面是静默跳过的
  //    (audioUrl 留 null、persistedAudio 不增),而响应里的 `rendered` 取自
  //    rendered.rendered —— 那是 **TTS 的成功数**,与落盘无关。于是「TTS 全成功、
  //    落盘全失败」会返回 ok:true + rendered:true,库里躺着一条 mediaUrls 为空的
  //    静音轨。owner 看到「解说已生成」,合成成片,交片时才发现没有声音;
  //    而 MiniMax 的音频外链几小时就过期,想补只能再花一次额度。
  //
  // ② 更要命的是顺序:原来是**先 delete 再 create**。注释写着「失败可重跑」,
  //    可失败时旧的那条已经被删了 —— 重跑一次失败,就把上一次成功的成果一起毁掉。
  //    「可重跑」的前提是失败不破坏现状,所以这两道闸必须在 delete 前面。
  if (rendered.segments.length > 0 && persistedAudio === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'audio_persist_failed',
        message:
          `解说音频落盘全部失败(TTS 已合成 ${rendered.okCount} 段,但一段都没存下来)。` +
          `已保留上一次的解说音轨、未做任何改动 —— 请重试。`,
        ttsOk: rendered.okCount,
        persistedAudio,
      },
      { status: 502 },
    );
  }
  if (rendered.segments.length > 0 && persistedAudio < rendered.okCount) {
    // 部分失败仍然落库(有总比没有强),但**必须说出来**,不能混在成功里
    console.warn(
      `[narration] ${rendered.okCount - persistedAudio}/${rendered.okCount} 段音频落盘失败,` +
        `成片里这几段会是静音`,
    );
  }

  // v9.0.1: 走 asset-repo (双驱动); narration 清旧 + 落新, 失败可重跑
  await deleteAssetsByType(id, 'narration');
  await createAsset({
    projectId: id, type: 'narration', name: `解说音轨 · ${rendered.voiceLabel}`,
    data, mediaUrls, persistentUrl: srtUrl, version: 1,
  });

  return NextResponse.json({
    ok: true,
    enabled: true,
    // v12.384:`rendered` 是 **TTS** 的成功标志,`segments` 是**文本**段总数 ——
    // 两个都不回答「有几段真的有声音」。不补这两个字段的话,
    // 「10 段文本、TTS 全成、只落盘 3 段」看起来和全成功一模一样。
    rendered: rendered.rendered,
    persistedAudio,
    segments: segments.length,
    audioSegments: mediaUrls.length,
    partialAudio: mediaUrls.length < rendered.okCount,
    srtUrl,
    totalDurationSec: rendered.totalDurationSec,
    timeline: narrationToTimelineSegments(data),
  });
}
