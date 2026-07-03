/**
 * v12.77 — Hook 公式化选句(问句>感叹>短句,宁缺毋滥)。
 */
import { describe, it, expect } from 'vitest';
import { pickHookLine } from '@/lib/end-card';

describe('v12.77 · pickHookLine', () => {
  it('问句优先(即使在第 2、3 镜)', () => {
    expect(pickHookLine(['又是这样……', '熬夜脸,有救吗?', '早八人集合!'])).toBe('熬夜脸,有救吗?');
    expect(pickHookLine(['平静叙述', '这也行呢?'])).toBe('这也行呢?');
  });

  it('无问句 → 感叹句次之', () => {
    expect(pickHookLine(['平静叙述', '再也不困了!'])).toBe('再也不困了!');
  });

  it('都没有 → 第一条合规短句;开头省略号被清洗', () => {
    expect(pickHookLine(['……再撑一下,没事。', '第二句'])).toBe('再撑一下,没事。');
  });

  it('超长/换行/空全被过滤 → null;只扫前 maxScan 句', () => {
    expect(pickHookLine(['这是一句非常非常非常长的完全不像 hook 的台词啊'])).toBeNull();
    expect(pickHookLine(['a\nb', '', null])).toBeNull();
    expect(pickHookLine(['长长长长长长长长长长长长长长长长长', '不扫我吗?'], 1)).toBeNull();
  });
});
