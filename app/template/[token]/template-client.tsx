'use client';

/**
 * /template/[token] · v2.18 P2.3 — 分享模板的公开落地页 (client part)
 *
 * v2.19 P0.3: 拆成 server page.tsx (generateMetadata + OG meta) + 这个 client。
 * 任何人都能访问 (无 auth). 点 "克隆到我的库" 触发 POST clone 端点 — 那个端点
 * 要求 auth, 没登录的用户被引导去登录后回流.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Check, Eye, Users, Warning as AlertTriangle, ArrowLeft, CircleNotch as Loader2 } from '@phosphor-icons/react';

interface SharedTemplate {
  token: string;
  template: {
    id: string;
    name: string;
    nameEn?: string;
    icon?: string;
    description?: string;
    exampleIdea?: string;
    structureHint?: string;
    emotionCurve?: string;
    keyElements?: string[];
    styleRecommendation?: string;
    shotCount?: { min: number; max: number };
    colorPalette?: string;
    tags?: string[];
    recommendedDuration?: 5 | 6 | 10 | 15;
    recommendedAspect?: string;
    recommendedCamera?: string;
  };
  ownerName?: string;
  viewCount: number;
  cloneCount: number;
  createdAt: string;
}

export default function SharedTemplateClient({ token }: { token: string }) {
  const [data, setData] = useState<SharedTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        const res = await fetch(`/api/templates/shared/${encodeURIComponent(token)}`);
        const body = await res.json();
        if (!res.ok) {
          setError(body.error || '加载失败');
          return;
        }
        setData(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
  }, [token]);

  const doClone = async () => {
    setCloning(true);
    try {
      const res = await fetch(`/api/templates/shared/${encodeURIComponent(token)}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || '克隆失败');
        return;
      }
      setCloned({ id: body.newAssetId, name: body.newAssetName });
    } catch (e) {
      alert(e instanceof Error ? e.message : '克隆失败');
    } finally {
      setCloning(false);
    }
  };

  if (loading) {
    return (
      <div className="cinema-page min-h-screen flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--cinema-amber)]" />
          <p className="cinema-mono text-[11px] opacity-70">加载分享模板...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="cinema-page min-h-screen flex items-center justify-center text-white px-4">
        <div className="cinema-card-hi p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-10 h-10 text-[var(--cinema-amber)] mx-auto mb-3" />
          <h1 className="cinema-headline text-lg mb-2">链接不可用</h1>
          <p className="cinema-mono text-[11px] opacity-70 mb-4">{error || '该分享模板不存在或已过期'}</p>
          <Link href="/dashboard/create" className="cinema-btn cinema-btn-primary !text-[12px]">
            去自己创建一个
          </Link>
        </div>
      </div>
    );
  }

  const t = data.template;

  return (
    <div className="cinema-page min-h-screen text-white">
      {/* nav */}
      <nav className="sticky top-0 z-30 bg-[var(--cinema-surface)]/85 backdrop-blur-xl border-b border-[var(--cinema-border)]">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/dashboard/create" className="cinema-btn-ghost cinema-btn !p-2 inline-flex items-center gap-1 !text-[11px]">
            <ArrowLeft className="w-3.5 h-3.5" />
            返回创作工坊
          </Link>
          <div className="flex items-center gap-2">
            <span className="cinema-chip cinema-chip-amber">
              <Eye className="w-3 h-3" />
              {data.viewCount}
            </span>
            <span className="cinema-chip">
              <Copy className="w-3 h-3" />
              {data.cloneCount} 克隆
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        {/* 顶部:icon + 名字 + 作者 */}
        <div className="cinema-card-hi p-5 flex items-start gap-4">
          <div className="text-5xl">{t.icon || '📄'}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="cinema-eyebrow">SHARED TEMPLATE</span>
              {data.ownerName && (
                <span className="cinema-mono text-[10px] opacity-50 inline-flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  by {data.ownerName}
                </span>
              )}
            </div>
            <h1 className="cinema-headline text-2xl truncate">{t.name}</h1>
            {t.nameEn && <div className="cinema-mono text-[11px] opacity-50 mt-0.5">{t.nameEn}</div>}
            {t.description && (
              <p className="cinema-subhead text-sm mt-2 opacity-85 leading-relaxed">{t.description}</p>
            )}
          </div>
        </div>

        {/* 操作:克隆 / 立刻用 */}
        {cloned ? (
          <div className="cinema-card-hi p-5 border-[var(--cinema-green)]/40">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-5 h-5 text-[var(--cinema-green)]" />
              <h3 className="cinema-headline text-base">已克隆到你的模板库</h3>
            </div>
            <p className="cinema-mono text-[11px] opacity-75 mb-4">
              新模板:「{cloned.name}」(id: {cloned.id.slice(0, 12)}...) 已保存到你的个人库, 下次创作时在
              "故事模板库" 里就能看到。
            </p>
            <Link href="/dashboard/create" className="cinema-btn cinema-btn-primary !text-[12px]">
              去使用 →
            </Link>
          </div>
        ) : (
          <div className="cinema-card-hi p-5 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="cinema-eyebrow mb-1">克隆到自己的模板库</div>
              <p className="cinema-mono text-[11px] opacity-70">
                克隆后这个模板会出现在你的个人库, 后续可改可删, 不影响原作者。
              </p>
            </div>
            <button
              onClick={doClone}
              disabled={cloning}
              className="cinema-btn cinema-btn-primary !px-4 !py-2 !text-[12px] inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {cloning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {cloning ? '克隆中…' : '克隆到我的库'}
            </button>
          </div>
        )}

        {/* 详情卡 */}
        {t.exampleIdea && (
          <div className="cinema-card-hi p-4">
            <div className="cinema-eyebrow mb-2">EXAMPLE IDEA · 示例创意</div>
            <p className="cinema-subhead text-[12.5px] opacity-90 leading-relaxed">{t.exampleIdea}</p>
          </div>
        )}

        {t.structureHint && (
          <div className="cinema-card-hi p-4">
            <div className="cinema-eyebrow mb-2">STRUCTURE · 结构提示</div>
            <p className="cinema-subhead text-[11.5px] opacity-85 leading-relaxed">{t.structureHint}</p>
          </div>
        )}

        {((t.keyElements && t.keyElements.length > 0) || (t.tags && t.tags.length > 0)) && (
          <div className="grid sm:grid-cols-2 gap-3">
            {t.keyElements && t.keyElements.length > 0 && (
              <div className="cinema-card-hi p-3">
                <div className="cinema-eyebrow mb-2">KEY ELEMENTS</div>
                <div className="flex flex-wrap gap-1">
                  {t.keyElements.map((el) => (
                    <span key={el} className="cinema-chip cinema-chip-amber">
                      {el}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {t.tags && t.tags.length > 0 && (
              <div className="cinema-card-hi p-3">
                <div className="cinema-eyebrow mb-2">TAGS</div>
                <div className="flex flex-wrap gap-1">
                  {t.tags.map((tg) => (
                    <span key={tg} className="cinema-chip">{tg}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="cinema-card p-4">
          <div className="cinema-eyebrow mb-2">RECOMMENDED · 推荐设置</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 cinema-mono text-[11px]">
            <div>
              <div className="opacity-50">画风</div>
              <div className="opacity-90">{t.styleRecommendation || '—'}</div>
            </div>
            <div>
              <div className="opacity-50">时长</div>
              <div className="opacity-90">{t.recommendedDuration ? `${t.recommendedDuration}s` : '—'}</div>
            </div>
            <div>
              <div className="opacity-50">画幅</div>
              <div className="opacity-90">{t.recommendedAspect || '—'}</div>
            </div>
            <div>
              <div className="opacity-50">运镜</div>
              <div className="opacity-90">{t.recommendedCamera || '—'}</div>
            </div>
          </div>
        </div>

        {t.colorPalette && (
          <div className="cinema-card p-3">
            <div className="cinema-eyebrow mb-1">COLOR PALETTE</div>
            <p className="cinema-mono text-[11px] opacity-75">{t.colorPalette}</p>
          </div>
        )}
      </main>
    </div>
  );
}
