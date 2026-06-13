/** v12.1.1 — 成片音频可听性判定单测(纯函数)。 */
import { describe, expect, it } from 'vitest';
import { audibilityLabel } from '@/lib/audio-health';

describe('v12.1.1 · audibilityLabel', () => {
  it('有 BGM+配音 → 有声;只 BGM / 只配音 → 有声;都无 → 静音', () => {
    expect(audibilityLabel({ hasBgm: true, hasVoiceover: true })).toMatchObject({ audible: true, sources: ['配音', '配乐'] });
    expect(audibilityLabel({ hasBgm: true }).audible).toBe(true);
    expect(audibilityLabel({ hasVoiceover: true }).audible).toBe(true);
    const silent = audibilityLabel({});
    expect(silent.audible).toBe(false);
    expect(silent.label).toContain('静音');
    expect(silent.sources).toEqual([]);
  });
});
