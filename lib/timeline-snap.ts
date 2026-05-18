/**
 * v3.1.3 P2 — Cinema timeline segment 碰撞检测 + auto-snap.
 *
 * 纯函数. 给当前段拖动后的 proposed start/duration, 同轨道其他段 (邻居),
 * 计算最终 start/duration 让段不重叠 — 在 SNAP_THRESHOLD_SEC 内时贴邻居边沿,
 * 超过阈值时硬阻止重叠 (clamp 到邻居边).
 *
 * 也输出 snapped: bool — 让 UI 高亮 (闪一下表示 snap 到位).
 */

export interface SegmentRange {
  id: string;
  startSec: number;
  durationSec: number;
}

export interface SnapInput {
  /** 当前正在拖的段 id (邻居计算时跳过自己) */
  selfId: string;
  /** 同轨道所有段 (含 self) */
  allSegments: SegmentRange[];
  /** 提议的新 startSec */
  proposedStart: number;
  /** 提议的新 durationSec */
  proposedDuration: number;
  /** 全片总时长 (作 hard upper bound, 段尾不能超) */
  totalDuration: number;
}

export interface SnapResult {
  startSec: number;
  durationSec: number;
  /** 该次操作是否触发了 snap (UI 用来做闪光提示) */
  snapped: boolean;
  /** 触发 snap 的邻居 id (debug + UI hint), null 当 snapped=false */
  snappedTo: string | null;
}

/** snap 阈值 — 离邻居边沿 ≤ 此距离时贴上去 (秒) */
export const SNAP_THRESHOLD_SEC = 0.4;
/** 邻居之间的最小间隙 — snap 后保留这个 gap, 不完全贴齐 */
export const SNAP_GAP_SEC = 0;

/**
 * 计算 snap 后的 startSec + durationSec.
 *
 * 算法 (3 步):
 *   1. 找到 self 左右两个最近的邻居 (按 startSec 排序后取 self 之前/之后第 1 个)
 *   2. 检测 proposed 是否落在 [left.end - threshold, left.end + threshold] (snap 左)
 *      或 [right.start - threshold, right.start + threshold] (snap 右 — duration 端).
 *   3. 硬碰撞 (proposed 在 neighbor 中间) → clamp 到 neighbor 边沿 (不允许重叠).
 *
 * Move 模式 (整段平移): 同步调整 start 和 duration, end 跟着移
 * Resize-right (只改 duration): start 不变, end 往后, 与右邻居碰则 clamp
 * Resize-left (改 start 同时改 duration): end 不变, start 往前, 与左邻居碰则 clamp
 */
export function computeSnap(input: SnapInput): SnapResult {
  const { selfId, allSegments, proposedStart, proposedDuration, totalDuration } = input;
  // 排他 + 排序
  const others = allSegments
    .filter((s) => s.id !== selfId)
    .map((s) => ({ id: s.id, startSec: s.startSec, endSec: s.startSec + s.durationSec }))
    .sort((a, b) => a.startSec - b.startSec);

  let startSec = Math.max(0, proposedStart);
  let durationSec = Math.max(0.5, proposedDuration);
  let endSec = startSec + durationSec;
  let snapped = false;
  let snappedTo: string | null = null;

  // Hard upper bound — 段尾不能超过全片时长
  if (totalDuration > 0 && endSec > totalDuration) {
    endSec = totalDuration;
    if (endSec - startSec < 0.5) {
      startSec = Math.max(0, endSec - 0.5);
    }
    durationSec = endSec - startSec;
  }

  // 找左邻居 (endSec ≤ proposed startSec 的最右边那个)
  const leftNeighbor = others
    .filter((n) => n.endSec <= startSec + SNAP_THRESHOLD_SEC)
    .reverse()[0];
  // 找右邻居 (startSec ≥ proposed endSec 的最左边那个)
  const rightNeighbor = others.find((n) => n.startSec + SNAP_THRESHOLD_SEC >= endSec);

  // Snap left: proposed startSec 离 leftNeighbor.endSec 很近 → 贴上去
  if (leftNeighbor && Math.abs(startSec - leftNeighbor.endSec) <= SNAP_THRESHOLD_SEC) {
    const delta = leftNeighbor.endSec + SNAP_GAP_SEC - startSec;
    startSec += delta;
    endSec += delta;
    snapped = true;
    snappedTo = leftNeighbor.id;
  }
  // Snap right: proposed endSec 离 rightNeighbor.startSec 很近 → 贴上去
  if (rightNeighbor && Math.abs(endSec - rightNeighbor.startSec) <= SNAP_THRESHOLD_SEC) {
    const delta = rightNeighbor.startSec - SNAP_GAP_SEC - endSec;
    endSec += delta;
    // duration 保持, start 跟着移
    startSec += delta;
    snapped = true;
    snappedTo = rightNeighbor.id;
  }

  // Hard collision — proposed 整段插进了某邻居中 → clamp 出来
  for (const n of others) {
    const overlap = startSec < n.endSec && endSec > n.startSec;
    if (!overlap) continue;
    // 看 self 中心离邻居哪边近, 推那边
    const selfMid = (startSec + endSec) / 2;
    const neighborMid = (n.startSec + n.endSec) / 2;
    if (selfMid < neighborMid) {
      // self 该贴 neighbor 左侧
      const newEnd = n.startSec - SNAP_GAP_SEC;
      startSec = Math.max(0, newEnd - durationSec);
      endSec = startSec + durationSec;
    } else {
      // self 该贴 neighbor 右侧
      const newStart = n.endSec + SNAP_GAP_SEC;
      startSec = newStart;
      endSec = startSec + durationSec;
    }
    snapped = true;
    snappedTo = n.id;
  }

  // 重新确认 hard bounds (after collision clamp 可能再越界)
  if (startSec < 0) {
    const delta = -startSec;
    startSec += delta;
    endSec += delta;
  }
  if (totalDuration > 0 && endSec > totalDuration) {
    endSec = totalDuration;
    if (endSec - startSec < 0.5) startSec = Math.max(0, endSec - 0.5);
    durationSec = endSec - startSec;
  }

  durationSec = endSec - startSec;
  return { startSec, durationSec, snapped, snappedTo };
}
