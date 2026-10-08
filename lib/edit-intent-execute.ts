/**
 * lib/edit-intent-execute — 编辑意图 → 执行计划(v12.251)。
 *
 * 把 `parseEditIntent` 出的结构化意图,映射到**既有端点**的调用参数:
 *   - 组合级编辑(画幅/字幕/平台/删镜/重配音)→ 一次 `POST /api/projects/[id]/recompose`
 *     (复用已生成的逐镜视频重新合成,快、确定性、不烧生成引擎)。
 *   - 重生某镜(regenShot)→ 走既有 `regenerate-shot` 逐镜重生流程(慢、要预算、SSE)。
 *   - 节奏(setPace)→ recompose 不接节奏参数,需整片重跑,本层只作提示不执行。
 *
 * 纯函数、可测:意图 → 计划。真正的 HTTP 调用与二次确认在前端/端点层做,这里只负责「怎么映射」。
 * recompose 端点自身还会再校验 aspect/captionStyle/platform 白名单 + 属主守卫,故本映射是防御纵深的一环而非唯一关。
 */

import type { EditOp } from './edit-intent';

export interface RecomposePlan {
  /** 只有「改画幅」意图才带;不带时 recompose 端点用项目画幅(v12.470 前是写死 16:9)。别在这里补缺省值。 */
  aspect?: '16:9' | '9:16';
  captionStyle?: 'clean' | 'social' | 'bold' | 'karaoke';
  platform?: 'douyin' | 'xiaohongshu' | 'none';
  dropShots?: number[];
  regenVoiceover?: boolean;
}

export interface ExecutionPlan {
  /** 组合级编辑合并成的一次 recompose 请求体;无组合级意图时为 null。 */
  recompose: RecomposePlan | null;
  /** 需单独重生的镜(走既有 regenerate-shot,不在 recompose 内)。 */
  regenShots: Array<{ shotNumber: number; note?: string }>;
  /** 节奏调整 —— recompose 不支持,需整片重跑,仅提示。 */
  paceHint: 'fast' | 'slow' | null;
  /** 是否含花钱/不可逆操作(删镜 / 重配音 / 重生镜)—— 执行前必须二次确认。 */
  destructive: boolean;
}

/** 意图列表 → 执行计划(纯函数)。 */
export function planExecution(intents: EditOp[]): ExecutionPlan {
  const rec: RecomposePlan = {};
  const dropShots: number[] = [];
  const regenShots: Array<{ shotNumber: number; note?: string }> = [];
  let paceHint: 'fast' | 'slow' | null = null;
  let hasRecompose = false;

  for (const it of intents || []) {
    switch (it.op) {
      case 'setAspect': rec.aspect = it.value; hasRecompose = true; break;
      case 'setCaptionStyle': rec.captionStyle = it.value; hasRecompose = true; break;
      case 'setPlatform': rec.platform = it.value; hasRecompose = true; break;
      case 'dropShot': dropShots.push(it.shotNumber); hasRecompose = true; break;
      case 'regenVoiceover': rec.regenVoiceover = true; hasRecompose = true; break;
      case 'regenShot': regenShots.push({ shotNumber: it.shotNumber, note: it.note }); break;
      case 'setPace': paceHint = it.value; break;
    }
  }
  if (dropShots.length) rec.dropShots = [...new Set(dropShots)].sort((a, b) => a - b);

  const destructive = !!(rec.dropShots?.length || rec.regenVoiceover || regenShots.length);
  return { recompose: hasRecompose ? rec : null, regenShots, paceHint, destructive };
}

/** 计划是否有任何**可在本页直接执行**的部分(即 recompose)。regenShot/pace 属另走流程。 */
export function hasExecutableRecompose(plan: ExecutionPlan): boolean {
  return plan.recompose !== null;
}
