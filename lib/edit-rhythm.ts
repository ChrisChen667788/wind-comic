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
  /** v12.0.2:镜号(给关键镜判定用) */
  shotNumber?: number;
}

export interface KeyShotInput {
  shotNumber: number;
  emotionTemperature?: number;
}

/**
 * v12.0.2 关键镜判定 —— 叙事侧重点(对标 pacing-audit/hook-audit 的结构关键镜):
 *   开场钩子(首镜)· 集尾悬念(末镜)· 情绪反转(温度大幅跳变/极性翻转)· 情感峰值(|温度|最大)。
 * 纯函数;返回关键镜号集合。剪辑把注意力(时长/转场)倾斜给这些镜。
 */
export function detectKeyShots(clips: KeyShotInput[]): Set<number> {
  const keys = new Set<number>();
  if (!clips.length) return keys;
  keys.add(clips[0].shotNumber);                       // 开场钩子
  keys.add(clips[clips.length - 1].shotNumber);        // 集尾 cliffhanger
  for (let i = 1; i < clips.length; i++) {
    const prev = clips[i - 1].emotionTemperature ?? 0;
    const cur = clips[i].emotionTemperature ?? 0;
    if (Math.abs(cur - prev) >= 6 || (prev > 1 && cur < -1) || (prev < -1 && cur > 1)) {
      keys.add(clips[i].shotNumber);                   // 情绪反转
    }
  }
  let peakIdx = 0, peakVal = -1;
  clips.forEach((c, i) => { const v = Math.abs(c.emotionTemperature ?? 0); if (v > peakVal) { peakVal = v; peakIdx = i; } });
  if (peakVal >= 5) keys.add(clips[peakIdx].shotNumber); // 情感峰值
  return keys;
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

export interface TransitionClip {
  shotNumber: number;
  emotionTemperature?: number;
  tensionLevel?: number;
  hasDialogue?: boolean;
  /** 用户/上游显式指定的转场(cut/flash-cut 等硬切优先保留) */
  explicit?: string;
}

/**
 * v12.0.3 转场审美 —— 按相邻镜关系选转场,而非一律 dissolve:
 *   · 显式硬切(cut/flash-cut)→ 保留(尊重创作意图)
 *   · 关键镜(开场/集尾/反转/峰值)→ fade(郑重入场)
 *   · 张力骤升(Δtension ≥ 3)→ cut(硬切给冲击)
 *   · 张力回落(Δtension ≤ -3)→ dissolve(叠化软收)
 *   · 情绪极性翻转 → fade(沉稳过反转)
 *   · 双对白镜 → dissolve(平顺,l-cut 管音轨衔接)
 *   · 其余 → 在 dissolve / fadeblack / wipeleft 间轮换求变化
 * **变化性守卫**:同一转场连续 3 次 → 换一个,避免单调。
 * 返回 transition[](长度 = 镜数;index 0 = ''(首镜无入场转场))。纯函数。
 */
export function selectTransitions(clips: TransitionClip[], keyShots?: Set<number>, cutBias = 0): string[] {
  // v12.0.4 风格偏置:cutBias>0(快剪)硬切池 + 张力阈值放宽;<0(慢叙)柔池 + 阈值收紧
  const VARIETY = cutBias > 0.3 ? ['cut', 'fadeblack', 'dissolve']
    : cutBias < -0.3 ? ['dissolve', 'fade', 'fadeblack']
    : ['dissolve', 'fadeblack', 'wipeleft'];
  const riseThresh = cutBias > 0.3 ? 2 : cutBias < -0.3 ? 4 : 3;   // 张力升→硬切的阈值
  const out: string[] = clips.length ? [''] : [];
  let varietyIdx = 0;
  let runTransition = '';
  let runLen = 0;

  for (let i = 1; i < clips.length; i++) {
    const prev = clips[i - 1];
    const cur = clips[i];
    const explicit = (cur.explicit || '').toLowerCase();
    let t: string;

    if (explicit === 'cut' || explicit === 'flash-cut') {
      t = explicit;
    } else if (keyShots?.has(cur.shotNumber)) {
      t = 'fade';
    } else {
      const dT = (cur.tensionLevel ?? 5) - (prev.tensionLevel ?? 5);
      const pe = prev.emotionTemperature ?? 0;
      const ce = cur.emotionTemperature ?? 0;
      const flip = (pe > 1 && ce < -1) || (pe < -1 && ce > 1);
      if (flip) t = 'fade';
      else if (dT >= riseThresh) t = 'cut';
      else if (dT <= -3) t = 'dissolve';
      else if (cur.hasDialogue && prev.hasDialogue) t = 'dissolve';
      else { t = VARIETY[varietyIdx % VARIETY.length]; varietyIdx++; }
    }

    // 变化性守卫:同转场连 3 次 → 换 variety 池下一个(硬切不算单调,跳过)
    if (t !== 'cut' && t !== 'flash-cut') {
      if (t === runTransition) runLen++;
      else { runTransition = t; runLen = 1; }
      if (runLen >= 3) {
        const alt = VARIETY.find((v) => v !== t) || t;
        t = alt; runTransition = alt; runLen = 1;
      }
    }
    out.push(t);
  }
  return out;
}

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
export function applyEmotionPacing(clips: RhythmClip[], opts?: { minShotS?: number; keyShots?: Set<number>; compressionBias?: number }): PacingResult {
  const minShot = opts?.minShotS ?? 1.2;
  const keyShots = opts?.keyShots;
  const bias = typeof opts?.compressionBias === 'number' ? Math.max(0.4, Math.min(1.6, opts.compressionBias)) : 1.0;
  const out: number[] = [];
  const reasons: string[] = [];
  let changed = 0;

  for (const c of clips) {
    const dur = c.durationS > 0 ? c.durationS : 5;
    // 区分「无情绪数据」(undefined → 不猜,满长)与「显式低值」(平淡过场 → 轻压)
    const hasData = c.emotionTemperature !== undefined || c.tensionLevel !== undefined;
    const temp = Math.abs(c.emotionTemperature ?? 0);
    const tension = c.tensionLevel ?? 0;
    const isKey = c.shotNumber !== undefined && !!keyShots?.has(c.shotNumber);

    let factor = 1.0;
    let why = '满长';
    if (isKey) { factor = 1.0; why = '关键镜·满长(侧重)'; }   // v12.0.2:关键镜不压,注意力倾斜
    else if (c.hasDialogue) { factor = 1.0; why = '对白镜·保配音'; }
    else if (temp >= 7) { factor = 1.0; why = '情感峰值·breathe'; }
    else if (tension >= 6) { factor = clamp(1 - 0.4 * ((tension - 6) / 4), 0.6, 1.0); why = '高张力·快切'; }
    else if (hasData && temp <= 2 && tension <= 3) { factor = 0.82; why = '平淡过场·轻压'; }

    // v12.0.4 风格调制:压缩量 ×bias(快剪压更狠/慢叙压更轻);满长镜(factor=1)不受影响
    const styled = factor < 1 ? 1 - (1 - factor) * bias : factor;
    const finalFactor = clamp(styled, 0.5, 1.0);
    const nd = Math.max(minShot, dur * finalFactor);
    if (Math.abs(nd - dur) > 0.04) { changed++; reasons.push(why); }
    out.push(nd);
  }
  return { durations: out, changed, reasons };
}
