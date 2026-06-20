/**
 * v12.14.0 — 视频横竖屏规则:比例规范化 + 引擎 size 映射。
 */
import { describe, it, expect } from 'vitest';
import { normalizeVideoAspect, veoSizeFromAspect, isVerticalAspect } from '@/lib/video-aspect';

describe('v12.14.0 · normalizeVideoAspect', () => {
  it('支持的三种原样返回', () => {
    expect(normalizeVideoAspect('9:16')).toBe('9:16');
    expect(normalizeVideoAspect('1:1')).toBe('1:1');
    expect(normalizeVideoAspect('16:9')).toBe('16:9');
  });
  it('其它比例/空值 → 就近归 16:9', () => {
    expect(normalizeVideoAspect('2.35:1')).toBe('16:9');
    expect(normalizeVideoAspect('4:3')).toBe('16:9');
    expect(normalizeVideoAspect(undefined)).toBe('16:9');
    expect(normalizeVideoAspect('')).toBe('16:9');
  });
});

describe('v12.14.0 · veoSizeFromAspect', () => {
  it('竖屏 720x1280、方 1024、横屏 1280x720', () => {
    expect(veoSizeFromAspect('9:16')).toBe('720x1280');
    expect(veoSizeFromAspect('1:1')).toBe('1024x1024');
    expect(veoSizeFromAspect('16:9')).toBe('1280x720');
    expect(veoSizeFromAspect(undefined)).toBe('1280x720'); // 默认横屏
  });
});

describe('v12.14.0 · isVerticalAspect', () => {
  it('仅 9:16 为竖屏', () => {
    expect(isVerticalAspect('9:16')).toBe(true);
    expect(isVerticalAspect('16:9')).toBe(false);
    expect(isVerticalAspect('1:1')).toBe(false);
  });
});
