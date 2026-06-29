/**
 * v12.50 — 结构化片尾卡(CTA 文字走 ffmpeg drawtext,根治模型烤乱码)。
 * 纯模块 lib/end-card:布局随画布缩放 + filter 串组装 + 路径转义。
 */
import { describe, it, expect } from 'vitest';
import { endCardLayout, escapeDrawtextPath, buildEndCardVf } from '@/lib/end-card';

describe('v12.50 · end-card 纯函数', () => {
  it('布局随画布缩放:竖屏字号按高度算、横屏更小', () => {
    const v = endCardLayout(720, 1280);  // 竖屏
    const h = endCardLayout(1280, 720);  // 横屏
    expect(v.titleSize).toBeGreaterThan(0);
    expect(v.sloganSize).toBeGreaterThan(0);
    expect(v.titleSize).toBeGreaterThan(v.sloganSize); // 主标比副标大
    // 竖屏 1280 高 × 0.058 ≈ 74;横屏 720 高 × 0.095 ≈ 68
    expect(v.titleSize).toBe(Math.round(1280 * 0.058));
    expect(h.titleSize).toBe(Math.round(720 * 0.095));
  });

  it('escapeDrawtextPath:转义冒号(Win 盘符)与反斜杠', () => {
    expect(escapeDrawtextPath('C:\\fonts\\a.ttc')).toBe('C\\:/fonts/a.ttc');
    expect(escapeDrawtextPath('/System/Fonts/STHeiti Light.ttc')).toBe('/System/Fonts/STHeiti Light.ttc');
  });

  it('buildEndCardVf:文字走 textfile(绝不内联中文)、字体单引号包裹、含点缀线与 format', () => {
    const vf = buildEndCardVf({
      w: 720, h: 1280, fontFile: '/f/STHeiti Light.ttc',
      titleFile: '/tmp/title.txt', sloganFile: '/tmp/slogan.txt', bg: 'blur',
    });
    expect(vf).toContain("textfile='/tmp/title.txt'");
    expect(vf).toContain("textfile='/tmp/slogan.txt'");
    expect(vf).toContain("fontfile='/f/STHeiti Light.ttc'");
    expect(vf).toContain('drawbox=');          // 玫瑰点缀线
    expect(vf).toContain('gblur=sigma=16');     // blur 背景
    expect(vf).toContain('crop=720:1280');      // 放大裁满
    expect(vf.endsWith('format=yuv420p')).toBe(true);
    expect(vf).not.toMatch(/:text=/);           // 没有内联 :text= 参数(只用 textfile,杜绝中文转义/乱码)
  });

  it('bg=solid:不 scale/blur 背景(纯色卡),仍可叠字', () => {
    const vf = buildEndCardVf({ w: 1280, h: 720, fontFile: '/f.ttc', titleFile: '/t.txt', bg: 'solid' });
    expect(vf).not.toContain('gblur');
    expect(vf).not.toContain('crop=');
    expect(vf).toContain("textfile='/t.txt'");
  });

  it('只给 slogan 不给 title:只渲副标', () => {
    const vf = buildEndCardVf({ w: 720, h: 1280, fontFile: '/f.ttc', sloganFile: '/s.txt', bg: 'blur' });
    expect(vf).toContain("textfile='/s.txt'");
    expect((vf.match(/drawtext=/g) || []).length).toBe(1);
  });
});
