/**
 * v12.2.3 — 跨集复用:确定性文本相似打分(无 embedding 时的兜底地板)。
 * (路由 + UI 推荐由 e2e 覆盖;此处锁纯打分逻辑。)
 */
import { describe, it, expect } from 'vitest';
import { textMatchScore } from '@/lib/asset-embedding';

describe('v12.2.3 · textMatchScore(确定性文本相似)', () => {
  it('名归一精确 → 1', () => {
    expect(textMatchScore('林小满', { name: '林小满' })).toBe(1);
    expect(textMatchScore('Alice, Chen', { name: 'alice chen' })).toBe(1); // 归一后相等
  });
  it('名子串(双向,≥2 字符)→ 0.7', () => {
    expect(textMatchScore('林小满', { name: '小满' })).toBe(0.7);  // query 含 name
    expect(textMatchScore('小满', { name: '林小满' })).toBe(0.7);  // name 含 query
  });
  it('无名命中 → 走描述/anchors 词覆盖(≤0.6)', () => {
    const s = textMatchScore('银发剑客', { name: '无关', description: '一个银发的少年剑客', visualAnchors: ['银色长发'] });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(0.6);
  });
  it('完全无关 → 0', () => {
    expect(textMatchScore('赛博朋克机器人', { name: '古风少女', description: '汉服' })).toBe(0);
  });
  it('空 query / 空资产 → 0(不崩)', () => {
    expect(textMatchScore('', { name: '林小满' })).toBe(0);
    expect(textMatchScore('林小满', {})).toBe(0);
  });
  it('精确 > 子串 > 词覆盖(优先级单调)', () => {
    const exact = textMatchScore('林小满', { name: '林小满' });
    const substr = textMatchScore('林小满', { name: '小满' });
    const token = textMatchScore('银发剑客', { name: 'x', description: '银发剑客登场' });
    expect(exact).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(token);
  });
});
