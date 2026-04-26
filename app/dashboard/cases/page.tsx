'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Play, Eye, Heart, Sparkles } from 'lucide-react';

export default function CasesPage() {
  const [cases, setCases] = useState<any[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/cases')
      .then((r) => r.json())
      .then((d) => setCases(d))
      .catch(() => {});
  }, []);

  // Vidu-style: one-click copy prompt to clipboard and navigate to create
  const handleCopyPrompt = (c: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = c.prompt || c.description || c.title;
    navigator.clipboard.writeText(promptText).then(() => {
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleUsePrompt = (c: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const promptText = c.prompt || c.description || c.title;
    // Navigate to create page with the prompt pre-filled
    router.push(`/dashboard/create?idea=${encodeURIComponent(promptText)}`);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">案例库</h2>
        <p className="text-sm text-[var(--muted)] mt-1">来自青枫漫剧合作伙伴与创作者 · 点击一键复用创意</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cases.map((c) => (
          <div key={c.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-[20px] overflow-hidden group transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <div className="relative h-[220px] overflow-hidden">
              <img src={c.coverUrl} alt={c.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <button className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[46px] h-[46px] rounded-full border border-[var(--border)] bg-[rgba(0,0,0,0.5)] text-white cursor-pointer hover:bg-[rgba(0,0,0,0.7)] transition-colors">
                <Play className="w-4 h-4 mx-auto" />
              </button>

              {/* Vidu-style: hover overlay with copy/use prompt buttons */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3">
                <div className="flex gap-2 w-full">
                  <button
                    onClick={(e) => handleCopyPrompt(c, e)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 backdrop-blur-sm hover:bg-white/20 text-xs text-white transition-all border border-white/10"
                  >
                    {copiedId === c.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    {copiedId === c.id ? '已复制' : '复制提示词'}
                  </button>
                  <button
                    onClick={(e) => handleUsePrompt(c, e)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E8C547]/80 hover:bg-[#E8C547] text-xs text-white transition-all"
                  >
                    <Sparkles className="w-3 h-3" />
                    用这个创作
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4">
              <span className="text-xs text-[var(--soft)]">{c.category}</span>
              <h4 className="font-semibold mt-1 mb-2">{c.title}</h4>
              {/* Prompt preview */}
              {(c.prompt || c.description) && (
                <p className="text-[11px] text-gray-500 line-clamp-2 mb-2 italic">
                  &ldquo;{(c.prompt || c.description).slice(0, 80)}&rdquo;
                </p>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-[var(--soft)]">
                  <img src={c.authorAvatar} alt={c.authorName} className="w-7 h-7 rounded-full" />
                  <span className="text-xs">{c.authorName}</span>
                </div>
                <div className="flex gap-2.5 text-[10px] text-[var(--soft)]">
                  <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" /> {c.metrics?.views || 0}</span>
                  <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" /> {c.metrics?.likes || 0}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
