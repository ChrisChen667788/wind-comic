/**
 * 阶段三十 v12.37.0 — 可审计决策日志聚合单测(纯函数)。
 */
import { describe, expect, it } from 'vitest';
import { buildDecisionLog } from '@/lib/decision-log';
import type { CostLogRow } from '@/lib/repos/cost-log-repo';

const row = (engine: string, costCny: number, shotNumber?: number): CostLogRow => ({
  id: 'c' + Math.round(costCny * 100), engine, resolution: '', durationSec: 8, costCny,
  metadata: shotNumber ? { shotNumber } : {}, createdAt: '2026-06-22T00:00:00Z',
});

describe('buildDecisionLog', () => {
  it('按镜号聚合成本 + 提取主视频引擎', () => {
    const log = buildDecisionLog({
      costRows: [row('video-veo', 4.8, 1), row('video-kling', 1.0, 2), row('video-veo', 4.8, 2)],
    });
    expect(log.shots.length).toBe(2);
    const s2 = log.shots.find((s) => s.shotNumber === 2)!;
    expect(s2.costCny).toBe(5.8);
    expect(s2.engines.sort()).toEqual(['video-kling', 'video-veo']);
    expect(s2.videoEngine).toBe('kling'); // 第一条 video-* 行
  });

  it('无镜号成本进 nonShotCosts(项目级)', () => {
    const log = buildDecisionLog({ costRows: [row('tts-minimax', 0.2), row('video-veo', 4.8, 1)] });
    expect(log.nonShotCosts).toEqual([{ engine: 'tts-minimax', costCny: 0.2 }]);
    expect(log.shots.length).toBe(1);
  });

  it('totals:总成本 + byEngine 降序 + 镜数', () => {
    const log = buildDecisionLog({ costRows: [row('video-veo', 4.8, 1), row('video-veo', 4.8, 2), row('tts-minimax', 0.2)] });
    expect(log.totals.totalCostCny).toBe(9.8);
    expect(log.totals.shotCount).toBe(2);
    expect(log.totals.byEngine[0]).toEqual({ engine: 'video-veo', costCny: 9.6, count: 2 });
  });

  it('合并 storyboard 资产:prompt / 一致性 / 九宫格选定', () => {
    const log = buildDecisionLog({
      costRows: [row('video-veo', 4.8, 1)],
      assets: [{ type: 'storyboard', shot_number: 1, data: { prompt: 'a hero on a cliff', consistency: 88, fromCandidate: 'cand-3' } }],
    });
    const s1 = log.shots[0];
    expect(s1.prompt).toBe('a hero on a cliff');
    expect(s1.consistencyScore).toBe(88);
    expect(s1.pickedFromCandidate).toBe('cand-3');
  });

  it('storyboard 资产可为没有成本行的镜建条目', () => {
    const log = buildDecisionLog({
      costRows: [],
      assets: [{ type: 'storyboard', shot_number: 5, data: { prompt: 'p' } }, { type: 'final_video', shot_number: 5, data: {} }],
    });
    expect(log.shots.map((s) => s.shotNumber)).toEqual([5]);
    expect(log.shots[0].costCny).toBe(0);
  });

  it('quality 兼容 snake/camel;无则 null', () => {
    expect(buildDecisionLog({ costRows: [], quality: { overall_score: 85, continuity_score: 90 } }).quality)
      .toEqual({ overall: 85, continuity: 90, lighting: undefined, face: undefined });
    expect(buildDecisionLog({ costRows: [] }).quality).toBeNull();
  });
});
