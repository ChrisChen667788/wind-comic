'use client';

/**
 * v5.0 — 当前 locale hook.
 *
 * 优先级: localStorage('qfmj-locale') > 浏览器 navigator.language > 'zh-CN'.
 * setLocale 持久化 + 广播 (同 tab 多组件同步) + 设 <html lang>.
 */

import { useCallback, useEffect, useState } from 'react';
import { normalizeLocale, getTranslations, type Locale } from '@/lib/i18n';

const KEY = 'qfmj-locale';
const EVT = 'qfmj-locale-change';

function readInitial(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  const saved = localStorage.getItem(KEY);
  if (saved) return normalizeLocale(saved);
  return normalizeLocale(navigator.language);
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>('zh-CN');

  useEffect(() => {
    setLocaleState(readInitial());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Locale>).detail;
      if (next) setLocaleState(next);
    };
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    const norm = normalizeLocale(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(KEY, norm);
      document.documentElement.lang = norm;
      window.dispatchEvent(new CustomEvent(EVT, { detail: norm }));
    }
    setLocaleState(norm);
  }, []);

  return { locale, setLocale, t: getTranslations(locale) };
}
