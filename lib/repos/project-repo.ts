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

// ─── v9.0.2: 创作管线 / 无 ACL 的按 id 写 (create-stream / cameo / share 复用) ──
// 这些路由是 demo-friendly 不强制归属, 按 id 直接写 (与现状一致, 不引 owner 守卫)。

/** v9.0.2: 创作管线建项目 — 客户端给定 id + 创作列 (style/primary cameo/locked chars). */
export interface InsertProjectFullInput {
  id: string;
  userId: string;
  title: string;
  description?: string;
  coverUrls?: string[];
  status?: string;
  styleId?: string | null;
  primaryCharacterRef?: string | null;
  /** 锁定角色数组 (repo 负责 JSON 序列化). */
  lockedCharacters?: unknown[];
}

export async function insertProjectFull(input: InsertProjectFullInput): Promise<ProjectRow> {
  const driver = getDbDriver();
  const ts = new Date().toISOString();
  await driver.run(
    `INSERT INTO projects (id, user_id, title, description, cover_urls, status, style_id, primary_character_ref, locked_characters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id, input.userId, input.title, input.description ?? null,
      JSON.stringify(input.coverUrls ?? []), input.status || 'active',
      input.styleId ?? null, input.primaryCharacterRef ?? null,
      JSON.stringify(input.lockedCharacters ?? []), ts, ts,
    ],
  );
  const row = await getProject(input.id);
  if (!row) throw new Error('insertProjectFull: 插入后读取失败');
  return row;
}

/** v9.0.2: 允许 updateProjectById 写的列白名单 (挡 key 注入; JSON 列由调用方先 stringify). */
const PROJECT_UPDATABLE_COLS = new Set([
  'title', 'description', 'cover_urls', 'status',
  'style_id', 'primary_character_ref', 'locked_characters',
  'director_notes', 'script_data',
]);

/**
 * v9.0.2: 按 id 更新项目列 (无 owner 守卫, 给创作管线/cameo 用).
 * patch 用 snake_case 列名 → 值 (string|null, JSON 列调用方已 stringify); 自动带 updated_at.
 * 传 undefined 的键跳过; 空 patch 返回 false. 非白名单列抛错.
 */
export async function updateProjectById(
  id: string,
  patch: Record<string, string | null | undefined>,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [col, val] of Object.entries(patch)) {
    if (val === undefined) continue;
    if (!PROJECT_UPDATABLE_COLS.has(col)) throw new Error(`updateProjectById: 不允许更新列 ${col}`);
    sets.push(`${col} = ?`);
    params.push(val);
  }
  if (sets.length === 0) return false;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  const r = await getDbDriver().run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.changes > 0;
}
