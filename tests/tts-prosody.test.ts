import { describe, it, expect } from 'vitest';
import { deriveProsody } from '@/lib/tts-prosody';

describe('deriveProsody', () => {
  it('returns neutral when no emotion and no temperature', () => {
    const p = deriveProsody({});
    expect(p.speed).toBe(1.0);
    expect(p.pitch).toBe(0);
    expect(p.vol).toBe(0.85);
  });

  it('slows down and lowers pitch for 悲伤', () => {
    const p = deriveProsody({ emotion: '悲伤' });
    expect(p.speed).toBeLessThan(1.0);
    expect(p.pitch).toBeLessThan(0);
  });

  it('speeds up and raises pitch for 愤怒', () => {
    const p = deriveProsody({ emotion: '愤怒' });
    expect(p.speed).toBeGreaterThan(1.0);
    expect(p.pitch).toBeGreaterThan(0);
  });

  it('emotionTemperature -10 pushes baseline deeper toward valley', () => {
    const neutral = deriveProsody({ emotion: '悲伤', emotionTemperature: 0 });
    const valley = deriveProsody({ emotion: '悲伤', emotionTemperature: -10 });
    expect(valley.speed).toBeLessThan(neutral.speed);
    expect(valley.pitch).toBeLessThan(neutral.pitch);
    expect(valley.vol).toBeLessThan(neutral.vol);
  });

  it('emotionTemperature +10 pushes baseline higher toward peak', () => {
    const neutral = deriveProsody({ emotion: '激动', emotionTemperature: 0 });
    const peak = deriveProsody({ emotion: '激动', emotionTemperature: 10 });
    expect(peak.speed).toBeGreaterThan(neutral.speed);
    expect(peak.pitch).toBeGreaterThan(neutral.pitch);
    expect(peak.vol).toBeGreaterThan(neutral.vol);
  });

  it('clamps speed/pitch/vol to MiniMax-valid range', () => {
    // 极端情况:狂喜(基线已经拉高) + temperature=+10 仍不能超标
    const p = deriveProsody({ emotion: '狂喜', emotionTemperature: 10 });
    expect(p.speed).toBeLessThanOrEqual(2.0);
    expect(p.speed).toBeGreaterThanOrEqual(0.5);
    expect(p.pitch).toBeLessThanOrEqual(12);
    expect(p.pitch).toBeGreaterThanOrEqual(-12);
    expect(p.vol).toBeLessThanOrEqual(1.0);
    expect(p.vol).toBeGreaterThanOrEqual(0.3);
  });

  it('returns integer pitch', () => {
    const p = deriveProsody({ emotion: '悲伤', emotionTemperature: -5 });
    expect(Number.isInteger(p.pitch)).toBe(true);
  });

  it('different emotions produce distinguishable prosody', () => {
    const sad = deriveProsody({ emotion: '悲伤', emotionTemperature: -5 });
    const angry = deriveProsody({ emotion: '愤怒', emotionTemperature: 5 });
    // 两者 speed/pitch 应明显不同
    expect(Math.abs(sad.speed - angry.speed)).toBeGreaterThan(0.1);
    expect(Math.abs(sad.pitch - angry.pitch)).toBeGreaterThanOrEqual(3);
  });
});
