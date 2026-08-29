/**
 * v12.364:`老X` 是对任意年龄成年人的通称,却被判成「老年」。
 *
 * 词表里用裸字 `老` 判年龄档。实测:
 *   老陈 / 老王 / 老师 / 老板 / 老公 → **全部判成老年**
 * owner 的出租车故事里正是「司机**老陈**」(中年人)—— 会被配上老年音色。
 * `婆` 同理:「老婆」是妻子,不是老人。
 *
 * 这条与 v12.346 是同一族:**姓名启发式在中文里极易误命中**。
 * 那一版的解法是「从剧本读事实」;这一版能做的是**把启发式收紧到不说谎的程度**,
 * 判不出就不给年龄档 —— 下游有 v12.296 立的「知性别不知年龄默认青年」兜底,
 * 比瞎猜一个老年/童声稳。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { inferTraitsFromName } from '@/lib/tts-prosody';

const age = (n: string) => inferTraitsFromName(n).ageGroup;

describe('v12.364 成年人通称不得判成老年', () => {
  it.each(['老陈', '老王', '老李', '老张', '老师', '老板', '老公', '老婆', '老友'])(
    '%s 不判老年', (n) => { expect(age(n)).toBeUndefined(); },
  );
});

describe('v12.364 真正的年长仍判得出(不能为了少误判就不判了)', () => {
  it.each(['老奶奶', '老爷爷', '大爷', '大娘', '年迈的老人', '白发老者', '老太太', '花甲之年'])(
    '%s 判老年', (n) => { expect(age(n)).toBe('老年'); },
  );

  /**
   * 「老X头」是专指老年男性的称谓,与「老X」(通称)不同。
   * 第一版收紧时把它一起干掉了 —— **是 v12.288 的既有测试拦住的**。
   * 教训:收紧词表时先跑既有测试,再下结论「收紧完成」。
   */
  it.each(['老头', '老张头', '老王头'])('%s 判老年(「老X头」≠「老X」)', (n) => {
    expect(age(n)).toBe('老年');
  });

  it('老奶奶/老爷爷 的性别也要判对', () => {
    expect(inferTraitsFromName('老奶奶').gender).toBe('female');
    expect(inferTraitsFromName('老爷爷').gender).toBe('male');
  });
});

describe('v12.364 童年档', () => {
  it.each(['小孩', '娃娃', '孩童', '幼儿', '少年'])('%s 判童年', (n) => {
    expect(age(n)).toBe('童年');
  });

  it('普通人名不判年龄 —— 判不出就别猜', () => {
    for (const n of ['李长安', '柳如烟', '张天佐', '苏青瓷']) expect(age(n)).toBeUndefined();
  });
});

describe('v12.364 实现约束', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/tts-prosody.ts'), 'utf8');
  const code = src.split('\n').filter((l) => {
    const t = l.trimStart();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');

  it('年龄档词表收口成常量,两处共用(原来是两份不同的正则)', () => {
    expect(code).toMatch(/const ELDERLY_HINT = /);
    expect(code).toMatch(/const CHILD_HINT = /);
    expect((code.match(/ELDERLY_HINT/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('老年词表里不得再有裸字 `老`', () => {
    const line = code.split('\n').find((l) => l.includes('const ELDERLY_HINT')) || '';
    expect(line).not.toMatch(/\/老\||\|老\|/);
  });

  it('两处判定不再各写各的正则', () => {
    expect(code).not.toMatch(/\/老\|爷\|婆\|翁\|叟\|年迈/);
  });
});
