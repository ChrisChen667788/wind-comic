'use client';

/**
 * DemoModeBanner (v10.1.2 · i18n v10.2.2) — 当图像/视频引擎未配置(克隆即跑、无 BYO key)时,
 * 在创作流程顶部提示「演示模式」:产出为占位/示意资产,并指引如何启用真实引擎
 * (口型已零配置可用)。可关闭(localStorage 记忆)。数据来自 GET /api/runtime/readiness。
 * 文案走 i18n(t.collab.*),四语一致。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/hooks/use-locale';

const DISMISS_KEY = 'qfmj-demo-banner-dismissed';

interface EngineState {
  kind: string;
  ready: boolean;
}

export function DemoModeBanner() {
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  const [missingKinds, setMissingKinds] = useState<string[]>(['image', 'video']);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    let alive = true;
    fetch('/api/runtime/readiness')
      .then((r) => r.json())
      .then((d: { demoMode?: boolean; engines?: EngineState[] }) => {
        if (!alive || !d?.demoMode) return;
        const kinds = (d.engines || [])
          .filter((e) => !e.ready && (e.kind === 'image' || e.kind === 'video'))
          .map((e) => e.kind);
        if (kinds.length) setMissingKinds(kinds);
        setShow(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  const missingLabel = missingKinds
    .map((k) => (k === 'image' ? t.collab.demoImage : t.collab.demoVideo))
    .join(' / ');

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-[var(--cinema-amber-deep,#8a6d1f)] bg-[rgba(232,197,71,0.08)] px-4 py-2.5 text-[12.5px] leading-snug">
      <span className="text-[var(--cinema-amber,#E8C547)] shrink-0">●</span>
      <span className="flex-1 opacity-90">
        <b className="text-[var(--cinema-amber,#E8C547)]">{t.collab.demoMode}</b> · {missingLabel} {t.collab.demoEnginesOff} —— {t.collab.demoPlaceholder}
        <span className="opacity-70">;{t.collab.demoLipsyncReady}。</span>
      </span>
      <Link
        href="/dashboard/health"
        className="shrink-0 underline opacity-80 hover:opacity-100 whitespace-nowrap"
      >
        {t.collab.demoHowToEnable} →
      </Link>
      <button
        type="button"
        aria-label={t.collab.demoHowToEnable}
        onClick={() => {
          try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
          setShow(false);
        }}
        className="shrink-0 opacity-50 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
