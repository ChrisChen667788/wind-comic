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
import { Trash as Trash2, ChatCircle as MessageCircle, PaperPlaneTilt as Send, CircleNotch as Loader2, Radio, Radio as RadioReceiver, Paperclip, X as XIcon } from '@phosphor-icons/react';
import { MentionTextarea } from './mention-textarea';
import type { CommentRowShape as CommentRow, CommentTargetType, CommentAttachmentShape } from '@/lib/comments-shared';
import { useYjs } from '@/hooks/use-yjs';
import { subscribeSSE } from '@/lib/sse-client';
import { useLocale } from '@/hooks/use-locale';

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
  /**
   * v3.0 P0.1: 自动轮询间隔; 0 = 不轮询 (子线程默认 0 省电).
   * v3.0 P0.2 后变成 fallback — 主路径走 Yjs 实时, 轮询用于:
   *   1. 初次进入页面 (拉取 server 已存历史)
   *   2. WS 断连时兜底刷新
   */
  pollIntervalMs?: number;
  /**
   * v3.0 P0.2: 设 false 跳过 Yjs 连接 (例如 SSR / 静态预览页).
   * 默认 true — 实时同步.
   */
  enableRealtime?: boolean;
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

function renderContent(content: string, deleted: boolean, deletedLabel = '[已删除]'): React.ReactNode {
  if (deleted) {
    return <span className="opacity-40 italic">{deletedLabel}</span>;
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

function formatTime(iso: string, locale: string = 'zh-CN'): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 60) return rtf.format(-Math.floor(diff), 'second');
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  if (diff < 604800) return rtf.format(-Math.floor(diff / 86400), 'day');
  return d.toLocaleDateString(locale);
}

interface ItemProps {
  comment: FetchedComment;
  currentUserId?: string | null;
  onReplyClick?: () => void;
  onDeleteClick?: () => void;
  indent?: boolean;
}

