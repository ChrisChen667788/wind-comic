'use client';

/**
 * components/ui/tabs (v2.13.5 · shadcn-style on Radix)
 *
 * 比项目里散落的"自定义 className 切换 active"实现稳:
 *   - 真正的 ARIA Tab 角色 / 键盘导航 (Arrow / Home / End)
 *   - 主题用 cinema 调色 (amber 高亮 + filmstrip 下划线)
 *   - asChild 通过 Radix Slot 透传, 给 Tab 加自定义元素
 *
 * 用法:
 *   <Tabs defaultValue="script">
 *     <TabsList>
 *       <TabsTrigger value="script">剧本</TabsTrigger>
 *       <TabsTrigger value="storyboard">分镜</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="script">...</TabsContent>
 *     <TabsContent value="storyboard">...</TabsContent>
 *   </Tabs>
 */

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // 影院 filmstrip 风:底部双线, 内 padding 留呼吸
      'inline-flex items-center gap-1 rounded-md p-1',
      'border border-[var(--cinema-border)] bg-[var(--cinema-surface-2)]',
      'text-[var(--cinema-text-2)]',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // 默认: 等宽 small caps; active: amber 底色 + 黑字
      'cinema-mono inline-flex items-center justify-center whitespace-nowrap rounded-sm',
      'px-3 py-1.5 text-[11px] font-semibold tracking-widest uppercase transition-all',
      'ring-offset-[var(--cinema-bg)] focus-visible:outline-none focus-visible:ring-2',
      'focus-visible:ring-[var(--cinema-amber-deep)] focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-40',
      'hover:bg-[var(--cinema-surface-hi)] hover:text-[var(--cinema-text)]',
      'data-[state=active]:bg-[var(--cinema-amber)]',
      'data-[state=active]:text-[#0A0908]',
      'data-[state=active]:shadow-[0_0_0_1px_var(--cinema-amber-deep)]',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-3 ring-offset-[var(--cinema-bg)] focus-visible:outline-none focus-visible:ring-2',
      'focus-visible:ring-[var(--cinema-amber-deep)] focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
