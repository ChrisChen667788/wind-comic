'use client';

/**
 * v3.x — InviteProjectButton: 项目 nav bar 上的邀请按钮 + popover.
 *
 * 行为:
 *   - Owner: 看到"邀请协作者"按钮, 点开 popover, 选 role 生成链接复制
 *   - 显示当前协作者列表 + 移除按钮
 *   - 非 owner: 不显示
 */

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Copy, Check, Trash as Trash2, CircleNotch as Loader2, X as XIcon } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type ProjectRole = 'viewer' | 'commenter' | 'editor';

interface InviteToken {
  token: string;
  url: string;
  role: ProjectRole;
  expiresAt: string | null;
  viewCount: number;
  acceptCount: number;
  createdAt: string;
}

interface CollaboratorEntry {
  id: string;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  role: ProjectRole;
  joinedAt: string;
}

interface InviteData {
  tokens: InviteToken[];
  collaborators: CollaboratorEntry[];
}

export interface InviteProjectButtonProps {
  projectId: string;
  isOwner: boolean;
}

const ROLE_LABEL: Record<ProjectRole, string> = {
  viewer: '只读',
  commenter: '可评论',
  editor: '可编辑',
};

export function InviteProjectButton({ projectId, isOwner }: InviteProjectButtonProps) {
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [expiresInDays, setExpiresInDays] = useState<string>('7'); // '0' = 永久
  const [busy, setBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite`);
      if (res.ok) setData(await res.json());
      else setError(`加载失败 ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, isOwner]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!isOwner) return null;

  const createInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const days = expiresInDays === '0' ? null : parseInt(expiresInDays, 10);
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, expiresInDays: days }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `失败 ${res.status}`);
        return;
      }
      // 复制到剪贴板
      try {
        await navigator.clipboard.writeText(body.url);
        setCopiedToken(body.token);
        setTimeout(() => setCopiedToken(null), 3000);
      } catch { /* ignore */ }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '失败');
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (token: string) => {
    if (!confirm('吊销这个邀请链接? 之后此链接将无效.')) return;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/invite?token=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      );
      if (res.ok) await refresh();
    } catch { /* ignore */ }
  };

  const removeCollab = async (userId: string, userName: string) => {
    if (!confirm(`从协作者中移除 ${userName}? 已写入的评论不会删除.`)) return;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/invite?userId=${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
      );
      if (res.ok) await refresh();
    } catch { /* ignore */ }
  };

  const updateCollabRole = async (userId: string, newRole: ProjectRole) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (res.ok) await refresh();
    } catch { /* ignore */ }
  };

  const copyUrl = async (url: string, token: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 3000);
    } catch { /* ignore */ }
  };

  return (
    <Popover>
      <PopoverTrigger
        className="cinema-btn-ghost cinema-btn !p-2 inline-flex items-center gap-1.5"
        title="邀请协作者"
      >
        <UserPlus className="w-4 h-4" />
        {data && data.collaborators.length > 0 && (
          <span className="cinema-mono text-[10px] opacity-70">{data.collaborators.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-3 max-h-[480px] overflow-y-auto custom-scrollbar">
        <div className="cinema-eyebrow flex items-center gap-1.5">
          <UserPlus className="w-3 h-3" />
          PROJECT COLLABORATORS
        </div>

        {/* 当前协作者 */}
        {data && data.collaborators.length > 0 && (
          <div className="space-y-1">
            <div className="cinema-mono text-[10px] opacity-60">已加入 ({data.collaborators.length})</div>
            {data.collaborators.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5">
                {c.userAvatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img loading="lazy" decoding="async" src={c.userAvatarUrl} alt={c.userName} className="w-6 h-6 rounded-full" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-[var(--cinema-amber)]/30 grid place-items-center cinema-mono text-[10px]">
                    {c.userName.slice(0, 1)}
                  </div>
                )}
                <span className="cinema-mono text-[11px] flex-1 truncate">{c.userName}</span>
                <select
                  value={c.role}
                  onChange={(e) => updateCollabRole(c.userId, e.target.value as ProjectRole)}
                  className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-1 py-0.5"
                >
                  <option value="viewer">{ROLE_LABEL.viewer}</option>
                  <option value="commenter">{ROLE_LABEL.commenter}</option>
                  <option value="editor">{ROLE_LABEL.editor}</option>
                </select>
                <button
                  onClick={() => removeCollab(c.userId, c.userName)}
                  className="opacity-60 hover:opacity-100 hover:text-[var(--cinema-red)]"
                  title="移除"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 创建新邀请 */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="cinema-mono text-[10px] opacity-60">生成新邀请链接</div>
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ProjectRole)}
              className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-1.5 py-1 flex-1"
            >
              <option value="viewer">只读 (viewer)</option>
              <option value="commenter">可评论 (commenter)</option>
              <option value="editor">可编辑 (editor)</option>
            </select>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-1.5 py-1"
            >
              <option value="1">1 天</option>
              <option value="7">7 天</option>
              <option value="30">30 天</option>
              <option value="0">永久</option>
            </select>
          </div>
          <button
            onClick={createInvite}
            disabled={busy}
            className="cinema-btn cinema-btn-primary w-full !text-[11px] inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
            生成 + 复制链接
          </button>
        </div>

        {/* 已生成的 token 列表 */}
        {data && data.tokens.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-white/5">
            <div className="cinema-mono text-[10px] opacity-60">已发的链接 ({data.tokens.length})</div>
            {data.tokens.slice(0, 8).map((t) => {
              const isCopied = copiedToken === t.token;
              return (
                <div key={t.token} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5">
                  <span className="cinema-mono text-[10px] opacity-50 flex-shrink-0">{ROLE_LABEL[t.role]}</span>
                  <span className="cinema-mono text-[10px] opacity-70 flex-1 truncate">
                    /{t.token.slice(0, 12)}...
                  </span>
                  <span className="cinema-mono text-[9px] opacity-50" title={`${t.viewCount} 次访问, ${t.acceptCount} 次接受`}>
                    👁{t.viewCount} ✓{t.acceptCount}
                  </span>
                  <button
                    onClick={() => copyUrl(t.url, t.token)}
                    className="opacity-60 hover:opacity-100"
                    title="复制链接"
                  >
                    {isCopied ? <Check className="w-3 h-3 text-[var(--cinema-green)]" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => revokeToken(t.token)}
                    className="opacity-60 hover:opacity-100 hover:text-[var(--cinema-red)]"
                    title="吊销链接"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="cinema-mono text-[10px] text-[var(--cinema-red)] pt-1">✗ {error}</div>
        )}
        {loading && (
          <div className="cinema-mono text-[10px] opacity-50 inline-flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            加载中
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
