import { describe, it, expect } from 'vitest';
import {
  matchLockedCharactersInShot,
  pickConsistencyRefs,
  type LockedCharacter,
} from '@/lib/consistency-policy';

const lc = (name: string, role: LockedCharacter['role'], cw: number, imageUrl: string): LockedCharacter => ({
  name, role, cw, imageUrl,
});

describe('matchLockedCharactersInShot (Phase 2)', () => {
  const A = lc('李长安', 'lead', 125, 'http://x/A.png');
  const B = lc('柳如烟', 'antagonist', 125, 'http://x/B.png');
  const C = lc('混混', 'cameo', 80, 'http://x/C.png');

  it('returns empty when shot has no characters', () => {
    expect(matchLockedCharactersInShot([], [A, B])).toEqual([]);
    expect(matchLockedCharactersInShot(undefined, [A, B])).toEqual([]);
  });

  it('returns empty when no locked characters', () => {
    expect(matchLockedCharactersInShot(['李长安'], [])).toEqual([]);
    expect(matchLockedCharactersInShot(['李长安'], undefined)).toEqual([]);
  });

  it('matches exact names', () => {
    const out = matchLockedCharactersInShot(['李长安'], [A, B, C]);
    expect(out).toEqual([A]);
  });

  it('matches case- and punctuation-insensitive (normalized)', () => {
    const a2 = lc('  李长安 ', 'lead', 125, 'http://x/A.png');
    const out = matchLockedCharactersInShot(['李长安(主角)'], [a2, B]);
    // shotName "李长安(主角)" -> normalized "李长安主角"; lockedName "李长安" -> "李长安"
    // substring match: "李长安主角" includes "李长安" -> hit
    expect(out).toHaveLength(1);
    expect(out[0].imageUrl).toBe('http://x/A.png');
  });

  it('preserves shot-order when multiple match', () => {
    const out = matchLockedCharactersInShot(['柳如烟', '李长安'], [A, B]);
    expect(out.map(c => c.name)).toEqual(['柳如烟', '李长安']);
  });

  it('does NOT match a single-char locked name (false-positive guard)', () => {
    const X = lc('安', 'lead', 125, 'http://x/X.png'); // 1 字, 不应触发模糊匹配
    expect(matchLockedCharactersInShot(['李长安', '柳如烟'], [X])).toEqual([]);
  });

  it('each locked character matches at most once across a shot', () => {
    // 同一镜头里"李长安"重复出现不会重复返回
    const out = matchLockedCharactersInShot(['李长安', '李长安(笑)'], [A, B]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(A);
  });
});

describe('pickConsistencyRefs (Phase 2 multi-character routing)', () => {
  const A = lc('李长安', 'lead', 125, 'http://x/A.png');
  const B = lc('柳如烟', 'antagonist', 125, 'http://x/B.png');
  const C = lc('混混', 'cameo', 80, 'http://x/C.png');

  it('matched-locked beats primaryCharacterRefLocked (Phase 2 priority)', () => {
    const pick = pickConsistencyRefs({
      primaryCharacterRef: 'http://x/PRIMARY.png',
      primaryCharacterRefLocked: true,
      shotCharacterNames: ['柳如烟'],
      lockedCharacters: [A, B, C],
    });
    expect(pick.cref).toBe('http://x/B.png');
    expect(pick.reason.crefSource).toBe('matched-locked');
    expect(pick.reason.matchedLockedName).toBe('柳如烟');
    expect(pick.cw).toBe(125); // B.cw = 125 (antagonist)
    expect(pick.reason.cwTier).toBe('matched-locked');
  });

  it('uses per-character cw (not global 125) for cameo role', () => {
    const pick = pickConsistencyRefs({
      shotCharacterNames: ['混混'],
      lockedCharacters: [A, B, C],
    });
    expect(pick.cref).toBe('http://x/C.png');
    expect(pick.cw).toBe(80); // C.cw = 80 (cameo) — NOT 125
    expect(pick.reason.cwTier).toBe('matched-locked');
  });

  it('extraCrefs holds the additional matches when multiple locked chars are in same shot', () => {
    const pick = pickConsistencyRefs({
      shotCharacterNames: ['李长安', '柳如烟', '混混'],
      lockedCharacters: [A, B, C],
    });
    expect(pick.cref).toBe('http://x/A.png');
    expect(pick.extraCrefs).toEqual(['http://x/B.png', 'http://x/C.png']);
    expect(pick.reason.crefSource).toBe('matched-locked');
  });

  it('falls back to user-locked primary when no shot character matches lockedCharacters', () => {
    const pick = pickConsistencyRefs({
      primaryCharacterRef: 'http://x/PRIMARY.png',
      primaryCharacterRefLocked: true,
      shotCharacterNames: ['路人甲'], // 不在 lockedCharacters 里
      lockedCharacters: [A, B],
    });
    expect(pick.cref).toBe('http://x/PRIMARY.png');
    expect(pick.reason.crefSource).toBe('user-locked');
    expect(pick.cw).toBe(125);
    expect(pick.extraCrefs).toBeUndefined();
  });

  it('falls back to charUrlMap when no primary and no locked match', () => {
    const charUrlMap = new Map([['路人甲', 'http://x/PG.png']]);
    const pick = pickConsistencyRefs({
      shotCharacterNames: ['路人甲'],
      charUrlMap,
      lockedCharacters: [A, B], // 都不匹配
    });
    expect(pick.cref).toBe('http://x/PG.png');
    expect(pick.reason.crefSource).toBe('character-sheet');
    expect(pick.extraCrefs).toBeUndefined();
  });

  it('clamps invalid cw values into MJ legal range [25,125]', () => {
    const X = lc('狂角色', 'lead', 999 as any, 'http://x/X.png');
    const Y = lc('弱角色', 'cameo', -50 as any, 'http://x/Y.png');
    expect(pickConsistencyRefs({ shotCharacterNames: ['狂角色'], lockedCharacters: [X] }).cw).toBe(125);
    expect(pickConsistencyRefs({ shotCharacterNames: ['弱角色'], lockedCharacters: [Y] }).cw).toBe(25);
  });
});
