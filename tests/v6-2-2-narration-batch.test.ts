/**
 * v6.2.2 — 解说音轨 + 整季批量 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  extractNarrationSegments, buildNarrationTrack, estDurationSec, CHARS_PER_SEC,
} from '@/lib/narration-track';
import {
  buildSeasonBatch, nextPending, markJob, batchProgress,
} from '@/lib/season-batch';
import type { Episode } from '@/lib/story-intake';

const SCRIPT = '少年走进山门,晨雾未散。\n他说:「师父,我来拜师。」\n老者抬眼,神色平静。';

describe('v6.2.2 · 解说音轨', () => {
  it('对白驱动模式不抽旁白', () => {
    expect(extractNarrationSegments(SCRIPT, 'dialogue')).toEqual([]);
  });
  it('旁白模式抽出非对白散文句 (含引号的对白被过滤)', () => {
    const segs = extractNarrationSegments(SCRIPT, 'narrator');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.some((s) => s.includes('「'))).toBe(false);
    expect(segs.join()).toContain('少年走进山门');
  });
  it('估时长按语速且 ≥1s', () => {
    expect(estDurationSec(0)).toBe(1);
    expect(estDurationSec(Math.round(CHARS_PER_SEC * 4))).toBe(4);
  });
  it('buildNarrationTrack: 对白驱动 disabled 空轨', () => {
    const t = buildNarrationTrack({ text: SCRIPT, mode: 'dialogue' });
    expect(t.enabled).toBe(false);
    expect(t.segments).toEqual([]);
    expect(t.totalDurationSec).toBe(0);
  });
  it('buildNarrationTrack: 旁白模式 enabled + 绑成熟男声 + 字幕时轴累进', () => {
    const t = buildNarrationTrack({ text: SCRIPT, mode: 'narrator' });
    expect(t.enabled).toBe(true);
    expect(t.voiceId).toBe('narrator_male_cn');
    expect(t.voiceLabel).toBe('成熟男声');
    expect(t.segments.length).toBe(t.subtitle.length);
    // 时轴连续: 每条 start == 上一条 end
    for (let i = 1; i < t.segments.length; i++) {
      expect(t.segments[i].start).toBe(t.segments[i - 1].end);
    }
    expect(t.totalDurationSec).toBe(t.segments.at(-1)!.end);
  });
  it('第一人称解说默认青年男声', () => {
    expect(buildNarrationTrack({ text: SCRIPT, mode: 'first_person' }).voiceId).toBe('young_male_cn');
  });
  it('voiceId 可覆盖', () => {
    expect(buildNarrationTrack({ text: SCRIPT, mode: 'narrator', voiceId: 'young_female_cn' }).voiceLabel).toBe('青年女声');
  });
});

function eps(n: number): Episode[] {
  return Array.from({ length: n }, (_, i) => ({ index: i + 1, title: `第${i + 1}集`, text: `第 ${i + 1} 集正文内容`, charCount: 10 }));
}

describe('v6.2.2 · 整季批量', () => {
  it('buildSeasonBatch: 每集一个 pending job, seed 含叙事 directive + 标题 + 正文', () => {
    const plan = buildSeasonBatch(eps(3), { mode: 'narrator' });
    expect(plan.totalEpisodes).toBe(3);
    expect(plan.modeLabel).toBe('第三人称旁白');
    expect(plan.jobs.every((j) => j.status === 'pending')).toBe(true);
    expect(plan.jobs[0].seed).toContain('第三人称旁白');
    expect(plan.jobs[0].seed).toContain('第1集');
  });
  it('nextPending / markJob / progress', () => {
    let { jobs } = buildSeasonBatch(eps(3), { mode: 'dialogue' });
    expect(nextPending(jobs)!.episodeIndex).toBe(1);
    jobs = markJob(jobs, 1, 'done');
    expect(nextPending(jobs)!.episodeIndex).toBe(2);
    expect(batchProgress(jobs)).toEqual({ done: 1, sent: 0, total: 3, pct: 33 });
    jobs = markJob(jobs, 2, 'done');
    jobs = markJob(jobs, 3, 'done');
    expect(nextPending(jobs)).toBeNull();
    expect(batchProgress(jobs).pct).toBe(100);
  });
  it('空集 → 空计划', () => {
    const plan = buildSeasonBatch([], {});
    expect(plan.totalEpisodes).toBe(0);
    expect(nextPending(plan.jobs)).toBeNull();
  });
});
