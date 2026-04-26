'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { SectionTitle } from '@/components/ui/section-title';

export default function CasesPublicPage() {
  const [cases, setCases] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/cases')
      .then((r) => r.json())
      .then((d) => setCases(d))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="px-[5vw] py-20">
        <SectionTitle title="案例精选" subtitle="来自青枫漫剧合作伙伴与创作者" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cases.map((c) => (
            <div key={c.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-[20px] overflow-hidden group transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
              <div className="relative h-[220px] overflow-hidden">
                <img src={c.coverUrl} alt={c.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                <button className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[46px] h-[46px] rounded-full border border-[var(--border)] bg-[rgba(0,0,0,0.5)] text-white cursor-pointer">▶</button>
              </div>
              <div className="p-4">
                <span className="text-xs text-[var(--soft)]">{c.category}</span>
                <h4 className="font-semibold mt-1 mb-2">{c.title}</h4>
                <div className="flex items-center gap-2.5 text-[var(--soft)]">
                  <img src={c.authorAvatar} alt={c.authorName} className="w-7 h-7 rounded-full" />
                  <span className="text-xs">{c.authorName}</span>
                </div>
                <div className="flex gap-3 text-xs text-[var(--soft)] mt-2.5">
                  <span>👁 {c.metrics?.views || 0}</span>
                  <span>❤ {c.metrics?.likes || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
