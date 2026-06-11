'use client';

/**
 * v3.0 P0.1 — NotificationBell for nav bar.
 *
 * 行为:
 *   - 60s 轮询 /api/notifications, 取 unreadCount + 最近 30 条
 *   - 点 bell 弹 popover, 显示通知列表
 *   - 每条通知点击 → 跳到对应 project (带 commentId hash)
 *   - "全部标已读" 按钮
 *   - badge 在 ≥1 时显示数字 (>99 → "99+")
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, At as AtSign, ChatCircle as MessageCircle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { subscribeSSE } from '@/lib/sse-client';
import { useLocale } from '@/hooks/use-locale';
import { getToken } from '@/lib/auth';

interface NotificationItem {
  id: string;
  type: 'mention' | 'reply' | 'project_invite' | 'weekly_digest'; // v10.5.4: 周报
  sourceUserId: string;
  sourceUserName: string;
  projectId: string | null;
  commentId: string | null;
  preview: string | null;
  readAt: string | null;
  createdAt: string;
}

function formatTime(iso: string, justNow = '刚刚'): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return justNow;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export interface NotificationBellProps {
  /** 轮询间隔; 0 = 不自动轮询 (例如未登录) */
  pollIntervalMs?: number;
}

export function NotificationBell({ pollIntervalMs = 60_000 }: NotificationBellProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  // v10.2.4: 带登录 token → 通知按当前登录用户取(不再走服务端 demo 兜底取最早用户)。
  const authHeaders = (): Record<string, string> => {
    const tok = getToken();
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=30', { headers: authHeaders() });
      if (res.status === 401) {
        // 未登录 — 静默关闭轮询, bell 不显示 badge
        setItems([]);
        setUnreadCount(0);
        setError(null);
        return;
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setItems(Array.isArray(body?.notifications) ? body.notifications : []);
      setUnreadCount(typeof body?.unreadCount === 'number' ? body.unreadCount : 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // v10.2.0: 实时改 SSE —— 有新通知即推 → 立即 refresh;轮询降级为慢速兜底(SSE 断线时保活)。
    // v10.2.4: 带登录 token,SSE 与 refresh 同解析为当前登录用户。
    const sub = subscribeSSE('/api/notifications/stream', {
      token: getToken(),
      onEvent: (ev) => { if (ev.event === 'notification') refresh(); },
    });
    const fallbackMs = pollIntervalMs > 0 ? Math.max(pollIntervalMs, 90_000) : 0;
    const timer = fallbackMs > 0 ? setInterval(refresh, fallbackMs) : null;
    return () => { sub.close(); if (timer) clearInterval(timer); };
  }, [refresh, pollIntervalMs]);

  const markRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'markRead', id }),
      });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnreadCount((n) => Math.max(0, n - 1));
    } catch {/* swallow */}
  };

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'markAllRead' }),
      });
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch {/* swallow */}
  };

  const badgeText = unreadCount === 0 ? null : unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <Popover>
      <PopoverTrigger
        className="relative cinema-btn-ghost cinema-btn !p-2"
        title={t.collab.notifTitle}
        aria-label={`${t.collab.notifTitle}${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {badgeText && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--cinema-amber)] text-black cinema-mono text-[9px] font-bold flex items-center justify-center">
            {badgeText}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 max-h-[480px] overflow-hidden flex flex-col">
        <div className="px-3 py-2 flex items-center justify-between border-b border-[var(--cinema-border)]">
          <div className="cinema-eyebrow">NOTIFICATIONS</div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="cinema-mono text-[10px] opacity-60 hover:text-[var(--cinema-amber)] inline-flex items-center gap-1"
            >
              <Check className="w-2.5 h-2.5" />
              {t.collab.markAllRead}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && items.length === 0 ? (
            <div className="px-3 py-6 cinema-mono text-[11px] opacity-50 text-center inline-flex items-center justify-center gap-2 w-full">
              <Loader2 className="w-3 h-3 animate-spin" /> {t.common.loading}
            </div>
          ) : error ? (
            <div className="px-3 py-4 cinema-mono text-[10px] text-[var(--cinema-red)] opacity-80">✗ {error}</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 cinema-mono text-[11px] opacity-50 text-center">
              {t.collab.notifEmpty}
            </div>
          ) : (
            <div>
              {items.map((n) => {
                const isUnread = !n.readAt;
                const href = n.projectId
                  ? `/projects/${n.projectId}${n.commentId ? `#comment-${n.commentId}` : ''}`
                  : '#';
                const Icon = n.type === 'mention' ? AtSign : MessageCircle; // weekly_digest 也走 MessageCircle,动词置空
                return (
                  <Link
                    key={n.id}
                    href={href}
                    onClick={() => isUnread && markRead(n.id)}
                    className={`block px-3 py-2 border-b border-white/5 hover:bg-white/5 ${isUnread ? 'bg-[var(--cinema-amber)]/5' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${isUnread ? 'text-[var(--cinema-amber)]' : 'opacity-50'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="cinema-mono text-[11px]">
                          <span className="font-medium">{n.sourceUserName}</span>
                          <span className="opacity-70">
                            {n.type === 'mention' ? ` ${t.collab.mentioned}` : n.type === 'weekly_digest' ? '' : ` ${t.collab.replied}`}
                          </span>
                        </div>
                        {n.preview && (
                          <div className="cinema-mono text-[10px] opacity-60 truncate mt-0.5">
                            {n.preview}
                          </div>
                        )}
                        <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
                          {formatTime(n.createdAt, t.collab.justNow)}
                        </div>
                      </div>
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinema-amber)] mt-1.5 flex-shrink-0" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
