/**
 * v6.2.4 — 解说音轨 → 时间线 + SRT 字幕 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  srtTimestamp, cuesToSrt, narrationToTimelineSegments, type RenderedNarrationLike,
} from '@/lib/narration-timeline';

describe('v6.2.4 · srtTimestamp', () => {
  it('格式 HH:MM:SS,mmm', () => {
    expect(srtTimestamp(0)).toBe('00:00:00,000');
    expect(srtTimestamp(7)).toBe('00:00:07,000');
    expect(srtTimestamp(65.5)).toBe('00:01:05,500');
    expect(srtTimestamp(3661.25)).toBe('01:01:01,250');
  });
  it('负数按 0', () => {
    expect(srtTimestamp(-5)).toBe('00:00:00,000');
  });
});

describe('v6.2.4 · cuesToSrt', () => {
  it('生成带序号 + 时间轴 + 文本的 SRT', () => {
    const srt = cuesToSrt([
      { start: 0, end: 3, text: '少年走进山门' },
      { start: 3, end: 7, text: '晨雾未散' },
    ]);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:03,000\n少年走进山门');
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:07,000\n晨雾未散');
    // 两条之间空行分隔
    expect(srt).toMatch(/少年走进山门\n\n2\n/);
  });
  it('空 cues → 空串', () => {
    expect(cuesToSrt([])).toBe('');
  });
});

describe('v6.2.4 · narrationToTimelineSegments', () => {
  const track: RenderedNarrationLike = {
    voiceLabel: '成熟男声',
    segments: [
      { text: '少年走进山门', start: 0, end: 7, audioUrl: '/api/serve-file?key=aaa' },
      { text: '晨雾未散', start: 7, end: 12, audioUrl: null },
    ],
    subtitle: [
      { start: 0, end: 7, text: '少年走进山门' },
      { start: 7, end: 12, text: '晨雾未散' },
    ],
  };

  it('解说段 → narration 轨 (挂落盘 audioUrl)', () => {
    const { narration } = narrationToTimelineSegments(track);
    expect(narration.length).toBe(2);
    expect(narration[0].type).toBe('narration');
    expect(narration[0].id).toBe('narration-0');
    expect(narration[0].startSec).toBe(0);
    expect(narration[0].durationSec).toBe(7);
    expect(narration[0].audioUrl).toBe('/api/serve-file?key=aaa');
    expect(narration[1].audioUrl).toBeUndefined(); // null → 不挂
  });

  it('字幕 cues → subtitle 轨 (id 不与剧本派生字幕相撞)', () => {
    const { subtitle } = narrationToTimelineSegments(track);
    expect(subtitle.length).toBe(2);
    expect(subtitle[0].type).toBe('subtitle');
    expect(subtitle[0].id).toBe('narration-sub-0');
    expect(subtitle[0].label).toBe('少年走进山门');
    expect(subtitle[1].startSec).toBe(7);
    expect(subtitle[1].durationSec).toBe(5);
  });

  it('派生默认 = 当前值 (只读, 无 override)', () => {
    const { narration } = narrationToTimelineSegments(track);
    expect(narration[0].derivedStartSec).toBe(narration[0].startSec);
    expect(narration[0].derivedDurationSec).toBe(narration[0].durationSec);
    expect(narration[0].isEdited).toBe(false);
  });
});
