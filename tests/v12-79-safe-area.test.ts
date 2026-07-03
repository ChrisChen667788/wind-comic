/**
 * v12.79 — 平台安全区字幕避让。
 */
import { describe, it, expect } from 'vitest';
import { captionSafeBottomRatio } from '@/lib/caption-style';
import { buildKaraokeAss } from '@/lib/ass-karaoke';

describe('v12.79 · 平台安全区', () => {
  it('竖屏:douyin 0.20 / xiaohongshu 0.17 / none 缺省 0.10', () => {
    expect(captionSafeBottomRatio('douyin', true)).toBe(0.20);
    expect(captionSafeBottomRatio('xiaohongshu', true)).toBe(0.17);
    expect(captionSafeBottomRatio('none', true)).toBe(0.10);
    expect(captionSafeBottomRatio(undefined, true)).toBe(0.10);
  });

  it('横屏不避让(信息流 UI 是竖屏问题)', () => {
    expect(captionSafeBottomRatio('douyin', false)).toBe(0.10);
  });

  it('marginVRatio 透传进 ASS(douyin 1280*0.20=256)', () => {
    const ass = buildKaraokeAss([{ text: '你好', startSec: 0, durSec: 2 }], { w: 720, h: 1280, fontName: 'F', vertical: true, marginVRatio: 0.20 });
    expect(ass).toMatch(/,2,40,40,256,1$/m);
    const dflt = buildKaraokeAss([{ text: '你好', startSec: 0, durSec: 2 }], { w: 720, h: 1280, fontName: 'F', vertical: true });
    expect(dflt).toMatch(/,2,40,40,128,1$/m); // 缺省 10%H 零回归
  });
});
