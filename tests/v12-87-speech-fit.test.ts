/**
 * v12.87 — 台词-镜长适配:语速估算 + 自适应提速。
 */
import { describe, it, expect } from 'vitest';
import { estimateSpeechSec, fitSpeechToShot } from '@/lib/tts-prosody';

describe('v12.87 · speech fit', () => {
  it('估算:20 个中文字 ≈ 4.65s;空串 0', () => {
    const est = estimateSpeechSec('一二三四五六七八九十一二三四五六七八九十');
    expect(est).toBeGreaterThan(4.4);
    expect(est).toBeLessThan(5.0);
    expect(estimateSpeechSec('')).toBe(0);
  });

  it('说得完 → 保持情绪速度不动', () => {
    const r = fitSpeechToShot('短句', 4, 1.0);
    expect(r.speed).toBe(1.0);
    expect(r.overflow).toBe(false);
  });

  it('说不完 → 提速(≤1.3);极端仍溢出 → overflow=true', () => {
    const long = '一二三四五六七八九十'.repeat(2); // ~4.65s
    const r = fitSpeechToShot(long, 4, 1.0);       // budget 3.75s → 需 ~1.24x
    expect(r.speed).toBeGreaterThan(1.1);
    expect(r.speed).toBeLessThanOrEqual(1.3);
    expect(r.overflow).toBe(false);
    const crazy = '一二三四五六七八九十'.repeat(5); // ~11.6s 塞 3s 镜
    const r2 = fitSpeechToShot(crazy, 3, 1.0);
    expect(r2.speed).toBe(1.3);
    expect(r2.overflow).toBe(true);
  });

  it('不降速拖戏(baseSpeed 是下限)', () => {
    expect(fitSpeechToShot('短', 10, 1.12).speed).toBe(1.12);
  });
});
