/**
 * v3.x — 项目协作: 分享链接 + 邀请协作者.
 *
 * 模式复用 lib/template-share.ts. 区别:
 *   - 分享对象不是 template asset, 而是整个 project
 *   - 多了 role 权限 ('viewer' | 'commenter' | 'editor')
 *   - 用户点链接 → 显示项目预览 → "接受邀请" 写入 project_collaborators
 *
 * 角色语义:
 *   - viewer: 只能 GET (看剧本/分镜/视频), 不能改/评论
 *   - commenter: viewer + 可以发评论 + @ 别人
 *   - editor: commenter + 可改 storyboard / 时间线 / 删评论 (但仍不能转让所有权)
 */

import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';

export type ProjectRole = 'viewer' | 'commenter' | 'editor';

export interface ProjectShareToken {
  token: string;
  projectId: string;
  ownerUserId: string;
  role: ProjectRole;
  viewCount: number;
  acceptCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ProjectCollaborator {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  invitedByUserId: string | null;
  invitedViaToken: string | null;
  joinedAt: string;
}

interface TokenRow {
  token: string;
  project_id: string;
  owner_user_id: string;
  role: string;
  view_count: number;
  accept_count: number;
  expires_at: string | null;
  created_at: string;
}

interface CollabRow {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  invited_by_user_id: string | null;
  invited_via_token: string | null;
  joined_at: string;
}

function rowToToken(r: TokenRow): ProjectShareToken {
  return {
    token: r.token,
    projectId: r.project_id,
    ownerUserId: r.owner_user_id,
    role: r.role as ProjectRole,
    viewCount: r.view_count,
    acceptCount: r.accept_count,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

function rowToCollab(r: CollabRow): ProjectCollaborator {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    role: r.role as ProjectRole,
    invitedByUserId: r.invited_by_user_id,
    invitedViaToken: r.invited_via_token,
    joinedAt: r.joined_at,
  };
}

function isValidRole(r: string): r is ProjectRole {
  return r === 'viewer' || r === 'commenter' || r === 'editor';
}

// ─── Token CRUD ────────────────────────────────────────────────────────────
export interface CreateShareTokenInput {
  projectId: string;
  ownerUserId: string;
  role?: ProjectRole;
  expiresInDays?: number | null;  // null = 永久, undefined = 永久, N = N 天后过期
}

export function createProjectShareToken(input: CreateShareTokenInput): ProjectShareToken {
  const role = input.role && isValidRole(input.role) ? input.role : 'viewer';
  const token = nanoid(24);
  const ts = now();
  let expiresAt: string | null = null;
  if (typeof input.expiresInDays === 'number' && Number.isFinite(input.expiresInDays) && input.expiresInDays > 0) {
    const days = Math.min(365, Math.floor(input.expiresInDays));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  db.prepare(`
    INSERT INTO project_share_tokens
      (token, project_id, owner_user_id, role, view_count, accept_count, created_at, expires_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?)
  `).run(token, input.projectId, input.ownerUserId, role, ts, expiresAt);
  return {
    token, projectId: input.projectId, ownerUserId: input.ownerUserId,
    role, viewCount: 0, acceptCount: 0, expiresAt, createdAt: ts,
  };
}

/** 取 token, 校验未过期; 失败返 null. */
export function getProjectShareToken(token: string): ProjectShareToken | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM project_share_tokens WHERE token = ?').get(token) as TokenRow | undefined;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return rowToToken(row);
}

export function incrementShareTokenViewCount(token: string): void {
  db.prepare(`UPDATE project_share_tokens SET view_count = view_count + 1 WHERE token = ?`).run(token);
}

export function incrementShareTokenAcceptCount(token: string): void {
  db.prepare(`UPDATE project_share_tokens SET accept_count = accept_count + 1 WHERE token = ?`).run(token);
}

export function listShareTokensForProject(projectId: string): ProjectShareToken[] {
  const rows = db.prepare(
    `SELECT * FROM project_share_tokens WHERE project_id = ? ORDER BY created_at DESC`,
  ).all(projectId) as TokenRow[];
  return rows.map(rowToToken);
}

/** 吊销 token — 只允许 owner. 返 true 删了 row. */
export function revokeProjectShareToken(token: string, requesterUserId: string): boolean {
  const r = db.prepare(
    `DELETE FROM project_share_tokens WHERE token = ? AND owner_user_id = ?`,
  ).run(token, requesterUserId);
  return r.changes > 0;
}

// ─── Collaborator CRUD ─────────────────────────────────────────────────────
export interface AcceptInviteInput {
  token: string;
  userId: string;
}

export interface AcceptInviteResult {
  ok: boolean;
  error?: string;
  collaborator?: ProjectCollaborator;
}

/**
 * 用户接受邀请 — 校验 token 有效, 写入 project_collaborators (UNIQUE 防重复).
 * Owner 不能接受自己的项目邀请 (本来就有权限).
 */
export function acceptProjectInvite(input: AcceptInviteInput): AcceptInviteResult {
  const token = getProjectShareToken(input.token);
  if (!token) return { ok: false, error: 'token 无效或已过期' };
  if (token.ownerUserId === input.userId) {
    return { ok: false, error: '这是你自己的项目, 不需要邀请' };
  }
  // 已是 collaborator? 升级 role (如果新 role 更高)
  const existing = db.prepare(
    `SELECT * FROM project_collaborators WHERE project_id = ? AND user_id = ?`,
  ).get(token.projectId, input.userId) as CollabRow | undefined;
  if (existing) {
    // 角色升级 (viewer < commenter < editor)
    const order: ProjectRole[] = ['viewer', 'commenter', 'editor'];
    const oldRank = order.indexOf(existing.role as ProjectRole);
    const newRank = order.indexOf(token.role);
    if (newRank > oldRank) {
      db.prepare(`UPDATE project_collaborators SET role = ? WHERE id = ?`).run(token.role, existing.id);
    }
    incrementShareTokenAcceptCount(input.token);
    const refreshed = db.prepare(`SELECT * FROM project_collaborators WHERE id = ?`).get(existing.id) as CollabRow;
    return { ok: true, collaborator: rowToCollab(refreshed) };
  }
  const id = nanoid();
  db.prepare(`
    INSERT INTO project_collaborators
      (id, project_id, user_id, role, invited_by_user_id, invited_via_token, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, token.projectId, input.userId, token.role, token.ownerUserId, input.token, now());
  incrementShareTokenAcceptCount(input.token);
  const row = db.prepare(`SELECT * FROM project_collaborators WHERE id = ?`).get(id) as CollabRow;
  return { ok: true, collaborator: rowToCollab(row) };
}

export function listCollaborators(projectId: string): ProjectCollaborator[] {
  const rows = db.prepare(
    `SELECT * FROM project_collaborators WHERE project_id = ? ORDER BY joined_at`,
  ).all(projectId) as CollabRow[];
  return rows.map(rowToCollab);
}

/** Owner 踢出协作者 (返 true 删除成功). */
export function removeCollaborator(projectId: string, userIdToRemove: string, requesterUserId: string): boolean {
  // 查 owner
  const proj = db.prepare(`SELECT user_id FROM projects WHERE id = ?`).get(projectId) as { user_id: string } | undefined;
  if (!proj) return false;
  if (proj.user_id !== requesterUserId) return false; // 仅 owner 可踢
  if (userIdToRemove === requesterUserId) return false; // 不能踢自己 (owner 本来就在外)
  const r = db.prepare(
    `DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?`,
  ).run(projectId, userIdToRemove);
  return r.changes > 0;
}

/** 修改协作者角色 (仅 owner). */
export function updateCollaboratorRole(
  projectId: string, userId: string, newRole: ProjectRole, requesterUserId: string,
): boolean {
  if (!isValidRole(newRole)) return false;
  const proj = db.prepare(`SELECT user_id FROM projects WHERE id = ?`).get(projectId) as { user_id: string } | undefined;
  if (!proj || proj.user_id !== requesterUserId) return false;
  const r = db.prepare(
    `UPDATE project_collaborators SET role = ? WHERE project_id = ? AND user_id = ?`,
  ).run(newRole, projectId, userId);
  return r.changes > 0;
}

// ─── 权限查询 (其他 API 鉴权用) ──────────────────────────────────────────────
/**
 * 用户对项目有哪些权限. 检查顺序:
 *   1. 是 owner → 'editor' (所有权限)
 *   2. 在 project_collaborators 里 → 该 collab.role
 *   3. 否则 → null (无权限)
 */
export function getUserProjectRole(projectId: string, userId: string): ProjectRole | null {
  const proj = db.prepare(`SELECT user_id FROM projects WHERE id = ?`).get(projectId) as { user_id: string } | undefined;
  if (proj && proj.user_id === userId) return 'editor';
  const collab = db.prepare(
    `SELECT role FROM project_collaborators WHERE project_id = ? AND user_id = ?`,
  ).get(projectId, userId) as { role: string } | undefined;
  if (collab && isValidRole(collab.role)) return collab.role as ProjectRole;
  return null;
}

/** 用户能不能编辑该项目 (editor 或 owner). */
export function canEditProject(projectId: string, userId: string): boolean {
  return getUserProjectRole(projectId, userId) === 'editor';
}

/** 用户能不能评论该项目 (commenter / editor / owner). */
export function canCommentProject(projectId: string, userId: string): boolean {
  const role = getUserProjectRole(projectId, userId);
  return role === 'commenter' || role === 'editor';
}

/** 用户能不能至少看该项目 (有任意 role 即可). */
export function canViewProject(projectId: string, userId: string): boolean {
  return getUserProjectRole(projectId, userId) !== null;
}
