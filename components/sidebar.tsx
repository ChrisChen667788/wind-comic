'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import {
  LayoutDashboard, FolderKanban, Sparkles, BookOpen, User,
  LogOut, ChevronLeft, ChevronRight, Package, PenTool, Users, Wand2, Film,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { href: '/dashboard', label: '创作总览', icon: LayoutDashboard },
  { href: '/dashboard/projects', label: '我的项目', icon: FolderKanban },
  { href: '/dashboard/create', label: '创作工坊', icon: Sparkles },
  // v2.11: 独立剧本润色工具 — 不走完整 Agent 管线, 纯文本润色
  { href: '/dashboard/polish', label: '剧本润色', icon: Wand2 },
  // v2.12 Sprint C.1: 单图变视频(I2V)独立工具
  { href: '/dashboard/u2v', label: '单图变视频', icon: Film },
  { href: '/dashboard/assets', label: '素材库', icon: Package },
  { href: '/dashboard/characters', label: '角色库', icon: Users },
  { href: '/dashboard/cases', label: '灵感库', icon: BookOpen },
  { href: '/dashboard/profile', label: '账户', icon: User },
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
          <PenTool className="w-3.5 h-3.5 text-[#0C0C0C] relative z-10" />
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
        className="absolute -right-3 top-[60px] w-5 h-5 rounded-full bg-[var(--background-elevated)] border border-[var(--border)] grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-hover)] transition-all z-10"
      >
        {collapsed ? <ChevronRight className="w-2.5 h-2.5" /> : <ChevronLeft className="w-2.5 h-2.5" />}
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
              <Icon className={`w-[17px] h-[17px] shrink-0 transition-colors ${isActive ? 'text-[#E8C547]' : ''}`} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className={`px-2.5 pb-3 ${collapsed ? 'flex flex-col items-center gap-2' : 'flex flex-col gap-2'}`}>
        {user && !collapsed && (
          <div className="flex gap-2.5 items-center p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
            <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover ring-1 ring-[var(--border)]" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[12px] truncate text-[var(--text)]">{user.name}</div>
              <div className="text-[10px] text-[var(--soft)] truncate">{user.email}</div>
            </div>
          </div>
        )}
        {user && collapsed && (
          <div className="p-1" title={user.name}>
            <img src={user.avatarUrl} alt={user.name} className="w-7 h-7 rounded-full object-cover ring-1 ring-[var(--border)]" />
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`flex items-center gap-2 text-[12px] text-[var(--soft)] hover:text-[var(--muted)] transition-colors rounded-md hover:bg-[var(--surface)] ${
            collapsed ? 'p-2 justify-center' : 'px-3 py-1.5'
          }`}
          title={collapsed ? '退出' : undefined}
        >
          <LogOut className="w-3.5 h-3.5" />
          {!collapsed && <span>退出</span>}
        </button>
      </div>
    </aside>
  );
}
