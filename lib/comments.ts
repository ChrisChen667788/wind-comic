/**
 * v3.0 P0.1 — Comments CRUD + @mention 触发 notifications.
 *
 * 数据模型见 lib/db.ts comments / notifications 表.
 *
 * 关键设计:
 *   - createComment 是事务: 写 comments + 解析 mentions + 批量写 notifications 一气呵成.
 *     失败任何一步都 rollback, 不会产生 "评论存了但没发通知" 的孤儿态.
 *   - target_id 语义随 target_type 变:
 *       project   → target_id === project_id
 *       shot      → target_id === `${project_id}:${shotNumber}` (字符串拼接, 跨项目镜头号会重复)
 *       scene     → target_id === scene.name (字符串)
 *       character → target_id === character.name
 *       storyboard → target_id === `${project_id}:${shotNumber}` (= shot)
 *     约定写在常量里, 调用方按 buildTargetId() 生成.
 *   - 软删: deleted_at 置位后查询过滤, 但 reply 仍能 attach 到这个 parent_id (UI 显 [已删除]).
 *   - mentions 解析在 server 端做单一真理 — 不信任客户端传的 mentions 数组.
 */

import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import { parseMentionNames, uniqueMentions } from '@/lib/mentions';
// v2.21 hotfix: client-safe helpers 移到独立文件, 避免 page.tsx 导入这里时
// 把 better-sqlite3 拉进浏览器 bundle. 这里仍 re-export 让旧 import 不破.
export { buildTargetId } from '@/lib/comments-shared';
export type { CommentTargetType } from '@/lib/comments-shared';
import type { CommentTargetType } from '@/lib/comments-shared';

export interface CommentAttachment {
  url: string;       // http URL (走 /api/upload 落盘后)
  type: 'image' | 'video' | 'file';
  size?: number;     // bytes
  filename?: string; // 原始文件名 (展示)
}

