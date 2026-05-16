/**
 * v2.19 P0.1 — Prompt slim regression guard.
 *
 * Background: Minimax image-01 enforces a 1500-char hard limit on the `prompt`
 * field. Before v2.19 the assembled character/scene image prompt was 1400-1700
 * chars, forcing minimax.service.ts to truncate at 1400 (commit b9d34ba). That
 * truncation cut off the final `--ar 16:9 --s 250 --no ...` tokens, silently
 * degrading aspect ratio + negative-prompt enforcement.
 *
 * This file pins a budget so future prompt additions can't quietly blow past
 * Minimax's cap again.
 */
import { describe, expect, it } from 'vitest';
import {
  getCharacterVisualPrompt,
  getSceneVisualPrompt,
} from '@/lib/mckee-skill';
import {
  enhanceCharacterPromptSeedance,
  enhanceScenePromptSeedance,
  styleAnchorBlock,
} from '@/lib/seedance-enhance';

// Minimax image-01 hard limit; we want headroom for per-call additions.
const MINIMAX_HARD_LIMIT = 1500;
const SAFE_BUDGET = 1200; // leaves 300 chars headroom for orchestrator-level appends

describe('v2.19 P0.1 · prompt slim — character image prompt budget', () => {
  it('typical character prompt stays under 1200 chars', () => {
    const base = getCharacterVisualPrompt(
      '陈淮安',
      '一位身负血仇的青年剑客,沉默寡言但眼神锐利,身手矫健,在江湖中以独行侠的身份游走',
      '身高约180cm,瘦削挺拔,五官冷峻,剑眉星目,左眉骨有一道浅疤,长发束起以墨色发带固定,穿玄色劲装腰间挂一柄黑鞘长剑',
      'cinematic, 35mm, soft amber light, hand-painted illustration',
      {
        genre: '古装武侠',
        visual: {
          age: '26',
          headShape: 'oval',
          bodyType: 'lean athletic',
          skinTone: 'pale',
          face: 'sharp jawline, scar above left brow',
          hair: 'long black hair tied with dark cloth band',
          outfit: 'black martial robe with silver embroidery',
          props: 'black-sheathed long sword at waist',
          colorScheme: 'black silver smoke gray',
          silhouette: 'slim vertical figure with sword at hip',
        },
      },
    );
    const enhanced = enhanceCharacterPromptSeedance(base, '陈淮安')
      + '. ' + styleAnchorBlock('cinematic, 35mm, soft amber light, hand-painted illustration');
    expect(enhanced.length).toBeLessThan(SAFE_BUDGET);
    expect(enhanced.length).toBeLessThan(MINIMAX_HARD_LIMIT);
  });

  it('worst-case verbose character prompt still fits within Minimax 1500 cap', () => {
    // simulate the most verbose case: long description + appearance + full visual struct
    const longDesc = '这是一个非常详细的角色描述'.repeat(20); // ~280 chars
    const longApp = '具体外貌细节包含'.repeat(30); // ~360 chars
    const base = getCharacterVisualPrompt('TestHero', longDesc, longApp, 'cinematic style with painterly brushwork', {
      genre: '古装历史',
      visual: {
        age: '30',
        headShape: 'square',
        bodyType: 'muscular',
        skinTone: 'tan',
        face: 'strong features',
        hair: 'short cropped black',
        outfit: 'ornate hanfu silk robe with dragon embroidery',
        props: 'jade pendant and bronze sword',
        colorScheme: 'crimson gold',
        silhouette: 'broad shouldered',
      },
    });
    const enhanced = enhanceCharacterPromptSeedance(base, 'TestHero')
      + '. ' + styleAnchorBlock('cinematic style with painterly brushwork');
    // Must always fit within Minimax's hard limit even with verbose inputs.
    expect(enhanced.length).toBeLessThan(MINIMAX_HARD_LIMIT);
  });

  it('character prompt preserves required markers', () => {
    const enhanced = enhanceCharacterPromptSeedance(
      getCharacterVisualPrompt('Hero', 'brave', 'tall', 'cinematic'),
      'Hero',
    );
    expect(enhanced).toContain('--ar');
    expect(enhanced).toContain('turnaround');
    // negative prompts must survive slimming for modern setting
    expect(enhanced).toContain('Character ID lock');
  });
});

describe('v2.19 P0.1 · prompt slim — scene image prompt budget', () => {
  it('typical scene prompt stays under 1200 chars', () => {
    const base = getSceneVisualPrompt(
      '昏黄油灯下的明代客栈大堂,木质横梁悬挂着褪色酒幌,长条桌椅斑驳,墙角堆着几个尘封的酒坛,空气里浮动着尘埃',
      '明代客栈大堂',
      'cinematic, 35mm, soft amber light, hand-painted illustration',
      {
        timeOfDay: 'evening',
        weather: 'clear',
        lighting: 'warm tungsten oil lamps with shadow falloff',
        architecture: 'Ming dynasty wooden inn with carved beams',
        atmosphere: 'dusty quiet anticipation',
        colorPalette: 'amber sepia smoke gray',
      },
    );
    const enhanced = enhanceScenePromptSeedance(base)
      + '. ' + styleAnchorBlock('cinematic, 35mm, soft amber light, hand-painted illustration');
    expect(enhanced.length).toBeLessThan(SAFE_BUDGET);
  });

  it('scene prompt preserves --no flags for people exclusion', () => {
    const enhanced = enhanceScenePromptSeedance(
      getSceneVisualPrompt('cliff at sunset', 'ocean cliff', 'cinematic'),
    );
    expect(enhanced).toContain('--no people');
    expect(enhanced).toContain('--no person');
    expect(enhanced).toContain('--ar');
    expect(enhanced).toContain('unpopulated');
  });
});
