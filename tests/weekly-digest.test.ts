/**
 * v10.5.4 — 周报 digest 单测(真 DB):首发/7 天幂等/零活动跳过/文案。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { maybeSendWeeklyDigest, digestPreview, DIGEST_TYPE } from '@/lib/weekly-digest';

let activeUser: string;
let idleUser: string;

beforeAll(() => {
  activeUser = 'u-' + nanoid();
  idleUser = 'u-' + nanoid();
  for (const uid of [activeUser, idleUser]) {
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(uid, `${uid}@test.local`, 'x', uid, now());
  }
  // activeUser:本周 1 新建 + 1 完成
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, '新片', '', '[]', 'active', ?, ?)`)
    .run('proj-' + nanoid(), activeUser, now(), now());
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, '完结片', '', '[]', 'completed', ?, ?)`)
    .run('proj-' + nanoid(), activeUser, '2026-01-01T00:00:00.000Z', now());
});

describe('v10.5.4 · maybeSendWeeklyDigest', () => {
  it('有活动首发 → sent + 通知落库(type/来源/文案)', async () => {
    expect(await maybeSendWeeklyDigest(activeUser)).toBe('sent');
    const row = db.prepare('SELECT * FROM notifications WHERE recipient_user_id = ? AND type = ?').get(activeUser, DIGEST_TYPE) as any;
    expect(row.source_user_name).toBe('青枫周报');
    expect(row.preview).toContain('新建 1 部');
    expect(row.preview).toContain('完成 1 部');
  });

  it('7 天内重复调用 → recent(不重复发)', async () => {
    expect(await maybeSendWeeklyDigest(activeUser)).toBe('recent');
    const c = db.prepare('SELECT count(*) c FROM notifications WHERE recipient_user_id = ? AND type = ?').get(activeUser, DIGEST_TYPE) as any;
    expect(c.c).toBe(1);
  });

  it('零活动用户 → no-activity(不发空周报)', async () => {
    expect(await maybeSendWeeklyDigest(idleUser)).toBe('no-activity');
    const c = db.prepare('SELECT count(*) c FROM notifications WHERE recipient_user_id = ?').get(idleUser) as any;
    expect(c.c).toBe(0);
  });

  it('digestPreview 文案按非零项拼接', () => {
    expect(digestPreview({ created: 2, completed: 0 })).toContain('新建 2 部');
    expect(digestPreview({ created: 2, completed: 0 })).not.toContain('完成');
  });
});
