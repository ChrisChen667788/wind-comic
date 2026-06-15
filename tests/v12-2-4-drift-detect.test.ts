/**
 * v12.2.4 — 身份漂移检测(阶段二十一收官):detectDriftOutliers 纯函数。
 * 给定逐镜视觉 embedding → 标离群(漂移)镜。BYO 图像嵌入的获取由路由 + 降级覆盖。
 */
import { describe, it, expect } from 'vitest';
import { detectDriftOutliers } from '@/lib/drift-detect';

describe('v12.2.4 · detectDriftOutliers', () => {
  it('一群相似 + 一个跑偏 → 跑偏镜被标 outlier', () => {
    const shots = [
      { shotNumber: 1, vector: [1, 0, 0] },
      { shotNumber: 2, vector: [0.98, 0.02, 0] },
      { shotNumber: 3, vector: [0.97, 0.03, 0] },
      { shotNumber: 4, vector: [0.99, 0.01, 0] },
      { shotNumber: 5, vector: [0, 1, 0] }, // 明显跑偏
    ];
    const r = detectDriftOutliers(shots);
    expect(r.available).toBe(true);
    expect(r.outliers).toContain(5);
    expect(r.scores[0].shotNumber).toBe(5); // 漂移最大排第一
    expect(r.scores[0].driftScore).toBeGreaterThan(r.scores[r.scores.length - 1].driftScore);
  });

  it('全片高度一致 → 无 outlier(不误报)', () => {
    const shots = [
      { shotNumber: 1, vector: [1, 0] },
      { shotNumber: 2, vector: [0.999, 0.001] },
      { shotNumber: 3, vector: [0.998, 0.002] },
    ];
    expect(detectDriftOutliers(shots).outliers).toEqual([]);
  });

  it('<2 个可用 embedding → available=false(调用方退回 LLM 评分)', () => {
    expect(detectDriftOutliers([]).available).toBe(false);
    expect(detectDriftOutliers([{ shotNumber: 1, vector: [1, 0] }]).available).toBe(false);
    expect(detectDriftOutliers([{ shotNumber: 1, vector: [] }, { shotNumber: 2, vector: [1] }]).available).toBe(false);
  });

  it('maxOutliers 截断 + 按漂移降序', () => {
    const shots = [
      { shotNumber: 1, vector: [1, 0, 0, 0] },
      { shotNumber: 2, vector: [1, 0, 0, 0] },
      { shotNumber: 3, vector: [1, 0, 0, 0] },
      { shotNumber: 4, vector: [0, 1, 0, 0] },
      { shotNumber: 5, vector: [0, 0, 1, 0] },
      { shotNumber: 6, vector: [0, 0, 0, 1] },
    ];
    const r = detectDriftOutliers(shots, { maxOutliers: 2, z: 0.5 });
    expect(r.outliers.length).toBeLessThanOrEqual(2);
  });

  it('minDrift 绝对地板:整体差异都很小则不标(画风本就有微差)', () => {
    const shots = [
      { shotNumber: 1, vector: [1, 0] },
      { shotNumber: 2, vector: [1, 0] },
      { shotNumber: 3, vector: [0.999, 0.0447] }, // 距离 ~0.001,远低于 minDrift 0.15
    ];
    expect(detectDriftOutliers(shots).outliers).toEqual([]);
  });
});
