/**
 * lib/drift-detect (v12.2.4) — 身份漂移检测(阶段二十一收官)。
 *
 * 成片级一致性体检:对每张 storyboard 取视觉 embedding → 算每镜「到其余镜的平均余弦距离」
 * (= 该镜离群程度)→ 标 outlier 漂移镜(画风/角色跑偏最大),喂给最弱镜重生入口。
 *
 * 对比现有 `scoreShotConsistency`(LLM 文字比对,非确定):这里是**确定、可量化、抓渐进漂移**
 * 的客观信号。BYO:无图像 embedding 能力 → 调用方退回现有 LLM 评分(诚实降级)。
 *
 * 纯函数、零 IO、可单测。
 */
import { cosineSimilarity } from './asset-embedding';

export interface ShotEmbedding {
  shotNumber: number;
  vector: number[];
}

export interface DriftScore {
  shotNumber: number;
  /** 到其余镜的平均余弦距离:0=与全片一致,越大越离群(漂移) */
  driftScore: number;
}

export interface DriftResult {
  /** 逐镜漂移分(按 driftScore 降序) */
  scores: DriftScore[];
  /** 判定为漂移的镜号(降序,已截断) */
  outliers: number[];
  /** 全片平均漂移(整体一致性的反向指标) */
  meanDrift: number;
  /** 是否有足够 embedding 可判(<2 → false,调用方退回 LLM 评分) */
  available: boolean;
}

/**
 * 漂移 outlier 检测(纯函数)。
 * 判据:driftScore > mean + z·std(相对离群)且 ≥ minDrift(绝对地板,避免把正常画风差异误判),
 * 按漂移降序取前 maxOutliers 个。
 */
export function detectDriftOutliers(
  shots: ShotEmbedding[],
  opts?: { z?: number; maxOutliers?: number; minDrift?: number },
): DriftResult {
  const usable = (shots || []).filter((s) => Array.isArray(s?.vector) && s.vector.length > 0);
  if (usable.length < 2) return { scores: [], outliers: [], meanDrift: 0, available: false };

  const scores: DriftScore[] = usable.map((s) => {
    let sum = 0;
    for (const o of usable) {
      if (o.shotNumber === s.shotNumber) continue;
      sum += 1 - cosineSimilarity(s.vector, o.vector);
    }
    return { shotNumber: s.shotNumber, driftScore: sum / (usable.length - 1) };
  });

  const vals = scores.map((x) => x.driftScore);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const std = Math.sqrt(variance);

  const z = opts?.z ?? 1.5;
  const minDrift = opts?.minDrift ?? 0.15;
  const maxOutliers = opts?.maxOutliers ?? 3;
  const threshold = mean + z * std;

  const sorted = [...scores].sort((a, b) => b.driftScore - a.driftScore);
  const outliers = sorted
    .filter((x) => x.driftScore > threshold && x.driftScore >= minDrift)
    .slice(0, maxOutliers)
    .map((x) => x.shotNumber);

  return { scores: sorted, outliers, meanDrift: mean, available: true };
}
