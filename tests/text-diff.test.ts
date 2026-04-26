/**
 * lib/text-diff 单元测试。
 *
 * 为什么要测 diff:
 *   润色页的"对比视图"直接依赖 diffLines 输出的行语义,
 *   如果 LCS/pairing 回归就会导致用户看到错位的 add/del,
 *   甚至把没改的行显示成"改了"。用这套 fixture 锁死。
 *
 * 覆盖:
 *   1. 完全相同 → 全部 same
 *   2. 纯新增 → 全部 add
 *   3. 纯删除 → 全部 del
 *   4. 局部修改 → 连续 del+add 自动配对成 mod
 *   5. \r\n / \r 换行归一化
 *   6. diffStats 的 changed 计数 + changeRatio
 *   7. 空输入边界
 */

import { describe, it, expect } from 'vitest';
import { diffLines, diffStats } from '@/lib/text-diff';

describe('diffLines', () => {
  it('identical → all same, no changed lines', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc');
    expect(rows).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
    expect(diffStats(rows).changed).toBe(0);
  });

  it('only additions → all add rows', () => {
    const rows = diffLines('', 'x\ny');
    // 空字符串 split 出 [''], 所以会有一行空 same 或 empty behavior —
    // 关键: 新增内容必须作为 add 出现
    const adds = rows.filter((r) => r.kind === 'add');
    expect(adds.map((r: any) => r.text)).toEqual(['x', 'y']);
  });

  it('only deletions → all del rows', () => {
    const rows = diffLines('x\ny', '');
    const dels = rows.filter((r) => r.kind === 'del');
    expect(dels.map((r: any) => r.text)).toEqual(['x', 'y']);
  });

  it('consecutive del + add get paired into mod rows', () => {
    // 原: a/b/c  新: a/B/c → 只有 b→B 一行改动
    const rows = diffLines('a\nb\nc', 'a\nB\nc');
    expect(rows).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'mod', left: 'b', right: 'B' },
      { kind: 'same', text: 'c' },
    ]);
    const s = diffStats(rows);
    expect(s.mod).toBe(1);
    expect(s.changed).toBe(1);
  });

  it('uneven del/add runs keep leftovers as del or add', () => {
    // 原: a/b/c/d  新: a/X/Y/Z/d → b,c 删, X/Y/Z 加, 会生成 2 mod + 1 add
    const rows = diffLines('a\nb\nc\nd', 'a\nX\nY\nZ\nd');
    expect(rows[0]).toEqual({ kind: 'same', text: 'a' });
    expect(rows[rows.length - 1]).toEqual({ kind: 'same', text: 'd' });
    const mods = rows.filter((r) => r.kind === 'mod');
    const adds = rows.filter((r) => r.kind === 'add');
    expect(mods.length).toBe(2);
    expect(adds.length).toBe(1);
  });

  it('normalizes \\r\\n and \\r to \\n', () => {
    const a = 'line1\r\nline2\r\nline3';
    const b = 'line1\nline2\nline3';
    const rows = diffLines(a, b);
    // 归一化后应完全一致, 全是 same
    expect(rows.every((r) => r.kind === 'same')).toBe(true);
    expect(rows.length).toBe(3);
  });

  it('handles empty-empty as zero rows (no phantom blank line)', () => {
    // '' 被当作 0 行而不是 1 行空串, 这样纯空输入就不会渲染出一条"幽灵空行"
    expect(diffLines('', '')).toEqual([]);
    expect(diffStats(diffLines('', '')).total).toBe(0);
  });

  it('preserves blank lines in script formatting', () => {
    // 剧本常见: 场景间有空行分隔, 空行也应作为"行"出现
    const rows = diffLines('A\n\nB', 'A\n\nB');
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual({ kind: 'same', text: '' });
  });
});

describe('diffStats', () => {
  it('computes correct counts + ratio', () => {
    const rows = diffLines('a\nb\nc\nd', 'a\nB\nc\nD');
    const s = diffStats(rows);
    expect(s.same).toBe(2);   // a, c
    expect(s.mod).toBe(2);    // b→B, d→D
    expect(s.changed).toBe(2);
    expect(s.total).toBe(4);
    expect(s.changeRatio).toBe(0.5);
  });

  it('empty rows → zero ratio', () => {
    expect(diffStats([]).changeRatio).toBe(0);
  });
});
