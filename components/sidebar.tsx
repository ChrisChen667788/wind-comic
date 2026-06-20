'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
// v8.3 P1: lucide → Phosphor (ultra-thin Light weight, Taste Skill 推荐, 摆脱 AI 默认观感)
import {
  SquaresFour, Kanban, Sparkle, BookOpen, User,
  SignOut, CaretLeft, CaretRight, Package, PenNib, MagicWand, FilmReel, CreditCard, Scroll, Palette, UsersThree, Pulse, Lightning, ChartLineUp, Stack, Queue, FilmSlate,
} from '@phosphor-icons/react';
import { useState } from 'react';

const navItems = [
  { href: '/dashboard', label: '创作总览', icon: SquaresFour },
  { href: '/dashboard/projects', label: '我的项目', icon: Kanban },
  { href: '/dashboard/create', label: '创作工坊', icon: Sparkle },
  // v7.6: 15s 短视频极速分镜台 (对标 CineSpark) — 三幕结构化分镜 + 运镜词库
  { href: '/dashboard/short-video', label: '极速分镜台', icon: Lightning },
  // v6.2.1: 长篇小说/剧本 → 自动分集 + 叙事模式 → 逐集送入创作
  { href: '/dashboard/story-intake', label: '长篇拆解', icon: Scroll },
  // 阶段二十六: 系列剧 — 跨集一致 + 一键批量出片
  { href: '/dashboard/series', label: '我的系列', icon: FilmSlate },
  // v2.11: 独立剧本润色工具 — 不走完整 Agent 管线, 纯文本润色
  { href: '/dashboard/polish', label: '剧本润色', icon: MagicWand },
  // v2.12 Sprint C.1: 单图变视频(I2V)独立工具
  { href: '/dashboard/u2v', label: '单图变视频', icon: FilmReel },
  // v8.3 P5: 角色库并入「素材库」(角色子类), 不再独立模块; 素材库统一管理角色/场景/视频/音乐/字幕/模板
  { href: '/dashboard/assets', label: '素材库', icon: Package },
  // v6.3: 风格模板画廊
  { href: '/dashboard/styles', label: '风格画廊', icon: Palette },
  { href: '/dashboard/cases', label: '灵感库', icon: BookOpen },
  // v9.6.8 (阶段十六 T2): 模板市场 — 把出片好的项目沉淀成可复用模板, 一键起片
  { href: '/dashboard/templates', label: '模板市场', icon: Stack },
  { href: '/dashboard/profile', label: '账户', icon: User },
  // v6.5: 团队工作区 — 主账号按成员分配积分额度
  { href: '/dashboard/team', label: '团队', icon: UsersThree },
  // v6.7: API 健康仪表盘 — 一眼看各网关欠费/掉线
  { href: '/dashboard/health', label: 'API 健康', icon: Pulse },
  // v9.3.2: 用量与成本可观测 — 引擎花费 / 每日趋势 / 预算环 / 配额告警
  { href: '/dashboard/usage', label: '用量成本', icon: ChartLineUp },
  // v10.4.2: 流水线任务队列 — 进度/死信可见,失败任务一键重投(续跑不重复计费)
  { href: '/dashboard/jobs', label: '任务队列', icon: Queue },
  // v2.12 Sprint C.2: Stripe 4 档订阅管理
  { href: '/dashboard/billing', label: '订阅 / 计费', icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <aside
      className={`relative flex flex-col min-h-screen shrink-0 border-r border-[var(--border)] transition-all duration-300 ${
        collapsed ? 'w-[64px]' : 'w-[220px]'
      }`}
      style={{ background: 'rgba(10,10,11,0.95)', backdropFilter: 'blur(48px) saturate(1.2)' }}
    >
      {/* Brand — 金色墨水笔 icon (整块包 Link, 折叠时仍可点 icon 回首页) */}
      <Link
        href="/"
        title="返回首页"
        className={`flex items-center gap-3 pt-5 pb-3 transition-opacity hover:opacity-80 ${collapsed ? 'justify-center px-3' : 'px-5'}`}
      >
        <div className="w-7 h-7 rounded-md grid place-items-center shrink-0 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#E8C547] to-[#D4A830]" />
          <PenNib size={14} weight="duotone" className="text-[#0C0C0C] relative z-10" />
        </div>
        {!collapsed && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">青枫</span>
            <span className="text-[10px] text-[var(--soft)] font-medium tracking-[0.15em] uppercase">Studio</span>
          </span>
        )}
      </Link>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        className="absolute -right-3 top-[60px] w-5 h-5 rounded-full bg-[var(--background-elevated)] border border-[var(--border)] grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-hover)] transition-all z-10"
      >
        {collapsed ? <CaretRight size={10} weight="bold" /> : <CaretLeft size={10} weight="bold" />}
      </button>

      {/* Thin divider */}
      <div className="mx-4 h-px bg-[var(--border)] mb-1" />

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2.5 py-3 flex-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-nav-item ${isActive ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={17} weight={isActive ? 'duotone' : 'light'} className={`shrink-0 transition-colors ${isActive ? 'text-[#E8C547]' : ''}`} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className={`px-2.5 pb-3 ${collapsed ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2'}`}>
        {user && !collapsed && (
          <div className="flex gap-2.5 items-center p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
            <img loading="lazy" decoding="async" src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover ring-1 ring-[var(--border)]" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[12px] truncate text-[var(--text)]">{user.name}</div>
              <div className="text-[10px] text-[var(--soft)] truncate">{user.email}</div>
            </div>
          </div>
        )}
        {user && collapsed && (
          <div className="p-1" title={user.name}>
            <img loading="lazy" decoding="async" src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover ring-1 ring-[var(--border)]" />
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`flex items-center gap-2 text-[12px] text-[var(--soft)] hover:text-[var(--muted)] transition-colors rounded-md hover:bg-[var(--surface)] ${
            collapsed ? 'p-2 justify-center' : 'px-3 py-1.5'
          }`}
          title={collapsed ? '退出' : undefined}
        >
          <SignOut size={14} weight="light" />
          {!collapsed && <span>退出</span>}
        </button>
      </div>
    </aside>
  );
}
