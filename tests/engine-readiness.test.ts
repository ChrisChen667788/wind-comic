import { describe, it, expect } from 'vitest';
import { computeReadiness } from '@/lib/engine-readiness';

describe('computeReadiness', () => {
  it('图像+视频都配 → 非演示模式', () => {
    const r = computeReadiness({ image: true, video: true, tts: true, lipsync: true });
    expect(r.demoMode).toBe(false);
    expect(r.readyCount).toBe(4);
    expect(r.total).toBe(4);
  });

  it('缺视频 → 演示模式', () => {
    expect(computeReadiness({ image: true, video: false, tts: true, lipsync: true }).demoMode).toBe(true);
  });

  it('缺图像 → 演示模式', () => {
    expect(computeReadiness({ image: false, video: true, tts: true, lipsync: true }).demoMode).toBe(true);
  });

  it('全缺(clone 即跑)→ 演示模式;但 lipsync 仍标 ready(零配置)', () => {
    const r = computeReadiness({ image: false, video: false, tts: false, lipsync: true });
    expect(r.demoMode).toBe(true);
    expect(r.engines.find((e) => e.kind === 'lipsync')?.ready).toBe(true);
    expect(r.readyCount).toBe(1);
  });

  it('每个引擎都有 label + enableHint', () => {
    const r = computeReadiness({ image: false, video: false, tts: false, lipsync: false });
    expect(r.engines).toHaveLength(4);
    for (const e of r.engines) {
      expect(e.label).toBeTruthy();
      expect(e.enableHint).toBeTruthy();
    }
  });
});
