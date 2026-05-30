'use client';

/**
 * v6.5.1 — 接受团队邀请页. 被邀请人 (已有账号, 已登录) 打开邀请链接 → 接受 → 进团队.
 * token 从 ?token= 取; 真正校验/落库在 POST /api/team/invite/accept. 不创建账号.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { UsersThree as UsersRound, CircleNotch as Loader2, CheckCircle as CheckCircle2, Warning as AlertTriangle, SignIn as LogIn } from '@phosphor-icons/react';

function AcceptInner() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    if (!token) { setError('链接缺少邀请 token'); return; }
    setBusy(true); setError(''); setNeedLogin(false);
    try {
      const res = await fetch('/api/team/invite/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) { setNeedLogin(true); return; }
      if (!res.ok) throw new Error(d.message || '接受失败');
      setResult(d);
    } catch (e: any) { setError(e?.message || '接受失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-md mx-auto mt-10">
      <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-6 text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/15 grid place-items-center mx-auto mb-3">
          <UsersRound className="w-6 h-6 text-amber-400" />
        </div>
        <h2 className="text-xl font-bold text-white">接受团队邀请</h2>
        <p className="text-sm text-[var(--muted)] mt-1.5">用你自己的账号加入对方的团队工作区,即可共享积分额度。</p>

        {result ? (
          <div className="mt-5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1.5" />
            <p className="text-sm text-emerald-300">已加入团队</p>
            <p className="text-[12px] text-[var(--muted)] mt-1">初始额度 {result.allocated} · 角色 {result.member?.role === 'admin' ? '管理员' : '成员'}</p>
            <Link href="/dashboard/team" className="inline-block mt-3 text-[12px] text-amber-300 hover:underline">前往团队工作区 →</Link>
          </div>
        ) : needLogin ? (
          <div className="mt-5 rounded-xl bg-amber-500/10 border border-amber-500/25 p-4">
            <LogIn className="w-6 h-6 text-amber-400 mx-auto mb-1.5" />
            <p className="text-sm text-amber-300">请先登录你的账号</p>
            <p className="text-[12px] text-[var(--muted)] mt-1">系统不会代为创建账号。登录后回到本链接即可接受。</p>
            <Link href={`/auth?next=${encodeURIComponent(`/dashboard/team/accept?token=${token}`)}`} className="inline-block mt-3 px-4 py-1.5 rounded-lg text-[12px] bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30">去登录</Link>
          </div>
        ) : (
          <>
            {error && (
              <p className="mt-4 text-[12px] text-rose-300 flex items-center justify-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>
            )}
            <button
              onClick={accept} disabled={busy || !token}
              className="mt-5 w-full py-2.5 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}接受邀请
            </button>
            {!token && <p className="mt-2 text-[11px] text-rose-300/80">链接缺少邀请凭证</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="text-center py-16 text-[var(--muted)]"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}>
      <AcceptInner />
    </Suspense>
  );
}
