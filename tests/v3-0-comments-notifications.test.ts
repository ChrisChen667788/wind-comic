/**
 * v3.0 P0.1 — Comments + Notifications integration.
 *
 * 锁:
 *   - createComment 写入 comments 表 + 命中 @mention 写入 notifications 表
 *   - 自己 @ 自己不发通知
 *   - mention 不命中真用户 → 仍写入 comment, mentions 数组为空, 不发通知
 *   - reply 自动给 parent 作者发 'reply' 通知 (但 reply+mention 同一人时不双发)
 *   - softdelete: deleted_at 置位, 但 row 仍能查到 (UI 渲 [已删除])
 *   - listComments 按 project_id 严格隔离
 *   - markRead / markAllRead 不影响其他用户
 *
 * 用 seeded 真实 user (FK 不强制 — notifications.recipient_user_id 没 FK).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import {
  createComment,
  listComments,
  deleteComment,
  buildTargetId,
} from '@/lib/comments';
import {
  listForUser,
  countUnread,
  markRead,
  markAllRead,
} from '@/lib/notifications';

let SEEDED_USER_ID = '';
let SEEDED_USER_NAME = '';

function freshTestUser(prefix: string): { id: string; name: string } {
  // 直接 INSERT 进 users 表 (绕 bcrypt) — name 用于 @ 匹配.
  // 注意: name 不能包含 '-' / '.' — parseMentionNames 用 [一-龥A-Za-z0-9_]{1,30}
  // 作字符类, 分隔符不算 username body. 这模拟生产环境的真实姓名 (中文 / 字母 / 数字 / _).
  const id = `test-${prefix}-${nanoid(6)}`;
  const name = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, created_at) VALUES (?, ?, '', ?, 'user', 'zh', ?)`,
  ).run(id, `${id}@test.local`, name, new Date().toISOString());
  return { id, name };
}

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const u = db.prepare('SELECT id, name FROM users LIMIT 1').get() as { id: string; name: string } | undefined;
    SEEDED_USER_ID = u?.id || '';
    SEEDED_USER_NAME = u?.name || '';
    if (!SEEDED_USER_ID) throw new Error('test setup: no seeded user');
  }
  // 清理测试产物
  db.prepare(`DELETE FROM notifications WHERE project_id LIKE 'test-proj-%' OR source_user_id LIKE 'test-%'`).run();
  db.prepare(`DELETE FROM comments WHERE project_id LIKE 'test-proj-%' OR author_user_id LIKE 'test-%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE 'test-%'`).run();
});

describe('v3.0 P0.1 · createComment + listComments', () => {
  it('creates a top-level project comment with no mentions', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment, notifiedUserIds } = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: SEEDED_USER_ID,
      authorName: SEEDED_USER_NAME,
      content: '这个剧本不错',
    });
    expect(comment.id).toBeTruthy();
    expect(comment.content).toBe('这个剧本不错');
    expect(comment.mentions).toEqual([]);
    expect(comment.parentId).toBeNull();
    expect(notifiedUserIds).toEqual([]);
  });

  it('rejects empty content', () => {
    expect(() =>
      createComment({
        projectId: 'test-proj-empty',
        targetType: 'project',
        targetId: 'test-proj-empty',
        authorUserId: SEEDED_USER_ID,
        authorName: SEEDED_USER_NAME,
        content: '   ',
      }),
    ).toThrow(/empty/);
  });

  it('rejects content over 2000 chars', () => {
    expect(() =>
      createComment({
        projectId: 'test-proj-long',
        targetType: 'project',
        targetId: 'test-proj-long',
        authorUserId: SEEDED_USER_ID,
        authorName: SEEDED_USER_NAME,
        content: 'x'.repeat(2001),
      }),
    ).toThrow(/too long/);
  });

  it('@-mention to real user creates notification', () => {
    const alice = freshTestUser('alice');
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment, notifiedUserIds } = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: SEEDED_USER_ID,
      authorName: SEEDED_USER_NAME,
      content: `@${alice.name} 你看一下这个镜头`,
    });
    expect(comment.mentions.length).toBe(1);
    expect(comment.mentions[0].userId).toBe(alice.id);
    expect(notifiedUserIds).toContain(alice.id);

    // Alice 的收件箱里能拿到
    const notifs = listForUser({ recipientUserId: alice.id });
    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe('mention');
    expect(notifs[0].sourceUserId).toBe(SEEDED_USER_ID);
    expect(notifs[0].projectId).toBe(projectId);
    expect(notifs[0].commentId).toBe(comment.id);
  });

  it('@-mention to non-existent user is silently dropped', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment, notifiedUserIds } = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: SEEDED_USER_ID,
      authorName: SEEDED_USER_NAME,
      content: '@ghost_user 你在吗',
    });
    expect(comment.mentions).toEqual([]);
    expect(notifiedUserIds).toEqual([]);
  });

  it('self-mention does not generate notification', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment, notifiedUserIds } = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: SEEDED_USER_ID,
      authorName: SEEDED_USER_NAME,
      content: `@${SEEDED_USER_NAME} 笔记: 重新看这段`,
    });
    expect(comment.mentions).toEqual([]);
    expect(notifiedUserIds).toEqual([]);
  });

  it('reply notifies parent author (when not self-reply)', () => {
    const alice = freshTestUser('alice');
    const bob = freshTestUser('bob');
    const projectId = `test-proj-${nanoid(6)}`;

    const top = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: alice.id,
      authorName: alice.name,
      content: '我觉得这段太慢了',
    });

    const { comment: reply, notifiedUserIds } = createComment({
      projectId,
      targetType: 'project',
      targetId: projectId,
      authorUserId: bob.id,
      authorName: bob.name,
      content: '同意, 可以加快',
      parentId: top.comment.id,
    });

    expect(reply.parentId).toBe(top.comment.id);
    expect(notifiedUserIds).toContain(alice.id);

    const aliceNotifs = listForUser({ recipientUserId: alice.id });
    expect(aliceNotifs.find((n) => n.type === 'reply')).toBeTruthy();
  });

  it('reply that also @-mentions parent author dedupes to one notification', () => {
    const alice = freshTestUser('alice');
    const bob = freshTestUser('bob');
    const projectId = `test-proj-${nanoid(6)}`;

    const top = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: alice.id, authorName: alice.name, content: '看法?',
    });

    createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: bob.id, authorName: bob.name,
      content: `@${alice.name} 我同意你说的`,
      parentId: top.comment.id,
    });

    const aliceNotifs = listForUser({ recipientUserId: alice.id });
    expect(aliceNotifs.length).toBe(1); // 不重复发
  });

  it('self-reply does not generate notification', () => {
    const alice = freshTestUser('alice');
    const projectId = `test-proj-${nanoid(6)}`;
    const top = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: alice.id, authorName: alice.name, content: '我先开个头',
    });
    const { notifiedUserIds } = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: alice.id, authorName: alice.name,
      content: '再补一句', parentId: top.comment.id,
    });
    expect(notifiedUserIds).toEqual([]);
  });

  it('listComments filters by targetType + targetId', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const shotTarget = buildTargetId('shot', projectId, 1);
    createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: '项目级评论',
    });
    createComment({
      projectId, targetType: 'shot', targetId: shotTarget,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: '第 1 镜评论',
    });
    const projOnly = listComments({ projectId, targetType: 'project' });
    const shotOnly = listComments({ projectId, targetType: 'shot', targetId: shotTarget });
    expect(projOnly.length).toBe(1);
    expect(projOnly[0].content).toBe('项目级评论');
    expect(shotOnly.length).toBe(1);
    expect(shotOnly[0].content).toBe('第 1 镜评论');
  });

  it('listComments isolates by projectId', () => {
    createComment({
      projectId: 'test-proj-A', targetType: 'project', targetId: 'test-proj-A',
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME, content: 'A',
    });
    createComment({
      projectId: 'test-proj-B', targetType: 'project', targetId: 'test-proj-B',
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME, content: 'B',
    });
    expect(listComments({ projectId: 'test-proj-A' }).length).toBe(1);
    expect(listComments({ projectId: 'test-proj-B' }).length).toBe(1);
  });
});

describe('v3.0 P0.1 · deleteComment', () => {
  it('author can softdelete own comment', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment } = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'will be deleted',
    });
    expect(deleteComment(comment.id, SEEDED_USER_ID)).toBe(true);
    const after = listComments({ projectId });
    expect(after.length).toBe(1);
    expect(after[0].deletedAt).toBeTruthy();
  });

  it('non-author cannot delete', () => {
    const alice = freshTestUser('alice');
    const bob = freshTestUser('bob');
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment } = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: alice.id, authorName: alice.name, content: 'mine',
    });
    expect(deleteComment(comment.id, bob.id)).toBe(false);
  });

  it('delete is idempotent', () => {
    const projectId = `test-proj-${nanoid(6)}`;
    const { comment } = createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: 'x',
    });
    expect(deleteComment(comment.id, SEEDED_USER_ID)).toBe(true);
    expect(deleteComment(comment.id, SEEDED_USER_ID)).toBe(true);
  });
});

describe('v3.0 P0.1 · Notifications API', () => {
  it('listForUser respects unreadOnly + limit', () => {
    const alice = freshTestUser('alice');
    const projectId = `test-proj-${nanoid(6)}`;
    // 创 3 条 @alice 通知
    for (let i = 0; i < 3; i++) {
      createComment({
        projectId, targetType: 'project', targetId: projectId,
        authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
        content: `@${alice.name} msg ${i}`,
      });
    }
    expect(listForUser({ recipientUserId: alice.id }).length).toBe(3);
    expect(listForUser({ recipientUserId: alice.id, limit: 2 }).length).toBe(2);
    expect(listForUser({ recipientUserId: alice.id, unreadOnly: true }).length).toBe(3);
    expect(countUnread(alice.id)).toBe(3);
  });

  it('markRead flips read_at, countUnread decreases', () => {
    const alice = freshTestUser('alice');
    const projectId = `test-proj-${nanoid(6)}`;
    createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: `@${alice.name} look`,
    });
    const [n0] = listForUser({ recipientUserId: alice.id });
    expect(markRead(n0.id, alice.id)).toBe(true);
    expect(countUnread(alice.id)).toBe(0);
    // 已读后再 mark 是 no-op (read_at 已存在)
    expect(markRead(n0.id, alice.id)).toBe(false);
  });

  it('markRead cannot affect another user\'s notification', () => {
    const alice = freshTestUser('alice');
    const bob = freshTestUser('bob');
    const projectId = `test-proj-${nanoid(6)}`;
    createComment({
      projectId, targetType: 'project', targetId: projectId,
      authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
      content: `@${alice.name} private`,
    });
    const [n0] = listForUser({ recipientUserId: alice.id });
    expect(markRead(n0.id, bob.id)).toBe(false);
    expect(countUnread(alice.id)).toBe(1);
  });

  it('markAllRead clears the inbox for that user', () => {
    const alice = freshTestUser('alice');
    const projectId = `test-proj-${nanoid(6)}`;
    for (let i = 0; i < 5; i++) {
      createComment({
        projectId, targetType: 'project', targetId: projectId,
        authorUserId: SEEDED_USER_ID, authorName: SEEDED_USER_NAME,
        content: `@${alice.name} ${i}`,
      });
    }
    expect(markAllRead(alice.id)).toBe(5);
    expect(countUnread(alice.id)).toBe(0);
  });
});

describe('v3.0 P0.1 · buildTargetId', () => {
  it('project target = projectId', () => {
    expect(buildTargetId('project', 'p123')).toBe('p123');
  });

  it('shot target = projectId:shotNumber', () => {
    expect(buildTargetId('shot', 'p123', 5)).toBe('p123:5');
  });

  it('scene target = name', () => {
    expect(buildTargetId('scene', 'p123', 'tavern')).toBe('tavern');
  });

  it('throws when subKey missing for non-project type', () => {
    expect(() => buildTargetId('shot', 'p123')).toThrow();
    expect(() => buildTargetId('scene', 'p123')).toThrow();
  });
});
