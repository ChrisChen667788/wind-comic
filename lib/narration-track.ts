/**
 * v6.2.2 — 解说/旁白音轨规划 · 纯逻辑 (client-safe, 可单测)
 *
 * 由叙事模式 (v6.2 story-intake) 推出一条解说音轨计划: 从正文抽旁白句 → 估时长 →
 * 绑定音色 + 生成字幕条目. 真出音频走 tts-prosody, 烧字幕走 subtitle-burn (本模块只产计划).
 * 对白驱动模式不生成解说轨.
 */

import { getNarrationMode, type NarrationMode } from './story-intake';
import { VOICE_CATALOG } from './character-studio';

/** 中文 TTS 估算语速 (字/秒). */
export const CHARS_PER_SEC = 4.5;

/** 叙事角色 → 默认音色 id (对齐 tts VOICE_PROFILES / character-studio VOICE_CATALOG). */
const ROLE_DEFAULT_VOICE: Record<string, string> = {
  narrator: 'narrator_male_cn',
  protagonist: 'young_male_cn',
  character: '',
};

export interface NarrationSegment {
  index: number;
  text: string;
  estDurationSec: number;
  start: number;
  end: number;
}

export interface SubtitleCue { start: number; end: number; text: string }

export interface NarrationTrack {
  mode: NarrationMode;
  /** 该模式是否生成解说轨 (对白驱动=false) */
  enabled: boolean;
  voiceId: string;
  voiceLabel: string;
  segments: NarrationSegment[];
  subtitle: SubtitleCue[];
  totalDurationSec: number;
}

/** 估一段文字的朗读时长 (秒), 至少 1s. */
export function estDurationSec(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_SEC));
}

/**
 * 从正文抽"旁白句": 非对白的散文句. 对白驱动模式 → 空 (不解说).
 * 判定: 含引号 (「」『』“”"') 的句子算对白, 其余算旁白.
 */
export function extractNarrationSegments(text: string, mode: string): string[] {
  if (getNarrationMode(mode).id === 'dialogue') return [];
  const src = (text || '').trim();
  if (!src) return [];
  const sentences = src
    .split(/(?<=[。!?！？])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.filter((s) => !/[「」『』“”"']/.test(s));
}

/** 由叙事模式 + 正文产出一条解说音轨计划. */
export function buildNarrationTrack(input: { text: string; mode: string; voiceId?: string }): NarrationTrack {
  const m = getNarrationMode(input.mode);
  const enabled = m.generatesNarrationTrack;
  const voiceId = input.voiceId || ROLE_DEFAULT_VOICE[m.ttsRole] || 'narrator_male_cn';
  const voiceLabel = VOICE_CATALOG.find((v) => v.id === voiceId)?.label || voiceId;

  const texts = enabled ? extractNarrationSegments(input.text, input.mode) : [];
  const segments: NarrationSegment[] = [];
  const subtitle: SubtitleCue[] = [];
  let t = 0;
  texts.forEach((txt, i) => {
    const dur = estDurationSec(txt.length);
    const start = t;
    const end = t + dur;
    segments.push({ index: i, text: txt, estDurationSec: dur, start, end });
    subtitle.push({ start, end, text: txt });
    t = end;
  });

  return { mode: m.id, enabled, voiceId, voiceLabel, segments, subtitle, totalDurationSec: t };
}
