/**
 * v2.20 P0.1 — Style Bible Frame.
 *
 * 验证:
 *   - buildStyleBiblePrompt 注入 styleKeywords + genre mood words + aspect
 *   - buildStyleBiblePrompt 始终包含 "no people / no faces" 防被画成具体场景
 *   - normalizeAspect 容忍各种写法
 *   - prependStyleAnchor 排在首位 + dedupe + 拒非 http
 *   - HybridOrchestrator.setAspect 校验输入, 拒非法格式
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildStyleBiblePrompt,
  normalizeAspect,
  prependStyleAnchor,
} from '@/lib/style-bible';

vi.mock('@/lib/db', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
  now: () => new Date().toISOString(),
}));

describe('v2.20 P0.1 · buildStyleBiblePrompt', () => {
  it('embeds styleKeywords + aspect + mood', () => {
    const p = buildStyleBiblePrompt({
      styleKeywords: 'cinematic 3D donghua, octane render',
      genre: '古装武侠',
      aspect: '9:16',
      moodHint: 'shadowy duel night',
    });
    expect(p).toContain('cinematic 3D donghua, octane render');
    // 古装 mood words 用气氛词 (no-people 帧, 不含服饰词)
    expect(p).toMatch(/amber|ink-wash|jade|crimson/);
    expect(p).toContain('--ar 9:16');
    expect(p).toContain('shadowy duel night');
  });

  it('always includes no-people negative prompts (frame is abstract look bible)', () => {
    const p = buildStyleBiblePrompt({ styleKeywords: 'cinematic', aspect: '16:9' });
    expect(p).toContain('--no people');
    expect(p).toContain('--no face');
    expect(p).toContain('environmental abstract composition');
  });

  it('falls back to default style when empty', () => {
    const p = buildStyleBiblePrompt({ styleKeywords: '', aspect: '16:9' });
    expect(p).toContain('cinematic');
    expect(p).toContain('35mm');
  });

  it('mood words differ per genre', () => {
    const ancient = buildStyleBiblePrompt({ styleKeywords: 'x', genre: '古装' });
    const cyber = buildStyleBiblePrompt({ styleKeywords: 'x', genre: '赛博' });
    const horror = buildStyleBiblePrompt({ styleKeywords: 'x', genre: '恐怖' });
    expect(ancient).toContain('amber');
    expect(cyber).toContain('neon');
    expect(horror).toContain('steel-blue');
    // 各 genre 之间互不污染
    expect(ancient).not.toContain('neon');
    expect(cyber).not.toContain('amber');
  });

  it('truncates moodHint to ≤80 chars', () => {
    const longMood = 'A'.repeat(200);
    const p = buildStyleBiblePrompt({ styleKeywords: 'x', moodHint: longMood });
    // 应只含 80 个 A (然后被截断)
    const matched = p.match(/A{50,}/);
    expect(matched).toBeTruthy();
    expect(matched![0].length).toBeLessThanOrEqual(80);
  });

  it('respects 9:16 vertical drama aspect', () => {
    const p = buildStyleBiblePrompt({ styleKeywords: 'x', aspect: '9:16' });
    expect(p).toContain('--ar 9:16');
    expect(p).not.toContain('--ar 16:9');
  });
});

describe('v2.20 P0.1 · normalizeAspect', () => {
  it.each([
    ['16:9', '16:9'],
    ['9:16', '9:16'],
    ['1:1', '1:1'],
    ['2.35:1', '16:9'],     // decimal denom — fails regex, default
    ['vertical', '9:16'],
    ['9x16', '9:16'],
    ['9-16', '9:16'],
    ['square', '1:1'],
    ['1x1', '1:1'],
    ['cinematic', '2.35:1'],
    ['', '16:9'],
    [undefined, '16:9'],
    ['invalid', '16:9'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAspect(input as string | undefined)).toBe(expected);
  });
});

describe('v2.20 P0.1 · prependStyleAnchor', () => {
  it('puts http style anchor at index 0', () => {
    const out = prependStyleAnchor('https://anchor.example/a.png', ['https://b.png', 'https://c.png']);
    expect(out[0]).toBe('https://anchor.example/a.png');
    expect(out).toContain('https://b.png');
    expect(out).toContain('https://c.png');
  });

  it('dedups when anchor already in array', () => {
    const out = prependStyleAnchor('https://a.png', ['https://b.png', 'https://a.png', 'https://c.png']);
    expect(out).toEqual(['https://a.png', 'https://b.png', 'https://c.png']);
    expect(out.length).toBe(3);
  });

  it('no-op when anchor already at index 0', () => {
    const refs = ['https://a.png', 'https://b.png'];
    const out = prependStyleAnchor('https://a.png', refs);
    expect(out).toBe(refs);
  });

  it('rejects data: URI (cannot send to remote image API)', () => {
    const out = prependStyleAnchor('data:image/png;base64,xxx', ['https://b.png']);
    expect(out).toEqual(['https://b.png']);
  });

  it('rejects empty / undefined anchor', () => {
    const refs = ['https://b.png'];
    expect(prependStyleAnchor(undefined, refs)).toBe(refs);
    expect(prependStyleAnchor('', refs)).toBe(refs);
  });

  it('handles empty refs array', () => {
    const out = prependStyleAnchor('https://a.png', []);
    expect(out).toEqual(['https://a.png']);
  });
});

describe('v2.20 P0.1 · HybridOrchestrator.setAspect', () => {
  it('accepts valid N:N format', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setAspect('9:16');
    expect((o as any).aspect).toBe('9:16');
    o.setAspect('1:1');
    expect((o as any).aspect).toBe('1:1');
  });

  it('rejects non-ratio strings', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    expect((o as any).aspect).toBe('16:9'); // default
    o.setAspect('vertical');
    expect((o as any).aspect).toBe('16:9'); // unchanged
    o.setAspect('');
    expect((o as any).aspect).toBe('16:9');
    // @ts-expect-error - test runtime guard
    o.setAspect(null);
    expect((o as any).aspect).toBe('16:9');
  });
});
