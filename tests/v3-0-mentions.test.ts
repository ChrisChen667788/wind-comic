/**
 * v3.0 P0.1 — @-mention parser unit tests.
 *
 * 验证范围:
 *   - 中文 / 英文 / 数字 / 下划线姓名都能 capture
 *   - email user@host.com 类不算 mention (@ 前是字符)
 *   - 多个 mention 顺序保留
 *   - dedupe + 20 上限
 *   - 空 / 非 string 输入安全降级
 */

import { describe, expect, it } from 'vitest';
import { parseMentionNames, uniqueMentions } from '@/lib/mentions';

describe('v3.0 P0.1 · parseMentionNames', () => {
  it('extracts a single Chinese-name mention', () => {
    expect(parseMentionNames('@张三 你好')).toEqual(['张三']);
  });

  it('extracts a Latin username with underscore', () => {
    expect(parseMentionNames('hey @lee_w please review')).toEqual(['lee_w']);
  });

  it('extracts multiple in order', () => {
    expect(parseMentionNames('@张三 and @lee_w and @user123 thanks')).toEqual([
      '张三', 'lee_w', 'user123',
    ]);
  });

  it('does NOT match email-style @-after-letter', () => {
    expect(parseMentionNames('email me at user@example.com please')).toEqual([]);
  });

  it('matches @-after-Chinese-punctuation', () => {
    expect(parseMentionNames('好的,@张三 请确认')).toEqual(['张三']);
  });

  it('matches @-at-line-start', () => {
    expect(parseMentionNames('@first hello')).toEqual(['first']);
  });

  it('caps at 20 mentions max even if more in text', () => {
    const many = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ');
    const out = parseMentionNames(many);
    expect(out.length).toBe(20);
    expect(out[0]).toBe('user0');
    expect(out[19]).toBe('user19');
  });

  it('returns empty for empty / non-string input', () => {
    expect(parseMentionNames('')).toEqual([]);
    // @ts-expect-error - testing runtime guard
    expect(parseMentionNames(null)).toEqual([]);
    // @ts-expect-error
    expect(parseMentionNames(undefined)).toEqual([]);
    // @ts-expect-error
    expect(parseMentionNames(42)).toEqual([]);
  });

  it('stops at punctuation / whitespace after the name', () => {
    expect(parseMentionNames('@alice. thanks')).toEqual(['alice']);
    expect(parseMentionNames('@alice、@bob')).toEqual(['alice', 'bob']);
  });

  it('does not match standalone @ with no name', () => {
    expect(parseMentionNames('hi @ @ @')).toEqual([]);
  });
});

describe('v3.0 P0.1 · uniqueMentions', () => {
  it('dedupes preserving first occurrence', () => {
    expect(uniqueMentions(['张三', 'lee', '张三', 'lee', 'bob'])).toEqual([
      '张三', 'lee', 'bob',
    ]);
  });

  it('case-insensitive dedupe for Latin', () => {
    expect(uniqueMentions(['Alice', 'alice', 'ALICE'])).toEqual(['Alice']);
  });

  it('caps at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => `user${i}`);
    expect(uniqueMentions(many).length).toBe(20);
  });

  it('empty array → empty', () => {
    expect(uniqueMentions([])).toEqual([]);
  });
});
