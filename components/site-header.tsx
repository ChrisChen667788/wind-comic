'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useLocale } from '@/hooks/use-locale';

export function SiteHeader({ variant = 'default' }: { variant?: 'default' | 'compact' | 'overlay' }) {
  const { user } = useAuth();
  const { t } = useLocale();

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
          <Link href="/dashboard/create" className="hover:text-white transition-colors duration-200 tracking-wide">{t.nav.create}</Link>
          <Link href="/dashboard/polish" className="hover:text-white transition-colors duration-200 tracking-wide">{t.nav.polish}</Link>
          <Link href="/dashboard/projects" className="hover:text-white transition-colors duration-200 tracking-wide">{t.nav.projects}</Link>
          <Link href="/dashboard" className="hover:text-white transition-colors duration-200 tracking-wide">{t.nav.workbench}</Link>
          <Link href="/cases" className="hover:text-white transition-colors duration-200 tracking-wide">{t.nav.cases}</Link>
        </nav>

        <div className="flex gap-3 items-center">
          <LocaleSwitcher compact />
          {user ? (
            <Link href="/dashboard" className="btn-primary text-sm px-4 py-2 rounded-xl inline-block">
              {t.nav.userCenter}
            </Link>
          ) : (
            <Link href="/dashboard/create" className="btn-primary text-sm px-5 py-2 rounded-xl inline-block">
              {t.nav.create}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
