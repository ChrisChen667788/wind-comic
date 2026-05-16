'use client';

/**
 * v3.0 P0.1 — CommentThread for one (projectId, targetType, targetId).
 *
 * 行为:
 *   - 拉 /api/projects/[id]/comments?targetType=&targetId= 列出评论
 *   - 30s 轮询刷新 (v3.0 P0.2 会接 Yjs 改成实时同步)
 *   - 输入框走 MentionTextarea, 提交时 POST 评论
 *   - 每个根评论可点 "回复" → 出现一层嵌套的输入框
 *   - 自己写的评论可点 🗑️ 删除 (软删, UI 显 [已删除])
 *
 * 显示规则:
 *   - 软删评论: content 替换为 "[已删除]", 删除按钮隐藏, 但子 reply 仍渲染
 *   - mentions: content 里的 @Name 用 cinema-amber 高亮
 */

import { useCallback, useEffect, useState } from 'react';
import { Trash2, MessageCircle, Send, Loader2 } from 'lucide-react';
import { MentionTextarea } from './mention-textarea';
import type { CommentRow, CommentTargetType } from '@/lib/comments';

interface FetchedComment extends CommentRow {}
interface Thread { root: FetchedComment; replies: FetchedComment[] }

export interface CommentThreadProps {
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  /** 显示在卡片上方的标签 — 例如 "PROJECT" / "SHOT 3" */
  contextLabel?: string;
  /** 当前用户 id, 用来判断是否能删 */
  currentUserId?: string | null;
  /** 自动刷新间隔 ms; 0 = 不轮询 */
  pollIntervalMs?: number;
}

function groupByThread(comments: FetchedComment[]): Thread[] {
  const byId = new Map<string, FetchedComment>();
  for (const c of comments) byId.set(c.id, c);
  const roots: FetchedComment[] = [];
  const repliesOf = new Map<string, FetchedComment[]>();
  for (const c of comments) {
    if (c.parentId && byId.has(c.parentId)) {
      const arr = repliesOf.get(c.parentId) || [];
      arr.push(c);
      repliesOf.set(c.parentId, arr);
    } else {
      roots.push(c);
    }
  }
  return roots.map((r) => ({ root: r, replies: repliesOf.get(r.id) || [] }));
}

function renderContent(content: string, deleted: boolean): React.ReactNode {
  if (deleted) {
    return <span className="opacity-40 italic">[已删除]</span>;
  }
  // 把 @name 高亮成 cinema-amber chip
  const parts: React.ReactNode[] = [];
  const re = /(@[一-龥A-Za-z0-9_]{1,30})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    parts.push(
      <span key={key++} className="text-[var(--cinema-amber)] font-medium">
        {m[1]}
      </span>,
    );
    last = m.index + m[1].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString();
}

interface ItemProps {
  comment: FetchedComment;
  currentUserId?: string | null;
  onReplyClick?: () => void;
  onDeleteClick?: () => void;
  indent?: boolean;
}

