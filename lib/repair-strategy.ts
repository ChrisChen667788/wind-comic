/**
 * lib/repair-strategy.ts — 弱镜该「局部重绘」还是「整张重生」(v12.408)。
 *
 * ── 病象:能力造好了,但一次都没被调用过 ──────────────────────────────
 * `services/fal-flux.service.ts` 早就有 `editImage()`(走 `fal-ai/flux-kontext/max`,
 * 指令式局部重绘),但**全仓零调用方**。竞品复核里那条 C7「已接入 provider 的特色
 * 能力大量闲置」,说的就是这个:接入成本已经付过了,能力却一直躺着。
 *
 * 而现状是:Vision Audit 判低分 → `rebirth-plan` 排出弱镜 → **整张重生**。
 * 整张重生有两个代价:① 贵(一次完整出图);② **不稳** —— 重生会把这一镜里
 * 本来已经对的部分(角色长相、光线、构图)一起重新掷骰子,常见的结果是
 * 「修好了动作,人却变样了」,于是又触发下一轮重生。
 *
 * ── 策略:按「错得有多整体」分流 ──────────────────────────────────────
 * 局部重绘不是万能的。判据是**这一镜错的是局部还是整体**:
 *
 *   · verdict = fail(< 50):整体跑题 —— 场景都不对,局部改无从改起 → 整张重生;
 *   · 最弱维度是 sceneMatch:场景本身错了,同样是整体问题 → 整张重生;
 *   · 其余(warn 档,且最弱维度是 action / mood / composition)→ **局部重绘**:
 *     人物、风格、光线大体已对,只是动作/情绪/构图偏了,这正是 Kontext 擅长的。
 *
 * 这样分流的收益是双向的:省钱,而且**保住已经对的部分**不被重新掷骰子。
 *
 * ── 一条刻意的保守 ────────────────────────────────────────────────────
 * 没有维度数据时(`dimensions` 缺失)一律走整张重生 —— 不猜。
 * 猜错的代价是「改了半天没改对,还多花一次钱」,比直接重生更差。
 */
import type { RebirthShot } from './rebirth-plan';

export type RepairMode = 'edit' | 'regenerate';

export interface RepairDecision {
  shotNumber: number;
  mode: RepairMode;
  /** mode='edit' 时给 Kontext 的指令;整张重生时为 undefined */
  editPrompt?: string;
  /** 为什么这样分流 —— 写进决策日志,便于复盘 */
  reason: string;
}

/** 这些维度的问题是**局部**的,适合指令式重绘。 */
const LOCAL_DIMENSIONS = new Set(['actionMatch', 'moodMatch', 'composition']);

/** 低于此分视为整体跑题,局部改无从改起。与 vision-audit 的 fail 档对齐。 */
export const REGENERATE_BELOW = 50;

export function chooseRepairStrategy(shot: RebirthShot): RepairDecision {
  const { shotNumber, score, weakestDimension, focusHint } = shot;

  if (score < REGENERATE_BELOW) {
    return {
      shotNumber,
      mode: 'regenerate',
      reason: `${score} 分属整体跑题(< ${REGENERATE_BELOW}),局部改无从改起`,
    };
  }
  if (!weakestDimension) {
    return {
      shotNumber,
      mode: 'regenerate',
      reason: '没有维度数据 —— 不猜哪里错了,直接重生比猜错再补一次更省',
    };
  }
  if (!LOCAL_DIMENSIONS.has(weakestDimension)) {
    return {
      shotNumber,
      mode: 'regenerate',
      reason: `最弱维度是 ${weakestDimension}(场景本身不对),属整体问题`,
    };
  }

  return {
    shotNumber,
    mode: 'edit',
    editPrompt: buildEditPrompt(shot),
    reason: `${score} 分且最弱维度是 ${weakestDimension} —— 局部偏差,重绘该处即可,保住已经对的部分`,
  };
}

/**
 * 指令式重绘的提示词。
 * 刻意**只描述要改的地方**,并显式要求保持其余不变 ——
 * 否则 Kontext 也会顺手改动别处,那就退化成了「换个方式整张重生」。
 */
export function buildEditPrompt(shot: RebirthShot): string {
  const keep = '保持角色长相、服装、画风、光线与整体构图不变';
  const fix = shot.focusHint?.trim() || '修正与剧本描述不符之处';
  return `${fix}。${keep}。只修改需要修改的区域,其余像素尽量保持原样。`;
}

/** 批量分流,并给出可写进日志的统计。 */
export function planRepairs(shots: RebirthShot[]): {
  decisions: RepairDecision[];
  editCount: number;
  regenerateCount: number;
} {
  const decisions = shots.map(chooseRepairStrategy);
  return {
    decisions,
    editCount: decisions.filter((d) => d.mode === 'edit').length,
    regenerateCount: decisions.filter((d) => d.mode === 'regenerate').length,
  };
}
