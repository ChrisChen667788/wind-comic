'use client';

import { useState } from 'react';

export function LanguageToggle() {
  const [lang, setLang] = useState('zh');

  return (
    <button
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--border)] bg-[rgba(255,255,255,0.08)] backdrop-blur-[20px] hover:bg-[rgba(255,255,255,0.12)] transition-all"
    >
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
