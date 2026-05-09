/**
 * Tests for v2.16 P0.1 — duration/resolution → tier mapping
 */

import { describe, it, expect } from 'vitest';
import {
  requiredTierForVideoDuration,
  requiredTierForResolution,
  tierRank,
} from '@/lib/plan-gate';

describe('requiredTierForVideoDuration', () => {
  it('5s → free (Minimax)', () => {
    expect(requiredTierForVideoDuration(5)).toBe('free');
  });
  it('6s → free (Minimax)', () => {
    expect(requiredTierForVideoDuration(6)).toBe('free');
  });
  it('10s → creator (Kling Master)', () => {
    expect(requiredTierForVideoDuration(10)).toBe('creator');
  });
  it('15s → pro (Vidu Q3 Pro, ¥0.3/sec)', () => {
    expect(requiredTierForVideoDuration(15)).toBe('pro');
  });
  it('any duration > 15 → pro (no enterprise-only above 15)', () => {
    expect(requiredTierForVideoDuration(30)).toBe('pro');
  });
  it('edge: 7s falls into creator band (>6 → creator)', () => {
    expect(requiredTierForVideoDuration(7)).toBe('creator');
  });
});

describe('requiredTierForResolution', () => {
  it('720p → free', () => {
    expect(requiredTierForResolution('720p')).toBe('free');
  });
  it('1080p → creator', () => {
    expect(requiredTierForResolution('1080p')).toBe('creator');
  });
  it('2160p (4K) → pro', () => {
    expect(requiredTierForResolution('2160p')).toBe('pro');
  });
});

describe('tier rank ordering (sanity)', () => {
  it('free < creator < pro < enterprise', () => {
    expect(tierRank('free')).toBeLessThan(tierRank('creator'));
    expect(tierRank('creator')).toBeLessThan(tierRank('pro'));
    expect(tierRank('pro')).toBeLessThan(tierRank('enterprise'));
  });
  it('unknown tier → 0 (treated as free)', () => {
    expect(tierRank('garbage')).toBe(0);
    expect(tierRank(null)).toBe(0);
    expect(tierRank(undefined)).toBe(0);
  });
});

// Matrix: 4 tiers × 4 durations → expected_allow
const ALLOW_MATRIX: Array<[string, number, boolean]> = [
  // free user
  ['free', 5, true],
  ['free', 6, true],
  ['free', 10, false],
  ['free', 15, false],
  // creator user
  ['creator', 5, true],
  ['creator', 6, true],
  ['creator', 10, true],
  ['creator', 15, false],
  // pro user
  ['pro', 5, true],
  ['pro', 6, true],
  ['pro', 10, true],
  ['pro', 15, true],
  // enterprise user
  ['enterprise', 5, true],
  ['enterprise', 6, true],
  ['enterprise', 10, true],
  ['enterprise', 15, true],
];

describe('tier × duration allow matrix', () => {
  for (const [tier, duration, expected] of ALLOW_MATRIX) {
    it(`${tier} user @ ${duration}s → ${expected ? 'allowed' : 'blocked'}`, () => {
      const required = requiredTierForVideoDuration(duration);
      const allow = tierRank(tier) >= tierRank(required);
      expect(allow).toBe(expected);
    });
  }
});
