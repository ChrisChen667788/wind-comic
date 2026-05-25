/**
 * lib/emotion-curve (v7.5) — 情感曲线 + 多轨节奏热力图 (对标 CineMatrix Emotion Curve / CineFlow 节奏热力图)
 *
 * 纯逻辑。把每镜的情绪标签 / 冲突分 / 时长 / 运动 / 光影 → 4 条随镜推进的曲线:
 *   情感强度 emotion · 紧张感 tension · 节奏 rhythm · 亮度 brightness (均 0-100)
 * 再算高潮点 / 峰值 / 均值, 供曲线图 + 文字摘要。
 */

export interface EmotionShotInput {
  emotion?: string;     // 中文情绪词 (来自 shot.emotion)
  durationS?: number;   // 时长 (秒)
  motion?: number;      // 0-100 (来自 cameraSpec.motion)
  conflict?: number;    // 0-10 (来自 pacingReport.shots[].conflictScore)
  /** 直接给亮度 0-100; 不给则由 lighting/atmosphere 推断 */
  brightness?: number;
  lightingSetup?: string;
  atmosphere?: string;
}

export interface EmotionPoint {
  index: number;     // 0-based
  emotion: number;   // 情感强度 0-100
  tension: number;   // 紧张感 0-100
  rhythm: number;    // 节奏 0-100 (快=高)
  brightness: number;// 亮度 0-100
}

/** 中文情绪词 → 情感强度 / 紧张感 (0-100) */
const EMOTION_LEXICON: Record<string, { intensity: number; tension: number }> = {
  平静: { intensity: 20, tension: 10 }, 冷漠: { intensity: 25, tension: 20 },
  温柔: { intensity: 45, tension: 15 }, 浪漫: { intensity: 60, tension: 20 }, 深情: { intensity: 65, tension: 25 },
  喜悦: { intensity: 60, tension: 15 }, 快乐: { intensity: 60, tension: 15 }, 开心: { intensity: 58, tension: 12 }, 兴奋: { intensity: 75, tension: 40 },
  悲伤: { intensity: 65, tension: 35 }, 难过: { intensity: 60, tension: 30 }, 痛苦: { intensity: 80, tension: 55 },
  焦虑: { intensity: 60, tension: 70 }, 紧张: { intensity: 65, tension: 85 }, 悬疑: { intensity: 55, tension: 75 },
  恐惧: { intensity: 80, tension: 90 }, 害怕: { intensity: 75, tension: 85 },
  震惊: { intensity: 85, tension: 80 }, 惊讶: { intensity: 70, tension: 60 },
  愤怒: { intensity: 88, tension: 85 }, 暴怒: { intensity: 95, tension: 92 },
  绝望: { intensity: 90, tension: 70 }, 隐忍: { intensity: 50, tension: 60 }, 决绝: { intensity: 80, tension: 65 },
  嫉妒: { intensity: 65, tension: 60 }, 尴尬: { intensity: 40, tension: 45 }, 释然: { intensity: 45, tension: 15 },
};

const NEUTRAL = { intensity: 40, tension: 35 };

/** 模糊匹配情绪词 (含子串), 命中取最强; 无命中回落中性 */
export function emotionScore(word?: string): { intensity: number; tension: number } {
  const w = (word || '').trim();
  if (!w) return { ...NEUTRAL };
  if (EMOTION_LEXICON[w]) return { ...EMOTION_LEXICON[w] };
  let best: { intensity: number; tension: number } | null = null;
  for (const key of Object.keys(EMOTION_LEXICON)) {
    if (w.includes(key)) {
      const v = EMOTION_LEXICON[key];
      if (!best || v.intensity > best.intensity) best = v;
    }
  }
  return best ? { ...best } : { ...NEUTRAL };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const BRIGHT_SETUP: Record<string, number> = {
  'high-key': 88, 'golden-hour': 78, natural: 60, rembrandt: 45, 'top-down': 45,
  rim: 40, 'neon-noir': 35, 'low-key': 22, silhouette: 15,
};
const ATMO_DELTA: Record<string, number> = { night: -25, neon: -10, fog: -8, smoke: -10, rain: -8, dust: -5, snow: 5, clear: 0 };

export function brightnessFor(input: EmotionShotInput): number {
  if (typeof input.brightness === 'number' && Number.isFinite(input.brightness)) return clamp(input.brightness);
  let b = input.lightingSetup && BRIGHT_SETUP[input.lightingSetup] != null ? BRIGHT_SETUP[input.lightingSetup] : 55;
  if (input.atmosphere && ATMO_DELTA[input.atmosphere] != null) b += ATMO_DELTA[input.atmosphere];
  return clamp(b);
}

/** 节奏: 时长越短越快 + 运动加成 */
export function rhythmFor(input: EmotionShotInput): number {
  const dur = typeof input.durationS === 'number' && input.durationS > 0 ? input.durationS : 5;
  const durRhythm = clamp(110 - dur * 10);          // 2s→90, 5s→60, 10s→10
  const motion = typeof input.motion === 'number' ? input.motion : 40;
  return clamp(durRhythm * 0.55 + motion * 0.45);
}

/** 每镜 → 4 轨点 */
export function computeEmotionCurve(shots: EmotionShotInput[]): EmotionPoint[] {
  if (!Array.isArray(shots)) return [];
  return shots.map((s, i): EmotionPoint => {
    const e = emotionScore(s.emotion);
    // 冲突分 (0-10) 叠加到紧张感
    const conflictBoost = typeof s.conflict === 'number' ? clamp(s.conflict * 10) : 0;
    return {
      index: i,
      emotion: clamp(e.intensity),
      tension: clamp(Math.max(e.tension, conflictBoost * 0.9) * 0.7 + e.tension * 0.3),
      rhythm: rhythmFor(s),
      brightness: brightnessFor(s),
    };
  });
}

export interface CurveStats {
  count: number;
  climaxIndex: number;   // 情感最高镜 (0-based, -1 空)
  peakEmotion: number;
  peakTension: number;
  avgEmotion: number;
  avgRhythm: number;
}

export function curveStats(curve: EmotionPoint[]): CurveStats {
  if (!curve.length) return { count: 0, climaxIndex: -1, peakEmotion: 0, peakTension: 0, avgEmotion: 0, avgRhythm: 0 };
  let climaxIndex = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i].emotion > curve[climaxIndex].emotion) climaxIndex = i;
  const peakEmotion = Math.max(...curve.map((p) => p.emotion));
  const peakTension = Math.max(...curve.map((p) => p.tension));
  const avgEmotion = Math.round(curve.reduce((a, p) => a + p.emotion, 0) / curve.length);
  const avgRhythm = Math.round(curve.reduce((a, p) => a + p.rhythm, 0) / curve.length);
  return { count: curve.length, climaxIndex, peakEmotion, peakTension, avgEmotion, avgRhythm };
}

export function describeCurve(curve: EmotionPoint[]): string {
  const s = curveStats(curve);
  if (!s.count) return '暂无分镜数据';
  return `${s.count} 镜 · 高潮在第 ${s.climaxIndex + 1} 镜 · 情感峰值 ${s.peakEmotion} · 紧张峰值 ${s.peakTension} · 均节奏 ${s.avgRhythm}`;
}
