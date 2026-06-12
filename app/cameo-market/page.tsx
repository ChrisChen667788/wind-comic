'use client';

/**
 * v4.0 — Cameo IP 市场页.
 *
 * 浏览公开角色 IP token, 看授权级别/版税, 申请复用. 创作者经济雏形.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkle as Sparkles, CircleNotch as Loader2, Crown, Lock, Check } from '@phosphor-icons/react';

interface MarketToken {
  id: string;
  name: string;
  coverUrl: string | null;
  license: 'view' | 'remix' | 'commercial';
  royaltyCny: number;
  useCount: number;
  ownerId: string;
}

const LICENSE_LABEL: Record<MarketToken['license'], string> = {
  view: '仅查看',
  remix: '可二创',
  commercial: '可商用',
};

export default function CameoMarketPage() {
  const [tokens, setTokens] = useState<MarketToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cameo-ip?scope=market');
      const body = await res.json();
      setTokens(body.tokens || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const callAction = useCallback(async (tokenId: string, action: 'request-grant' | 'import') => {
    setRequesting(tokenId);
    setMsg(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
      const res = await fetch(`/api/cameo-ip/${encodeURIComponent(tokenId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, message: '希望在我的项目里复用这个角色' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (action === 'import') {
        setMsg(body.alreadyImported ? '该角色已在你的角色库中, 创作时可直接选用' : '已导入到你的角色库! 新建项目时即可选用此角色');
      } else {
        setMsg(body.grant?.status === 'pending' ? '已提交申请, 等作者审批' : '申请已记录');
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败');
    } finally {
      setRequesting(null);
    }
  }, []);

  return (
    <div className="cinema-page min-h-screen bg-[var(--cinema-bg,#0a0a0f)] text-white p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-white/60 hover:text-white text-sm">
          <ArrowLeft className="w-4 h-4" /> 返回
        </Link>
        <h1 className="inline-flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="w-5 h-5 text-fuchsia-400" /> Cameo IP 市场
        </h1>
        <div className="w-16" />
      </div>

      <p className="text-white/50 text-sm mb-6">
        浏览创作者公开的角色 IP。可二创/可商用的角色直接复用；仅查看的需申请作者授权。
      </p>

      {msg && <div className="mb-4 text-sm text-emerald-400">{msg}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/50 py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> 加载市场…
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-center text-white/40 py-16">市场还没有公开的角色 IP。</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {tokens.map((t) => {
            const open = t.license === 'remix' || t.license === 'commercial';
            return (
              <div key={t.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                <div className="aspect-[3/4] bg-gradient-to-br from-fuchsia-900/40 to-indigo-900/40 flex items-center justify-center">
                  {t.coverUrl
                    ? <img loading="lazy" decoding="async" src={t.coverUrl} alt={t.name} className="w-full h-full object-cover" />
                    : <Crown className="w-10 h-10 text-white/20" />}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{t.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${
                      open ? 'text-emerald-400 border-emerald-500/40' : 'text-amber-400 border-amber-500/40'
                    }`}>
                      {LICENSE_LABEL[t.license]}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-white/40 flex items-center gap-2">
                    <span>{t.royaltyCny > 0 ? `¥${t.royaltyCny}/次` : '免费'}</span>
                    <span>· 已复用 {t.useCount}</span>
                  </div>
                  {open ? (
                    <button
                      onClick={() => callAction(t.id, 'import')}
                      disabled={requesting === t.id}
                      className="mt-2 w-full cinema-btn cinema-btn-primary !py-1.5 !text-[11px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {requesting === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      导入到角色库
                    </button>
                  ) : (
                    <button
                      onClick={() => callAction(t.id, 'request-grant')}
                      disabled={requesting === t.id}
                      className="mt-2 w-full cinema-btn !py-1.5 !text-[11px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {requesting === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                      申请授权
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
