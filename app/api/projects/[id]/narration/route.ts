import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { buildNarrationTrack } from '@/lib/narration-track';
import { synthesizeNarrationTrack } from '@/lib/narration-synth';
import { persistAsset } from '@/lib/asset-storage';
import { cuesToSrt, narrationToTimelineSegments, type RenderedNarrationLike } from '@/lib/narration-timeline';

export const runtime = 'nodejs';

/** GET → 项目落库的解说音轨 (含落盘 audio + srt). 没有 → null. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  // v9.0.1: 走 asset-repo (双驱动); narration 清旧 + 落新, 失败可重跑
  await deleteAssetsByType(id, 'narration');
  await createAsset({
    projectId: id, type: 'narration', name: `解说音轨 · ${rendered.voiceLabel}`,
    data, mediaUrls, persistentUrl: srtUrl, version: 1,
  });

  return NextResponse.json({
    ok: true,
    enabled: true,
    rendered: rendered.rendered,
    persistedAudio,
    segments: segments.length,
    srtUrl,
    totalDurationSec: rendered.totalDurationSec,
    timeline: narrationToTimelineSegments(data),
  });
}
