'use client';

import { useAuth } from '@/components/auth-provider';
import { GlassCard } from '@/components/ui/glass-card';

export default function ProfilePage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">用户中心</h2>
        <p className="text-sm text-[var(--muted)] mt-1">账号与偏好设置</p>
      </div>

      <div className="flex items-center justify-between gap-4 bg-[rgba(255,255,255,0.06)] rounded-[18px] p-5 border border-[var(--border)] mb-6">
        <div className="flex items-center gap-4">
          <img src={user?.avatarUrl} alt={user?.name} className="w-16 h-16 rounded-full object-cover" />
          <div>
            <h3 className="font-semibold text-lg">{user?.name}</h3>
            <p className="text-sm text-[var(--muted)]">{user?.email}</p>
          </div>
        </div>
        <div className="flex gap-5">
          <div className="text-center">
            <span className="text-xs text-[var(--soft)]">角色</span>
            <strong className="block mt-1">{user?.role}</strong>
          </div>
          <div className="text-center">
            <span className="text-xs text-[var(--soft)]">语言</span>
            <strong className="block mt-1">{user?.locale === 'en' ? 'English' : '中文'}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GlassCard>
          <h4 className="font-semibold mb-3">视觉偏好</h4>
          <p className="text-sm text-[var(--muted)]">默认风格：Poetic Mist</p>
          <p className="text-sm text-[var(--muted)]">色彩：Film Warm</p>
        </GlassCard>
        <GlassCard>
          <h4 className="font-semibold mb-3">协作空间</h4>
          <p className="text-sm text-[var(--muted)]">团队：青枫漫剧 Studio</p>
          <p className="text-sm text-[var(--muted)]">权限：创作 + 发布</p>
        </GlassCard>
      </div>
    </div>
  );
}
