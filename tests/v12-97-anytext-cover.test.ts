/**
 * v12.97 — AnyText 封面:payload 构造 + 响应解析。
 */
import { describe, it, expect } from 'vitest';
import { buildAnyTextPayload, parseAnyTextResponse } from '@/lib/anytext-cover';

describe('v12.97 · anytext-cover', () => {
  it('payload:文字双引号内嵌(AnyText 约定)+ texts + 画幅尺寸', () => {
    const p = buildAnyTextPayload({ title: '一夜焕新', aspectRatio: '9:16' });
    expect(p.prompt).toContain('"一夜焕新"');
    expect(p.texts).toEqual(['一夜焕新']);
    expect(p.width).toBe(720);
    expect(p.height).toBe(1280);
    expect(buildAnyTextPayload({ title: 'x', aspectRatio: '16:9' }).width).toBe(1280);
  });

  it('title 截断 ≤16 字;scenePrompt 可自定', () => {
    const p = buildAnyTextPayload({ title: '一二三四五六七八九十一二三四五六七八', scenePrompt: 'coffee poster' });
    expect(p.texts[0].length).toBe(16);
    expect(p.prompt).toContain('coffee poster');
  });

  it('响应解析:容忍多种字段形态;非法 null', () => {
    expect(parseAnyTextResponse({ imageUrl: 'https://x/a.png' })).toBe('https://x/a.png');
    expect(parseAnyTextResponse({ images: ['https://x/b.png'] })).toBe('https://x/b.png');
    expect(parseAnyTextResponse({ image_base64: 'AAAA' })).toBe('data:image/png;base64,AAAA');
    expect(parseAnyTextResponse({ output: { image_url: 'https://x/c.png' } })).toBe('https://x/c.png');
    expect(parseAnyTextResponse({ url: 'ftp://nope' })).toBeNull();
    expect(parseAnyTextResponse(null)).toBeNull();
  });
});
