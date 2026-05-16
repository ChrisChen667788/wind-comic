/**
 * v3.0 P0.1 — Notifications API.
 *
 * Notifications 写入在 lib/comments.createComment 内事务化触发 — 这个文件只负责
 * 读取 + 标记已读, 不直接 INSERT (避免和 comments 触发逻辑分叉, 单源真理).
 *
 * 鉴权:
 *   - listForUser / markRead / markAllRead / countUnread 都按 recipient_user_id 严格隔离
 *   - 任何一条 notification 都属于某个 recipient, 不存在跨用户访问
 */

import { db, now } from '@/lib/db';

export interface NotificationRow {
  id: string;
  recipientUserId: string;
  type: 'mention' | 'reply' | 'project_invite';
  sourceUserId: string;
  sourceUserName: string;
  projectId: string | null;
  commentId: string | null;
  preview: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationDbRow {
  id: string;
  recipient_user_id: string;
  type: string;
  source_user_id: string;
  source_user_name: string;
  project_id: string | null;
  comment_id: string | null;
  preview: string | null;
  read_at: string | null;
  created_at: string;
}

function rowToNotif(r: NotificationDbRow): NotificationRow {
  return {
    id: r.id,
    recipientUserId: r.recipient_user_id,
    type: r.type as NotificationRow['type'],
    sourceUserId: r.source_user_id,
    sourceUserName: r.source_user_name,
    projectId: r.project_id,
    commentId: r.comment_id,
    preview: r.preview,
    readAt: r.read_at,
    createdAt: r.created_at,
  };
}

export interface ListNotificationsOptions {
  recipientUserId: string;
  unreadOnly?: boolean;
  limit?: number;
}

export function listForUser(opts: ListNotificationsOptions): NotificationRow[] {
  const where: string[] = ['recipient_user_id = ?'];
  const args: any[] = [opts.recipientUserId];
  if (opts.unreadOnly) where.push('read_at IS NULL');
  const limit = Math.min(200, Math.max(1, opts.limit || 30));
  args.push(limit);
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...args) as NotificationDbRow[];
  return rows.map(rowToNotif);
}

export function countUnread(recipientUserId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL')
    .get(recipientUserId) as { n: number };
  return row.n || 0;
}

/**
 * 标记单条已读. 不属于此用户 → no-op (不暴露存在性).
 */
export function markRead(id: string, recipientUserId: string): boolean {
  const result = db
    .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL')
    .run(now(), id, recipientUserId);
  return result.changes > 0;
}

/** 全部标已读 — 返回受影响数 */
export function markAllRead(recipientUserId: string): number {
  const result = db
    .prepare('UPDATE notifications SET read_at = ? WHERE recipient_user_id = ? AND read_at IS NULL')
    .run(now(), recipientUserId);
  return result.changes;
}
