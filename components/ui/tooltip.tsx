'use client';

/**
 * components/ui/tooltip (v2.13.5 · shadcn-style on Radix)
 *
 * 比 native title="..." 强:
 *   - 跟随光标的可定制 (top/bottom/left/right + sideOffset)
 *   - 触摸屏 long-press 才触发, 不污染移动端
 *   - 真正的 ARIA aria-describedby 关联, 屏幕阅读器友好
 *
 * 用法:
 *   <TooltipProvider>
 *     <Tooltip>
 *       <TooltipTrigger asChild><button>SHOT 03</button></TooltipTrigger>
 *       <TooltipContent>第 3 个镜头 · Cameo 92 / Edit cut</TooltipContent>
 *     </Tooltip>
 *   </TooltipProvider>
 *
 * 整页用:在 layout 顶层包一个 <TooltipProvider delayDuration={300}>;
 * 局部用:就近包一个即可。
 */

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      // 影院风: 黑底 amber 框 + cinema-mono
      'z-50 overflow-hidden rounded-md border px-2.5 py-1.5',
      'border-[var(--cinema-border-hi)] bg-[var(--cinema-surface-hi)]',
      'cinema-mono text-[10.5px] tracking-wide text-[var(--cinema-text)]',
      'shadow-[0_4px_18px_-6px_rgba(0,0,0,0.55)]',
      'animate-in fade-in-0 zoom-in-95',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1',
      'data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