export interface CommentRow {
  id: string;
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  authorUserId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  mentions: Array<{ userId: string; name: string }>;
  /** v3.x E.1: 评论附件 — 拖拽图片到评论框上传 */
  attachments: CommentAttachment[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
}

interface CommentDbRow {
  id: string;
  project_id: string;
  target_type: string;
  target_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar_url: string | null;
  content: string;
  mentions: string;
  attachments: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

function rowToComment(row: CommentDbRow): CommentRow {
  let mentions: Array<{ userId: string; name: string }> = [];
  try {
    const parsed = JSON.parse(row.mentions || '[]');
    if (Array.isArray(parsed)) mentions = parsed;
  } catch { /* ignore corrupt JSON */ }
  let attachments: CommentAttachment[] = [];
  try {
    const parsed = JSON.parse(row.attachments || '[]');
    if (Array.isArray(parsed)) {
      attachments = parsed.filter((a: any) =>
        a && typeof a.url === 'string' && a.url.startsWith('http') &&
        ['image', 'video', 'file'].includes(a.type),
      );
    }
  } catch { /* ignore */ }
  return {
    id: row.id,
    projectId: row.project_id,
    targetType: row.target_type as CommentTargetType,
    targetId: row.target_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    content: row.content,
    mentions,
    attachments,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// buildTargetId 已迁移到 lib/comments-shared.ts (client-safe), 这里 re-export 见文件顶部.

export interface CreateCommentInput {
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  authorUserId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  content: string;
  parentId?: string | null;
  /** v3.x E.1: 附件 URL 数组 (上限 6, 单个 ≤10MB 由上传 API 校验) */
  attachments?: CommentAttachment[];
}

export interface CreateCommentResult {
  comment: CommentRow;
  /** mentioned user ids — 实际命中并发通知的, 不含 username 写了但没人匹配上的 */
  notifiedUserIds: string[];
}

/**
 * 创建评论 + 解析 @mention + 写 notifications (单事务).
 *
 * 字段校验:
 *   - content 必须 1-2000 字, 去 trim
 *   - parentId 必须指向同 project 下未软删的评论 (否则忽略)
 */
export function createComment(input: CreateCommentInput): CreateCommentResult {
  const content = (input.content || '').trim();
  // v3.x E.1: 允许"附件无文字"评论 — 仅当无 content + 无附件时拒
  const attachments: CommentAttachment[] = Array.isArray(input.attachments)
    ? input.attachments
        .filter((a) => a && typeof a.url === 'string' && a.url.startsWith('http'))
        .filter((a) => ['image', 'video', 'file'].includes(a.type))
        .slice(0, 6) // 上限 6 个附件
    : [];
  if (!content && attachments.length === 0) throw new Error('comment content empty');
  if (content.length > 2000) throw new Error('comment content too long (max 2000)');

  const txn = db.transaction(() => {
    // parentId 校验
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = db
        .prepare(`SELECT id, project_id, deleted_at FROM comments WHERE id = ?`)
        .get(input.parentId) as { id: string; project_id: string; deleted_at: string | null } | undefined;
      if (parent && parent.project_id === input.projectId) {
        parentId = parent.id; // 允许 reply 到软删评论 (UI 会渲 [已删除])
      }
    }

    // 解析 @-mentions, 用户表查名字 → user_id (case-insensitive 匹配 users.name)
    const rawNames = uniqueMentions(parseMentionNames(content));
    const mentions: Array<{ userId: string; name: string }> = [];
    if (rawNames.length > 0) {
      const stmt = db.prepare('SELECT id, name FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1');
      for (const name of rawNames) {
        const u = stmt.get(name) as { id: string; name: string } | undefined;
        if (u && u.id !== input.authorUserId) {
          // 不通知自己 @ 自己 (常见 typo, 不算 mention)
          mentions.push({ userId: u.id, name: u.name });
        }
      }
    }

    const id = nanoid();
    const ts = now();
    db.prepare(`
      INSERT INTO comments
      (id, project_id, target_type, target_id, author_user_id, author_name, author_avatar_url, content, mentions, attachments, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.targetType,
      input.targetId,
      input.authorUserId,
      input.authorName,
      input.authorAvatarUrl || null,
      content,
      JSON.stringify(mentions),
      JSON.stringify(attachments),
      parentId,
      ts,
    );

    // 通知收件箱: mention → recipient + reply → parent 评论作者 (如果不是自己回自己)
    const notifyIds = new Set<string>();
    for (const m of mentions) notifyIds.add(m.userId);
    if (parentId) {
      const parentRow = db
        .prepare('SELECT author_user_id FROM comments WHERE id = ?')
        .get(parentId) as { author_user_id: string } | undefined;
      if (parentRow && parentRow.author_user_id !== input.authorUserId) {
        notifyIds.add(parentRow.author_user_id);
      }
    }

    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
    const insertNotif = db.prepare(`
      INSERT INTO notifications
      (id, recipient_user_id, type, source_user_id, source_user_name, project_id, comment_id, preview, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const recipient of notifyIds) {
      const isReply = parentId && mentions.every(m => m.userId !== recipient);
      insertNotif.run(
        nanoid(),
        recipient,
        isReply ? 'reply' : 'mention',
        input.authorUserId,
        input.authorName,
        input.projectId,
        id,
        preview,
        ts,
      );
    }

    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentDbRow;
    return {
      comment: rowToComment(row),
      notifiedUserIds: Array.from(notifyIds),
      // v3.x E.2: 收集 per-recipient 类型, 给事务外的 email send 用
      notifyRecords: Array.from(notifyIds).map((rid) => ({
        recipientUserId: rid,
        type: (parentId && mentions.every(m => m.userId !== rid)) ? 'reply' as const : 'mention' as const,
        preview,
      })),
    };
  });

  const result = txn();

  // v3.x E.2: 事务外异步触发邮件 — best-effort, 失败不影响评论已提交
  void (async () => {
    try {
      const { sendCommentNotificationEmail, isEmailEnabled } = await import('@/lib/email-sender');
      if (!isEmailEnabled()) return;
      // 查项目标题给邮件用
      let projectTitle: string | undefined;
      try {
        const p = db.prepare('SELECT title FROM projects WHERE id = ?').get(input.projectId) as { title?: string } | undefined;
        projectTitle = p?.title;
      } catch { /* ignore */ }
      for (const rec of (result as any).notifyRecords || []) {
        await sendCommentNotificationEmail({
          recipientUserId: rec.recipientUserId,
          sourceUserName: input.authorName,
          projectId: input.projectId,
          projectTitle,
          commentId: result.comment.id,
          preview: rec.preview,
          type: rec.type,
        }).catch((e) => {
          console.warn('[email-notify] send failed:', e instanceof Error ? e.message : e);
        });
      }
    } catch (e) {
      console.warn('[email-notify] block failed:', e instanceof Error ? e.message : e);
    }
  })();

  return { comment: result.comment, notifiedUserIds: result.notifiedUserIds };
}

export interface ListCommentsOptions {
  projectId: string;
  targetType?: CommentTargetType;
  targetId?: string;
  limit?: number;
  /** include soft-deleted (rendered as [已删除]) — default true so threads stay coherent */
  includeDeleted?: boolean;
}

/**
 * 按 project 拉评论, 可选按 target_type+target_id 过滤. 默认按 created_at ASC.
 * 默认上限 200 条; threading 在 UI 层做 (按 parent_id 分组).
 */
export function listComments(opts: ListCommentsOptions): CommentRow[] {
  const where: string[] = ['project_id = ?'];
  const args: any[] = [opts.projectId];
  if (opts.targetType) {
    where.push('target_type = ?');
    args.push(opts.targetType);
  }
  if (opts.targetId) {
    where.push('target_id = ?');
    args.push(opts.targetId);
  }
  if (opts.includeDeleted === false) {
    where.push('deleted_at IS NULL');
  }
  const limit = Math.min(500, Math.max(1, opts.limit || 200));
  args.push(limit);
  const rows = db
    .prepare(`SELECT * FROM comments WHERE ${where.join(' AND ')} ORDER BY created_at ASC LIMIT ?`)
    .all(...args) as CommentDbRow[];
  return rows.map(rowToComment);
}

/** 软删除 — 作者本人可删. 返回 true 表示成功删除. */
export function deleteComment(id: string, requesterUserId: string): boolean {
  const row = db
    .prepare('SELECT author_user_id, deleted_at FROM comments WHERE id = ?')
    .get(id) as { author_user_id: string; deleted_at: string | null } | undefined;
  if (!row) return false;
  if (row.author_user_id !== requesterUserId) return false; // 不是自己写的不能删
  if (row.deleted_at) return true; // 已经删过, 幂等
  db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(now(), id);
  return true;
}

/** 评论按 thread (parent_id) 分组 — 给 UI 渲染嵌套用. 1 层 reply, 不再深. */
export interface CommentThread {
  root: CommentRow;
  replies: CommentRow[];
}
export function groupByThread(comments: CommentRow[]): CommentThread[] {
  const byId = new Map<string, CommentRow>();
  for (const c of comments) byId.set(c.id, c);
  const roots: CommentRow[] = [];
  const replyOf = new Map<string, CommentRow[]>();
  for (const c of comments) {
    if (c.parentId && byId.has(c.parentId)) {
      const arr = replyOf.get(c.parentId) || [];
      arr.push(c);
      replyOf.set(c.parentId, arr);
    } else {
      roots.push(c);
    }
  }
  return roots.map((r) => ({ root: r, replies: replyOf.get(r.id) || [] }));
}

// ════════════════════════════════════════════════════════════════════════════
// v4.2.6 · async / DbDriver 版本 (SQLite/PG 双驱动). 逻辑与上面同步版等价.
// 写路径 (createCommentAsync) 走 DbDriver.transaction 保证 comment + notifications 原子.
// 同步版保留 (其他调用方 + 向后兼容); route 切到 async 版.
// ════════════════════════════════════════════════════════════════════════════

/** async 版创建评论 + @mention 解析 + 通知扇出 (单事务). */
export async function createCommentAsync(input: CreateCommentInput): Promise<CreateCommentResult> {
  const content = (input.content || '').trim();
  const attachments: CommentAttachment[] = Array.isArray(input.attachments)
    ? input.attachments
        .filter((a) => a && typeof a.url === 'string' && a.url.startsWith('http'))
        .filter((a) => ['image', 'video', 'file'].includes(a.type))
        .slice(0, 6)
    : [];
  if (!content && attachments.length === 0) throw new Error('comment content empty');
  if (content.length > 2000) throw new Error('comment content too long (max 2000)');

  const { getDbDriver } = await import('@/lib/db-driver');
  const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;

  const result = await getDbDriver().transaction(async (tx) => {
    // parentId 校验 (同 project)
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await tx.get<{ id: string; project_id: string }>(
        `SELECT id, project_id, deleted_at FROM comments WHERE id = ?`, [input.parentId]);
      if (parent && parent.project_id === input.projectId) parentId = parent.id;
    }
    // @mention 解析 → user_id (服务端唯一真理)
    const rawNames = uniqueMentions(parseMentionNames(content));
    const mentions: Array<{ userId: string; name: string }> = [];
    for (const name of rawNames) {
      const u = await tx.get<{ id: string; name: string }>(
        'SELECT id, name FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
      if (u && u.id !== input.authorUserId) mentions.push({ userId: u.id, name: u.name });
    }
    const id = nanoid();
    const ts = now();
    await tx.run(
      `INSERT INTO comments
        (id, project_id, target_type, target_id, author_user_id, author_name, author_avatar_url, content, mentions, attachments, parent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.projectId, input.targetType, input.targetId, input.authorUserId, input.authorName,
       input.authorAvatarUrl || null, content, JSON.stringify(mentions), JSON.stringify(attachments), parentId, ts],
    );
    // 通知扇出: mention + reply→parent 作者
    const notifyIds = new Set<string>();
    for (const m of mentions) notifyIds.add(m.userId);
    if (parentId) {
      const parentRow = await tx.get<{ author_user_id: string }>(
        'SELECT author_user_id FROM comments WHERE id = ?', [parentId]);
      if (parentRow && parentRow.author_user_id !== input.authorUserId) notifyIds.add(parentRow.author_user_id);
    }
    for (const recipient of notifyIds) {
      const isReply = parentId && mentions.every((m) => m.userId !== recipient);
      await tx.run(
        `INSERT INTO notifications
          (id, recipient_user_id, type, source_user_id, source_user_name, project_id, comment_id, preview, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [nanoid(), recipient, isReply ? 'reply' : 'mention', input.authorUserId, input.authorName, input.projectId, id, preview, ts],
      );
    }
    const row = await tx.get<CommentDbRow>('SELECT * FROM comments WHERE id = ?', [id]);
    const notifyRecords = Array.from(notifyIds).map((rid) => ({
      recipientUserId: rid,
      type: (parentId && mentions.every((m) => m.userId !== rid)) ? 'reply' as const : 'mention' as const,
      preview,
    }));
    return { comment: rowToComment(row!), notifiedUserIds: Array.from(notifyIds), notifyRecords };
  });

  // 实时推送 (SSE · 进程内事件总线 · best-effort): 评论落库后即时通知订阅的前端
  // —— comment 频道驱动评论区实时刷新, notif 频道驱动通知铃实时更新, 取代轮询.
  try {
    const { emitComment, emitNotification } = await import('@/lib/event-bus');
    emitComment(input.projectId, { commentId: result.comment.id });
    for (const uid of result.notifiedUserIds) {
      emitNotification(uid, { commentId: result.comment.id, projectId: input.projectId });
    }
  } catch { /* 推送失败不影响评论已落库 */ }

  // 事务外 best-effort 邮件 (与同步版一致)
  void (async () => {
    try {
      const { sendCommentNotificationEmail, isEmailEnabled } = await import('@/lib/email-sender');
      if (!isEmailEnabled()) return;
      let projectTitle: string | undefined;
      try {
        const { getDbDriver } = await import('@/lib/db-driver');
        const p = await getDbDriver().get<{ title?: string }>('SELECT title FROM projects WHERE id = ?', [input.projectId]);
        projectTitle = p?.title;
      } catch { /* ignore */ }
      for (const rec of result.notifyRecords) {
        await sendCommentNotificationEmail({
          recipientUserId: rec.recipientUserId,
          sourceUserName: input.authorName,
          projectId: input.projectId,
          projectTitle,
          commentId: result.comment.id,
          preview: rec.preview,
          type: rec.type,
        }).catch((e) => console.warn('[email-notify] send failed:', e instanceof Error ? e.message : e));
      }
    } catch (e) {
      console.warn('[email-notify] block failed:', e instanceof Error ? e.message : e);
    }
  })();

  return { comment: result.comment, notifiedUserIds: result.notifiedUserIds };
}

/** async 版按 project 拉评论. */
export async function listCommentsAsync(opts: ListCommentsOptions): Promise<CommentRow[]> {
  const { getDbDriver } = await import('@/lib/db-driver');
  const where: string[] = ['project_id = ?'];
  const args: any[] = [opts.projectId];
  if (opts.targetType) { where.push('target_type = ?'); args.push(opts.targetType); }
  if (opts.targetId) { where.push('target_id = ?'); args.push(opts.targetId); }
  if (opts.includeDeleted === false) where.push('deleted_at IS NULL');
  const limit = Math.min(500, Math.max(1, opts.limit || 200));
  args.push(limit);
  const rows = await getDbDriver().query<CommentDbRow>(
    `SELECT * FROM comments WHERE ${where.join(' AND ')} ORDER BY created_at ASC LIMIT ?`, args);
  return rows.map(rowToComment);
}

/** async 版软删 (作者本人, 幂等). */
export async function deleteCommentAsync(id: string, requesterUserId: string): Promise<boolean> {
  const { getDbDriver } = await import('@/lib/db-driver');
  const row = await getDbDriver().get<{ author_user_id: string; deleted_at: string | null }>(
    'SELECT author_user_id, deleted_at FROM comments WHERE id = ?', [id]);
  if (!row) return false;
  if (row.author_user_id !== requesterUserId) return false;
  if (row.deleted_at) return true;
  await getDbDriver().run('UPDATE comments SET deleted_at = ? WHERE id = ?', [now(), id]);
  return true;
}
