'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { LanguageToggle } from '@/components/language-toggle';

export function SiteHeader({ variant = 'default' }: { variant?: 'default' | 'compact' | 'overlay' }) {
  const { user } = useAuth();

  // overlay: 叠在全屏英雄图上,无底色,文字靠 text-shadow 维持可读
  const wrapperClass =
    variant === 'default'
      ? 'sticky top-0 z-40 backdrop-blur-[48px] bg-gradient-to-b from-[rgba(10,10,11,0.85)] to-[rgba(10,10,11,0.3)] border-b border-[var(--border)]'
      : variant === 'overlay'
        ? 'absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-[rgba(10,10,11,0.55)] to-transparent border-none'
        : 'relative bg-transparent border-none';

  return (
    <header className={`${wrapperClass} px-[5vw] py-[18px]`}>
      <div className="flex items-center justify-between gap-6">
        <Link href="/" className="flex flex-col font-bold">
          <span className="text-[22px] tracking-wide brand-gradient">青枫</span>
          <span className="text-xs text-[var(--soft)]">QingFeng Manju</span>
        </Link>

        <nav className="hidden md:flex gap-7 text-sm text-white/70">
          <Link href="/dashboard/create" className="hover:text-white transition-colors duration-200 tracking-wide">开始创作</Link>
          <Link href="/dashboard/polish" className="hover:text-white transition-colors duration-200 tracking-wide">剧本润色</Link>
          <Link href="/dashboard/projects" className="hover:text-white transition-colors duration-200 tracking-wide">项目资产</Link>
          <Link href="/dashboard" className="hover:text-white transition-colors duration-200 tracking-wide">工作台</Link>
          <Link href="/cases" className="hover:text-white transition-colors duration-200 tracking-wide">作品案例</Link>
        </nav>

        <div className="flex gap-3 items-center">
          <LanguageToggle />
          {user ? (
            <Link href="/dashboard" className="btn-primary text-sm px-4 py-2 rounded-xl inline-block">
              用户中心
            </Link>
          ) : (
            <Link href="/dashboard/create" className="btn-primary text-sm px-5 py-2 rounded-xl inline-block">
              开始创作
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
