/**
 * v6.2.4 — 解说音轨 → 时间线 + 字幕(SRT) · 纯逻辑 (client-safe, 可单测)
 *
 * 把 v6.2.3 真出的解说音轨 (RenderedNarrationTrack) 转成:
 *   1. 时间线 narration 音轨段 (TrackSegment[], 挂落盘后的 audioUrl)
 *   2. 时间线 subtitle 字幕段 (TrackSegment[]) + 烧录用 SRT 文本
 * 落盘 (audio + srt 写 storage) 在 API 层 (persistAsset); 这里只做纯转换/格式化.
 */

import type { TrackSegment } from './timeline-tracks';
import type { SubtitleCue } from './narration-track';

/** 一条"已渲染解说段"的最小形状 (来自 narration-synth, 或落库后回读). */
export interface RenderedNarrationLike {
  voiceLabel?: string;
  segments: Array<{ text: string; start: number; end: number; audioUrl?: string | null }>;
  subtitle: SubtitleCue[];
}

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm`. */
export function srtTimestamp(sec: number): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** 字幕 cues → SRT 文本 (字幕烧录: subtitle-burn 的 ffmpeg subtitles filter 引用此文件). */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}`)
    .join('\n\n') + (cues.length ? '\n' : '');
}

function seg(
  type: TrackSegment['type'],
  id: string,
  start: number,
  end: number,
  label: string,
  audioUrl?: string | null,
): TrackSegment {
  const dur = Math.max(0, end - start);
  return {
    id, type, startSec: start, durationSec: dur, label,
    muted: false, isEdited: false,
    derivedStartSec: start, derivedDurationSec: dur,
    ...(audioUrl ? { audioUrl } : {}),
  };
}

/**
 * 解说轨 → 时间线段: narration 音轨 (挂 audioUrl) + subtitle 字幕轨.
 * narration 段 id = `narration-{i}`; 字幕段 id = `narration-sub-{i}` (与剧本派生字幕不撞).
 */
export function narrationToTimelineSegments(
  track: RenderedNarrationLike,
): { narration: TrackSegment[]; subtitle: TrackSegment[] } {
  const narration = track.segments.map((s, i) =>
    seg('narration', `narration-${i}`, s.start, s.end, s.text, s.audioUrl),
  );
  const subtitle = track.subtitle.map((c, i) =>
    seg('subtitle', `narration-sub-${i}`, c.start, c.end, c.text),
  );
  return { narration, subtitle };
}
