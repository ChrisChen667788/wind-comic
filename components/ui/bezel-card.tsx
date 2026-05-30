import { cn } from '@/lib/utils';

/**
 * BezelCard (v8.3 P2) — 真 Double-Bezel 双层卡片 (机加工托盘套玻璃面板)
 *
 * 对标 Taste Skill「high-end-visual-design」的 Doppelrand / Nested Architecture:
 *   外壳 (.bezel-shell, 6px padding + 发丝边 + 金色光晕) 套
 *   内芯 (.bezel-core, 独立色 + 顶缘高光 + 同心圆角)。
 *
 * 用于高价值 surface (dashboard hero / 关键卡片)。布局 className (col-span/grid…) 上外壳,
 * 内容 padding 由内芯默认给 (可用 coreClassName 覆盖)。
 */
export function BezelCard({
  className,
  coreClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { coreClassName?: string }) {
  return (
    <div className={cn('bezel-shell', className)} {...props}>
      <div className={cn('bezel-core p-6', coreClassName)}>{children}</div>
    </div>
  );
}
