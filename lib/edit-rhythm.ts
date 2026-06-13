/**
 * lib/edit-rhythm (v12.0.1) — 情绪节奏曲线(阶段二十 A · 智能剪辑)。
 *
 * 「只拼接、无节奏」的第二刀:让剪辑跟着情绪起伏走 —— **情感峰值镜 breathe(满长)、
 * 动作/高张力镜快切压缩、平淡过场轻压**(对标 BeatSync「calm holds / energy cuts」、
 * CutClaw 能量驱动 pacing)。
 *
 * 关键约束(与卡点剪辑同):**只压不拉**——用现有素材,压缩 = 切点提前,不会缺素材;
 * 拉长会让 xfade 在素材结束后还要 fade 报错。**带对白的镜不压**——保配音/口型完整。
 *
 * 纯函数、零 IO、可单测。无情绪数据(emotionTemperature/tensionLevel 全空)→ 不动(诚实降级)。
 */

export interface RhythmClip {
  durationS: number;
  /** 情感温度 -10(谷底)~ +10(巅峰),|值| 大 = 情感峰值 */
  emotionTemperature?: number;
  /** 张力等级 0-10,高 = 动作/悬疑 */
  tensionLevel?: number;
  /** 该镜有对白(有配音)→ 不压缩,保配音满长 */
  hasDialogue?: boolean;
}

export interface PacingResult {
  /** 重分配后的逐镜时长(每镜 ≤ 原时长) */
  durations: number[];
  /** 实际调速的镜数 */
  changed: number;
  /** 逐镜调速原因(调试/验收) */
  reasons: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 情绪驱动 pacing —— 返回逐镜新时长(只压不拉)+ 调速摘要。
 *
 * 规则(优先级从上到下):
 *   1. 对白镜 → 满长(配音完整,口型不断)
 *   2. 情感峰值(|温度| ≥ 7)→ 满长(让高潮 breathe)
 *   3. 高张力(tension ≥ 6)→ 压缩快切(张力越高压越多,最多压到 0.6)
 *   4. 平淡过场(|温度| ≤ 2 且 tension ≤ 3)→ 轻压 0.82(避免温吞)
 *   5. 其余 → 满长
 */
export function applyEmotionPacing(clips: RhythmClip[], opts?: { minShotS?: number }): PacingResult {
  const minShot = opts?.minShotS ?? 1.2;
  const out: number[] = [];
  const reasons: string[] = [];
  let changed = 0;

  for (const c of clips) {
    const dur = c.durationS > 0 ? c.durationS : 5;
    // 区分「无情绪数据」(undefined → 不猜,满长)与「显式低值」(平淡过场 → 轻压)
    const hasData = c.emotionTemperature !== undefined || c.tensionLevel !== undefined;
    const temp = Math.abs(c.emotionTemperature ?? 0);
    const tension = c.tensionLevel ?? 0;

    let factor = 1.0;
    let why = '满长';
    if (c.hasDialogue) { factor = 1.0; why = '对白镜·保配音'; }
    else if (temp >= 7) { factor = 1.0; why = '情感峰值·breathe'; }
    else if (tension >= 6) { factor = clamp(1 - 0.4 * ((tension - 6) / 4), 0.6, 1.0); why = '高张力·快切'; }
    else if (hasData && temp <= 2 && tension <= 3) { factor = 0.82; why = '平淡过场·轻压'; }

    const nd = Math.max(minShot, dur * factor);
    if (Math.abs(nd - dur) > 0.04) { changed++; reasons.push(why); }
    out.push(nd);
  }
  return { durations: out, changed, reasons };
}
