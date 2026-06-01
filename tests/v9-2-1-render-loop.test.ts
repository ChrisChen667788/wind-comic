/**
 * v9.2.1 — lib/render-loop 单测 (渲染循环模型: 每镜状态归约 + 进度/ETA 聚合).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveShotRenderStates, summarizeRenderLoop, isRenderLoopSettled, formatEta,
  type ShotLike, type AssetLike,
} from '@/lib/render-loop';

const SHOTS: ShotLike[] = [
  { shotNumber: 1, emotion: '紧张' },
  { shotNumber: 2 },
  { shotNumber: 3 },
];

describe('v9.2.1 · deriveShotRenderStates', () => {
  it('无任何资产 → 全 pending / storyboard / attempts 0', () => {
    const st = deriveShotRenderStates({ shots: SHOTS });
    expect(st).toHaveLength(3);
    expect(st.every((s) => s.status === 'pending' && s.stage === 'storyboard' && s.attempts === 0)).toBe(true);
    expect(st[0].name).toBe('Shot 1 (紧张)'); // emotion 进名称
  });

  it('分镜行无图 → storyboard active; 分镜有图无视频 → video active', () => {
    const storyboardAssets: AssetLike[] = [
      { shot_number: 1, version: 1, media_urls: '[]' },                 // 无图 → storyboard active
      { shot_number: 2, version: 2, media_urls: ['https://x/sb2.png'] }, // 有图 → video active
    ];
    const st = deriveShotRenderStates({ shots: SHOTS, storyboardAssets });
    expect(st[0]).toMatchObject({ status: 'active', stage: 'storyboard', attempts: 1 });
    expect(st[1]).toMatchObject({ status: 'active', stage: 'video', attempts: 2 });
    expect(st[2]).toMatchObject({ status: 'pending', stage: 'storyboard' });
  });

  it('视频有媒体 → done + 耗时 (updated-created) + attempts=version', () => {
    const videoAssets: AssetLike[] = [
      { shot_number: 1, version: 3, persistent_url: 'https://x/v1.mp4', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:42Z' },
    ];
    const st = deriveShotRenderStates({ shots: SHOTS, videoAssets });
    expect(st[0]).toMatchObject({ status: 'done', stage: 'video', attempts: 3, durationMs: 42000 });
  });

  it('资产 data 带 error → failed (优先于 media)', () => {
    const videoAssets: AssetLike[] = [
      { shot_number: 1, version: 2, persistent_url: 'https://x/v1.mp4', data: JSON.stringify({ error: 'engine 502' }) },
    ];
    const st = deriveShotRenderStates({ shots: SHOTS, videoAssets });
    expect(st[0]).toMatchObject({ status: 'failed', stage: 'video', attempts: 2 });
  });

  it('shotNumber 缺省按序号兜底; 裸串 media_urls 也算有图', () => {
    const shots: ShotLike[] = [{}, {}];
    const videoAssets: AssetLike[] = [{ shotNumber: 2, mediaUrls: ['https://x/v.mp4'] }];
    const st = deriveShotRenderStates({ shots, videoAssets });
    expect(st[0].shotNumber).toBe(1);
    expect(st[1]).toMatchObject({ shotNumber: 2, status: 'done' });
  });
});

describe('v9.2.1 · summarizeRenderLoop', () => {
  it('计数 + percent + 平均耗时 + ETA = 平均 × 剩余', () => {
    const st = deriveShotRenderStates({
      shots: SHOTS,
      videoAssets: [
        { shot_number: 1, persistent_url: 'a', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:20Z' }, // done 20s
      ],
      storyboardAssets: [
        { shot_number: 2, media_urls: ['sb'] }, // video active
      ],
    });
    const sum = summarizeRenderLoop(st);
    expect(sum).toMatchObject({ total: 3, done: 1, active: 1, pending: 1, failed: 0, percent: 33 });
    expect(sum.avgShotMs).toBe(20000);
    expect(sum.etaMs).toBe(20000 * 2); // 平均 20s × 剩余 2
  });

  it('有剩余但无耗时样本 → ETA null; 全完成 → ETA 0', () => {
    const noDur = summarizeRenderLoop([
      { shotNumber: 1, name: 'a', stage: 'storyboard', status: 'pending', attempts: 0 },
    ]);
    expect(noDur.etaMs).toBeNull();
    expect(noDur.percent).toBe(0);

    const allDone = summarizeRenderLoop([
      { shotNumber: 1, name: 'a', stage: 'video', status: 'done', attempts: 1, durationMs: 1000 },
    ]);
    expect(allDone.etaMs).toBe(0);
    expect(allDone.percent).toBe(100);
    expect(isRenderLoopSettled(allDone)).toBe(true);
  });

  it('failed 计入但不算 done; 仍有 failed/done 而无 active/pending → settled', () => {
    const sum = summarizeRenderLoop([
      { shotNumber: 1, name: 'a', stage: 'video', status: 'done', attempts: 1, durationMs: 5000 },
      { shotNumber: 2, name: 'b', stage: 'video', status: 'failed', attempts: 3 },
    ]);
    expect(sum).toMatchObject({ done: 1, failed: 1, active: 0, pending: 0, percent: 50, etaMs: 0 });
    expect(isRenderLoopSettled(sum)).toBe(true);
  });

  it('空 → 全 0, percent 0, ETA 0, settled', () => {
    const sum = summarizeRenderLoop([]);
    expect(sum).toMatchObject({ total: 0, done: 0, percent: 0, etaMs: 0 });
    expect(isRenderLoopSettled(sum)).toBe(true);
  });
});

describe('v9.2.1 · formatEta', () => {
  it('null → — · ≤0 → 完成 · 秒 · 分秒', () => {
    expect(formatEta(null)).toBe('—');
    expect(formatEta(0)).toBe('完成');
    expect(formatEta(45_000)).toBe('~45s');
    expect(formatEta(130_000)).toBe('~2m10s');
    expect(formatEta(120_000)).toBe('~2m');
  });
});
