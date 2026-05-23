/**
 * v4.2.4 — collab repos (comment + notification) async via DbDriver, 真 SQLite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import {
  listComments, getComment, createComment, softDeleteComment, countProjectComments,
} from '@/lib/repos/comment-repo';
import {
  listNotifications, countUnread, createNotification, markRead, markAllRead,
} from '@/lib/repos/notification-repo';

let userId: string;
let projectId: string;
beforeAll(() => {
  userId = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(userId, `${userId}@test.local`, 'x', userId, now());
  projectId = 'proj-' + nanoid();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 'c', '', '[]', 'draft', ?, ?)`)
    .run(projectId, userId, now(), now());
});

describe('v4.2.4 · comment-repo', () => {
  it('create + list + get round-trip with mentions', async () => {
    const c = await createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: userId, authorName: '测试', content: '第一条评论 @张三',
      mentions: [{ userId: 'zhangsan', name: '张三' }],
    });
    expect(c.id).toMatch(/^cmt_/);
    const got = await getComment(c.id);
    expect(JSON.parse(got!.mentions)).toEqual([{ userId: 'zhangsan', name: '张三' }]);
    const list = await listComments('project', projectId);
    expect(list.some((x) => x.id === c.id)).toBe(true);
  });

  it('soft delete keeps row (only author), thread placeholder preserved', async () => {
    const c = await createComment({ projectId, targetType: 'project', targetId: projectId, authorUserId: userId, authorName: 'a', content: 'del me' });
    expect(await softDeleteComment(c.id, 'someone-else')).toBe(false); // 非作者拒
    expect(await softDeleteComment(c.id, userId)).toBe(true);
    const got = await getComment(c.id);
    expect(got).not.toBeNull();       // 行还在
    expect(got!.deleted_at).toBeTruthy();
    // 二次删 (已删) → false
    expect(await softDeleteComment(c.id, userId)).toBe(false);
  });

  it('countProjectComments excludes soft-deleted', async () => {
    const pid = 'proj-' + nanoid();
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 'x', '', '[]', 'draft', ?, ?)`)
      .run(pid, userId, now(), now());
    const a = await createComment({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: userId, authorName: 'a', content: '1' });
    await createComment({ projectId: pid, targetType: 'project', targetId: pid, authorUserId: userId, authorName: 'a', content: '2' });
    expect(await countProjectComments(pid)).toBe(2);
    await softDeleteComment(a.id, userId);
    expect(await countProjectComments(pid)).toBe(1);
  });
});

describe('v4.2.4 · notification-repo', () => {
  it('create + list + unread count', async () => {
    const rid = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(rid, `${rid}@test.local`, 'x', rid, now());
    await createNotification({ recipientUserId: rid, type: 'mention', sourceUserId: userId, sourceUserName: '甲', preview: '提到了你' });
    await createNotification({ recipientUserId: rid, type: 'reply', sourceUserId: userId, sourceUserName: '甲' });
    expect(await countUnread(rid)).toBe(2);
    expect(await listNotifications(rid)).toHaveLength(2);
    expect(await listNotifications(rid, { unreadOnly: true })).toHaveLength(2);
  });

  it('markRead single (only recipient) + markAllRead', async () => {
    const rid = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(rid, `${rid}@test.local`, 'x', rid, now());
    const n = await createNotification({ recipientUserId: rid, type: 'mention', sourceUserId: userId, sourceUserName: '甲' });
    await createNotification({ recipientUserId: rid, type: 'reply', sourceUserId: userId, sourceUserName: '甲' });
    expect(await markRead(n.id, 'intruder')).toBe(false); // 非接收者拒
    expect(await markRead(n.id, rid)).toBe(true);
    expect(await countUnread(rid)).toBe(1);
    expect(await markAllRead(rid)).toBe(1); // 剩 1 条
    expect(await countUnread(rid)).toBe(0);
  });

  it('list newest first + limit', async () => {
    const rid = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(rid, `${rid}@test.local`, 'x', rid, now());
    for (let i = 0; i < 5; i++) {
      await createNotification({ recipientUserId: rid, type: 'mention', sourceUserId: userId, sourceUserName: 'n' + i });
      await new Promise((r) => setTimeout(r, 3));
    }
    const list = await listNotifications(rid, { limit: 3 });
    expect(list).toHaveLength(3);
    // newest first
    expect(new Date(list[0].created_at) >= new Date(list[1].created_at)).toBe(true);
  });
});
