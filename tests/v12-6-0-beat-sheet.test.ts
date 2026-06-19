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

describe('v12.11.0 · 黄金模板字段进引擎 prompt', () => {
  const richBeats = [
    { ts: '0-3s', startSec: 0, endSec: 3, action: '双方随机对打', camera: 'MS, eye-level, handheld', mood: '冷峻压迫', characters: ['主角', '对手'], scene: '锈蚀铁笼' },
    { ts: '3-6s', startSec: 3, endSec: 6, action: '主角假动作晃开', camera: 'CU, low-angle, whip-pan', microExpression: '眼神微眯·假动作预判', speedRamp: '0.2x slow-mo on feint', mood: '蓄势' },
  ];

  it('微表情内联进对应 beat 动作', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats: richBeats, targetEngine: 'kling3' });
    expect(out).toContain('(眼神微眯·假动作预判)');
  });

  it('慢镜插针 → Timing: 带时间码', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats: richBeats, targetEngine: 'veo31' });
    expect(out).toContain('Timing:');
    expect(out).toContain('3-6s 0.2x slow-mo on feint');
  });

  it('氛围逐 beat 去重 → Mood: a → b', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats: richBeats, targetEngine: 'seedance2' });
    expect(out).toContain('Mood: 冷峻压迫 → 蓄势');
  });

  it('mustShow(镜头级) → Must show: 清单', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats: richBeats, mustShow: ['短刃停在喉结前1cm', '水渍溅起'] });
    expect(out).toContain('Must show: 短刃停在喉结前1cm, 水渍溅起');
  });

  it('无新字段时不产出空 Mood/Timing/Must show(向后兼容)', () => {
    const out = synthesizeBeatsToEnginePrompt({ beats, targetEngine: 'kling3' });
    expect(out).not.toContain('Mood:');
    expect(out).not.toContain('Timing:');
    expect(out).not.toContain('Must show:');
  });

  it('buildBeatSheetBlock 含黄金模板字段指引', () => {
    const b = buildBeatSheetBlock();
    expect(b).toContain('microExpression');
    expect(b).toContain('mustShow');
    expect(b).toContain('transition');
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
