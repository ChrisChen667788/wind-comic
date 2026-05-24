/**
 * v6.2.3 — 解说音轨接真 TTS + N 集并行编排 单测.
 * synth / runner 全注入, 不打网络.
 */

import { describe, it, expect } from 'vitest';
import { runPool, orchestrateSeason } from '@/lib/season-orchestrator';
import {
  retimeFromDurations, synthesizeNarrationTrack, type SynthFn,
} from '@/lib/narration-synth';
import { buildNarrationTrack } from '@/lib/narration-track';
import { buildSeasonBatch } from '@/lib/season-batch';
import type { Episode } from '@/lib/story-intake';

const SCRIPT = '少年走进山门,晨雾未散。\n他说:「师父,我来拜师。」\n老者抬眼,神色平静。山风拂过,松涛阵阵。';

describe('v6.2.3 · runPool 有界并发', () => {
  it('全部成功: 结果按 index 排, 计数正确', async () => {
    const r = await runPool([1, 2, 3, 4], async (x) => x * 10, { concurrency: 2 });
    expect(r.total).toBe(4);
    expect(r.ok).toBe(4);
    expect(r.failed).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.results.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    expect(r.results.map((s) => s.value)).toEqual([10, 20, 30, 40]);
  });

  it('并发不超过上限', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runPool(
      [1, 2, 3, 4, 5],
      async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 5));
        inFlight--;
      },
      { concurrency: 2 },
    );
    expect(maxInFlight).toBe(2);
  });

  it('continueOnError=true: 单个失败不影响其余', async () => {
    const r = await runPool(
      [1, 2, 3],
      async (x) => { if (x === 2) throw new Error('boom'); return x; },
      { concurrency: 3, continueOnError: true },
    );
    expect(r.ok).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(0);
    expect(r.results.find((s) => s.index === 1)?.error).toBe('boom');
  });

  it('continueOnError=false: 失败后中止 (concurrency=1 → 后续 skipped)', async () => {
    const r = await runPool(
      [1, 2, 3],
      async (x) => { if (x === 2) throw new Error('stop'); return x; },
      { concurrency: 1, continueOnError: false },
    );
    expect(r.ok).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.skipped).toBe(1); // 第 3 个没跑
  });

  it('onSettle 进度回调每 job 触发一次', async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], async (x) => x, { onSettle: (s) => seen.push(s.index) });
    expect(seen.sort()).toEqual([0, 1, 2]);
  });
});

function eps(n: number): Episode[] {
  return Array.from({ length: n }, (_, i) => ({ index: i + 1, title: `第${i + 1}集`, text: `第 ${i + 1} 集正文。山门外。`, charCount: 12 }));
}

describe('v6.2.3 · orchestrateSeason', () => {
  it('并行跑完整季, 结果带回 episodeIndex/title', async () => {
    const plan = buildSeasonBatch(eps(3), { mode: 'narrator' });
    const report = await orchestrateSeason(plan.jobs, async (job) => `done:${job.episodeIndex}`, { concurrency: 2 });
    expect(report.total).toBe(3);
    expect(report.ok).toBe(3);
    expect(report.results.map((r) => r.episodeIndex)).toEqual([1, 2, 3]);
    expect(report.results[0].output).toBe('done:1');
    expect(report.results[0].title).toBe('第1集');
  });

  it('部分失败被记录, 其余成功', async () => {
    const plan = buildSeasonBatch(eps(3), { mode: 'narrator' });
    const report = await orchestrateSeason(
      plan.jobs,
      async (job) => { if (job.episodeIndex === 2) throw new Error('ep2 fail'); return job.episodeIndex; },
      { concurrency: 3 },
    );
    expect(report.ok).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.results.find((r) => r.episodeIndex === 2)?.error).toBe('ep2 fail');
  });
});

describe('v6.2.3 · retimeFromDurations', () => {
  it('累加重排, 首段从 0', () => {
    expect(retimeFromDurations([2, 3, 1])).toEqual([
      { start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: 6 },
    ]);
  });
  it('负数按 0 计, 空数组空', () => {
    expect(retimeFromDurations([])).toEqual([]);
    expect(retimeFromDurations([-5, 2])).toEqual([{ start: 0, end: 0 }, { start: 0, end: 2 }]);
  });
});

describe('v6.2.3 · synthesizeNarrationTrack', () => {
  const okSynth: SynthFn = async ({ text, voiceId }) => ({
    audioUrl: `data:audio/mp3;base64,FAKE-${voiceId}-${text.length}`,
    duration: 7, // 真实时长固定 7s, 用来验证"按真实时长重排"
    provider: 'fake-tts',
  });

  it('对白驱动模式 → 不渲染空轨', async () => {
    const track = buildNarrationTrack({ text: SCRIPT, mode: 'dialogue' });
    const r = await synthesizeNarrationTrack(track, { synth: okSynth });
    expect(r.rendered).toBe(false);
    expect(r.segments).toEqual([]);
    expect(r.totalDurationSec).toBe(0);
  });

  it('旁白模式 → 真出音频 + 按真实时长重排时轴', async () => {
    const track = buildNarrationTrack({ text: SCRIPT, mode: 'narrator' });
    const r = await synthesizeNarrationTrack(track, { synth: okSynth, concurrency: 2 });
    expect(r.rendered).toBe(true);
    expect(r.okCount).toBe(track.segments.length);
    expect(r.failCount).toBe(0);
    expect(r.segments.every((s) => s.audioUrl?.startsWith('data:audio/'))).toBe(true);
    expect(r.segments.every((s) => s.provider === 'fake-tts')).toBe(true);
    // 每段真实 7s → 时轴 0-7, 7-14, ...
    expect(r.segments[0].start).toBe(0);
    expect(r.segments[0].end).toBe(7);
    expect(r.segments[1].start).toBe(7);
    expect(r.totalDurationSec).toBe(7 * track.segments.length);
    expect(r.subtitle.length).toBe(r.segments.length);
    expect(r.subtitle[0].end).toBe(7);
  });

  it('单段失败 → 降级回估算时长, ok=false, 整轨仍 rendered', async () => {
    let call = 0;
    const flakySynth: SynthFn = async ({ text, voiceId }) => {
      call++;
      if (call === 1) throw new Error('engine 503');
      return { audioUrl: `data:audio/mp3;base64,X-${voiceId}-${text.length}`, duration: 5, provider: 'fake' };
    };
    const track = buildNarrationTrack({ text: SCRIPT, mode: 'narrator' });
    const r = await synthesizeNarrationTrack(track, { synth: flakySynth, concurrency: 1 });
    expect(r.rendered).toBe(true);
    expect(r.failCount).toBe(1);
    const failed = r.segments.find((s) => !s.ok)!;
    expect(failed.audioUrl).toBeNull();
    expect(failed.error).toContain('503');
    // 失败段降级用估算时长 (>=1)
    expect(failed.estDurationSec).toBeGreaterThanOrEqual(1);
  });

  it('全失败 → rendered=false 但保留分段结构', async () => {
    const deadSynth: SynthFn = async () => { throw new Error('no engine'); };
    const track = buildNarrationTrack({ text: SCRIPT, mode: 'narrator' });
    const r = await synthesizeNarrationTrack(track, { synth: deadSynth });
    expect(r.rendered).toBe(false);
    expect(r.okCount).toBe(0);
    expect(r.segments.length).toBe(track.segments.length);
    expect(r.totalDurationSec).toBeGreaterThan(0); // 估算时轴仍在
  });
});
