/**
 * v6.1.3 — 生成前就绪度评估单测.
 */

import { describe, it, expect } from 'vitest';
import { assessPromptReadiness, CAMEO_PASS, type ReadinessInput } from '@/lib/prompt-readiness';

const base: ReadinessInput = {
  compiledPrompt: '', usedKinds: [], unresolvedCount: 0,
  hasFace: false, refs: { image: 0, audio: 0, video: 0 }, cameoScore: null,
};

describe('v6.1.3 · assessPromptReadiness', () => {
  it('空创意 → 低就绪度', () => {
    const r = assessPromptReadiness(base);
    expect(r.level).toBe('low');
    expect(r.checks.find((c) => c.id === 'content')!.ok).toBe(false);
  });

  it('内容 + 角色 + 风格 + 全匹配 → 高就绪度', () => {
    const r = assessPromptReadiness({
      ...base,
      compiledPrompt: '一个关于时间旅行者的爱情故事, 长镜头推进, 黄昏色调氛围',
      usedKinds: ['character', 'style'],
      unresolvedCount: 0,
    });
    expect(r.level).toBe('high');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.checks.find((c) => c.id === 'character')!.ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'style')!.ok).toBe(true);
  });

  it('hasFace 顶替 @character 也算锁定主角', () => {
    const r = assessPromptReadiness({ ...base, compiledPrompt: '十二字十二字十二字十二字', hasFace: true, cameoScore: 90 });
    expect(r.checks.find((c) => c.id === 'character')!.ok).toBe(true);
  });

  it('未匹配引用扣分', () => {
    const ok = assessPromptReadiness({ ...base, compiledPrompt: '足够长的剧情内容描述文字', usedKinds: ['character'], unresolvedCount: 0 });
    const bad = assessPromptReadiness({ ...base, compiledPrompt: '足够长的剧情内容描述文字', usedKinds: ['character'], unresolvedCount: 2 });
    expect(bad.score).toBeLessThan(ok.score);
    expect(bad.checks.find((c) => c.id === 'resolved')!.ok).toBe(false);
  });

  it('cameo 检查只在有脸时出现, 且按 75 阈值', () => {
    const noFace = assessPromptReadiness({ ...base, compiledPrompt: 'x'.repeat(30) });
    expect(noFace.checks.some((c) => c.id === 'cameo')).toBe(false);

    const lowFace = assessPromptReadiness({ ...base, compiledPrompt: 'x'.repeat(30), hasFace: true, cameoScore: CAMEO_PASS - 1 });
    expect(lowFace.checks.find((c) => c.id === 'cameo')!.ok).toBe(false);

    const goodFace = assessPromptReadiness({ ...base, compiledPrompt: 'x'.repeat(30), hasFace: true, cameoScore: CAMEO_PASS });
    expect(goodFace.checks.find((c) => c.id === 'cameo')!.ok).toBe(true);
  });

  it('多模态参考加分项', () => {
    const r = assessPromptReadiness({ ...base, compiledPrompt: 'x'.repeat(30), refs: { image: 1, audio: 0, video: 0 } });
    expect(r.checks.find((c) => c.id === 'refs')!.ok).toBe(true);
  });
});
