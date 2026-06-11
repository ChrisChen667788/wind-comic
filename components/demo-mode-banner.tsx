'use client';

/**
 * DemoModeBanner (v10.1.2 → v10.5.1 配置进度条) — 「一把 key 分级体验」的 UI 落点。
 *
 * 旧版只在 demoMode(缺图像/视频)时警示;现在升级为**配置进度条**:
 *   - 头行:引擎配置 N/5 + 进度条 + 分级文案(level:none/script/visual/film/media-only)
 *   - 明细:各创作环节 chips,逐个如实标「真 / 示意」—— UI 无一处虚假承诺(验收条款)
 * 全部 5 引擎就绪时整条隐藏;可关闭(localStorage 记忆)。
 * 数据来自 GET /api/runtime/readiness(levelLabel / stages 文案由服务端给出)。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/hooks/use-locale';

const DISMISS_KEY = 'qfmj-demo-banner-dismissed';

interface StageTruth {
  key: string;
  label: string;
  real: boolean;
}

interface ReadinessView {
  readyCount: number;
  total: number;
  levelLabel: string;
  stages: StageTruth[];
}

export function DemoModeBanner() {
  const { t } = useLocale();
  const [report, setReport] = useState<ReadinessView | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    let alive = true;
    fetch('/api/runtime/readiness')
      .then((r) => r.json())
      .then((d: Partial<ReadinessView>) => {
        if (!alive || !d || typeof d.readyCount !== 'number' || typeof d.total !== 'number') return;
        if (d.readyCount >= d.total) return; // 全配齐 → 不打扰
        setReport({
          readyCount: d.readyCount,
          total: d.total,
          levelLabel: d.levelLabel || '',
          stages: Array.isArray(d.stages) ? d.stages : [],
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!report) return null;
  const pct = Math.round((report.readyCount / Math.max(report.total, 1)) * 100);

  return (
    <div className="mb-4 rounded-lg border border-[var(--cinema-amber-deep,#8a6d1f)] bg-[rgba(232,197,71,0.08)] px-4 py-2.5 text-[12.5px] leading-snug">
      {/* 头行:进度 + 分级文案 + 指引/关闭 */}
      <div className="flex items-center gap-3">
        <span className="text-[var(--cinema-amber,#E8C547)] shrink-0">●</span>
        <b className="text-[var(--cinema-amber,#E8C547)] shrink-0 whitespace-nowrap">
          {t.collab.readinessTitle} {report.readyCount}/{report.total}
        </b>
        <span
          className="hidden sm:block h-1.5 w-24 shrink-0 rounded-full bg-white/10 overflow-hidden"
          role="progressbar"
          aria-valuenow={report.readyCount}
          aria-valuemin={0}
          aria-valuemax={report.total}
          aria-label={t.collab.readinessTitle}
        >
          <span className="block h-full bg-[var(--cinema-amber,#E8C547)]" style={{ width: `${pct}%` }} />
        </span>
        <span className="flex-1 opacity-90 min-w-0 truncate" title={report.levelLabel}>{report.levelLabel}</span>
        <Link href="/dashboard/health" className="shrink-0 underline opacity-80 hover:opacity-100 whitespace-nowrap">
          {t.collab.demoHowToEnable} →
        </Link>
        <button
          type="button"
          aria-label={t.collab.demoHowToEnable}
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
            setReport(null);
          }}
          className="shrink-0 opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      </div>

      {/* 明细:各环节真/示意 chips(逐环节如实标注) */}
      {report.stages.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
          {report.stages.map((s) => (
            <span
              key={s.key}
              title={`${s.label}:${s.real ? t.collab.readinessReal : t.collab.readinessSim}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                s.real
                  ? 'border-emerald-500/35 text-emerald-300'
                  : 'border-[var(--cinema-amber-deep,#8a6d1f)] text-[var(--cinema-amber,#E8C547)] opacity-90'
              }`}
            >
              <span aria-hidden="true">{s.real ? '✓' : '○'}</span>
              {s.label}
              <span className="opacity-75">· {s.real ? t.collab.readinessReal : t.collab.readinessSim}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
