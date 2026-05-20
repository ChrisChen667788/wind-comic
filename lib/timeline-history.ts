/**
 * v3.3 — Cinema timeline undo/redo 栈.
 *
 * 通用快照式撤销栈. 调用方每次落定一次编辑 (拖完 / resize 完 / ripple 完) 就 push
 * 一个 state 快照, undo/redo 在 past/future 两栈间倒腾.
 *
 * 设计取舍:
 *   - 快照式 (存整个 state) 而非 command 式 (存 diff). timeline state 不大
 *     (几十段 × 几个字段), 快照实现简单且绝不出 replay bug.
 *   - 有上限 (默认 50 步), 超了丢最老的, 防内存涨爆.
 *   - 不可变: push 进来的 state 调用方保证别再 mutate (传 structuredClone 的结果最稳).
 *
 * 单测: tests/v3-3-timeline-history.test.ts.
 */

export class TimelineHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private readonly limit: number;

  constructor(limit = 50) {
    this.limit = Math.max(1, limit);
  }

  /**
   * 落定一次编辑. 把"上一个 state"压入 past, 清空 future (新分支).
   * 注意: 传的是编辑 **之前** 的 state (调用方在 apply 新 state 前调).
   */
  push(prevState: T): void {
    this.past.push(prevState);
    if (this.past.length > this.limit) {
      this.past.shift(); // 丢最老
    }
    this.future = []; // 新编辑作废 redo 分支
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /**
   * 撤销. 传当前 state (会被压入 future 以便 redo), 返回要恢复到的上一个 state.
   * 无可撤销返 null.
   */
  undo(currentState: T): T | null {
    if (this.past.length === 0) return null;
    const prev = this.past.pop() as T;
    this.future.push(currentState);
    if (this.future.length > this.limit) {
      this.future.shift();
    }
    return prev;
  }

  /**
   * 重做. 传当前 state (会被压回 past), 返回要恢复到的下一个 state.
   * 无可重做返 null.
   */
  redo(currentState: T): T | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop() as T;
    this.past.push(currentState);
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    return next;
  }

  /** 清空两栈 (切项目 / 重载时). */
  clear(): void {
    this.past = [];
    this.future = [];
  }

  /** 当前撤销栈深度 (调试 / UI badge 用). */
  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }
}
