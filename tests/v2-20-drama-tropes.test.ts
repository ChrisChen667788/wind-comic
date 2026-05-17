/**
 * v2.20 P0.2 — Drama tropes library.
 *
 * 验证:
 *   - isDramaContext 检测 genre + idea
 *   - detectTrope 命中正确 trope (重生/系统/战神/...)
 *   - shouldDefaultToVertical 与 isDramaContext 等价
 *   - buildDramaTropeBlock:
 *       - 短剧场景: 返回完整规则块 + 命中 trope 时附 hook 模板
 *       - 非短剧场景: 返回空字符串 (不污染老路径)
 *   - Writer prompt 注入 — 短剧时 getMcKeeWriterPrompt 含 漫剧模式 段, 非短剧不含
 */

import { describe, expect, it } from 'vitest';
import {
  DRAMA_TROPES,
  isDramaContext,
  detectTrope,
  shouldDefaultToVertical,
  buildDramaTropeBlock,
} from '@/lib/drama-tropes';
import { getMcKeeWriterPrompt } from '@/lib/mckee-skill';

describe('v2.20 P0.2 · isDramaContext', () => {
  it.each([
    ['短剧', undefined, true],
    ['漫剧', undefined, true],
    ['霸总', '一个总裁的故事', true],
    ['古装言情', '重生回到大学时代', true],
    ['', '系统流爽文', true],
    ['', '战神归来回家', true],
    ['', '一个少年的成长故事', false],
    ['古装', '昭和年间的医生', false],
    ['现代', '都市白领的日常', false],
    [undefined, undefined, false],
  ])('genre=%s idea=%s → %s', (genre, idea, expected) => {
    expect(isDramaContext(genre, idea)).toBe(expected);
  });
});

describe('v2.20 P0.2 · detectTrope', () => {
  it('detects 重生 trope', () => {
    const t = detectTrope('重生爽剧', '醒来发现自己回到了高考前');
    expect(t?.key).toBe('reborn');
  });

  it('detects 系统流 trope', () => {
    const t = detectTrope('系统流', '主角绑定签到系统');
    expect(t?.key).toBe('system');
  });

  it('detects 战神归来 trope', () => {
    const t = detectTrope('战神归来', '隐藏身份的兵王回家');
    expect(t?.key).toBe('reveal');
  });

  it('detects 霸总 trope', () => {
    const t = detectTrope('霸总言情', '灰姑娘遇到豪门总裁');
    expect(t?.key).toBe('rich-vs-poor');
  });

  it('returns null for non-drama context', () => {
    const t = detectTrope('科幻', '人类首次接触外星文明');
    expect(t).toBeNull();
  });

  it('handles empty inputs gracefully', () => {
    expect(detectTrope(undefined, undefined)).toBeNull();
    expect(detectTrope('', '')).toBeNull();
  });
});

describe('v2.20 P0.2 · shouldDefaultToVertical', () => {
  it('returns true for drama context', () => {
    expect(shouldDefaultToVertical('重生', undefined)).toBe(true);
    expect(shouldDefaultToVertical('短剧', undefined)).toBe(true);
  });

  it('returns false for non-drama', () => {
    expect(shouldDefaultToVertical('科幻', '太空歌剧')).toBe(false);
    expect(shouldDefaultToVertical('纪录片', '历史回顾')).toBe(false);
  });
});

describe('v2.20 P0.2 · buildDramaTropeBlock', () => {
  it('returns empty string for non-drama context', () => {
    const block = buildDramaTropeBlock('科幻', '太空冒险故事');
    expect(block).toBe('');
  });

  it('returns full rules block for drama context', () => {
    const block = buildDramaTropeBlock('短剧', '一个普通故事');
    expect(block).toContain('漫剧模式');
    expect(block).toContain('硬性规则');
    expect(block).toContain('第 1 镜必须是钩子');
    expect(block).toContain('反转密度');
    expect(block).toContain('cliffhanger');
    expect(block).toContain('反例');
    expect(block).toContain('正例');
  });

  it('includes specific trope template when matched', () => {
    const block = buildDramaTropeBlock('重生', '醒来回到大学');
    expect(block).toContain('reborn');
    expect(block).toContain('前世记忆');
    expect(block).toContain('节奏建议');
  });

  it('falls back to enumeration when no specific trope matches', () => {
    // 短剧 keyword 触发, 但 idea 没有具体 trope keyword (不命中 reborn/system/...)
    const block = buildDramaTropeBlock('漫剧', '一个故事');
    expect(block).toContain('未命中具体 trope');
    // 应列出几个示例 trope key
    expect(block).toMatch(/reborn|system|reveal|slap/);
  });
});

describe('v2.20 P0.2 · DRAMA_TROPES library integrity', () => {
  it('all tropes have non-empty required fields', () => {
    for (const t of DRAMA_TROPES) {
      expect(t.key).toBeTruthy();
      expect(t.hookCore.length).toBeGreaterThan(10);
      expect(t.shot1Visual.length).toBeGreaterThan(10);
      expect(t.shot1Dialogue.length).toBeGreaterThan(5);
      expect(t.beatPlan.length).toBeGreaterThan(20);
      expect(t.genreKeywords.length).toBeGreaterThan(0);
    }
  });

  it('all trope keys are unique', () => {
    const keys = DRAMA_TROPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('library has at least 10 tropes (full coverage of major short-drama types)', () => {
    expect(DRAMA_TROPES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('v2.20 P0.2 · getMcKeeWriterPrompt integration', () => {
  it('non-drama genre: does NOT include 漫剧模式 block', () => {
    const p = getMcKeeWriterPrompt('科幻', 'cinematic', { idea: '太空歌剧的故事' });
    expect(p).not.toContain('漫剧模式');
  });

  it('drama genre: includes 漫剧模式 block', () => {
    const p = getMcKeeWriterPrompt('重生爽剧', 'cinematic', { idea: '醒来回到过去' });
    expect(p).toContain('漫剧模式');
    expect(p).toContain('cliffhanger');
  });

  it('drama with specific trope: includes trope-specific guidance', () => {
    const p = getMcKeeWriterPrompt('系统流', 'cinematic', { idea: '主角觉醒系统' });
    expect(p).toContain('漫剧模式');
    expect(p).toContain('system'); // trope key
  });

  it('idea-only drama keyword (no genre): still triggers 漫剧 mode', () => {
    const p = getMcKeeWriterPrompt('', 'cinematic', { idea: '战神归来打脸前妻' });
    expect(p).toContain('漫剧模式');
  });
});
