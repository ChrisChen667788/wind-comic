/**
 * v12.74 — 品牌色主题化:hex 规范化 + 卡片点缀线/副标着色。
 */
import { describe, it, expect } from 'vitest';
import { normalizeHexColor, buildEndCardVf } from '@/lib/end-card';

describe('v12.74 · 品牌色', () => {
  it('normalizeHexColor:#/0x/裸 hex 均可;非法 null', () => {
    expect(normalizeHexColor('#ff5533')).toBe('0xFF5533');
    expect(normalizeHexColor('0xAABBCC')).toBe('0xAABBCC');
    expect(normalizeHexColor('00c2ff')).toBe('0x00C2FF');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('#fff')).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
  });

  it('accentColor 生效:点缀线与副标都用品牌色', () => {
    const vf = buildEndCardVf({ w: 720, h: 1280, fontFile: '/f.ttc', sloganFile: '/s.txt', bg: 'blur', accentColor: '#00C2FF' });
    expect(vf).toContain('color=0x00C2FF@0.9');
    expect(vf).toContain('fontcolor=0x00C2FF');
  });

  it('缺省玫瑰(零回归):线 0xE8A0AE、副标 0xF3D9DE', () => {
    const vf = buildEndCardVf({ w: 720, h: 1280, fontFile: '/f.ttc', sloganFile: '/s.txt', bg: 'blur' });
    expect(vf).toContain('color=0xE8A0AE@0.9');
    expect(vf).toContain('fontcolor=0xF3D9DE');
  });
});
