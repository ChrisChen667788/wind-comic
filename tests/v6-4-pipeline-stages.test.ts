/**
 * v6.4 — 导演级全链路 流水线环节模型 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES, derivePipelineStages, downstreamStages, rerunPlan, pipelineProgress,
  type StageAsset,
} from '@/lib/pipeline-stages';

describe('v6.4 · derivePipelineStages', () => {
  it('无资产 → 全 empty', () => {
    const st = derivePipelineStages([]);
    expect(st.map((s) => s.id)).toEqual(['script', 'assets', 'storyboard', 'final']);
    expect(st.every((s) => s.status === 'empty')).toBe(true);
  });

  it('只有剧本 → script ready, 其余 empty', () => {
    const st = derivePipelineStages([{ type: 'script', updatedAt: '2026-05-01' }]);
    expect(st.find((s) => s.id === 'script')!.status).toBe('ready');
    expect(st.find((s) => s.id === 'assets')!.status).toBe('empty');
  });

  it('character + scene 都算 assets 环节', () => {
    const st = derivePipelineStages([{ type: 'character' }, { type: 'scene' }, { type: 'scene' }]);
    expect(st.find((s) => s.id === 'assets')!.count).toBe(3);
    expect(st.find((s) => s.id === 'assets')!.status).toBe('ready');
  });

  it('全链路有产物 → 全 ready', () => {
    const assets: StageAsset[] = [
      { type: 'script', updatedAt: '2026-05-01' },
      { type: 'character', updatedAt: '2026-05-02' },
      { type: 'storyboard', updatedAt: '2026-05-03' },
      { type: 'video', updatedAt: '2026-05-04' },
    ];
    expect(derivePipelineStages(assets).every((s) => s.status === 'ready')).toBe(true);
  });

  it('上游比下游新 → 下游 stale', () => {
    const assets: StageAsset[] = [
      { type: 'script', updatedAt: '2026-05-10' },      // 剧本后改的
      { type: 'storyboard', updatedAt: '2026-05-03' },  // 分镜更旧 → stale
    ];
    const st = derivePipelineStages(assets);
    expect(st.find((s) => s.id === 'storyboard')!.status).toBe('stale');
    expect(st.find((s) => s.id === 'script')!.status).toBe('ready');
  });
});

describe('v6.4 · downstream / rerunPlan', () => {
  it('downstreamStages', () => {
    expect(downstreamStages('script')).toEqual(['assets', 'storyboard', 'final']);
    expect(downstreamStages('storyboard')).toEqual(['final']);
    expect(downstreamStages('final')).toEqual([]);
  });
  it('rerunPlan 目标 + 失效下游', () => {
    expect(rerunPlan('assets')).toEqual({ target: 'assets', invalidates: ['storyboard', 'final'] });
  });
});

describe('v6.4 · pipelineProgress', () => {
  it('produced 计 ready+stale', () => {
    const st = derivePipelineStages([{ type: 'script' }, { type: 'storyboard' }]);
    const p = pipelineProgress(st);
    expect(p.total).toBe(4);
    expect(p.produced).toBe(2);
    expect(p.pct).toBe(50);
  });
});
