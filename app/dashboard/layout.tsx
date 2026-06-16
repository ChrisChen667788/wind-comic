'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Sidebar } from '@/components/sidebar';
import { ApiQuotaBanner } from '@/components/dashboard/api-quota-banner';
import { NotificationBell } from '@/components/collab/notification-bell';
import { ActiveGenerationIndicator } from '@/components/active-generation-indicator';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[var(--background)]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-9 h-9 rounded-md grid place-items-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-[#E8C547] to-[#D4A830] animate-pulse" />
            <svg className="w-4 h-4 text-[#0C0C0C] relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="text-xs text-[var(--soft)]">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-[var(--background)]">
      {/* 暖墨质感氛围 */}
      <div className="cosmic-bg">
        <div className="noise-overlay" />
      </div>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto relative outline-none">
        {/* 微妙的金色顶部光晕 */}
        <div className="page-glow" />
        {/* v2.17 P0.3: API 配额告警 banner — 任意上游配额耗尽 / 上游饱和时可见 */}
        <ApiQuotaBanner />
        {/* v3.0 P0.1: 通知 bell — 浮在右上角, dashboard 任意页都可见 */}
        <div className="absolute top-4 right-5 z-30">
          <NotificationBell />
        </div>
        <div className="relative z-10 p-5 lg:p-7">
          {children}
        </div>
      </main>
      {/* v12.5.0(#4):工坊任务进行中 → 全局浮动指示条(任一模块可见、一键返回) */}
      <ActiveGenerationIndicator />
    </div>
  );
}
