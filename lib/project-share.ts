/**
 * v3.x — 项目协作: 分享链接 + 邀请协作者. (v9.0.4b: 全量异步化, 走 DbDriver 双驱动)
 *
 * 角色语义: viewer(只看) < commenter(+评论) < editor(+改分镜/时间线/删评论)。
 */

import { getDbDriver } from '@/lib/db-driver';
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
    token: r.token, projectId: r.project_id, ownerUserId: r.owner_user_id,
    role: r.role as ProjectRole, viewCount: r.view_count, acceptCount: r.accept_count,
    expiresAt: r.expires_at, createdAt: r.created_at,
  };
}

function rowToCollab(r: CollabRow): ProjectCollaborator {
  return {
    id: r.id, projectId: r.project_id, userId: r.user_id, role: r.role as ProjectRole,
    invitedByUserId: r.invited_by_user_id, invitedViaToken: r.invited_via_token, joinedAt: r.joined_at,
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
  expiresInDays?: number | null;
}

export async function createProjectShareToken(input: CreateShareTokenInput): Promise<ProjectShareToken> {
  const role = input.role && isValidRole(input.role) ? input.role : 'viewer';
  const token = nanoid(24);
  const ts = new Date().toISOString();
  let expiresAt: string | null = null;
  if (typeof input.expiresInDays === 'number' && Number.isFinite(input.expiresInDays) && input.expiresInDays > 0) {
    const days = Math.min(365, Math.floor(input.expiresInDays));
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  await getDbDriver().run(
    `INSERT INTO project_share_tokens (token, project_id, owner_user_id, role, view_count, accept_count, created_at, expires_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
    [token, input.projectId, input.ownerUserId, role, ts, expiresAt],
  );
  return { token, projectId: input.projectId, ownerUserId: input.ownerUserId, role, viewCount: 0, acceptCount: 0, expiresAt, createdAt: ts };
}

/** 取 token, 校验未过期; 失败返 null. */
export async function getProjectShareToken(token: string): Promise<ProjectShareToken | null> {
  if (!token) return null;
  const row = await getDbDriver().get<TokenRow>('SELECT * FROM project_share_tokens WHERE token = ?', [token]);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return rowToToken(row);
}

export async function incrementShareTokenViewCount(token: string): Promise<void> {
  await getDbDriver().run(`UPDATE project_share_tokens SET view_count = view_count + 1 WHERE token = ?`, [token]);
}

export async function incrementShareTokenAcceptCount(token: string): Promise<void> {
  await getDbDriver().run(`UPDATE project_share_tokens SET accept_count = accept_count + 1 WHERE token = ?`, [token]);
}

export async function listShareTokensForProject(projectId: string): Promise<ProjectShareToken[]> {
  const rows = await getDbDriver().query<TokenRow>(
    `SELECT * FROM project_share_tokens WHERE project_id = ? ORDER BY created_at DESC`, [projectId]);
  return rows.map(rowToToken);
}

/** 吊销 token — 只允许 owner. */
export async function revokeProjectShareToken(token: string, requesterUserId: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `DELETE FROM project_share_tokens WHERE token = ? AND owner_user_id = ?`, [token, requesterUserId]);
  return r.changes > 0;
}

// ─── Collaborator CRUD ─────────────────────────────────────────────────────
export interface AcceptInviteInput { token: string; userId: string; }
export interface AcceptInviteResult { ok: boolean; error?: string; collaborator?: ProjectCollaborator; }

/** 用户接受邀请 — 校验 token, 写 project_collaborators (已存在则按需升级 role). */
export async function acceptProjectInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
  const d = getDbDriver();
  const token = await getProjectShareToken(input.token);
  if (!token) return { ok: false, error: 'token 无效或已过期' };
  if (token.ownerUserId === input.userId) return { ok: false, error: '这是你自己的项目, 不需要邀请' };

  const existing = await d.get<CollabRow>(
    `SELECT * FROM project_collaborators WHERE project_id = ? AND user_id = ?`, [token.projectId, input.userId]);
  if (existing) {
    const order: ProjectRole[] = ['viewer', 'commenter', 'editor'];
    if (order.indexOf(token.role) > order.indexOf(existing.role as ProjectRole)) {
      await d.run(`UPDATE project_collaborators SET role = ? WHERE id = ?`, [token.role, existing.id]);
    }
    await incrementShareTokenAcceptCount(input.token);
    const refreshed = await d.get<CollabRow>(`SELECT * FROM project_collaborators WHERE id = ?`, [existing.id]);
    return { ok: true, collaborator: rowToCollab(refreshed!) };
  }
  const id = nanoid();
  await d.run(
    `INSERT INTO project_collaborators (id, project_id, user_id, role, invited_by_user_id, invited_via_token, joined_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, token.projectId, input.userId, token.role, token.ownerUserId, input.token, new Date().toISOString()]);
  await incrementShareTokenAcceptCount(input.token);
  const row = await d.get<CollabRow>(`SELECT * FROM project_collaborators WHERE id = ?`, [id]);
  return { ok: true, collaborator: rowToCollab(row!) };
}

export async function listCollaborators(projectId: string): Promise<ProjectCollaborator[]> {
  const rows = await getDbDriver().query<CollabRow>(
    `SELECT * FROM project_collaborators WHERE project_id = ? ORDER BY joined_at`, [projectId]);
  return rows.map(rowToCollab);
}

/** Owner 踢出协作者. */
export async function removeCollaborator(projectId: string, userIdToRemove: string, requesterUserId: string): Promise<boolean> {
  const d = getDbDriver();
  const proj = await d.get<{ user_id: string }>(`SELECT user_id FROM projects WHERE id = ?`, [projectId]);
  if (!proj) return false;
  if (proj.user_id !== requesterUserId) return false;
  if (userIdToRemove === requesterUserId) return false;
  const r = await d.run(`DELETE FROM project_collaborators WHERE project_id = ? AND user_id = ?`, [projectId, userIdToRemove]);
  return r.changes > 0;
}

/** 修改协作者角色 (仅 owner). */
export async function updateCollaboratorRole(
  projectId: string, userId: string, newRole: ProjectRole, requesterUserId: string,
): Promise<boolean> {
  if (!isValidRole(newRole)) return false;
  const d = getDbDriver();
  const proj = await d.get<{ user_id: string }>(`SELECT user_id FROM projects WHERE id = ?`, [projectId]);
  if (!proj || proj.user_id !== requesterUserId) return false;
  const r = await d.run(`UPDATE project_collaborators SET role = ? WHERE project_id = ? AND user_id = ?`, [newRole, projectId, userId]);
  return r.changes > 0;
}

// ─── 权限查询 ────────────────────────────────────────────────────────────────
export async function getUserProjectRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const d = getDbDriver();
  const proj = await d.get<{ user_id: string }>(`SELECT user_id FROM projects WHERE id = ?`, [projectId]);
  if (proj && proj.user_id === userId) return 'editor';
  const collab = await d.get<{ role: string }>(`SELECT role FROM project_collaborators WHERE project_id = ? AND user_id = ?`, [projectId, userId]);
  if (collab && isValidRole(collab.role)) return collab.role as ProjectRole;
  return null;
}

export async function canEditProject(projectId: string, userId: string): Promise<boolean> {
  return (await getUserProjectRole(projectId, userId)) === 'editor';
}

export async function canCommentProject(projectId: string, userId: string): Promise<boolean> {
  const role = await getUserProjectRole(projectId, userId);
  return role === 'commenter' || role === 'editor';
}

export async function canViewProject(projectId: string, userId: string): Promise<boolean> {
  return (await getUserProjectRole(projectId, userId)) !== null;
}
