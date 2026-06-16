/**
 * v12.6.0(#1)— 逐秒 beat sheet → 引擎 prompt 合成 + 向后兼容。
 */
import { describe, it, expect } from 'vitest';
import { synthesizeBeatsToEnginePrompt, getEffectiveVisualPrompt, buildBeatSheetBlock } from '@/lib/writer-enhance';

const beats = [
  { ts: '0-2s', startSec: 0, endSec: 2, action: 'woman stands frozen at rainy intersection', camera: 'CU, low-angle, static', audio: 'rain ambience' },
  { ts: '2-4s', startSec: 2, endSec: 4, action: 'she suddenly lifts gaze, phone slipping', camera: 'ECU, eye-level, push-in', dialogue: '「你骗了我。」', audio: 'heartbeat' },
  { ts: '4-6s', startSec: 4, endSec: 6, action: 'phone shatters in puddle, water exploding', camera: 'ECU insert, worms-eye, static', audio: 'glass shatter SFX' },
];

describe('v12.6.0 · synthesizeBeatsToEnginePrompt', () => {
  it('kling3:保留时间码前缀 + 台词内联', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats, targetEngine: 'kling3', lens: '85mm', cameraMovement: 'push-in', shotSize: 'CU' });
    expect(out).toContain('Beat 0-2s:');
    expect(out).toContain('「你骗了我。」');
    expect(out).toContain('Camera:');           // 相机单独声明
    expect(out).toContain('Audio:');
  });

  it('veo31:剥时间码,用 then/suddenly 串联', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats, targetEngine: 'veo31' });
    expect(out).not.toContain('Beat 0-2s:');
    expect(out.toLowerCase()).toContain('then');
  });

  it('seedance2:严格 3s 窗口前缀', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats, targetEngine: 'seedance2' });
    expect(out).toContain('0-2s:');
  });

  it('negativePrompt → Avoid 追加到尾', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats, negativePrompt: '过度抖动, 多余人物' });
    expect(out).toContain('Avoid: 过度抖动');
  });

  it('相机无变化时不重复 then', () => {
    const same = [
      { ts: '0-2s', startSec: 0, endSec: 2, action: 'a', camera: 'CU, eye-level, static' },
      { ts: '2-4s', startSec: 2, endSec: 4, action: 'b', camera: 'CU, eye-level, static' },
    ];
    const out = synthesizeBeatsToEnginePrompt({ beats: same, targetEngine: 'kling3' });
    expect(out).not.toContain(', then CU, eye-level, static');
  });
});

describe('v12.6.0 · getEffectiveVisualPrompt 向后兼容', () => {
  it('有 beats → 合成结果', () => {
    const out = getEffectiveVisualPrompt({ beats, targetEngine: 'kling3' });
    expect(out).toContain('Beat 0-2s:');
  });
  it('无 beats → 回退已有 visualPrompt(旧项目不破)', () => {
    const out = getEffectiveVisualPrompt({ visualPrompt: 'slow push-in on 85mm: a woman walks' });
    expect(out).toBe('slow push-in on 85mm: a woman walks');
  });
  it('既无 beats 也无 visualPrompt → 空串', () => {
    expect(getEffectiveVisualPrompt({})).toBe('');
  });
});

describe('v12.6.0 · buildBeatSheetBlock', () => {
  it('包含核心铁律关键词', () => {
    const b = buildBeatSheetBlock();
    expect(b).toContain('beats');
    expect(b).toContain('hook');
    expect(b).toContain('temporal collapse');
  });
});
