/**
 * v4.2.2 — 项目仓库 (async, 走 DbDriver).
 *
 * PG 迁移分模块异步化第二个模块 (auth 之后). 项目读写全部经异步 DbDriver,
 * SQLite/PG 双驱动. 占位符统一 SQLite 风格 `?`, PG driver 自动翻 `$n`.
 *
 * 只覆盖 projects 表本体 (列表/详情/建/改状态/删); 关联资产表照后续模块迁.
 *
 * 单测: tests/v4-2-2-project-repo.test.ts.
 */

import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_urls: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, user_id, title, description, cover_urls, status, created_at, updated_at';

export async function getProject(id: string): Promise<ProjectRow | null> {
  return getDbDriver().get<ProjectRow>(`SELECT ${COLS} FROM projects WHERE id = ?`, [id]);
}

/** 校验归属: 项目存在且属于该用户才返回. */
export async function getOwnedProject(id: string, userId: string): Promise<ProjectRow | null> {
  return getDbDriver().get<ProjectRow>(
    `SELECT ${COLS} FROM projects WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
}

export async function listProjectsByUser(userId: string): Promise<ProjectRow[]> {
  return getDbDriver().query<ProjectRow>(
    `SELECT ${COLS} FROM projects WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );
}

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
  coverUrls?: string[];
  status?: string;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectRow> {
  const driver = getDbDriver();
  const id = 'proj-' + Date.now() + '-' + nanoid(6);
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.userId, input.title, input.description ?? null,
      JSON.stringify(input.coverUrls ?? []), input.status || 'draft', ts, ts,
    ],
  );
  const row = await getProject(id);
  if (!row) throw new Error('createProject: 插入后读取失败');
  return row;
}

/** 改状态 (draft/active/...). 仅 owner. 返回是否改动. */
export async function updateProjectStatus(id: string, userId: string, status: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [status, new Date().toISOString(), id, userId],
  );
  return r.changes > 0;
}

/** 改标题/描述. 仅 owner. */
export async function updateProjectMeta(
  id: string,
  userId: string,
  patch: { title?: string; description?: string },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) { sets.push('title = ?'); params.push(patch.title); }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?'); params.push(new Date().toISOString());
  params.push(id, userId);
  const r = await getDbDriver().run(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    params,
  );
  return r.changes > 0;
}

/** 删项目. 仅 owner. (关联资产由调用方/级联另处理). */
export async function deleteProject(id: string, userId: string): Promise<boolean> {
  const r = await getDbDriver().run(`DELETE FROM projects WHERE id = ? AND user_id = ?`, [id, userId]);
  return r.changes > 0;
}
