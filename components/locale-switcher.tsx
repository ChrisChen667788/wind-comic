'use client';

/**
 * v5.0 — 语言切换器.
 *
 * 下拉选 简/繁/英/日, 即时切换 (走 useLocale, localStorage 持久化 + 广播).
 */

import { useState } from 'react';
import { Globe, Check, CaretDown as ChevronDown } from '@phosphor-icons/react';
import { useLocale } from '@/hooks/use-locale';
import { LOCALES, LOCALE_LABELS } from '@/lib/i18n';

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-2.5 py-1.5 text-[11px] inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-white hover:border-[var(--border-hover,var(--border))] transition-colors"
        title="切换语言 / Language"
      >
        <Globe className="w-3.5 h-3.5" />
        {!compact && <span>{LOCALE_LABELS[locale]}</span>}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 mt-1 w-32 z-30 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl">
            {LOCALES.map((l) => (
              <button
                key={l}
                onClick={() => { setLocale(l); setOpen(false); }}
                className="w-full text-left px-2.5 py-1.5 rounded-md text-[11px] text-white/80 hover:bg-white/10 inline-flex items-center justify-between gap-2"
              >
                {LOCALE_LABELS[l]}
                {l === locale && <Check className="w-3 h-3 text-emerald-400" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
