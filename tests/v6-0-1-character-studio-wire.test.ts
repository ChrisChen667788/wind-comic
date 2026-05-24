/**
 * v6.0.1 — 角色资产中心接线 (character_library ↔ CharacterProfile) 单测.
 */

import { describe, it, expect } from 'vitest';
import {
  traitsFromLibraryRow,
  buildProfileFromLibraryRow,
  serializeProfile,
  parseProfile,
} from '@/lib/character-studio';

describe('v6.0.1 · traitsFromLibraryRow', () => {
  it('appearance 优先取 appearance 字段', () => {
    const t = traitsFromLibraryRow({ name: '林小满', appearance: '黑长直发', description: 'desc' });
    expect(t.name).toBe('林小满');
    expect(t.appearance).toBe('黑长直发');
    expect(t.gender).toBe('unknown');     // 库里无结构化性别 → 不瞎猜
    expect(t.confident).toBe(false);
  });
  it('appearance 为空时回退 description', () => {
    const t = traitsFromLibraryRow({ name: 'X', appearance: '', description: '一位老兵' });
    expect(t.appearance).toBe('一位老兵');
  });
  it('都为空 → 未明示', () => {
    expect(traitsFromLibraryRow({ name: 'X' }).appearance).toBe('未明示');
  });
});

describe('v6.0.1 · buildProfileFromLibraryRow', () => {
  it('从库行出完整档案 (小传/音色/四视图)', () => {
    const p = buildProfileFromLibraryRow({ name: '林小满', appearance: '黑长直发, 瓜子脸', style_keywords: '国风动漫' });
    expect(p.name).toBe('林小满');
    expect(p.turnaround).toHaveLength(4);
    expect(p.voiceId).toBeTruthy();
    expect(p.bio).toContain('林小满');
    // style 缺省取行的 style_keywords
    expect(p.turnaround[0].prompt).toContain('国风动漫');
    // appearance 进了 turnaround 身份锚
    expect(p.turnaround[0].prompt).toContain('黑长直发');
  });
  it('opts.style 覆盖行的 style_keywords', () => {
    const p = buildProfileFromLibraryRow({ name: 'X', style_keywords: '国风动漫' }, { style: 'cinematic realism' });
    expect(p.turnaround[0].prompt).toContain('cinematic realism');
    expect(p.turnaround[0].prompt).not.toContain('国风动漫');
  });
});

describe('v6.0.1 · serializeProfile / parseProfile', () => {
  it('round-trip 一致', () => {
    const p = buildProfileFromLibraryRow({ name: '甲', appearance: 'a' });
    const back = parseProfile(serializeProfile(p));
    expect(back).toEqual(p);
  });
  it('坏数据返回 null 不抛', () => {
    expect(parseProfile('not json')).toBeNull();
    expect(parseProfile('{}')).toBeNull();           // 缺 name/turnaround
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile('')).toBeNull();
  });
});
