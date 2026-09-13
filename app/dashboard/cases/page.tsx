'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Play, Sparkle as Sparkles } from '@phosphor-icons/react';
import { useLocale } from '@/hooks/use-locale';
import { loadList } from '@/lib/load-list';
import { LoadErrorState } from '@/components/ui/load-error-state';
import { caseSeedIdea } from '@/lib/case-seed';

export default function CasesPage() {
  const { t } = useLocale();
  const [cases, setCases] = useState<any[]>([]);
  // v12.434:这页原本连**空态都没有** —— fetch 挂了 cases 保持 [],
  // 网格渲染零张卡片,用户看到的是标题下面一片空白,没有加载中、没有出错、也没有「暂无案例」。
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const router = useRouter();

  const fetchCases = async () => {
    setLoading(true);
    setLoadError(null);
    const r = await loadList<any>('/api/cases');
    if (r.ok) setCases(r.items);
    else setLoadError(r.reason);
    setLoading(false);
  };

  useEffect(() => { void fetchCases(); }, []);

  // Vidu-style: one-click copy prompt to clipboard and navigate to create
  const handleCopyPrompt = (c: any, e: React.MouseEvent) => {
    e.stopPropagation();
    // v12.436:cases 表没有 prompt 列,修前永远只复制到标题(「月华藏境」四个字)
    const promptText = caseSeedIdea(c);
    navigator.clipboard.writeText(promptText).then(() => {
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleUsePrompt = (c: any, e: React.MouseEvent) => {
    e.stopPropagation();
    // v12.436:修前带过去的是 4 个字的标题,创作页开机门槛 10 字 —— 跳过去按钮是灰的
    const promptText = caseSeedIdea(c);
    // Navigate to create page with the prompt pre-filled
    router.push(`/dashboard/create?idea=${encodeURIComponent(promptText)}`);
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">{t.cases.title}</h2>
        <p className="text-sm text-[var(--muted)] mt-1">{t.cases.subtitleReuse}</p>
      </div>

      {loading ? (
        <div className="text-center py-20 text-[var(--muted)]">
          <div className="w-8 h-8 border-2 border-[#E8C547] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <span className="text-sm">加载中…</span>
        </div>
      ) : loadError ? (
        <LoadErrorState what="案例库" reason={loadError} onRetry={fetchCases} />
      ) : cases.length === 0 ? (
        <div className="text-center py-20 text-[var(--muted)]">
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <p className="text-sm">暂无案例</p>
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cases.map((c) => (
          <div key={c.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-md overflow-hidden group transition-colors duration-300 hover:border-[var(--cinema-amber)]/40">
            <div className="relative aspect-video overflow-hidden bg-black">
              {/* 题材签在画面容器顶层渲染 —— 初版把它放进了「有视频才渲染」的分支里,
                  同时从信息区删掉了原来的题材文字:没有视频的案例会连题材一起丢掉。 */}
              {(c.category || c.videoUrl) && (
                <span className="absolute top-2 left-2 z-10 flex items-center gap-1">
                  {c.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--cinema-amber)]/85 text-black font-medium">{c.category}</span>
                  )}
                  {/* 「示意片段」是版权诚实标记(引用自公开影视作品),有视频就必须在 */}
                  {c.videoUrl && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/55 text-white/80 border border-white/10 backdrop-blur-sm">示意片段</span>
                  )}
                </span>
              )}
              {playingId === c.id && c.videoUrl ? (
                <video
                  src={c.videoUrl}
                  className="w-full h-full object-cover bg-black"
                  autoPlay loop playsInline controls
                />
              ) : (
                <>
                  {/* v9.5.5 修复:有视频的卡片直接静音循环自动播放(展示真片段),非仅 gradient 占位 */}
                  {c.videoUrl ? (
                    <video
                      src={c.videoUrl}
                      className="w-full h-full object-cover bg-black transition-transform duration-300 group-hover:scale-105"
                      autoPlay muted loop playsInline preload="metadata"
                    />
                  ) : (
                    <img loading="lazy" decoding="async" src={c.coverUrl} alt={c.title} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  )}
                  {c.videoUrl && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlayingId(c.id); }}
                        aria-label="有声播放"
                        className="absolute top-2.5 right-2.5 z-10 text-[10px] px-2 py-1 rounded-full bg-black/55 text-white/90 border border-white/15 backdrop-blur-sm inline-flex items-center gap-1 cursor-pointer hover:bg-black/75 transition-all"
                      >
                        <Play weight="fill" className="w-2.5 h-2.5" /> 有声播放
                      </button>
                    </>
                  )}

                  {/* Vidu-style: hover overlay with copy/use prompt buttons */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3">
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={(e) => handleCopyPrompt(c, e)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 backdrop-blur-sm hover:bg-white/20 text-xs text-white transition-all border border-white/10"
                      >
                        {copiedId === c.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        {copiedId === c.id ? t.cases.copied : t.cases.copyPrompt}
                      </button>
                      <button
                        onClick={(e) => handleUsePrompt(c, e)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E8C547]/80 hover:bg-[#E8C547] text-xs text-white transition-all"
                      >
                        <Sparkles className="w-3 h-3" />
                        {t.cases.usePrompt}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {/* v12.436:信息区只留标题 + 一句「拿去就能开机」的创意。
                去掉了作者行和播放/点赞 —— 那两个数是种子数据(1129 赞 / 4112 播放),
                不是真实互动,而在自己的案例库里摆假热度没有意义。 */}
            <div className="p-2.5">
              <h4 className="text-[13px] font-semibold leading-snug line-clamp-1">{c.title}</h4>
              <p className="text-[11px] text-[var(--soft)] line-clamp-2 leading-relaxed mt-0.5">{caseSeedIdea(c)}</p>
            </div>
          </div>
        ))}
      </div>
      )}

      <p className="mt-6 text-[11px] text-[var(--soft)] leading-relaxed max-w-3xl">
        ⚠️ 部分卡片的「示意片段」引用自公开影视作品(如《英雄联盟：双城之战 / Arcane》，版权归 Riot Games · Fortiche · Netflix），
        仅用于个人学习与画风参考、<strong className="text-[var(--muted)]">非商业用途</strong>，版权归原作者所有。正式上线请替换为自有或已授权素材。
      </p>
    </div>
  );
}
