'use client';

import Link from 'next/link';
import { Check, X, CreditCard, Lightning as Zap, Shield, HeadphonesIcon, Buildings as Building2, ArrowRight, PenNib as PenTool } from '@phosphor-icons/react';
import { PRICING_TIERS, PricingTier } from '@/lib/pricing';
import { useLocale } from '@/hooks/use-locale';

function TierIcon({ id, color }: { id: string; color: string }) {
  const cls = 'w-5 h-5';
  if (id === 'free') return <CreditCard className={cls} style={{ color }} />;
  if (id === 'creator') return <Zap className={cls} style={{ color }} />;
  if (id === 'pro') return <Shield className={cls} style={{ color }} />;
  return <Building2 className={cls} style={{ color }} />;
}

function TierCard({ tier }: { tier: PricingTier }) {
  const { t } = useLocale();
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
            {t.billing.recommended}
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
            <span className="text-3xl font-bold text-white">{t.pricing.custom}</span>
            <p className="text-xs text-[var(--muted)] mt-1">{t.pricing.customNote}</p>
          </div>
        ) : (
          <div className="flex items-end gap-1">
            {!isFree && <span className="text-lg text-[var(--muted)] mb-1">¥</span>}
            <span
              className="text-4xl font-bold"
              style={{ color: isRecommended ? '#E8C547' : 'white' }}
            >
              {isFree ? t.pricing.free : tier.price}
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
            <li className="flex items-start gap-2.5">
              <X className="w-4 h-4 mt-0.5 shrink-0 text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)] line-through decoration-[var(--muted)]/40">{t.pricing.apiAccess}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <X className="w-4 h-4 mt-0.5 shrink-0 text-[var(--muted)]" />
              <span className="text-sm text-[var(--muted)] line-through decoration-[var(--muted)]/40">{t.pricing.commercialLicense}</span>
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
          {t.billing.contactUs}
        </a>
      ) : isFree ? (
        <Link
          href="/dashboard"
          className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-[var(--border)] text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-strong)] hover:border-[var(--border-hover)] transition-all"
        >
          {t.pricing.startUsing}
          <ArrowRight className="w-4 h-4" />
        </Link>
      ) : (
        <Link
          href="/dashboard/billing"
          className={`flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${
            isRecommended
              ? 'bg-[#E8C547] hover:bg-[#D4A830] text-[#0C0C0C] shadow-md shadow-[#E8C547]/20'
              : 'bg-[var(--surface-strong)] hover:bg-white/10 text-white border border-[var(--border)] hover:border-[var(--border-hover)]'
          }`}
        >
          {t.billing.upgradeTo} {tier.name}
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}

export default function PricingPage() {
  const { t } = useLocale();
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
            {t.pricing.enterWorkbench}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 pt-16 pb-10 text-center outline-none">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8C547]/10 border border-[#E8C547]/20 mb-6">
          <CreditCard className="w-3.5 h-3.5 text-[#E8C547]" />
          <span className="text-xs font-medium text-[#E8C547]">{t.pricing.badge}</span>
        </div>
        <h1 className="text-4xl font-bold text-white mb-4">
          {t.pricing.titleLead}<span className="text-[#E8C547]">{t.pricing.titleHighlight}</span>
        </h1>
        <p className="text-[var(--muted)] text-lg max-w-xl mx-auto">
          {t.pricing.subtitle}
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
          {t.pricing.footnote}
        </p>
      </div>

      {/* FAQ */}
      <div className="max-w-3xl mx-auto px-4 pb-24">
        <h2 className="text-2xl font-bold text-white text-center mb-10">{t.pricing.faqTitle}</h2>
        <div className="space-y-4">
          {t.pricing.faq.map((item, i) => (
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
          <h3 className="text-xl font-bold text-white mb-2">{t.pricing.moreTitle}</h3>
          <p className="text-[var(--muted)] text-sm mb-5">{t.pricing.moreDesc}</p>
          <a
            href="mailto:support@qingfeng.ai"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E8C547] text-[#0C0C0C] text-sm font-bold hover:bg-[#D4A830] transition-colors"
          >
            <HeadphonesIcon className="w-4 h-4" />
            {t.pricing.contactSupport}
          </a>
        </div>
      </div>
    </div>
  );
}
