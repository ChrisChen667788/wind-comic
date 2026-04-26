'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/ui/toast-provider';
import { IMG_AUTH_BG1, IMG_AUTH_BG2 } from '@/lib/placeholder-images';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@qfmanju.ai');
  const [password, setPassword] = useState('Qfmanju123');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { login, register } = useAuth();
  const { showToast } = useToast();

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
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <SiteHeader variant="compact" />
      <main className="grid grid-cols-1 md:grid-cols-2 gap-10 px-[5vw] py-20 items-center">
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
                <span>演示：demo@qfmanju.ai / Qfmanju123</span>
              </div>
            )}

            {error && (
              <div className="bg-[rgba(255,88,88,0.12)] border border-[rgba(255,88,88,0.4)] px-3 py-2.5 rounded-xl text-sm">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary py-3 rounded-xl text-sm w-full">
              {loading ? '...' : mode === 'login' ? '登录' : '注册'}
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
          <img src={IMG_AUTH_BG1} alt="" className="absolute w-[260px] rounded-[20px] shadow-[var(--shadow)] top-0 right-10" />
          <img src={IMG_AUTH_BG2} alt="" className="absolute w-[260px] rounded-[20px] shadow-[var(--shadow)] bottom-0 left-5" />
        </div>
      </main>
    </div>
  );
}
