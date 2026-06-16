'use client';

/**
 * components/active-generation-indicator (v12.5.0 · #4 修复)
 *
 * 工坊「进行中任务」全局浮动指示条 —— 挂在 dashboard layout,任一模块都可见。
 * 解决「工坊任务进行中点其他模块就像中断了」:任务其实仍在跑(SSE 闭包不随页面卸载停),
 * 这条指示让用户随时看到进度 + 一键返回工坊;离开/刷新前给原生警告防误关。
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CircleNotch, ArrowRight, FilmSlate } from '@phosphor-icons/react';
import { useActiveGenerationStore } from '@/lib/store';

export function ActiveGenerationIndicator() {
  const current = useActiveGenerationStore((s) => s.current);
  const hydrate = useActiveGenerationStore((s) => s.hydrate);
  const pathname = usePathname();
  const router = useRouter();

  // 挂载时从 localStorage 恢复(刷新/重进后仍显示)
  useEffect(() => { hydrate(); }, [hydrate]);

  // 任务进行中 → 关闭/刷新页面前原生警告(防误触丢失进度)
  useEffect(() => {
    if (!current) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [current]);

  // 已在工坊页就不重复显示
  if (!current || pathname === '/dashboard/create') return null;

  return (
    <button
      onClick={() => router.push('/dashboard/create')}
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full border border-[var(--cinema-amber)] bg-[var(--cinema-bg,#0c0c10)]/95 px-4 py-2.5 shadow-lg shadow-black/40 backdrop-blur transition hover:scale-[1.02]"
      title="工坊任务进行中 — 点击返回"
    >
      <CircleNotch size={16} className="animate-spin text-[var(--cinema-amber)]" weight="bold" />
      <span className="flex flex-col items-start leading-tight">
        <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--cinema-amber)]">
          <FilmSlate size={12} /> 工坊任务进行中 · {current.phase}
        </span>
        <span className="max-w-[200px] truncate text-[10px] opacity-60">{current.idea}</span>
      </span>
      <ArrowRight size={14} className="opacity-70" />
    </button>
  );
}
