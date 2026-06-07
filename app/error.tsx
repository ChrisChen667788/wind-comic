'use client';

/**
 * 根路由错误边界 (v10.2.1) — Next App Router segment 级错误兜底。
 * 取代"白屏 / 仅落全局 ErrorBoundary":出错时显示可读信息 + 一键重试(reset 重渲该段)。
 */
import { useEffect } from 'react';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 上报到控制台(生产可换成真实埋点)
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-[var(--cinema-amber,#E8C547)] text-5xl leading-none">⚠</div>
      <h2 className="text-lg font-semibold">页面出错了</h2>
      <p className="text-sm opacity-60 max-w-md break-words">{error?.message || '发生了未知错误,请重试。'}</p>
      <div className="flex gap-3">
        <button onClick={() => reset()} className="btn-primary px-5 py-2 rounded-xl text-sm">
          重试
        </button>
        <a href="/dashboard" className="px-5 py-2 rounded-xl text-sm border border-white/15 opacity-80 hover:opacity-100">
          回工作台
        </a>
      </div>
    </div>
  );
}