function CommentItem({ comment, currentUserId, onReplyClick, onDeleteClick, indent }: ItemProps) {
  const deleted = !!comment.deletedAt;
  const canDelete = !deleted && currentUserId && comment.authorUserId === currentUserId;
  return (
    <div className={`flex gap-3 ${indent ? 'ml-8 pl-3 border-l border-white/10' : ''}`}>
      {comment.authorAvatarUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={comment.authorAvatarUrl} alt={comment.authorName} className="w-7 h-7 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-[var(--cinema-amber)]/30 grid place-items-center cinema-mono text-[11px] flex-shrink-0">
          {comment.authorName.slice(0, 1)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="cinema-mono text-[11px] font-medium">{comment.authorName}</span>
          <span className="cinema-mono text-[10px] opacity-50">{formatTime(comment.createdAt)}</span>
          {deleted && <span className="cinema-mono text-[9px] opacity-40">已删除</span>}
        </div>
        <div className="cinema-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
          {renderContent(comment.content, deleted)}
        </div>
        {!deleted && (
          <div className="flex items-center gap-2 mt-1">
            {onReplyClick && (
              <button
                onClick={onReplyClick}
                className="cinema-mono text-[10px] opacity-50 hover:opacity-100 hover:text-[var(--cinema-amber)] inline-flex items-center gap-1"
              >
                <MessageCircle className="w-2.5 h-2.5" />
                回复
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDeleteClick}
                className="cinema-mono text-[10px] opacity-50 hover:opacity-100 hover:text-[var(--cinema-red)] inline-flex items-center gap-1"
              >
                <Trash2 className="w-2.5 h-2.5" />
                删除
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommentThread({
  projectId, targetType, targetId, contextLabel, currentUserId, pollIntervalMs = 30_000,
}: CommentThreadProps) {
  const [comments, setComments] = useState<FetchedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  const fetchComments = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ targetType, targetId, limit: '200' });
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments?${qs}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setComments(Array.isArray(body.comments) ? body.comments : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [projectId, targetType, targetId]);

  useEffect(() => {
    fetchComments();
    if (pollIntervalMs > 0) {
      const t = setInterval(fetchComments, pollIntervalMs);
      return () => clearInterval(t);
    }
  }, [fetchComments, pollIntervalMs]);

  const post = async (content: string, parentId: string | null) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, content: trimmed, parentId }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error || `发送失败 (${res.status})`);
        return;
      }
      if (parentId) {
        setReplyTo(null);
        setReplyDraft('');
      } else {
        setDraft('');
      }
      // 乐观刷新
      await fetchComments();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('删除这条评论? 回复链不受影响.')) return;
    const qs = new URLSearchParams({ commentId });
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments?${qs}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || '删除失败');
      return;
    }
    await fetchComments();
  };

  const threads = groupByThread(comments);

  return (
    <div className="cinema-card-hi p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="cinema-eyebrow flex items-center gap-1.5">
          <MessageCircle className="w-3 h-3" />
          COMMENTS{contextLabel ? ` · ${contextLabel}` : ''}
        </div>
        <span className="cinema-mono text-[10px] opacity-50">
          {comments.filter((c) => !c.deletedAt).length} 条
        </span>
      </div>

      {error && (
        <div className="cinema-mono text-[10px] text-[var(--cinema-red)] opacity-80">✗ {error}</div>
      )}

      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
        {loading ? (
          <div className="cinema-mono text-[11px] opacity-50 py-4 text-center inline-flex items-center justify-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> 加载中
          </div>
        ) : threads.length === 0 ? (
          <div className="cinema-mono text-[11px] opacity-50 py-4 text-center">
            还没有评论, 第 1 个评论从你开始 ✨
          </div>
        ) : (
          threads.map(({ root, replies }) => (
            <div key={root.id} className="space-y-2">
              <CommentItem
                comment={root}
                currentUserId={currentUserId}
                onReplyClick={() => {
                  setReplyTo(root.id);
                  setReplyDraft('');
                }}
                onDeleteClick={() => handleDelete(root.id)}
              />
              {replies.map((r) => (
                <CommentItem
                  key={r.id}
                  comment={r}
                  currentUserId={currentUserId}
                  onDeleteClick={() => handleDelete(r.id)}
                  indent
                />
              ))}
              {replyTo === root.id && (
                <div className="ml-8 pl-3 border-l border-[var(--cinema-amber)]/30 space-y-2">
                  <MentionTextarea
                    value={replyDraft}
                    onChange={setReplyDraft}
                    rows={2}
                    placeholder={`回复 ${root.authorName}... ⌘+Enter 发送`}
                    onSubmit={() => post(replyDraft, root.id)}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => post(replyDraft, root.id)}
                      disabled={!replyDraft.trim() || submitting}
                      className="cinema-btn cinema-btn-primary !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40"
                    >
                      {submitting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                      发送
                    </button>
                    <button
                      onClick={() => { setReplyTo(null); setReplyDraft(''); }}
                      className="cinema-mono text-[10px] opacity-50 hover:opacity-100"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 新评论输入 */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          rows={3}
          placeholder="评论这条... 输入 @ 提及成员. ⌘+Enter 发送."
          onSubmit={() => post(draft, null)}
        />
        <div className="flex items-center justify-between">
          <span className="cinema-mono text-[9px] opacity-40">
            {draft.length}/2000
          </span>
          <button
            onClick={() => post(draft, null)}
            disabled={!draft.trim() || submitting}
            className="cinema-btn cinema-btn-primary !px-3 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            发送评论
          </button>
        </div>
      </div>
    </div>
  );
}
