/**
 * v6.2.3 — 解说音轨 · 接真 TTS 引擎 (client-safe 核心 + 服务端默认合成器)
 *
 * v6.2.2 的 narration-track 只产"计划"(估时长 + 绑音色 + 字幕时轴). 这里把计划真出成
 * 音频: 每段旁白送 TTS 引擎 (默认走 tts-providers 注册表的链, 失败自动 fallback),
 * 拿到真实 audioUrl + 实际时长后按真实时长重排时轴 + 字幕. 单段失败不拖垮整轨
 * (降级回估算时长, ok=false). synth 注入 → 可纯单测.
 */

import { runPool } from './season-orchestrator';
import type { NarrationTrack, NarrationSegment, SubtitleCue } from './narration-track';
import type { NarrationMode } from './story-intake';

export interface SynthInput {
  text: string;
  voiceId: string;
}
export interface SynthOutput {
  audioUrl: string;
  /** 实际成片时长, 秒 */
  duration: number;
  provider?: string;
}
export type SynthFn = (input: SynthInput) => Promise<SynthOutput>;

export interface RenderedSegment extends NarrationSegment {
  /** 真出的音频地址; 未出 (失败/无引擎) 为 null */
  audioUrl: string | null;
  ok: boolean;
  provider?: string;
  error?: string;
}

export interface RenderedNarrationTrack {
  mode: NarrationMode;
  enabled: boolean;
  /** 至少一段真出了音频 */
  rendered: boolean;
  voiceId: string;
  voiceLabel: string;
  segments: RenderedSegment[];
  subtitle: SubtitleCue[];
  totalDurationSec: number;
  okCount: number;
  failCount: number;
}

/** 由各段时长 (实际 or 估算) 顺序累加重排时轴. 纯函数, 负数按 0 计. */
export function retimeFromDurations(durations: number[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let t = 0;
  for (const d of durations) {
    const dur = Math.max(0, d);
    out.push({ start: t, end: t + dur });
    t += dur;
  }
  return out;
}

/**
 * 把一条解说音轨计划真出成音频.
 *   - 不生成解说轨的模式 (对白驱动) → rendered=false 空轨.
 *   - 每段并发送 synth, 成功取真实时长, 失败降级回估算时长 (ok=false).
 *   - 按最终时长重排 start/end + 字幕.
 */
export async function synthesizeNarrationTrack(
  track: NarrationTrack,
  opts: { synth?: SynthFn; concurrency?: number } = {},
): Promise<RenderedNarrationTrack> {
  const base = {
    mode: track.mode, enabled: track.enabled,
    voiceId: track.voiceId, voiceLabel: track.voiceLabel,
  };
  if (!track.enabled || track.segments.length === 0) {
    return { ...base, rendered: false, segments: [], subtitle: [], totalDurationSec: 0, okCount: 0, failCount: 0 };
  }

  const synth = opts.synth ?? defaultSynth;
  const pool = await runPool(
    track.segments,
    (seg) => synth({ text: seg.text, voiceId: track.voiceId }),
    { concurrency: opts.concurrency ?? 3, continueOnError: true },
  );
  const byIndex = new Map(pool.results.map((r) => [r.index, r]));

  const durations = track.segments.map((seg, i) => {
    const r = byIndex.get(i);
    return r?.ok && r.value ? Math.max(1, Math.round(r.value.duration)) : seg.estDurationSec;
  });
  const timing = retimeFromDurations(durations);

  const segments: RenderedSegment[] = track.segments.map((seg, i) => {
    const r = byIndex.get(i);
    const ok = !!(r?.ok && r.value?.audioUrl);
    return {
      ...seg,
      estDurationSec: durations[i],
      start: timing[i].start,
      end: timing[i].end,
      audioUrl: ok ? r!.value!.audioUrl : null,
      ok,
      provider: r?.value?.provider,
      error: r && !r.ok ? r.error : undefined,
    };
  });
  const subtitle: SubtitleCue[] = segments.map((s) => ({ start: s.start, end: s.end, text: s.text }));
  const okCount = segments.filter((s) => s.ok).length;

  return {
    ...base,
    rendered: okCount > 0,
    segments,
    subtitle,
    totalDurationSec: timing.length ? timing[timing.length - 1].end : 0,
    okCount,
    failCount: segments.length - okCount,
  };
}

/**
 * 默认合成器: 走 tts-providers 注册表 (Minimax T2A 等), 失败抛错由上层降级.
 * 仅服务端可用 (动态 import, 浏览器侧不会被打进 bundle).
 */
const defaultSynth: SynthFn = async ({ text, voiceId }) => {
  await import('./tts-providers/builtins'); // 确保内置 provider 注册 (side-effect)
  const { dispatchTTSGenerate } = await import('./tts-providers/registry');
  // v12.6.1(#2):按旁白文本自检语种(中文→zh-CN / 英文→en-US),不再硬编码 zh-CN
  const { detectLanguage, ttsLangCode } = await import('./language-detect');
  const r = await dispatchTTSGenerate({ text, voiceId, language: ttsLangCode(detectLanguage(text)) });
  if (!r.result) {
    const reason = r.tried.map((t) => t.error).join(' | ').slice(0, 80);
    throw new Error(`TTS 无可用引擎: ${reason || '未配置 provider (需 MINIMAX_API_KEY)'}`);
  }
  return { audioUrl: r.result.audioUrl, duration: r.result.duration || 0, provider: r.result.provider };
};
