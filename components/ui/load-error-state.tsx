'use client';

/**
 * 「读不到」的统一说法(v12.434)。
 *
 * 五个列表页在取数失败时都会掉进各自的空态文案 ——「暂无角色」「暂无素材」
 * 「还没有创作项目」「暂无收藏」,案例库甚至连空态都没有,**只剩一片空白**。
 * 对一个真有数据的账号说这些话,等于告诉他东西丢了;而他能做的只有反复刷新。
 *
 * 所以失败要有自己的样子,并且**五处长一个样** —— 各写各的就会漏掉其中一两处,
 * 这一族 bug 本来就是这么长出来的。
 */

import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react';

export function LoadErrorState({
  what,
  reason,
  onRetry,
  className = '',
}: {
  /** 读的是什么,用于组成「角色库加载失败」 */
  what: string;
  /** 为什么没读到(来自 loadList) */
  reason?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-center py-20 ${className}`} role="status">
      <WarningCircle className="w-12 h-12 mx-auto mb-3 text-amber-400/60" weight="duotone" />
      <p className="text-sm text-amber-300/90">{what}加载失败</p>
      {reason && <p className="text-xs mt-1.5 text-gray-500">{reason}</p>}
      {/* 说清楚这不是「你没有数据」—— 用户最容易误判的就是这一点 */}
      <p className="text-xs mt-1 text-gray-600">这不代表你的{what}没了,只是这次没读到。</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
        >
          <ArrowClockwise className="w-3.5 h-3.5" />
          重试
        </button>
      )}
    </div>
  );
}
