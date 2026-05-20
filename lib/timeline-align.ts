/**
 * v3.3 — Cinema timeline 段对齐 hint (左 / 右 / 中 三选一).
 *
 * 拖段时算出对齐参考线 (像 Figma / PR 的 smart guides): 把当前段的
 * 左边沿 / 右边沿 / 中线 对齐到邻居的对应位置, 各给一个候选. UI 据此画参考线 +
 * 选最近的吸附.
 *
 * 跟 timeline-snap.ts 区别: snap 只做"贴邻居边沿防重叠", align 做"多种对齐基准 +
 * 可视参考线", 是更细的对齐辅助. 两者可叠加用.
 *
 * 单测: tests/v3-3-timeline-align.test.ts.
 */

import type { SegmentRange } from './timeline-snap';

export type AlignKind = 'left' | 'right' | 'center';

export interface AlignHint {
  /** 用 segment 的哪条线去对齐: 左沿 / 右沿 / 中线. */
  kind: AlignKind;
  /** 对齐后 segment 的新 startSec. */
  targetStart: number;
  /** 参考线全局位置 (秒) — UI 在这画竖线. */
  guideSec: number;
  /** 参考来源段 id. */
  refId: string;
  /** 当前线离参考线的距离 (秒), 越小越优先. */
  distance: number;
}

export interface AlignInput {
  selfId: string;
  allSegments: SegmentRange[];
  /** 当前拖动中的 startSec. */
  proposedStart: number;
  /** 当前段时长 (对齐保持不变). */
  durationSec: number;
  /** 对齐阈值 (秒). 默认 0.4, 与 SNAP_THRESHOLD_SEC 对齐. */
  threshold?: number;
  /** 额外参考线 (act 边界 / playhead 等), 也参与对齐. */
  extraGuides?: number[];
}

const DEFAULT_THRESHOLD = 0.4;

/**
 * 算出所有在阈值内的对齐候选, 按距离升序. UI 可全画 (参考线), 取第 1 个吸附.
 *
 * 参考点来源:
 *   - 每个邻居的 startSec / endSec / 中点
 *   - extraGuides 里的每条线
 * 对齐基准 (self 的线):
 *   - left   = proposedStart
 *   - right  = proposedStart + durationSec
 *   - center = proposedStart + durationSec / 2
 */
export function computeAlignHints(input: AlignInput): AlignHint[] {
  const {
    selfId, allSegments, proposedStart, durationSec,
    threshold = DEFAULT_THRESHOLD, extraGuides = [],
  } = input;

  const refLines: Array<{ pos: number; refId: string }> = [];
  for (const s of allSegments) {
    if (s.id === selfId) continue;
    refLines.push({ pos: s.startSec, refId: s.id });
    refLines.push({ pos: s.startSec + s.durationSec, refId: s.id });
    refLines.push({ pos: s.startSec + s.durationSec / 2, refId: s.id });
  }
  for (let i = 0; i < extraGuides.length; i++) {
    refLines.push({ pos: extraGuides[i], refId: `guide:${i}` });
  }

  const selfLines: Array<{ kind: AlignKind; pos: number }> = [
    { kind: 'left', pos: proposedStart },
    { kind: 'right', pos: proposedStart + durationSec },
    { kind: 'center', pos: proposedStart + durationSec / 2 },
  ];

  const hints: AlignHint[] = [];
  for (const self of selfLines) {
    for (const ref of refLines) {
      const distance = Math.abs(self.pos - ref.pos);
      if (distance > threshold) continue;
      // 把 self.line 对齐到 ref.pos → 反推 startSec
      const delta = ref.pos - self.pos;
      hints.push({
        kind: self.kind,
        targetStart: Math.max(0, proposedStart + delta),
        guideSec: ref.pos,
        refId: ref.refId,
        distance,
      });
    }
  }

  hints.sort((a, b) => a.distance - b.distance);
  return hints;
}

/**
 * 取最佳对齐 (距离最小). 没有候选返 null.
 * UI 落定吸附时用这个的 targetStart.
 */
export function bestAlignHint(input: AlignInput): AlignHint | null {
  const hints = computeAlignHints(input);
  return hints.length > 0 ? hints[0] : null;
}
