/**
 * Tests for lib/prompt-templates (v2.13.4)
 *
 * 锁住"用户输入 → 专业级提示词增强"的关键决策。
 */

import { describe, it, expect } from 'vitest';
import {
  enhanceIdeaForCreation,
  enhancePolishRequirement,
  enhanceU2VMotionPrompt,
  enhanceChatMessage,
} from '@/lib/prompt-templates';

describe('enhanceIdeaForCreation', () => {
  it('appends 制作要求 with three-act structure to any idea', () => {
    const out = enhanceIdeaForCreation('暮色城市中的旅人');
    expect(out.enhancedIdea).toContain('暮色城市中的旅人');
    expect(out.enhancedIdea).toContain('制作要求');
    expect(out.enhancedIdea).toContain('三幕结构');
    expect(out.enhancedIdea).toContain('影视化语言');
  });

  it('detects 古装 genre and locks it in the suffix', () => {
    const out = enhanceIdeaForCreation('唐朝长安城的剑客复仇故事');
    expect(out.enhancedIdea).toMatch(/题材锁定[:：].*古装/);
    expect(out.hint).toContain('古装');
  });

  it('detects 言情 genre and locks it', () => {
    const out = enhanceIdeaForCreation('咖啡馆偶遇,一见钟情后的误会');
    expect(out.enhancedIdea).toMatch(/题材锁定[:：].*言情/);
  });

  it('combines multiple genres', () => {
    const out = enhanceIdeaForCreation('赛博朋克世界里的悬疑破案故事,女主是个程序员');
    expect(out.hint).toMatch(/科幻|悬疑/);
    expect(out.enhancedIdea).toContain('题材锁定');
  });

  it('detects emotional tone (基调)', () => {
    const out = enhanceIdeaForCreation('一段温暖的治愈系小故事');
    expect(out.enhancedIdea).toMatch(/情绪基调[:：].*治愈/);
    expect(out.hint).toContain('治愈');
  });

  it('flags too-short ideas in hint', () => {
    const out = enhanceIdeaForCreation('一个旅人');
    expect(out.hint).toContain('简短');
  });

  it('does NOT flag too-short for ≥25 char ideas', () => {
    const out = enhanceIdeaForCreation('一段在唐朝长安城上演的剑客复仇悲情故事,主角失去妹妹后踏上江湖');
    expect(out.hint).not.toContain('简短');
  });
});

describe('enhancePolishRequirement', () => {
  it('returns empty string for empty input', () => {
    expect(enhancePolishRequirement('')).toBe('');
    expect(enhancePolishRequirement('   ')).toBe('');
  });

  it('expands "强化视觉感" with do/don\'t list', () => {
    const out = enhancePolishRequirement('强化视觉感');
    expect(out).toContain('视觉强化');
    expect(out).toContain('光源方向');
    expect(out).toMatch(/不改|不删|不动/);
  });

  it('expands "把第三人称改成第一人称"', () => {
    const out = enhancePolishRequirement('把第三人称改成第一人称');
    expect(out).toContain('人称改写');
    expect(out).toContain('第一人称');
    expect(out).toMatch(/对白保持原样|内心独白/);
  });

  it('expands "节奏加快"', () => {
    const out = enhancePolishRequirement('节奏加快');
    expect(out).toContain('节奏加快');
    expect(out).toContain('低张力');
  });

  it('expands "克制 / 留白" style', () => {
    const out = enhancePolishRequirement('风格更克制一点');
    expect(out).toContain('风格克制');
    expect(out).toContain('暗示');
  });

  it('passes through unrecognized requirements with strict-execution note', () => {
    const out = enhancePolishRequirement('请把所有角色名字改成英文');
    expect(out).toContain('用户特别要求');
    expect(out).toContain('英文');
    expect(out).toMatch(/不允许改情节走向|不允许删核心对白/);
  });
});

describe('enhanceU2VMotionPrompt', () => {
  it('returns empty for empty input', () => {
    expect(enhanceU2VMotionPrompt('')).toBe('');
  });

  it('adds camera move when missing', () => {
    const out = enhanceU2VMotionPrompt('人物缓缓抬头');
    expect(out).toContain('Camera:');
    expect(out).toMatch(/push.in|zoom/);
  });

  it('does NOT duplicate Camera term when user already specified one', () => {
    const out = enhanceU2VMotionPrompt('Slow push-in on the actor as he turns around');
    // Camera 词已在用户输入里, 我们的 additions 里 Camera 行应被跳过
    const cameraMatches = (out.match(/Camera:/gi) || []).length;
    expect(cameraMatches).toBeLessThanOrEqual(0); // 我们当前实现不加, 因为 push.in 已命中
  });

  it('always appends realism + anti-artifact guard', () => {
    const out = enhanceU2VMotionPrompt('人物缓缓抬头');
    expect(out).toContain('photographic realism');
    expect(out).toContain('Avoid');
  });
});

describe('enhanceChatMessage', () => {
  it('wraps message with project context when title given', () => {
    const out = enhanceChatMessage('帮我看下分镜 3 怎么改', '雨夜重逢');
    expect(out).toContain('雨夜重逢');
    expect(out).toContain('用户:帮我看下分镜 3 怎么改');
    expect(out).toContain('剧本/角色/分镜/视频');
  });

  it('uses generic context when no project title', () => {
    const out = enhanceChatMessage('我想问一下');
    expect(out).toContain('Wind Comic 创作工坊');
    expect(out).toContain('用户:我想问一下');
  });

  it('returns empty for empty input', () => {
    expect(enhanceChatMessage('')).toBe('');
  });
});
