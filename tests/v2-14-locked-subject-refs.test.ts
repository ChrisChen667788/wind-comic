/**
 * Tests for v2.14 P0.1 — getLockedSubjectReferences()
 *
 * 验证 orchestrator 把 lockedCharacters 转成 Minimax S2V-01 期望的
 * subjectReferences 数组格式 (filter 空 imageUrl + cap 3 + 字段映射)。
 */

import { describe, it, expect } from 'vitest';
import { HybridOrchestrator } from '@/services/hybrid-orchestrator';

describe('HybridOrchestrator.getLockedSubjectReferences (v2.14 P0.1)', () => {
  it('returns [] when no locked characters', () => {
    const o = new HybridOrchestrator();
    expect(o.getLockedSubjectReferences()).toEqual([]);
  });

  it('maps lockedCharacters to {type, imageUrl, name} S2V format', () => {
    const o = new HybridOrchestrator();
    o.setLockedCharacters([
      { name: '阿凯', role: 'lead', cw: 125, imageUrl: 'http://x/a.png' },
      { name: '小白', role: 'antagonist', cw: 125, imageUrl: 'http://x/b.png' },
    ]);
    const refs = o.getLockedSubjectReferences();
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ type: 'character', imageUrl: 'http://x/a.png', name: '阿凯' });
    expect(refs[1]).toEqual({ type: 'character', imageUrl: 'http://x/b.png', name: '小白' });
  });

  it('filters out entries with empty imageUrl', () => {
    const o = new HybridOrchestrator();
    o.setLockedCharacters([
      { name: 'A', role: 'lead', cw: 100, imageUrl: 'http://x/a.png' },
      { name: 'B', role: 'lead', cw: 100, imageUrl: '' }, // setLockedCharacters 已过滤, 这里是双保险
    ]);
    const refs = o.getLockedSubjectReferences();
    expect(refs.every((r) => r.imageUrl.length > 0)).toBe(true);
  });

  it('caps to 3 entries (S2V-01 hard limit)', () => {
    const o = new HybridOrchestrator();
    // setLockedCharacters 自身就 slice(3), 但 getLockedSubjectReferences 也再 slice 一次保险
    o.setLockedCharacters([
      { name: 'A', role: 'lead', cw: 100, imageUrl: 'http://x/a.png' },
      { name: 'B', role: 'lead', cw: 100, imageUrl: 'http://x/b.png' },
      { name: 'C', role: 'supporting', cw: 80, imageUrl: 'http://x/c.png' },
      { name: 'D', role: 'cameo', cw: 60, imageUrl: 'http://x/d.png' },
    ]);
    expect(o.getLockedSubjectReferences().length).toBeLessThanOrEqual(3);
  });

  it('all entries have type=character (Minimax requires this for character subjects)', () => {
    const o = new HybridOrchestrator();
    o.setLockedCharacters([
      { name: 'A', role: 'lead', cw: 100, imageUrl: 'http://x/a.png' },
    ]);
    expect(o.getLockedSubjectReferences()[0].type).toBe('character');
  });
});
