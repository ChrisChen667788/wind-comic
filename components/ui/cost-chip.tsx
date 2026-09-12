'use client';

/**
 * 「这一下要花多少钱」的显示件(v12.435)。
 *
 * 五个花钱入口共用一份 —— 各写各的就会出现「开机那儿说 ¥8、重生那儿说 ¥1.2,
 * 用户自己都对不上」的局面,而这个仓为「同一语义两份实现」栽过太多次。
 *
 * 估不准的时候**必须改口**:引擎已知写「约 ¥1.2」,引擎未指定写「最多 ¥3.6」并
 * 标注按最贵档估。把一个保守上限伪装成精确报价,和把「没读到」写成 0 是同一种谎。
 */

import { Coins } from '@phosphor-icons/react';
import { previewCost, type SpendAction } from '@/lib/action-cost';

export function CostChip({
  action,
  prefix,
  className = '',
}: {
  action: SpendAction;
  /** 前缀词,比如「本次」「重生」 */
  prefix?: string;
  className?: string;
}) {
  const p = previewCost(action);
  const tone = p.confident
    ? 'text-[var(--cinema-amber)] border-[var(--cinema-amber)]/25 bg-[var(--cinema-amber)]/8'
    : 'text-amber-300/90 border-amber-400/30 bg-amber-400/8';

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] cinema-mono whitespace-nowrap ${tone} ${className}`}
      title={p.detail}
    >
      <Coins className="w-3 h-3 shrink-0" weight="duotone" />
      {prefix ? `${prefix} ` : ''}{p.label}
    </span>
  );
}
