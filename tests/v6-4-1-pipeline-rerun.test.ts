/**
 * v6.4.1 — 单环节重跑计划 + 显式失效 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  stageOfType, buildRerunPlan, derivePipelineStages, downstreamStages,
  type StageAsset,
} from '@/lib/pipeline-stages';

const ASSETS: StageAsset[] = [
  { id: 's1', type: 'script', updatedAt: '2026-01-01' },
  { id: 'c1', type: 'character', updatedAt: '2026-01-02' },
  { id: 'sc1', type: 'scene', updatedAt: '2026-01-02' },
  { id: 'b1', type: 'storyboard', updatedAt: '2026-01-03' },
  { id: 'v1', type: 'video', updatedAt: '2026-01-04' },
];

describe('v6.4.1 · stageOfType', () => {
  it('资产类型映射到所属环节', () => {
    expect(stageOfType('script')).toBe('script');
    expect(stageOfType('character')).toBe('assets');
    expect(stageOfType('scene')).toBe('assets');
    expect(stageOfType('storyboard')).toBe('storyboard');
    expect(stageOfType('video')).toBe('final');
    expect(stageOfType('unknown')).toBeNull();
  });
});

describe('v6.4.1 · buildRerunPlan', () => {
  it('重跑剧本 → 失效全部下游 + 收齐下游资产 id', () => {
    const plan = buildRerunPlan(ASSETS, 'script');
    expect(plan.target).toBe('script');
    expect(plan.invalidates).toEqual(['assets', 'storyboard', 'final']);
    expect(plan.affectedAssetIds.sort()).toEqual(['b1', 'c1', 'sc1', 'v1']);
    expect(plan.sequence).toEqual(['script', 'assets', 'storyboard', 'final']);
  });

  it('重跑分镜 → 仅失效成片', () => {
    const plan = buildRerunPlan(ASSETS, 'storyboard');
    expect(plan.invalidates).toEqual(['final']);
    expect(plan.affectedAssetIds).toEqual(['v1']);
    expect(plan.sequence).toEqual(['storyboard', 'final']);
  });

  it('重跑成片 (末环节) → 无下游影响', () => {
    const plan = buildRerunPlan(ASSETS, 'final');
    expect(plan.invalidates).toEqual([]);
    expect(plan.affectedAssetIds).toEqual([]);
    expect(plan.sequence).toEqual(['final']);
  });

  it('无 id 的资产不计入 affectedAssetIds', () => {
    const noId: StageAsset[] = [{ type: 'video' }, { id: 'v2', type: 'video' }];
    expect(buildRerunPlan(noId, 'storyboard').affectedAssetIds).toEqual(['v2']);
  });

  it('downstreamStages 与 plan.invalidates 一致', () => {
    expect(buildRerunPlan(ASSETS, 'assets').invalidates).toEqual(downstreamStages('assets'));
  });
});

describe('v6.4.1 · derivePipelineStages 显式失效', () => {
  it('被显式标记 stale 的资产 → 该环节 stale (不依赖时间)', () => {
    const flagged: StageAsset[] = [
      { id: 's1', type: 'script', updatedAt: '2026-01-01' },
      { id: 'c1', type: 'character', updatedAt: '2026-01-02', stale: true },
      { id: 'b1', type: 'storyboard', updatedAt: '2026-01-03' },
    ];
    const stages = derivePipelineStages(flagged);
    expect(stages.find((s) => s.id === 'assets')!.status).toBe('stale');
    expect(stages.find((s) => s.id === 'script')!.status).toBe('ready');
    expect(stages.find((s) => s.id === 'storyboard')!.status).toBe('ready');
    expect(stages.find((s) => s.id === 'final')!.status).toBe('empty');
  });

  it('无 stale 标记 → 退回时间比较 (向后兼容 v6.4 行为)', () => {
    // storyboard(01-01) 比上游 script(01-05) 旧 → stale
    const timed: StageAsset[] = [
      { id: 's1', type: 'script', updatedAt: '2026-01-05' },
      { id: 'b1', type: 'storyboard', updatedAt: '2026-01-01' },
    ];
    const stages = derivePipelineStages(timed);
    expect(stages.find((s) => s.id === 'script')!.status).toBe('ready');
    expect(stages.find((s) => s.id === 'storyboard')!.status).toBe('stale');
  });
});
