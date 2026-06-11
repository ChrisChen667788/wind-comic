import { describe, it, expect } from 'vitest';
import { computeReadiness, computeLevel } from '@/lib/engine-readiness';

const F = (over: Partial<Record<'llm' | 'image' | 'video' | 'tts' | 'lipsync', boolean>>) => ({
  llm: false, image: false, video: false, tts: false, lipsync: true, ...over,
});

describe('computeReadiness(v10.5.1 五引擎)', () => {
  it('图像+视频都配 → 非演示模式;total=5', () => {
    const r = computeReadiness(F({ llm: true, image: true, video: true, tts: true }));
    expect(r.demoMode).toBe(false);
    expect(r.readyCount).toBe(5);
    expect(r.total).toBe(5);
  });

  it('缺视频/缺图像 → 演示模式(demoMode 判定不变)', () => {
    expect(computeReadiness(F({ image: true })).demoMode).toBe(true);
    expect(computeReadiness(F({ video: true })).demoMode).toBe(true);
  });

  it('全缺(clone 即跑)→ 演示模式;lipsync 仍 ready(零配置)', () => {
    const r = computeReadiness(F({}));
    expect(r.demoMode).toBe(true);
    expect(r.engines.find((e) => e.kind === 'lipsync')?.ready).toBe(true);
    expect(r.readyCount).toBe(1);
  });

  it('每个引擎都有 label + enableHint;llm 在首位(一把 key 推荐顺序)', () => {
    const r = computeReadiness(F({}));
    expect(r.engines).toHaveLength(5);
    expect(r.engines[0].kind).toBe('llm');
    for (const e of r.engines) {
      expect(e.label).toBeTruthy();
      expect(e.enableHint).toBeTruthy();
    }
  });
});

describe('v10.5.1 · 一把 key 分级(computeLevel)', () => {
  it('五级阶梯', () => {
    expect(computeLevel(F({}))).toBe('none');
    expect(computeLevel(F({ llm: true }))).toBe('script');
    expect(computeLevel(F({ llm: true, image: true }))).toBe('visual');
    expect(computeLevel(F({ llm: true, image: true, video: true }))).toBe('film');
    expect(computeLevel(F({ image: true }))).toBe('media-only'); // 有画面没剧本
    expect(computeLevel(F({ video: true }))).toBe('media-only');
  });
});

describe('v10.5.1 · 环节真/占位明细(验收:只配 LLM → 剧本/分镜规划/审计全真)', () => {
  it('仅 LLM:script/storyboardPlan/audit 全真;画面/视频/配音为示意', () => {
    const r = computeReadiness(F({ llm: true }));
    expect(r.level).toBe('script');
    const real = Object.fromEntries(r.stages.map((s) => [s.key, s.real]));
    expect(real).toMatchObject({
      script: true, storyboardPlan: true, audit: true,        // 全真 ✓
      storyboardImage: false, shotVideo: false, tts: false,    // 如实标示意
      lipsync: true, assemble: true,                           // 本地恒真
    });
    // 占位环节必须给出补齐引擎(UI 指引用)
    expect(r.stages.find((s) => s.key === 'shotVideo')?.dependsOn).toBe('video');
  });

  it('全配齐:8 个环节全真,levelLabel=全链真实成片', () => {
    const r = computeReadiness(F({ llm: true, image: true, video: true, tts: true }));
    expect(r.stages.every((s) => s.real)).toBe(true);
    expect(r.levelLabel).toContain('全链真实成片');
  });

  it('media-only:画面真但剧本如实标模板', () => {
    const r = computeReadiness(F({ image: true, video: true }));
    expect(r.level).toBe('media-only');
    expect(r.stages.find((s) => s.key === 'script')?.real).toBe(false);
    expect(r.stages.find((s) => s.key === 'storyboardImage')?.real).toBe(true);
  });
});
