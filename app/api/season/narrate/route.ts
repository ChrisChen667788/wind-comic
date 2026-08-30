import { NextRequest, NextResponse } from 'next/server';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';
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
/** 单次整季旁白的集数上限 —— 整季通常 12 集以内 */
const MAX_EPISODES_PER_CALL = 24;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const episodes: Episode[] = Array.isArray(body?.episodes)
    ? body.episodes.filter((e: any) => e && typeof e.text === 'string')
    : [];
  const mode = typeof body?.mode === 'string' ? body.mode : 'narrator';
  const concurrency = Number.isFinite(body?.concurrency)
    ? Math.max(1, Math.min(8, Math.floor(body.concurrency)))
    : 3;
  // v12.382:整季旁白是**按集数放大**的付费操作 —— 一次请求就能触发几十集 TTS,
  // 全部记在 owner 的 MiniMax 账上。此前这个端点连鉴权都没有,裸 curl 即可提交。
  // 预算按集数估,让 assertBudget 在真正开跑前就能拦下超额的整季任务。
  const _paid = await guardPaidEndpoint(request, { pendingCostCny: episodes.length * 0.2 });
  if (!_paid.ok) return _paid.response;
  // 集数上限:整季通常 12 集以内,给到 24 已很宽松。没有上限的话,
  // 一次请求就能把当天额度清零 —— 而外层集级并发最高到 8,烧得还很快。
  if (episodes.length > MAX_EPISODES_PER_CALL) {
    return NextResponse.json(
      { message: `单次最多 ${MAX_EPISODES_PER_CALL} 集(收到 ${episodes.length} 集)—— 请分批提交` },
      { status: 413 },
    );
  }
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
