'use client';

import Link from 'next/link';
import { Check, X, CreditCard, Zap, Shield, HeadphonesIcon, Building2, ArrowRight, PenTool } from 'lucide-react';
import { PRICING_TIERS, PricingTier } from '@/lib/pricing';

const FAQ_ITEMS = [
  {
    q: '免费版有哪些限制？',
    a: '免费版每月可创建 3 个项目，角色库最多存储 5 个角色，视频导出分辨率为 720p，并包含青枫水印。适合个人体验使用。',
  },
  {
    q: '升级后能立即使用新功能吗？',
    a: '是的，付款成功后系统将立即激活对应套餐的权益，无需等待审核。',
  },
  {
    q: '专业版的商业授权包含哪些范围？',
    a: '专业版商业授权允许将使用青枫漫剧生成的内容用于商业目的，包括广告、品牌宣传、影视发行等，但不包含源模型的二次训练权利。',
  },
  {
    q: '企业版与专业版的主要区别是什么？',
    a: '企业版支持私有化部署，可将整套 AI 系统部署在您的私有服务器上，并提供自定义 AI 智能体开发、SLA 保障和专属客户成功经理服务。',
  },
  {
    q: '可以随时取消订阅吗？',
    a: '可以，您可以随时在账户设置中取消订阅。取消后，当前付费周期结束前仍可正常使用所有功能。',
  },
];

function TierIcon({ id, color }: { id: string; color: string }) {
  const cls = 'w-5 h-5';
  if (id === 'free') return <CreditCard className={cls} style={{ color }} />;
  if (id === 'creator') return <Zap className={cls} style={{ color }} />;
  if (id === 'pro') return <Shield className={cls} style={{ color }} />;
  return <Building2 className={cls} style={{ color }} />;
}

function TierCard({ tier }: { tier: PricingTier }) {
  const isFree = tier.price === 0;
  const isEnterprise = tier.price === -1;
  const isRecommended = !!tier.recommended;

  return (
    <div
      className={`relative flex flex-col rounded-2xl p-6 border transition-all duration-200 hover:scale-[1.02] ${
        isRecommended
          ? 'border-[#E8C547] bg-gradient-to-b from-[#E8C547]/08 to-[#E8C547]/03 shadow-lg shadow-[#E8C547]/10'
          : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-hover)]'
      }`}
    >
      {isRecommended && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#E8C547] text-[#0C0C0C] text-xs font-bold shadow-md whitespace-nowrap">
            <Zap className="w-3 h-3" />
            推荐
          </span>
        </div>
      )}

      {/* Tier header */}
      <div className="mb-5">
        <div
          className="w-10 h-10 rounded-xl grid place-items-center mb-3"
          style={{ background: `${tier.color}20` }}
        >
          <TierIcon id={tier.id} color={tier.color} />
        </div>
        <h3 className="text-lg font-bold text-white">{tier.name}</h3>
        <p className="text-xs text-[var(--muted)] mt-0.5">{tier.nameEn}</p>
      </div>

      {/* Price */}
      <div className="mb-6">
        {isEnterprise ? (
          <div>
            <span className="text-3xl font-bold text-white">定制</span>
            <p className="text-xs text-[var(--muted)] mt-1">按需报价，联系销售</p>
          </div>
        ) : (
          <div className="flex items-end gap-1">
            {!isFree && <span className="text-lg text-[var(--muted)] mb-1">¥</span>}
            <span
              className="text-4xl font-bold"
              style={{ color: isRecommended ? '#E8C547' : 'white' }}
            >
              {isFree ? '免费' : tier.price}
            </span>
            {!isFree && (
              <span className="text-sm text-[var(--muted)] mb-1.5">
                /{tier.priceUnit.replace('元/', '')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-2.5 mb-8 flex-1">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <Check
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: isRecommended ? '#E8C547' : tier.color }}
            />
            <span className="text-sm text-[var(--text)]">{feature}</span>
          </li>
        ))}
        {tier.id === 'free' && (
          <>
            <li className="flex items-start gap-2.5 opacity-50">
              <X className="w-4 h-4 mt-0.5 shrink-0 text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)]">API 访问</span>
            </li>
            <li className="flex items-start gap-2.5 opacity-50">
              <X className="w-4 h-4 mt-0.5 shrink-0 text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)]">商业授权</span>
            </li>
          </>
        )}
      </ul>

      {/* CTA */}
      {isEnterprise ? (
        <a
          href="mailto:enterprise@qingfeng.ai"
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-[var(--border)] text-sm font-medium text-white hover:bg-[var(--surface-strong)] hover:border-[var(--border-hover)] transition-all"
        >
          <HeadphonesIcon className="w-4 h-4" />
          联系我们
        </a>
      ) : isFree ? (
        <Link
          href="/dashboard"
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-strong)] hover:border-[var(--border-hover)] transition-all"
        >
          开始使用
          <ArrowRight className="w-4 h-4" />
        </Link>
      ) : (
        <button
          className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
            isRecommended
              ? 'bg-[#E8C547] hover:bg-[#D4A830] text-[#0C0C0C] shadow-md shadow-[#E8C547]/20'
              : 'bg-[var(--surface-strong)] hover:bg-white/10 text-white border border-[var(--border)] hover:border-[var(--border-hover)]'
          }`}
          onClick={() => alert('支付功能即将上线，敬请期待！')}
        >
          升级到{tier.name}
          <ArrowRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      {/* Minimal top nav */}
      <nav className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md grid place-items-center bg-gradient-to-br from-[#E8C547] to-[#D4A830]">
              <PenTool className="w-3.5 h-3.5 text-[#0C0C0C]" />
            </div>
            <span className="text-[15px] font-bold text-white">青枫漫剧</span>
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#E8C547] text-[#0C0C0C] text-sm font-bold hover:bg-[#D4A830] transition-colors"
          >
            进入工作台
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-4 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8C547]/10 border border-[#E8C547]/20 mb-6">
          <CreditCard className="w-3.5 h-3.5 text-[#E8C547]" />
          <span className="text-xs font-medium text-[#E8C547]">定价方案</span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-4">
          选择适合你的<span className="text-[#E8C547]">创作套餐</span>
        </h1>
        <p className="text-[var(--muted)] text-lg max-w-xl mx-auto">
          从免费体验到企业私有化部署，青枫漫剧为每位创作者提供最合适的 AI 漫剧制作方案
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-4">
          {PRICING_TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} />
          ))}
        </div>
        <p className="text-center text-xs text-[var(--soft)] mt-8">
          所有套餐均包含 7×24 小时 AI 引擎支持 · 付款后立即生效 · 随时可取消
        </p>
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold text-white text-center mb-10">常见问题</h2>
        <div className="space-y-4">
          {FAQ_ITEMS.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 hover:border-[var(--border-hover)] transition-colors"
            >
              <h3 className="font-semibold text-white text-sm mb-2">{item.q}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center p-8 rounded-2xl border border-[#E8C547]/20 bg-gradient-to-br from-[#E8C547]/06 to-transparent">
          <h3 className="text-xl font-bold text-white mb-2">还有其他问题？</h3>
          <p className="text-[var(--muted)] text-sm mb-5">我们的团队随时为你解答疑问</p>
          <a
            href="mailto:support@qingfeng.ai"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E8C547] text-[#0C0C0C] text-sm font-bold hover:bg-[#D4A830] transition-colors"
          >
            <HeadphonesIcon className="w-4 h-4" />
            联系支持团队
          </a>
        </div>
      </div>
    </div>
  );
}
