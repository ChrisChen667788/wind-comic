/**
 * v12.365:80% 触发的「可能冲突」警告,等于没有警告。
 *
 * `shot-edit-merge` 的冲突提示设计是对的 —— **只报不判,交用户确认**,
 * 而且要求 note 与原描述**同时**命中,天然抑制了大部分误报
 * (实测:一句与属性无关的指令「让她转过身来」→ **0% 误报**)。
 *
 * 但 note 侧用了裸字,所以误报**可达且严重**。拿 120 条真实分镜描述实测:
 *   「让他**冷**静下来」→ **96/120(80%)** 报色调冲突 —— 说的是神态
 *   「他**冷**笑一声」   → 80% 同上
 *   「给她加一把**雨**伞」→ 25% 报天气冲突 —— 是道具
 *
 * 80% 触发的警告会被无视,**真冲突反而跟着一起被无视** —— 这才是它的危害。
 *
 * 修法:**只收紧 note 侧到属性语义**。original 侧保持宽松 ——
 * 冲突要求两边同时命中,note 侧收紧就够了,original 宽一点不会产生误报。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mergeShotEdit } from '@/lib/shot-edit-merge';

/** 一条典型的、同时含色调与天气词的原描述。 */
const ORIGINAL = '黄昏土院,暖橘色夕阳斜照,细雨初歇,中景,柳如烟坐在竹椅上';

const conflicts = (note: string) => mergeShotEdit(ORIGINAL, note).conflicts;

describe('v12.365 神态/道具不得被当成属性冲突', () => {
  it.each([
    ['让他冷静下来,别那么激动', '冷静=神态'],
    ['他冷笑一声', '冷笑=神态'],
    ['她的态度很冷淡', '冷淡=神态'],
    ['给她加一把雨伞', '雨伞=道具'],
    ['他穿着雨衣', '雨衣=道具'],
    ['让气氛温暖一点,人物更亲近', '温暖=氛围而非调色'],
  ])('%s 不报冲突(%s)', (note) => {
    expect(conflicts(note)).toEqual([]);
  });
});

describe('v12.365 真属性意图仍然报得出(不能为了少误报就不报了)', () => {
  it.each([
    ['把整体调成暖色调', '色调'],
    ['改成冷光,更疏离', '色调'],
    ['降低饱和度', '色调'],
    ['改成黑白', '色调'],
    ['改成下雨的夜晚', '天气'],
    ['外面在下雪', '天气'],
    ['改成特写', '景别'],
    ['改成清晨', '时间'],
  ])('%s 报出「%s」冲突', (note, kind) => {
    expect(conflicts(note)).toContain(kind);
  });
});

describe('v12.365 与属性无关的指令本来就不报(既有设计,别改坏)', () => {
  it.each(['让她转过身来', '镜头推近一点她的手', '加一句台词'])('%s 不报冲突', (note) => {
    // 「镜头推近」不含景别词;「加一句台词」与四类属性都无关
    expect(conflicts(note)).toEqual([]);
  });
});

describe('v12.365 实现约束', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'lib/shot-edit-merge.ts'), 'utf8');
  const rules = src.slice(src.indexOf('const CONFLICT_RULES'), src.indexOf('export interface ShotEditMerge'));
  const code = rules.split('\n').filter((l) => {
    const t = l.trimStart();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');

  it('note 侧不再有裸字 `冷` / `暖` / `雨`', () => {
    const noteLines = code.split('\n').filter((l) => l.includes('note:'));
    for (const l of noteLines) {
      expect(l).not.toMatch(/\/暖\|冷\|/);
      expect(l).not.toMatch(/\/雨\|雪\|雾\|/);
    }
  });

  it('original 侧**保持宽松** —— 收紧它没必要,还会漏掉真冲突', () => {
    expect(code).toMatch(/original: \/暖\|冷\|橘/);
    expect(code).toMatch(/original: \/雨\|雪\|雾/);
  });

  it('把「只收紧 note 侧」的理由写在代码里', () => {
    expect(rules).toMatch(/note 侧收紧就够了/);
  });
});
