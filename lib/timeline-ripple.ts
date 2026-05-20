/**
 * v3.3 — Cinema timeline ripple edit (后段连动).
 *
 * 经典 ripple: 改一段的长度 / 删一段 / 移一段, 它之后的所有段一起平移同样的 delta,
 * 不留缝 / 不重叠. 纯函数, 给当前轨道全部段 + delta + 锚点, 返回 ripple 后的新位置.
 *
 * 与 lib/timeline-snap.ts 关系: snap 管单段贴边, ripple 管"动一段牵连后面". 调用方
 * 在 resize / move 落定后, 可选地调 computeRipple 把下游段一起推.
 *
 * 单测: tests/v3-3-timeline-ripple.test.ts.
 */

import type { SegmentRange } from './timeline-snap';

export interface RippleInput {
  /** 被编辑的段 id (它自己不被 ripple 平移, 调用方已经 apply 了 edit). */
  editedId: string;
  /** 同轨道所有段 (含 edited). 函数内自行排序, 传入顺序无所谓. */
  allSegments: SegmentRange[];
  /**
   * 编辑造成的时间增量 (秒).
   *   resize-right 变长 → +delta; 缩短 → -delta
   *   move 右移 → +delta; 左移 → -delta
   */
  deltaSec: number;
  /**
   * ripple 锚点: 此时间点 (含) 之后的段算"下游", 一起平移.
   * resize-right 通常传 edited 的原 endSec; move 通常传 edited 的原 startSec.
   */
  anchorSec: number;
  /** 全片总时长上界 (可选). 段尾被推过界时 clamp. 0 / 不传 = 不限制. */
  totalDuration?: number;
}

export interface RippleResult {
  /** 全部段的新位置 (edited 段原样返回, 不动). */
  segments: SegmentRange[];
  /** 真正被 ripple 平移的下游段 id. */
  shiftedIds: string[];
}

const EPS = 1e-6;

/**
 * 计算 ripple 后的全部段位置.
 *
 * 规则:
 *   - startSec ≥ anchorSec 的非 edited 段, startSec += deltaSec (clamp 到 ≥ 0)
 *   - deltaSec < 0 (缩短/左移) 时, 下游段往前贴, 但不会被推到 < 0 或与上游重叠到负
 *   - totalDuration 给了时, 段尾超界则 clamp duration (极端情况)
 */
export function computeRipple(input: RippleInput): RippleResult {
  const { editedId, allSegments, deltaSec, anchorSec, totalDuration } = input;
  const shiftedIds: string[] = [];

  const segments = allSegments.map((s) => {
    if (s.id === editedId) return { ...s };
    if (s.startSec >= anchorSec - EPS) {
      const newStart = Math.max(0, s.startSec + deltaSec);
      if (Math.abs(newStart - s.startSec) > EPS) shiftedIds.push(s.id);
      let durationSec = s.durationSec;
      if (totalDuration && totalDuration > 0 && newStart + durationSec > totalDuration) {
        durationSec = Math.max(0.5, totalDuration - newStart);
      }
      return { ...s, startSec: newStart, durationSec };
    }
    return { ...s };
  });

  return { segments, shiftedIds };
}

/**
 * 删段 ripple — 删掉 removedId 后, 它之后的段往前补 removedDuration.
 * 便捷封装: delta = -removedDuration, anchor = removed.endSec.
 */
export function computeRippleDelete(
  removedId: string,
  allSegments: SegmentRange[],
  totalDuration?: number,
): RippleResult {
  const removed = allSegments.find((s) => s.id === removedId);
  if (!removed) {
    return { segments: allSegments.map((s) => ({ ...s })), shiftedIds: [] };
  }
  const remaining = allSegments.filter((s) => s.id !== removedId);
  const r = computeRipple({
    editedId: '__none__',
    allSegments: remaining,
    deltaSec: -removed.durationSec,
    anchorSec: removed.startSec + removed.durationSec,
    totalDuration,
  });
  return r;
}