function CommentItem({ comment, currentUserId, onReplyClick, onDeleteClick, indent }: ItemProps) {
  const { t, locale } = useLocale();
  const deleted = !!comment.deletedAt;
  const canDelete = !deleted && currentUserId && comment.authorUserId === currentUserId;
  return (
    <div className={`flex gap-3 ${indent ? 'ml-8 pl-3 border-l border-white/10' : ''}`}>
      {comment.authorAvatarUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img loading="lazy" decoding="async" src={comment.authorAvatarUrl} alt={comment.authorName} className="w-7 h-7 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-[var(--cinema-amber)]/30 grid place-items-center cinema-mono text-[11px] flex-shrink-0">
          {comment.authorName.slice(0, 1)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="cinema-mono text-[11px] font-medium">{comment.authorName}</span>
          <span className="cinema-mono text-[10px] opacity-50">{formatTime(comment.createdAt, locale)}</span>
          {deleted && <span className="cinema-mono text-[9px] opacity-40">{t.collab.deleted}</span>}
        </div>
        <div className="cinema-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
          {renderContent(comment.content, deleted, t.collab.deleted)}
        </div>
        {/* v3.x E.1: 附件渲染 — 图片缩略图 / 视频 controls / 文件链接 */}
        {!deleted && Array.isArray((comment as any).attachments) && (comment as any).attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {((comment as any).attachments as Array<{ url: string; type: string; filename?: string }>).map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block max-w-[180px] rounded border border-white/10 overflow-hidden hover:border-[var(--cinema-amber)]/50"
                title={att.filename}
              >
                {att.type === 'image' ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img loading="lazy" decoding="async" src={att.url} alt={att.filename || 'attachment'} className="w-full max-h-32 object-cover" />
                ) : att.type === 'video' ? (
                  <video src={att.url} className="w-full max-h-32" controls muted />
                ) : (
                  <div className="px-2 py-3 text-[10px] opacity-70 break-all">
                    📎 {att.filename || 'file'}
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
        {!deleted && (
          <div className="flex items-center gap-2 mt-1">
            {onReplyClick && (
              <button
                onClick={onReplyClick}
                className="cinema-mono text-[10px] opacity-50 hover:opacity-100 hover:text-[var(--cinema-amber)] inline-flex items-center gap-1"
              >
                <MessageCircle className="w-2.5 h-2.5" />
                {t.collab.reply}
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDeleteClick}
                className="cinema-mono text-[10px] opacity-50 hover:opacity-100 hover:text-[var(--cinema-red)] inline-flex items-center gap-1"
              >
                <Trash2 className="w-2.5 h-2.5" />
                {t.common.delete}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommentThread({
  projectId, targetType, targetId, contextLabel, currentUserId,
  pollIntervalMs = 30_000, enableRealtime = true,
}: CommentThreadProps) {
  const { t } = useLocale();
  const [comments, setComments] = useState<FetchedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  // v3.x E.1: 附件状态
  const [draftAttachments, setDraftAttachments] = useState<CommentAttachmentShape[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const uploadAttachment = async (file: File) => {
    if (uploadingAttachment) return;
    if (draftAttachments.length >= 6) {
      setError('附件最多 6 个');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(`${file.name} 超过 10MB 上限`);
      return;
    }
    setUploadingAttachment(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/comment-attachment', { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || !body?.url) {
        setError(body?.error || `上传失败 (${res.status})`);
        return;
      }
      setDraftAttachments((prev) => [...prev, { url: body.url, type: body.type, size: body.size, filename: body.filename }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploadingAttachment(false);
    }
  };

  // v3.0 P0.2: Yjs 实时 — 一个项目一个 doc, 所有 target 的评论都在同一 Y.Array
  // 这里按 targetType+targetId filter 出本组件关心的子集.
  const yjs = useYjs(enableRealtime ? `project-${projectId}` : null);

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

  // 初次 + WS 重连时拉 server 端权威列表 (Yjs 仅做实时 push, 不做权威源)
  useEffect(() => {
    fetchComments();
    // v10.2.0: 未启 Yjs 实时时,改用 SSE 推送(项目评论频道)取代固定轮询;轮询降为慢速兜底。
    if (!enableRealtime) {
      const sub = subscribeSSE(`/api/projects/${encodeURIComponent(projectId)}/comments/stream`, {
        onEvent: (ev) => { if (ev.event === 'comment') fetchComments(); },
      });
      const fallbackMs = pollIntervalMs > 0 ? Math.max(pollIntervalMs, 90_000) : 0;
      const t = fallbackMs > 0 ? setInterval(fetchComments, fallbackMs) : null;
      return () => { sub.close(); if (t) clearInterval(t); };
    }
    // Yjs 实时模式: 仍保留低频轮询作为 WS 断连兜底, 间隔显著拉长省电
    if (enableRealtime && pollIntervalMs > 0) {
      const fallbackInterval = Math.max(pollIntervalMs, 60_000) * 4; // ≥4 分钟
      const t = setInterval(fetchComments, fallbackInterval);
      return () => clearInterval(t);
    }
  }, [fetchComments, pollIntervalMs, enableRealtime, projectId]);

  // Yjs Y.Array 监听 — 新评论 push 进来, 按 targetId filter 后 merge 到 state
  useEffect(() => {
    if (!yjs) return;
    const arr = yjs.doc.getArray<{ [k: string]: unknown }>('comments');
    const onChange = () => {
      const all = arr.toArray() as unknown as FetchedComment[];
      const filtered = all.filter(
        (c) => c && c.targetType === targetType && c.targetId === targetId,
      );
      if (filtered.length === 0) return;
      setComments((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const yc of filtered) {
          // 合并: Yjs 版优先 (它带 deletedAt 更新), 但保 prev 字段兜底
          byId.set(yc.id, { ...byId.get(yc.id), ...yc });
        }
        // 按 createdAt asc
        return Array.from(byId.values()).sort((a, b) =>
          a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
        );
      });
    };
    arr.observe(onChange);
    // 初次也跑一遍, 把已有的 Y.Array 内容 merge 进来
    onChange();
    return () => arr.unobserve(onChange);
  }, [yjs, targetType, targetId]);

  const post = async (content: string, parentId: string | null) => {
    const trimmed = content.trim();
    // v3.x E.1: 允许"附件无文字"评论
    const isMainComment = parentId === null;
    const attachmentsForPost = isMainComment ? draftAttachments : [];
    if (!trimmed && attachmentsForPost.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType, targetId, content: trimmed, parentId,
          attachments: attachmentsForPost,
        }),
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
        setDraftAttachments([]); // v3.x E.1: 清空附件
      }
      // 乐观刷新
      await fetchComments();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm(t.collab.confirmDelete)) return;
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
        <div className="flex items-center gap-2">
          {/* v3.0 P0.2: WS 连接状态 chip */}
          {enableRealtime && yjs && (
            <span
              className={`cinema-mono text-[9px] inline-flex items-center gap-1 ${
                yjs.status === 'connected' ? 'text-[var(--cinema-green)]'
                : yjs.status === 'connecting' ? 'opacity-50'
                : 'text-[var(--cinema-amber)]'
              }`}
              title={
                yjs.status === 'connected' ? '实时同步已开 (Yjs WS)'
                : yjs.status === 'connecting' ? '正在连接实时同步...'
                : 'WS 已断, 走轮询兜底 — 检查 npm run dev:ws'
              }
            >
              {yjs.status === 'connected' ? <Radio className="w-2.5 h-2.5" /> : <RadioReceiver className="w-2.5 h-2.5" />}
              {yjs.status === 'connected' ? '实时' : yjs.status === 'connecting' ? '...' : '离线'}
            </span>
          )}
          <span className="cinema-mono text-[10px] opacity-50">
            {comments.filter((c) => !c.deletedAt).length} 条
          </span>
        </div>
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
      <div
        className="space-y-2 pt-2 border-t border-white/5"
        onDrop={async (e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files || []);
          for (const f of files) {
            if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
              await uploadAttachment(f);
            }
          }
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          rows={3}
          placeholder={t.collab.commentPlaceholder}
          onSubmit={() => post(draft, null)}
        />
        {/* v3.x E.1: 附件预览 */}
        {draftAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {draftAttachments.map((att, i) => (
              <div
                key={i}
                className="relative max-w-[120px] rounded border border-white/10 overflow-hidden group/att"
              >
                {att.type === 'image' ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img loading="lazy" decoding="async" src={att.url} alt={att.filename} className="w-full max-h-20 object-cover" />
                ) : att.type === 'video' ? (
                  <video src={att.url} className="w-full max-h-20" muted />
                ) : (
                  <div className="px-2 py-3 text-[10px]">📎 {att.filename}</div>
                )}
                <button
                  onClick={() => setDraftAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white/80 opacity-0 group-hover/att:opacity-100 transition-opacity"
                  title="移除附件"
                >
                  <XIcon className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label
              className={`cinema-mono text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--cinema-border)] cursor-pointer hover:border-[var(--cinema-amber)] transition-colors ${
                uploadingAttachment || draftAttachments.length >= 6 ? 'opacity-40 cursor-not-allowed' : ''
              }`}
              title={draftAttachments.length >= 6 ? '已达 6 附件上限' : '上传图片/视频 (≤10MB, 最多 6 个)'}
            >
              {uploadingAttachment ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Paperclip className="w-3 h-3" />
              )}
              附件
              <input
                type="file"
                accept="image/*,video/*"
                disabled={uploadingAttachment || draftAttachments.length >= 6}
                multiple={false}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await uploadAttachment(f);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            <span className="cinema-mono text-[9px] opacity-40">{draft.length}/2000</span>
          </div>
          <button
            onClick={() => post(draft, null)}
            disabled={(!draft.trim() && draftAttachments.length === 0) || submitting}
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
