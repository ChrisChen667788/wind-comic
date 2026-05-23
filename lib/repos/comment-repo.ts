/**
 * v4.2.4 — 评论仓库 (async, 走 DbDriver).
 *
 * PG 迁移协作域第一块: comments. 软删保留占位避免 reply 孤儿. 走异步 DbDriver,
 * SQLite/PG 双驱动, 占位符统一 `?`.
 *
 * 单测: tests/v4-2-4-collab-repo.test.ts.
 */

import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface CommentRow {
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

const COLS =
  'id, project_id, target_type, target_id, author_user_id, author_name, author_avatar_url, content, mentions, parent_id, created_at, updated_at, deleted_at';

/** 列某 target 的评论 (含软删占位, 按时间升序). */
export async function listComments(targetType: string, targetId: string): Promise<CommentRow[]> {
  return getDbDriver().query<CommentRow>(
    `SELECT ${COLS} FROM comments WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC`,
    [targetType, targetId],
  );
}

export async function getComment(id: string): Promise<CommentRow | null> {
  return getDbDriver().get<CommentRow>(`SELECT ${COLS} FROM comments WHERE id = ?`, [id]);
}

export interface CreateCommentInput {
  projectId: string;
  targetType: string;
  targetId: string;
  authorUserId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  content: string;
  mentions?: Array<{ userId: string; name: string }>;
  parentId?: string | null;
}

export async function createComment(input: CreateCommentInput): Promise<CommentRow> {
  const driver = getDbDriver();
  const id = 'cmt_' + nanoid(12);
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO comments (id, project_id, target_type, target_id, author_user_id, author_name, author_avatar_url, content, mentions, parent_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    [
      id, input.projectId, input.targetType, input.targetId,
      input.authorUserId, input.authorName, input.authorAvatarUrl ?? null,
      input.content.slice(0, 2000), JSON.stringify(input.mentions ?? []),
      input.parentId ?? null, ts,
    ],
  );
  const row = await getComment(id);
  if (!row) throw new Error('createComment: 插入后读取失败');
  return row;
}

/** 软删 (仅作者). 保留行 + deleted_at, thread 显示 [已删除] 占位. */
export async function softDeleteComment(id: string, userId: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE comments SET deleted_at = ? WHERE id = ? AND author_user_id = ? AND deleted_at IS NULL`,
    [new Date().toISOString(), id, userId],
  );
  return r.changes > 0;
}

export async function countProjectComments(projectId: string): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM comments WHERE project_id = ? AND deleted_at IS NULL`, [projectId],
  );
  return r?.c ?? 0;
}
