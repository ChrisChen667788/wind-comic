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

export type CommentTargetType = 'project' | 'shot' | 'scene' | 'character' | 'storyboard';

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
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** 给 UI 调用方统一构造 target_id 的辅助函数, 避免拼写漂移. */
export function buildTargetId(
  targetType: CommentTargetType,
  projectId: string,
  subKey?: string | number,
): string {
  if (targetType === 'project') return projectId;
  if (targetType === 'shot' || targetType === 'storyboard') {
    if (subKey == null) throw new Error(`${targetType} target requires subKey (shotNumber)`);
    return `${projectId}:${subKey}`;
  }
  // scene / character — 用名字作 sub-key
  if (subKey == null) throw new Error(`${targetType} target requires subKey (name)`);
  return String(subKey);
}

export interface CreateCommentInput {
  projectId: string;
  targetType: CommentTargetType;
  targetId: string;
  authorUserId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  content: string;
  parentId?: string | null;
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
  if (!content) throw new Error('comment content empty');
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
      (id, project_id, target_type, target_id, author_user_id, author_name, author_avatar_url, content, mentions, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    };
  });

  return txn();
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
