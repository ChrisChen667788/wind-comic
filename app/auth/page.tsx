'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/ui/toast-provider';
import { IMG_AUTH_BG1, IMG_AUTH_BG2 } from '@/lib/placeholder-images';

/** 秒 → 「X 分 Y 秒」/「Y 秒」—— 540 秒写成「540 秒」读起来没概念。 */
function fmtWait(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60); const r = sec % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@qfmanju.ai');
  const [password, setPassword] = useState(''); // v12.171:不再预填演示密码(仓库零明文)
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { login, register } = useAuth();
  const { showToast } = useToast();
  // v12.341:限流冷却。此前 429 与 401 都只显示「操作失败」——用户以为密码记错了,
  // 反复重试(徒劳:锁定窗口是固定的,重试既不会延长也不会提前结束它)。
  const [cooldownSec, setCooldownSec] = useState(0);
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setInterval(() => setCooldownSec((n) => (n > 1 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldownSec > 0]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      showToast({ title: mode === 'login' ? '登录成功' : '注册成功', type: 'success' });
      router.push('/dashboard');
    } catch (err: any) {
      // 服务端已经算好了「还剩多少秒」,不该在这里被丢掉 —— 如实告诉用户,
      // 而不是让他对着一句「登录失败」猜是不是密码错了。
      if (err?.status === 429) {
        const sec = Number(err?.retryAfterSec) || 0;
        setCooldownSec(sec);
        setError(sec
          ? `登录尝试过于频繁,请 ${fmtWait(sec)} 后再试(密码可能是对的 —— 锁定期内即使输对也会被拒)`
          : '登录尝试过于频繁,请稍后再试(密码可能是对的 —— 锁定期内即使输对也会被拒)');
      } else if (err?.status === 401) {
        setError('邮箱或密码不正确');
      } else {
        setError(err.message || '操作失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader variant="compact" />
      <main id="main-content" tabIndex={-1} className="grid grid-cols-1 md:grid-cols-2 gap-10 px-[5vw] py-20 items-center outline-none">
        {/* Login Card */}
        <div className="bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-[var(--border)] rounded-[26px] p-9 shadow-[var(--shadow)] backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E8C547] to-[#D4A830] grid place-items-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <span className="text-lg font-bold brand-gradient">青枫漫剧</span>
              <div className="text-[10px] text-[var(--soft)] tracking-widest uppercase">AI Studio</div>
            </div>
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {mode === 'login' ? '欢迎回到青枫漫剧' : '创建账户'}
          </h1>
          <p className="text-sm text-[var(--muted)] mb-6">
            {mode === 'login' ? '使用账号进入创作工作台' : '注册开始你的创作之旅'}
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <label className="flex flex-col gap-2 text-sm">
                用户名
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)} required
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 text-white focus:border-[#E8C547]/40 focus:outline-none focus:ring-1 focus:ring-[#E8C547]/20 transition-all placeholder:text-[var(--soft)]"
                  placeholder="输入用户名"
                />
              </label>
            )}
            <label className="flex flex-col gap-2 text-sm">
              邮箱
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 text-white focus:border-[#E8C547]/40 focus:outline-none focus:ring-1 focus:ring-[#E8C547]/20 transition-all placeholder:text-[var(--soft)]"
                placeholder="输入邮箱地址"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              密码
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 text-white focus:border-[#E8C547]/40 focus:outline-none focus:ring-1 focus:ring-[#E8C547]/20 transition-all placeholder:text-[var(--soft)]"
                placeholder="输入密码"
              />
            </label>

            {mode === 'login' && (
              <div className="flex justify-between items-center text-xs text-[var(--soft)]">
                <span>演示账号:demo@qfmanju.ai(密码由部署方 DEMO_PASSWORD 提供)</span>
              </div>
            )}

            {cooldownSec > 0 && (
              <div id="login-cooldown" role="status" className="text-[11px] text-[var(--soft)] -mt-1">
                这是防爆破限流,不是密码错误。锁定窗口固定,重试既不会延长也不会缩短它。
              </div>
            )}

            {error && (
              <div role="alert" className="bg-[rgba(255,88,88,0.12)] border border-[rgba(255,88,88,0.4)] px-3 py-2.5 rounded-xl text-sm">{error}</div>
            )}

            {/* v12.341:冷却期内禁用提交并实时倒计时。**只禁按钮、不禁输入框** ——
                用户完全可以趁等待把密码改对,没理由连输入都拦住。 */}
            <button
              type="submit"
              disabled={loading || cooldownSec > 0}
              aria-describedby={cooldownSec > 0 ? 'login-cooldown' : undefined}
              className="btn-primary py-3 rounded-xl text-sm w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cooldownSec > 0
                ? `${fmtWait(cooldownSec)}后可重试`
                : loading ? '...' : mode === 'login' ? '登录' : '注册'}
            </button>
          </form>

          <p className="text-sm text-[var(--soft)] text-center mt-6">
            {mode === 'login' ? '还没有账户？' : '已有账户？'}
            <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="ml-1 text-[var(--primary)] hover:underline">
              {mode === 'login' ? '立即注册' : '立即登录'}
            </button>
          </p>
        </div>

        {/* Visual */}
        <div className="relative min-h-[400px] hidden md:block">
          <div className="absolute w-[200px] h-[200px] rounded-full bg-[radial-gradient(circle,rgba(232,197,71,0.4),transparent_70%)] top-[20%] left-[10%] blur-[10px]" />
          <img loading="lazy" decoding="async" src={IMG_AUTH_BG1} alt="" className="absolute w-[260px] rounded-[20px] shadow-[var(--shadow)] top-0 right-10" />
          <img loading="lazy" decoding="async" src={IMG_AUTH_BG2} alt="" className="absolute w-[260px] rounded-[20px] shadow-[var(--shadow)] bottom-0 left-5" />
        </div>
      </main>
    </div>
  );
}
