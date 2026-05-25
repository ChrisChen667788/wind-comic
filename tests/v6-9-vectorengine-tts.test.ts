/**
 * v6.9 — vectorengine TTS voice 映射 单测.
 */

import { describe, it, expect } from 'vitest';
import { mapVoiceToOpenAI } from '@/lib/tts-providers/vectorengine-tts';

describe('v6.9 · mapVoiceToOpenAI', () => {
  it('女声 → nova', () => {
    expect(mapVoiceToOpenAI('narrator_female_cn')).toBe('nova');
    expect(mapVoiceToOpenAI('young_female_cn')).toBe('nova');
    expect(mapVoiceToOpenAI('女主角')).toBe('nova');
  });
  it('男声 → onyx', () => {
    expect(mapVoiceToOpenAI('narrator_male_cn')).toBe('onyx');
    expect(mapVoiceToOpenAI('young_male_cn')).toBe('onyx');
    expect(mapVoiceToOpenAI('男配')).toBe('onyx');
  });
  it('未知/空 → alloy 兜底', () => {
    expect(mapVoiceToOpenAI('')).toBe('alloy');
    expect(mapVoiceToOpenAI(undefined)).toBe('alloy');
    expect(mapVoiceToOpenAI('robot')).toBe('alloy');
  });
});
