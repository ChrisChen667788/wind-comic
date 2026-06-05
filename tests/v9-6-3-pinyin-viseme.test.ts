/**
 * v9.6.3 — lib/pinyin-viseme 单测(常用字主元音表)+ 与 lipsync-plan 集成(CJK 提保真)。
 */
import { describe, it, expect } from 'vitest';
import { commonCharVowel, COMMON_CHAR_COUNT } from '@/lib/pinyin-viseme';
import { planVisemes } from '@/lib/lipsync-plan';

describe('v9.6.3 · commonCharVowel', () => {
  it('高频字 → 正确主元音', () => {
    expect(commonCharVowel('我')).toBe('o');
    expect(commonCharVowel('啊')).toBe('a');
    expect(commonCharVowel('的')).toBe('e');
    expect(commonCharVowel('一')).toBe('i');
    expect(commonCharVowel('不')).toBe('u');
    expect(commonCharVowel('你')).toBe('i');
    expect(commonCharVowel('好')).toBe('a');
    expect(commonCharVowel('哭')).toBe('u');
    expect(commonCharVowel('笑')).toBe('a');
    expect(commonCharVowel('爱')).toBe('a');
  });
  it('未收录字 / 非汉字 → null', () => {
    expect(commonCharVowel('龘')).toBeNull();
    expect(commonCharVowel('A')).toBeNull();
    expect(commonCharVowel(' ')).toBeNull();
  });
  it('收录常用字数 ≥ 200', () => {
    expect(COMMON_CHAR_COUNT).toBeGreaterThanOrEqual(200);
  });
});

describe('v9.6.3 · planVisemes 集成提保真', () => {
  it('「你好」→ 真元音 viseme(你 i→I · 好 a→aa),不再是码点占位', () => {
    const fr = planVisemes({ shotNumber: 1, text: '你好', startSec: 0, endSec: 1 });
    expect(fr[0].viseme).toBe('I');  // 你 → i
    expect(fr[1].viseme).toBe('aa'); // 好 → a
    expect(fr[fr.length - 1].viseme).toBe('sil');
  });
  it('「我哭了」→ O / U / E', () => {
    const fr = planVisemes({ shotNumber: 1, text: '我哭了', startSec: 0, endSec: 1.5 });
    expect(fr.slice(0, 3).map((f) => f.viseme)).toEqual(['O', 'U', 'E']); // 我o 哭u 了e
  });
});
