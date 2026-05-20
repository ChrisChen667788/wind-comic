/**
 * v3.3 — Timeline undo/redo 栈单测.
 */

import { describe, it, expect } from 'vitest';
import { TimelineHistory } from '@/lib/timeline-history';

interface State { v: number }

describe('v3.3 · TimelineHistory', () => {
  it('starts empty', () => {
    const h = new TimelineHistory<State>();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undoDepth).toBe(0);
  });

  it('undo restores the previous state', () => {
    const h = new TimelineHistory<State>();
    // 编辑序列: s0 → s1 → s2. 每次编辑前 push 旧 state.
    h.push({ v: 0 });            // 准备从 s0 编辑到 s1
    h.push({ v: 1 });            // 准备从 s1 编辑到 s2
    // 当前 state = s2
    const prev = h.undo({ v: 2 });
    expect(prev).toEqual({ v: 1 });
    expect(h.canRedo()).toBe(true);
  });

  it('redo re-applies an undone state', () => {
    const h = new TimelineHistory<State>();
    h.push({ v: 0 });
    h.push({ v: 1 });
    const undone = h.undo({ v: 2 });   // → v:1, future=[v:2]
    expect(undone).toEqual({ v: 1 });
    const redone = h.redo({ v: 1 });   // → v:2
    expect(redone).toEqual({ v: 2 });
    expect(h.canRedo()).toBe(false);
  });

  it('undo returns null when nothing to undo', () => {
    const h = new TimelineHistory<State>();
    expect(h.undo({ v: 0 })).toBeNull();
  });

  it('redo returns null when nothing to redo', () => {
    const h = new TimelineHistory<State>();
    h.push({ v: 0 });
    expect(h.redo({ v: 1 })).toBeNull();
  });

  it('push clears the redo branch', () => {
    const h = new TimelineHistory<State>();
    h.push({ v: 0 });
    h.push({ v: 1 });
    h.undo({ v: 2 });            // future=[v:2]
    expect(h.canRedo()).toBe(true);
    h.push({ v: 1 });            // 新编辑 → redo 分支作废
    expect(h.canRedo()).toBe(false);
  });

  it('respects the limit (drops oldest)', () => {
    const h = new TimelineHistory<State>(3);
    h.push({ v: 0 });
    h.push({ v: 1 });
    h.push({ v: 2 });
    h.push({ v: 3 });            // 超过 limit=3, 丢最老的 v:0
    expect(h.undoDepth).toBe(3);
    // 连续 undo 3 次能拿到 v3/v2/v1, 拿不到 v0
    const a = h.undo({ v: 99 });
    const b = h.undo(a!);
    const c = h.undo(b!);
    expect([a, b, c]).toEqual([{ v: 3 }, { v: 2 }, { v: 1 }]);
    expect(h.canUndo()).toBe(false);  // v0 被丢了
  });

  it('clear empties both stacks', () => {
    const h = new TimelineHistory<State>();
    h.push({ v: 0 });
    h.undo({ v: 1 });
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it('round-trips a multi-step undo/redo chain', () => {
    const h = new TimelineHistory<State>();
    let cur: State = { v: 0 };
    // 3 步编辑
    h.push(cur); cur = { v: 1 };
    h.push(cur); cur = { v: 2 };
    h.push(cur); cur = { v: 3 };
    // undo ×3
    cur = h.undo(cur)!; expect(cur).toEqual({ v: 2 });
    cur = h.undo(cur)!; expect(cur).toEqual({ v: 1 });
    cur = h.undo(cur)!; expect(cur).toEqual({ v: 0 });
    // redo ×3
    cur = h.redo(cur)!; expect(cur).toEqual({ v: 1 });
    cur = h.redo(cur)!; expect(cur).toEqual({ v: 2 });
    cur = h.redo(cur)!; expect(cur).toEqual({ v: 3 });
  });
});
