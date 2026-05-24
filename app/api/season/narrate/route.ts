import { NextRequest, NextResponse } from 'next/server';
import { buildNarrationTrack } from '@/lib/narration-track';
import { synthesizeNarrationTrack } from '@/lib/narration-synth';
import { buildSeasonBatch } from '@/lib/season-batch';
import { orchestrateSeason } from '@/lib/season-orchestrator';
import type { Episode } from '@/lib/story-intake';

export const runtime = 'nodejs';

/**
 * v6.2.3 — N 集并行编排: 整季解说音轨同时真出 TTS.
 * POST { episodes, mode, concurrency? } → 有界并发逐集合成解说音轨 → 汇总报告.
 * 单集失败不拖垮整季 (continueOnError). 无 TTS 引擎时每集 rendered=false 但仍出计划.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const episodes: Episode[] = Array.isArray(body?.episodes)
    ? body.episodes.filter((e: any) => e && typeof e.text === 'string')
    : [];
  const mode = typeof body?.mode === 'string' ? body.mode : 'narrator';
  const concurrency = Number.isFinite(body?.concurrency)
    ? Math.max(1, Math.min(8, Math.floor(body.concurrency)))
    : 3;
  if (episodes.length === 0) return NextResponse.json({ message: 'episodes 必填' }, { status: 400 });

  const plan = buildSeasonBatch(episodes, { mode });
  const report = await orchestrateSeason(
    plan.jobs,
    async (job) => {
      const ep = episodes.find((e) => e.index === job.episodeIndex);
      const track = buildNarrationTrack({ text: ep?.text || '', mode });
      const rendered = await synthesizeNarrationTrack(track, { concurrency: 2 });
      return {
        enabled: rendered.enabled,
        rendered: rendered.rendered,
        segments: rendered.segments.length,
        durationSec: rendered.totalDurationSec,
        voiceLabel: rendered.voiceLabel,
        okCount: rendered.okCount,
        failCount: rendered.failCount,
      };
    },
    { concurrency, continueOnError: true },
  );

  return NextResponse.json({ mode: plan.mode, modeLabel: plan.modeLabel, concurrency, report });
}
