/**
 * 阶段二十七 P1 — 原生音画一体(Native A/V)决策层(纯函数,可单测)。
 *
 * 前沿引擎(Grok Imagine / Seedance 2.0 / LTX-2 / Veo 3.1 / Kling 3.0)成片自带对白+音效。
 * 开启 `NATIVE_AV=1` 时:对**有台词**且**真由原生音频引擎出片**的镜头,直接用成片自带音轨,
 * **跳过「视频→TTS→对唇形」三步**;其余镜头仍走 TTS 老链路(零回归)。默认关 → 行为完全不变。
 *
 * 诚实边界:原生引擎是「生成贴合语义的语音」,不保证逐字念脚本/锁定 per-character 音色 ——
 * 故为 opt-in 备选,不替代 TTS 默认链;原生镜若引擎实际没出音轨,composer ffprobe 兜底为静音
 * (native 模式不再回退 TTS,避免双音轨)。
 */

/** 自带原生音频的引擎(按 provider id 基名;变体如 kling-flf 用前缀匹配)。 */
export const NATIVE_AUDIO_ENGINES = ['grok-imagine', 'seedance', 'veo', 'kling', 'ltx'] as const;

/** 全局开关:env NATIVE_AV=1 开启(项目级开关可后续叠加)。 */
export function nativeAudioEnabled(): boolean {
  return process.env.NATIVE_AV === '1';
}

/** provider id(含 veo / kling-flf / minimax-video 等变体)是否属于原生音频引擎。 */
export function isNativeAudioProvider(providerId?: string): boolean {
  if (!providerId) return false;
  const id = providerId.toLowerCase();
  return NATIVE_AUDIO_ENGINES.some((base) => id === base || id.startsWith(base + '-') || id.startsWith(base));
}

export interface NativeAudioDecision {
  enabled: boolean;
  /** 真正出片的 provider id(plugin 路径取 dispatch provider;legacy 取 usedVideoEngine)。 */
  ranProvider?: string;
  /** 本镜是否有台词(无台词无所谓原生不原生)。 */
  hasDialogue: boolean;
}

/**
 * 某镜的成片是否「带原生音频、可跳过 TTS」:开启 + 有台词 + 真由原生音频引擎出片,三者齐备。
 */
export function shouldUseNativeAudio(d: NativeAudioDecision): boolean {
  return !!(d.enabled && d.hasDialogue && isNativeAudioProvider(d.ranProvider));
}

/** 从已生成 clips 收集「带原生音频」镜号(供 editor 跳 TTS + composer 取真音轨)。 */
export function nativeAudioShotNumbers(
  clips: Array<{ shotNumber?: number; nativeAudio?: boolean }>,
): number[] {
  return clips
    .filter((c) => c.nativeAudio && typeof c.shotNumber === 'number')
    .map((c) => c.shotNumber as number);
}

/** editor 用:把有台词的镜头按是否已原生音分成两组(native 组跳 TTS)。 */
export function partitionDialogueShots<T extends { shotNumber?: number }>(
  dialogueShots: T[],
  nativeShots: Set<number>,
): { tts: T[]; native: T[] } {
  const tts: T[] = [];
  const native: T[] = [];
  for (const s of dialogueShots) {
    if (typeof s.shotNumber === 'number' && nativeShots.has(s.shotNumber)) native.push(s);
    else tts.push(s);
  }
  return { tts, native };
}
