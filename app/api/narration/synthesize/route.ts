import { NextRequest, NextResponse } from 'next/server';
import { buildNarrationTrack } from '@/lib/narration-track';
import { synthesizeNarrationTrack } from '@/lib/narration-synth';

export const runtime = 'nodejs';

/**
 * v6.2.3 — 单集解说音轨真出 TTS.
 * POST { text, mode, voiceId? } → 构计划 → 走 TTS 引擎真出音频 (无引擎则降级返回计划).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const text = typeof body?.text === 'string' ? body.text : '';
  const mode = typeof body?.mode === 'string' ? body.mode : 'narrator';
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined;
  if (!text.trim()) return NextResponse.json({ message: 'text 必填' }, { status: 400 });

  const plan = buildNarrationTrack({ text, mode, voiceId });
  if (!plan.enabled) {
    return NextResponse.json({ enabled: false, rendered: false, track: plan });
  }

  const rendered = await synthesizeNarrationTrack(plan, { concurrency: 4 });
  return NextResponse.json({ enabled: true, rendered: rendered.rendered, track: rendered });
}
