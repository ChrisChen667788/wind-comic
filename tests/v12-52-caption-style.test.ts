/**
 * v12.52 — 字幕风格预设(调研 embedded-captions / 社媒电商实践,封装进 composer)。
 * clean 必须与改造前 composer 硬编码 force_style 逐字符一致 → 旧链路零回归。
 */
import { describe, it, expect } from 'vitest';
import { buildCaptionForceStyle, pickCaptionPreset } from '@/lib/caption-style';

describe('v12.52 · 字幕风格预设', () => {
  it('clean 与旧硬编码逐字符一致(零回归)', () => {
    expect(buildCaptionForceStyle('clean', 'PingFang SC')).toBe(
      'FontName=PingFang SC,FontSize=24,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,Alignment=2,MarginV=40',
    );
  });

  it('缺省/未知预设兜底 clean', () => {
    expect(buildCaptionForceStyle('social', 'F')).not.toBe(buildCaptionForceStyle('clean', 'F'));
    // @ts-expect-error 故意传非法值测兜底
    expect(buildCaptionForceStyle('nope', 'F')).toBe(buildCaptionForceStyle('clean', 'F'));
  });

  it('social:加粗 + 比 clean 大 + 竖屏抬更高(避 CTA/UI)', () => {
    const v = buildCaptionForceStyle('social', 'F', { vertical: true });
    const h = buildCaptionForceStyle('social', 'F', { vertical: false });
    expect(v).toContain('Bold=1');
    expect(v).toContain('FontSize=30');     // 竖屏更大
    expect(h).toContain('FontSize=26');
    expect(v).toContain('MarginV=120');     // 竖屏抬高
    expect(h).toContain('MarginV=56');
  });

  it('bold:特大粗体重描边、无阴影', () => {
    const b = buildCaptionForceStyle('bold', 'F', { vertical: true });
    expect(b).toContain('Bold=1');
    expect(b).toContain('FontSize=32');
    expect(b).toContain('Shadow=0');
    expect(b).toContain('Outline=4');
  });

  it('pickCaptionPreset:商业题材 karaoke(v12.56 默认升级),否则 clean', () => {
    expect(pickCaptionPreset(true)).toBe('karaoke');
    expect(pickCaptionPreset(false)).toBe('clean');
  });
});
