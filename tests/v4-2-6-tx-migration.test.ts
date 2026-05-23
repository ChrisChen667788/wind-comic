/**
 * v4.2.6 — register (consumeInviteCodeTx) + comments async 事务迁移单测.
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { getDbDriver } from '@/lib/db-driver';
import { consumeInviteCodeTx } from '@/lib/invite-codes';
import { createCommentAsync, listCommentsAsync, deleteCommentAsync } from '@/lib/comments';

function seedUser(name?: string): { id: string; name: string } {
  const id = 'u-' + nanoid();
  const nm = name || id;
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(id, `${id}@test.local`, 'x', nm, now());
  return { id, name: nm };
}
function seedInvite(): string {
  const code = 'INV' + nanoid(6).toUpperCase();
  db.prepare(`INSERT INTO invite_codes (code, status, created_by, created_at) VALUES (?, 'unused', 'admin', ?)`).run(code, now());
  return code;
}
function seedProject(userId: string): string {
  const id = 'proj-' + nanoid();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 't', '', '[]', 'draft', ?, ?)`)
    .run(id, userId, now(), now());
  return id;
}

describe('v4.2.6 · consumeInviteCodeTx (within transaction)', () => {
  it('atomic: insert user + consume invite both commit', async () => {
    const code = seedInvite();
    const userId = 'u-' + nanoid();
    await getDbDriver().transaction(async (tx) => {
      await tx.run(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'member', ?)`,
        [userId, `${userId}@test.local`, 'h', 'reg', now()]);
      const r = await consumeInviteCodeTx(tx, code, userId);
      expect(r.ok).toBe(true);
    });
    // 用户存在 + 邀请码 used
    expect(db.prepare('SELECT id FROM users WHERE id=?').get(userId)).toBeTruthy();
    const inv = db.prepare('SELECT status, used_by_user_id FROM invite_codes WHERE code=?').get(code) as any;
    expect(inv.status).toBe('used');
    expect(inv.used_by_user_id).toBe(userId);
  });

  it('bad code → throw rolls back the whole tx (user not created)', async () => {
    const userId = 'u-' + nanoid();
    await expect(getDbDriver().transaction(async (tx) => {
      await tx.run(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'member', ?)`,
        [userId, `${userId}@test.local`, 'h', 'reg', now()]);
      const r = await consumeInviteCodeTx(tx, 'NONEXISTENT-CODE', userId);
      if (!r.ok) throw new Error('invite ' + r.error);
    })).rejects.toThrow(/invite/);
    // 回滚: 用户不应存在
    expect(db.prepare('SELECT id FROM users WHERE id=?').get(userId)).toBeUndefined();
  });

  it('already-used code → NOT_FOUND/ALREADY_USED', async () => {
    const code = seedInvite();
    const u1 = seedUser();
    await getDbDriver().transaction(async (tx) => { await consumeInviteCodeTx(tx, code, u1.id); });
    const r = await getDbDriver().transaction(async (tx) => consumeInviteCodeTx(tx, code, 'someone'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ALREADY_USED');
  });
});

describe('v4.2.6 · createCommentAsync', () => {
  it('creates comment + notifies @-mentioned user', async () => {
    const author = seedUser('作者甲');
    const mentioned = seedUser('小明');
    const pid = seedProject(author.id);
    const r = await createCommentAsync({
      projectId: pid, targetType: 'project', targetId: pid,
      authorUserId: author.id, authorName: author.name, content: '你好 @小明 看看这个',
    });
    expect(r.comment.id).toBeTruthy();
    expect(r.notifiedUserIds).toContain(mentioned.id);
    // 通知确实写了
    const n = db.prepare(`SELECT type FROM notifications WHERE recipient_user_id=? AND comment_id=?`).get(mentioned.id, r.comment.id) as any;
    expect(n?.type).toBe('mention');
  });

  it('reply notifies parent author (type=reply)', async () => {
    const a = seedUser('甲'); const b = seedUser('乙');
    const pid = seedProject(a.id);
    const root = await createCommentAsync({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: a.id, authorName: a.name, content: '根评论' });
    const reply = await createCommentAsync({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: b.id, authorName: b.name, content: '回复你', parentId: root.comment.id });
    expect(reply.notifiedUserIds).toContain(a.id);
    const n = db.prepare(`SELECT type FROM notifications WHERE recipient_user_id=? AND comment_id=?`).get(a.id, reply.comment.id) as any;
    expect(n?.type).toBe('reply');
  });

  it('does not notify self-mention', async () => {
    const a = seedUser('独行侠');
    const pid = seedProject(a.id);
    const r = await createCommentAsync({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: a.id, authorName: a.name, content: '@独行侠 自言自语' });
    expect(r.notifiedUserIds).not.toContain(a.id);
  });

  it('list + soft delete async', async () => {
    const a = seedUser();
    const pid = seedProject(a.id);
    const c = await createCommentAsync({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: a.id, authorName: a.name, content: '待删' });
    expect((await listCommentsAsync({ projectId: pid })).some((x) => x.id === c.comment.id)).toBe(true);
    expect(await deleteCommentAsync(c.comment.id, 'not-author')).toBe(false);
    expect(await deleteCommentAsync(c.comment.id, a.id)).toBe(true);
  });

  it('rejects empty content + no attachments', async () => {
    const a = seedUser();
    const pid = seedProject(a.id);
    await expect(createCommentAsync({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: a.id, authorName: a.name, content: '   ' })).rejects.toThrow(/empty/);
  });
});
