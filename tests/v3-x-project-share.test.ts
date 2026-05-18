/**
 * v3.x — 项目协作分享 + 邀请接受 + 角色权限.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import {
  createProjectShareToken,
  getProjectShareToken,
  listShareTokensForProject,
  revokeProjectShareToken,
  acceptProjectInvite,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  getUserProjectRole,
  canEditProject,
  canCommentProject,
  canViewProject,
} from '@/lib/project-share';

const TEST_PREFIX = 'test-v3x-share-';

let SEEDED_USER_ID = '';

function mkUser(prefix: string): { id: string; name: string } {
  const id = `${TEST_PREFIX}user-${prefix}-${nanoid(6)}`;
  const name = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
     VALUES (?, ?, '', ?, 'user', 'zh', ?)`,
  ).run(id, `${id}@test.local`, name, new Date().toISOString());
  return { id, name };
}

function mkProject(ownerUserId: string): string {
  const id = `${TEST_PREFIX}proj-${nanoid(8)}`;
  db.prepare(
    `INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', 'draft', ?, ?)`,
  ).run(id, ownerUserId, 'test project', 'desc', new Date().toISOString(), new Date().toISOString());
  return id;
}

function cleanupAll() {
  // 必须按 FK 顺序 DELETE — collaborators / tokens 先, projects 次, users 最后.
  db.prepare(`DELETE FROM project_share_tokens WHERE project_id LIKE 'test-v3x-share-%' OR owner_user_id LIKE 'test-v3x-share-%'`).run();
  db.prepare(`DELETE FROM project_collaborators WHERE project_id LIKE 'test-v3x-share-%' OR user_id LIKE 'test-v3x-share-%'`).run();
  db.prepare(`DELETE FROM projects WHERE id LIKE 'test-v3x-share-%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE 'test-v3x-share-%'`).run();
}

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const u = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    SEEDED_USER_ID = u?.id || '';
  }
  cleanupAll();
});

// 必须 afterEach 也清, 否则别的 test 文件 (例如 v3-0-comments-notifications) 在
// beforeEach 跑 `DELETE FROM users WHERE id LIKE 'test-%'` 时会撞 FK (projects 还
// 引用着我们的 test users).
afterEach(() => {
  cleanupAll();
});

describe('v3.x · createProjectShareToken', () => {
  it('creates token with default role viewer', () => {
    const owner = mkUser('owner');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    expect(t.token).toBeTruthy();
    expect(t.role).toBe('viewer');
    expect(t.viewCount).toBe(0);
    expect(t.acceptCount).toBe(0);
    expect(t.expiresAt).toBeNull();
  });

  it('respects custom role + expiresInDays', () => {
    const owner = mkUser('owner');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({
      projectId: pid, ownerUserId: owner.id,
      role: 'editor', expiresInDays: 7,
    });
    expect(t.role).toBe('editor');
    expect(t.expiresAt).toBeTruthy();
    // 7 天后
    const expDate = new Date(t.expiresAt!);
    const expectedDay = new Date(Date.now() + 7 * 86400_000);
    expect(Math.abs(expDate.getTime() - expectedDay.getTime())).toBeLessThan(60_000);
  });

  it('clamps expiresInDays to 365', () => {
    const owner = mkUser('owner');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({
      projectId: pid, ownerUserId: owner.id, expiresInDays: 9999,
    });
    const expDate = new Date(t.expiresAt!);
    const oneYear = new Date(Date.now() + 365 * 86400_000);
    expect(Math.abs(expDate.getTime() - oneYear.getTime())).toBeLessThan(60_000);
  });

  it('invalid role falls back to viewer', () => {
    const owner = mkUser('owner');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({
      projectId: pid, ownerUserId: owner.id, role: 'god' as any,
    });
    expect(t.role).toBe('viewer');
  });
});

describe('v3.x · getProjectShareToken', () => {
  it('returns token; null for missing', () => {
    const owner = mkUser('o');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    expect(getProjectShareToken(t.token)?.token).toBe(t.token);
    expect(getProjectShareToken('not-a-real-token')).toBeNull();
  });

  it('expired token returns null', () => {
    const owner = mkUser('o');
    const pid = mkProject(owner.id);
    // 手插过期 token
    const token = nanoid(24);
    const expired = new Date(Date.now() - 60_000).toISOString();
    db.prepare(`
      INSERT INTO project_share_tokens
        (token, project_id, owner_user_id, role, view_count, accept_count, created_at, expires_at)
      VALUES (?, ?, ?, 'viewer', 0, 0, ?, ?)
    `).run(token, pid, owner.id, new Date().toISOString(), expired);
    expect(getProjectShareToken(token)).toBeNull();
  });
});

describe('v3.x · revokeProjectShareToken', () => {
  it('only owner can revoke', () => {
    const owner = mkUser('o');
    const other = mkUser('x');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    expect(revokeProjectShareToken(t.token, other.id)).toBe(false);
    expect(getProjectShareToken(t.token)).toBeTruthy();
    expect(revokeProjectShareToken(t.token, owner.id)).toBe(true);
    expect(getProjectShareToken(t.token)).toBeNull();
  });
});

describe('v3.x · acceptProjectInvite', () => {
  it('happy path — guest joins as collaborator with token role', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'commenter' });
    const r = acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(r.ok).toBe(true);
    expect(r.collaborator?.role).toBe('commenter');
    expect(r.collaborator?.userId).toBe(guest.id);
    expect(r.collaborator?.projectId).toBe(pid);
  });

  it('owner cannot accept own invite', () => {
    const owner = mkUser('o');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    const r = acceptProjectInvite({ token: t.token, userId: owner.id });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/自己/);
  });

  it('accepting again with higher-role token upgrades role', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t1 = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'viewer' });
    acceptProjectInvite({ token: t1.token, userId: guest.id });
    expect(getUserProjectRole(pid, guest.id)).toBe('viewer');
    const t2 = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'editor' });
    const r = acceptProjectInvite({ token: t2.token, userId: guest.id });
    expect(r.ok).toBe(true);
    expect(getUserProjectRole(pid, guest.id)).toBe('editor');
  });

  it('accepting lower-role token does NOT downgrade role', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t1 = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'editor' });
    acceptProjectInvite({ token: t1.token, userId: guest.id });
    const t2 = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'viewer' });
    acceptProjectInvite({ token: t2.token, userId: guest.id });
    expect(getUserProjectRole(pid, guest.id)).toBe('editor');
  });

  it('expired/invalid token rejected', () => {
    const guest = mkUser('g');
    const r = acceptProjectInvite({ token: 'no-such-token', userId: guest.id });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/无效|过期/);
  });

  it('increments acceptCount on success', () => {
    const owner = mkUser('o');
    const g1 = mkUser('g1');
    const g2 = mkUser('g2');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    acceptProjectInvite({ token: t.token, userId: g1.id });
    acceptProjectInvite({ token: t.token, userId: g2.id });
    const refreshed = getProjectShareToken(t.token);
    expect(refreshed?.acceptCount).toBe(2);
  });
});

describe('v3.x · collaborator role management', () => {
  it('listCollaborators returns joined users', () => {
    const owner = mkUser('o');
    const g1 = mkUser('g1');
    const g2 = mkUser('g2');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'commenter' });
    acceptProjectInvite({ token: t.token, userId: g1.id });
    acceptProjectInvite({ token: t.token, userId: g2.id });
    const list = listCollaborators(pid);
    expect(list.length).toBe(2);
    expect(list.map((c) => c.userId).sort()).toEqual([g1.id, g2.id].sort());
  });

  it('owner removes collaborator', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(removeCollaborator(pid, guest.id, owner.id)).toBe(true);
    expect(getUserProjectRole(pid, guest.id)).toBeNull();
  });

  it('non-owner cannot remove collaborator', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const other = mkUser('x');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(removeCollaborator(pid, guest.id, other.id)).toBe(false);
  });

  it('updateCollaboratorRole only by owner', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'viewer' });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(updateCollaboratorRole(pid, guest.id, 'editor', owner.id)).toBe(true);
    expect(getUserProjectRole(pid, guest.id)).toBe('editor');
    // 非 owner 改不动
    const other = mkUser('x');
    expect(updateCollaboratorRole(pid, guest.id, 'viewer', other.id)).toBe(false);
  });
});

describe('v3.x · permission helpers (getUserProjectRole / can*)', () => {
  it('owner has editor role + can edit/comment/view', () => {
    const owner = mkUser('o');
    const pid = mkProject(owner.id);
    expect(getUserProjectRole(pid, owner.id)).toBe('editor');
    expect(canEditProject(pid, owner.id)).toBe(true);
    expect(canCommentProject(pid, owner.id)).toBe(true);
    expect(canViewProject(pid, owner.id)).toBe(true);
  });

  it('non-collaborator → null role, all permissions false', () => {
    const owner = mkUser('o');
    const other = mkUser('x');
    const pid = mkProject(owner.id);
    expect(getUserProjectRole(pid, other.id)).toBeNull();
    expect(canViewProject(pid, other.id)).toBe(false);
    expect(canCommentProject(pid, other.id)).toBe(false);
    expect(canEditProject(pid, other.id)).toBe(false);
  });

  it('viewer can view, not comment/edit', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'viewer' });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(canViewProject(pid, guest.id)).toBe(true);
    expect(canCommentProject(pid, guest.id)).toBe(false);
    expect(canEditProject(pid, guest.id)).toBe(false);
  });

  it('commenter can view + comment, not edit', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'commenter' });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(canViewProject(pid, guest.id)).toBe(true);
    expect(canCommentProject(pid, guest.id)).toBe(true);
    expect(canEditProject(pid, guest.id)).toBe(false);
  });

  it('editor can do all three', () => {
    const owner = mkUser('o');
    const guest = mkUser('g');
    const pid = mkProject(owner.id);
    const t = createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'editor' });
    acceptProjectInvite({ token: t.token, userId: guest.id });
    expect(canViewProject(pid, guest.id)).toBe(true);
    expect(canCommentProject(pid, guest.id)).toBe(true);
    expect(canEditProject(pid, guest.id)).toBe(true);
  });
});

describe('v3.x · listShareTokensForProject', () => {
  it('returns all tokens for project, newest first', () => {
    const owner = mkUser('o');
    const pid = mkProject(owner.id);
    createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'viewer' });
    createProjectShareToken({ projectId: pid, ownerUserId: owner.id, role: 'editor' });
    const list = listShareTokensForProject(pid);
    expect(list.length).toBe(2);
  });

  it('isolates between projects', () => {
    const owner = mkUser('o');
    const p1 = mkProject(owner.id);
    const p2 = mkProject(owner.id);
    createProjectShareToken({ projectId: p1, ownerUserId: owner.id });
    expect(listShareTokensForProject(p1).length).toBe(1);
    expect(listShareTokensForProject(p2).length).toBe(0);
  });
});
