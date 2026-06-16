/**
 * v12.3.2 — 封面标题烧入(阶段二十二):buildCoverDrawtext / 字体候选 / 路径转义 纯逻辑。
 */
import { describe, it, expect } from 'vitest';
import { buildCoverDrawtext, coverFontCandidates, escapeDrawtextPath } from '@/lib/cover-title-burn';
import { getTitleSafeArea } from '@/lib/cover-candidates';

const safe = getTitleSafeArea();

describe('v12.3.2 · buildCoverDrawtext', () => {
  it('含字体/文本文件/居中/安全区顶部/底框', () => {
    const f = buildCoverDrawtext({ width: 1080, height: 1920, safeArea: safe, fontFile: '/f/PingFang.ttc', textfile: '/t/title.txt' });
    expect(f).toMatch(/^drawtext=/);
    expect(f).toContain("fontfile='/f/PingFang.ttc'");
    expect(f).toContain("textfile='/t/title.txt'");
    expect(f).toContain('x=(w-text_w)/2');               // 水平居中
    expect(f).toContain(`y=(h*${safe.topPct}/100)`);     // 安全区顶部(表达式)
    expect(f).toContain('box=1');
    expect(f).toMatch(/fontsize=\d+/);
  });

  it('字号随图高 ~4.5%(1920 → ~86)', () => {
    const f = buildCoverDrawtext({ width: 1080, height: 1920, safeArea: safe, fontFile: 'x', textfile: 't' });
    const m = f.match(/fontsize=(\d+)/);
    expect(Number(m?.[1])).toBe(Math.round(1920 * 0.045));
  });

  it('escapeDrawtextPath 转义冒号/反斜杠/单引号', () => {
    expect(escapeDrawtextPath("/a:b'c\\d")).toBe("/a\\:b\\'c\\\\d");
  });

  it('coverFontCandidates:env 优先 + 含 macOS/Linux CJK 字体', () => {
    const prev = process.env.COVER_FONT_FILE;
    process.env.COVER_FONT_FILE = '/my/font.ttf';
    const list = coverFontCandidates();
    expect(list[0]).toBe('/my/font.ttf');
    expect(list.some((p) => p.includes('PingFang'))).toBe(true);
    expect(list.some((p) => p.includes('NotoSansCJK'))).toBe(true);
    if (prev === undefined) delete process.env.COVER_FONT_FILE; else process.env.COVER_FONT_FILE = prev;
  });
});
