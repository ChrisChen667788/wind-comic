'use client';

import { cn } from '@/lib/utils';
import { ArrowRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * CtaButton (v8.3 P2) — Nested CTA (Button-in-Button)
 *
 * 对标 Taste Skill: 主 CTA 的尾随箭头/图标 NEVER sits naked —— 嵌进一个独立圆形"岛屿"。
 * 整个按钮全圆角胶囊, 岛屿贴合右内边距, hover 时岛屿微微右移。
 *
 *   <CtaButton onClick={…}>用此方案去创作</CtaButton>
 *   <CtaButton variant="ghost" icon={<Sparkle/>}>优化</CtaButton>
 */
export function CtaButton({
  children,
  variant = 'gold',
  icon,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'gold' | 'ghost';
  icon?: ReactNode;
}) {
  return (
    <button className={cn('cta', variant === 'ghost' ? 'cta--ghost' : 'cta--gold', className)} {...props}>
      <span>{children}</span>
      <span className="cta__island" aria-hidden>
        {icon ?? <ArrowRight size={16} weight="bold" />}
      </span>
    </button>
  );
}
