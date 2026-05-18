/**
 * v3.1 F.2 — Timeline virtual scrolling helper.
 *
 * 长片 (15+ 镜) 时, 每镜卡片 160px 宽 + 整轨道横向滚动会卡 (DOM 节点 + img 全部
 * 渲染). 这个 lib 给纯函数, 接收 scrollLeft + viewport width, 返回当前可见的
 * shot 索引窗口 (含 1-2 卡 buffer).
 *
 * 用法:
 *   const { startIdx, endIdx, leftPad } = visibleRange({
 *     totalCount, itemWidth, scrollLeft, viewportWidth, gap: 8, buffer: 2,
 *   });
 *   shots.slice(startIdx, endIdx).map(...)
 *
 * 不依赖 react / DOM, 纯算术, 方便测.
 */

export interface VirtualRangeInput {
  totalCount: number;
  itemWidth: number;
  /** 当前 scrollLeft */
  scrollLeft: number;
  /** 容器可见宽度 */
  viewportWidth: number;
  /** items 之间的 gap (px). 默认 0 */
  gap?: number;
  /** 每端多渲几个作 buffer 防抖. 默认 2 */
  buffer?: number;
}

export interface VirtualRangeResult {
  /** 起始 item 索引 (inclusive) */
  startIdx: number;
  /** 结束 item 索引 (exclusive) */
  endIdx: number;
  /** 给 inner 容器加的 left padding (px), 让虚拟 items 在正确视觉位置 */
  leftPad: number;
  /** 给 inner 容器加的 right padding (px), 保留滚动条 thumb 大小 */
  rightPad: number;
}

/**
 * 计算当前需渲染的 item 窗口. 如果 totalCount <= bufferThreshold (默认 12)
 * 直接返回全集, 调用方按全集 render — 短片不浪费 virtual 复杂度.
 */
export function visibleRange(input: VirtualRangeInput): VirtualRangeResult {
  const { totalCount, itemWidth, scrollLeft, viewportWidth } = input;
  const gap = input.gap ?? 0;
  const buffer = input.buffer ?? 2;

  if (totalCount <= 0 || itemWidth <= 0 || viewportWidth <= 0) {
    return { startIdx: 0, endIdx: 0, leftPad: 0, rightPad: 0 };
  }

  const stride = itemWidth + gap;
  const firstVisible = Math.max(0, Math.floor(scrollLeft / stride));
  const lastVisible = Math.min(totalCount, Math.ceil((scrollLeft + viewportWidth) / stride));
  const startIdx = Math.max(0, firstVisible - buffer);
  const endIdx = Math.min(totalCount, lastVisible + buffer);
  const leftPad = startIdx * stride;
  const rightPad = Math.max(0, (totalCount - endIdx) * stride);
  return { startIdx, endIdx, leftPad, rightPad };
}

/** 该 timeline 是否值得启用 virtual mode — 短片不必, 简化 UI. */
export function shouldVirtualize(totalCount: number, threshold = 12): boolean {
  return totalCount > threshold;
}
