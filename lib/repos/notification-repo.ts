/**
 * v4.2.4 — 通知仓库 (async, 走 DbDriver).
 *
 * PG 迁移协作域第二块: notifications. 走异步 DbDriver, SQLite/PG 双驱动.
 *
 * 单测: tests/v4-2-4-collab-repo.test.ts.
 */

import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface NotificationRow {
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

const COLS =
  'id, recipient_user_id, type, source_user_id, source_user_name, project_id, comment_id, preview, read_at, created_at';

/** 列某用户的通知 (新→旧). unreadOnly=true 只列未读. */
export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const where = opts.unreadOnly ? 'AND read_at IS NULL' : '';
  return getDbDriver().query<NotificationRow>(
    `SELECT ${COLS} FROM notifications WHERE recipient_user_id = ? ${where} ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}

export async function countUnread(userId: string): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL`, [userId],
  );
  return r?.c ?? 0;
}

export interface CreateNotificationInput {
  recipientUserId: string;
  type: string;
  sourceUserId: string;
  sourceUserName: string;
  projectId?: string | null;
  commentId?: string | null;
  preview?: string | null;
}

export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  const driver = getDbDriver();
  const id = 'ntf_' + nanoid(12);
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO notifications (id, recipient_user_id, type, source_user_id, source_user_name, project_id, comment_id, preview, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      id, input.recipientUserId, input.type, input.sourceUserId, input.sourceUserName,
      input.projectId ?? null, input.commentId ?? null,
      input.preview ? input.preview.slice(0, 200) : null, ts,
    ],
  );
  const row = await driver.get<NotificationRow>(`SELECT ${COLS} FROM notifications WHERE id = ?`, [id]);
  if (!row) throw new Error('createNotification: 插入后读取失败');
  return row;
}

/** 标记单条已读 (仅接收者). */
export async function markRead(id: string, userId: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`,
    [new Date().toISOString(), id, userId],
  );
  return r.changes > 0;
}

/** 全部标记已读. 返回标记数. */
export async function markAllRead(userId: string): Promise<number> {
  const r = await getDbDriver().run(
    `UPDATE notifications SET read_at = ? WHERE recipient_user_id = ? AND read_at IS NULL`,
    [new Date().toISOString(), userId],
  );
  return r.changes;
}
