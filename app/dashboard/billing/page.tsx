'use client';

/**
 * /dashboard/billing · Sprint C.2 — 订阅管理页
 *
 * 4 卡:Free / Creator / Pro / Enterprise. 当前 tier 高亮.
 * 点"升级到 X" → POST /api/stripe/checkout → 重定向到 Stripe Checkout.
 * Stripe 跳回时带 ?status=success 或 ?status=canceled, 我们渲染 toast.
 *
 * 不直接做"降级 / 取消" — 那走 Stripe 的 Customer Portal (Stripe 自己的页面).
 * MVP 里把 Customer Portal 链接当 placeholder, 等用户配 STRIPE_PORTAL_LINK 再启用.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Check, Star, ExternalLink } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { PRICING_TIERS } from '@/lib/pricing';
import { useToast } from '@/components/ui/toast-provider';

export default function BillingPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const params = useSearchParams();
  const [currentTier, setCurrentTier] = useState<string>('free');
  const [busy, setBusy] = useState<string | null>(null);

  // 从 /api/auth/me 拿 subscription_tier(/api/auth/me 已经返回, 见下方注释)
  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
        const res = await fetch('/api/auth/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.subscriptionTier) setCurrentTier(data.subscriptionTier);
        }
      } catch { /* 静默 — 默认 free */ }
    };
    fetchPlan();
  }, [user]);

  // Stripe 跳回时显示状态
  useEffect(() => {
    const status = params.get('status');
    if (status === 'success') {
      const tier = params.get('tier');
      showToast({ title: `🎉 已升级到 ${tier || '新档位'}!订阅已激活`, type: 'success' });
    } else if (status === 'canceled') {
      showToast({ title: '已取消支付', type: 'info' });
    }
  }, [params, showToast]);

  const startCheckout = async (tier: string) => {
    if (tier === 'free') return;
    setBusy(tier);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast({ title: data.error || 'Checkout 失败', type: 'error' });
        return;
      }
      // 跳到 Stripe Checkout 页
      window.location.href = data.url;
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : 'Checkout 失败', type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">订阅管理</h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          当前档位:<span className="text-[#E8C547] font-semibold">{tierLabel(currentTier)}</span>
          <span className="text-white/30 mx-2">·</span>
          支付走 Stripe Checkout(国际版),取消 / 改卡走 Stripe Customer Portal
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PRICING_TIERS.map(tier => {
          const isCurrent = tier.id === currentTier;
          const isFree = tier.id === 'free';
          const isCustom = tier.price === -1;
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl border p-5 flex flex-col ${
                isCurrent
                  ? 'border-[#E8C547] bg-[#E8C547]/5'
                  : tier.recommended
                    ? 'border-[#E8C547]/40 bg-white/[0.03]'
                    : 'border-white/10 bg-white/[0.02]'
              }`}
            >
              {tier.recommended && !isCurrent && (
                <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-[#E8C547] text-black text-[10px] font-bold flex items-center gap-1">
                  <Star className="w-2.5 h-2.5 fill-current" />
                  推荐
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold">
                  当前档位
                </div>
              )}
              <div className="mb-3">
                <div className="text-xs text-[var(--soft)] uppercase tracking-wider">{tier.nameEn}</div>
                <div className="text-xl font-bold mt-0.5" style={{ color: tier.color }}>
                  {tier.name}
                </div>
              </div>
              <div className="mb-4">
                {isCustom ? (
                  <div className="text-2xl font-bold">联系我们</div>
                ) : (
                  <>
                    <span className="text-3xl font-bold tabular-nums">¥{tier.price}</span>
                    <span className="text-sm text-[var(--soft)] ml-1">/月</span>
                  </>
                )}
              </div>
              <ul className="text-xs text-white/70 space-y-1.5 mb-5 flex-1">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Check className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => startCheckout(tier.id)}
                disabled={isCurrent || isFree || busy !== null}
                className={`w-full px-3 py-2 rounded-lg text-sm font-semibold transition ${
                  isCurrent
                    ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                    : isFree
                      ? 'bg-white/5 text-white/40 cursor-not-allowed'
                      : 'bg-[#E8C547] hover:bg-[#E8C547]/90 text-black'
                }`}
              >
                {isCurrent ? (
                  <>✓ 已是此档位</>
                ) : isFree ? (
                  <>免费 · 无需购买</>
                ) : busy === tier.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : isCustom ? (
                  <>商务洽谈</>
                ) : (
                  <>升级到 {tier.name}</>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-8 p-4 bg-white/5 border border-white/10 rounded-xl">
        <h2 className="text-sm font-semibold mb-2">订阅管理</h2>
        <p className="text-xs text-[var(--soft)] leading-relaxed">
          升级、降级、取消订阅、修改支付方式 都在 Stripe Customer Portal 里完成 —
          点下方按钮跳转(自托管时需配置 <code className="text-[#E8C547]">STRIPE_PORTAL_LINK</code>)。
        </p>
        {process.env.NEXT_PUBLIC_STRIPE_PORTAL_LINK && (
          <a
            href={process.env.NEXT_PUBLIC_STRIPE_PORTAL_LINK}
            target="_blank"
            rel="noopener"
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
          >
            <ExternalLink className="w-3 h-3" />
            打开 Stripe Customer Portal
          </a>
        )}
      </div>
    </div>
  );
}

function tierLabel(id: string): string {
  return PRICING_TIERS.find(t => t.id === id)?.name || '免费版';
}
