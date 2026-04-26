/**
 * TTS Prosody Derivation (v2.9 Bug 3)
 *
 * 把 (emotion, emotionTemperature, character) 翻译成 MiniMax TTS 的
 * (speed, pitch, vol) 三元组。
 *
 * 问题:
 *   之前每个 shot 的 TTS 都固定 speed=1.0, pitch=0, vol=0.85,
 *   悲伤和愤怒听起来一样平,画面情绪爆到 emotionTemperature=+8
 *   但台词仍然波澜不惊 —— 声画脱节的廉价感。
 *
 * 方案:
 *   - emotion 关键词匹配 → 基线 prosody (粗略分档)
 *   - emotionTemperature -10~+10 → ±20% 幅度细调(速度 ±0.08,音调 ±3 半音,音量 ±0.05)
 *   - 结果 clamp 到 MiniMax 合法区间:speed 0.5~2.0 / pitch -12~+12 / vol 0.3~1.0
 *
 * 为什么不用 LLM 去算:
 *   TTS 调用本就是逐 shot 串行的瓶颈,再塞个 LLM 就是灾难。
 *   这个函数纯规则 <1ms 出结果,emotion 覆盖 8 档 + temperature 连续细调
 *   已经足够把"画面走情绪,配音也跟着走"做出来了。
 */

export interface ProsodyParams {
  speed: number;   // 0.5 ~ 2.0, 默认 1.0
  pitch: number;   // -12 ~ +12 半音, 默认 0
  vol: number;     // 0.3 ~ 1.0, 默认 0.85
}

interface ProsodyInput {
  emotion?: string;               // 如"悲伤"、"愤怒"、"激动"
  emotionTemperature?: number;    // -10(谷底) ~ 0(中性) ~ +10(巅峰)
  character?: string;             // 角色名(可用于性别/年龄线索,暂未使用)
}

// 情绪关键词 → 基线 prosody
// 负值 pitch 听起来更低沉,正值更明亮;speed 越高越急促
const EMOTION_BASELINE: Array<{ match: RegExp; p: ProsodyParams }> = [
  { match: /狂怒|暴怒|爆炸|咆哮/,        p: { speed: 1.18, pitch: +2, vol: 1.00 } },
  { match: /愤怒|恼怒|怒火/,             p: { speed: 1.12, pitch: +2, vol: 0.95 } },
  { match: /狂喜|欣喜|大笑|兴奋|亢奋/,   p: { speed: 1.12, pitch: +3, vol: 0.95 } },
  { match: /激动|热烈/,                  p: { speed: 1.08, pitch: +2, vol: 0.92 } },
  { match: /惊恐|恐惧|吓|害怕/,          p: { speed: 1.15, pitch: +4, vol: 0.90 } },
  { match: /惊讶|诧异|错愕/,             p: { speed: 1.10, pitch: +3, vol: 0.88 } },
  { match: /紧张|焦虑|急促|急切/,        p: { speed: 1.10, pitch: +1, vol: 0.88 } },
  { match: /悲痛|绝望|崩溃/,             p: { speed: 0.85, pitch: -3, vol: 0.72 } },
  { match: /悲伤|哭泣|哀伤|难过/,        p: { speed: 0.90, pitch: -2, vol: 0.75 } },
  { match: /委屈|哽咽/,                  p: { speed: 0.92, pitch: -1, vol: 0.72 } },
  { match: /深沉|沉思|凝重/,             p: { speed: 0.88, pitch: -3, vol: 0.78 } },
  { match: /低落|忧郁|落寞/,             p: { speed: 0.92, pitch: -2, vol: 0.75 } },
  { match: /温柔|温暖|轻柔|亲切/,        p: { speed: 0.96, pitch: +1, vol: 0.80 } },
  { match: /俏皮|活泼|调皮|搞笑/,        p: { speed: 1.10, pitch: +2, vol: 0.92 } },
  { match: /冷静|理性|沉稳/,             p: { speed: 0.98, pitch: 0,  vol: 0.85 } },
  { match: /旁白|叙述|解说/,             p: { speed: 1.00, pitch: 0,  vol: 0.88 } },
];

const NEUTRAL: ProsodyParams = { speed: 1.00, pitch: 0, vol: 0.85 };

/**
 * 从情绪语义生成 MiniMax TTS prosody 参数。
 *
 * @example
 *   deriveProsody({ emotion: '悲伤', emotionTemperature: -7 })
 *   // → { speed: 0.84, pitch: -4, vol: 0.72 } (在悲伤基线上再往谷底拉)
 *
 *   deriveProsody({ emotion: '激动', emotionTemperature: +8 })
 *   // → { speed: 1.14, pitch: +4, vol: 0.96 } (在激动基线上再推高)
 */
export function deriveProsody(input: ProsodyInput = {}): ProsodyParams {
  const emotion = (input.emotion || '').trim();
  const temperature = typeof input.emotionTemperature === 'number' ? input.emotionTemperature : 0;

  // 1) emotion 关键词匹配基线
  let base: ProsodyParams = NEUTRAL;
  if (emotion) {
    const hit = EMOTION_BASELINE.find(({ match }) => match.test(emotion));
    if (hit) base = hit.p;
  }

  // 2) emotionTemperature ±20% 幅度细调
  //    t ∈ [-1, +1] 之后:speed ±0.08 / pitch ±3 半音 / vol ±0.05
  const t = Math.max(-10, Math.min(10, temperature)) / 10;
  const speed = clamp(base.speed + t * 0.08, 0.5, 2.0);
  const pitch = clampInt(base.pitch + t * 3, -12, 12);
  const vol = clamp(base.vol + t * 0.05, 0.3, 1.0);

  return {
    speed: round2(speed),
    pitch,
    vol: round2(vol),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
