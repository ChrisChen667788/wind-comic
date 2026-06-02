/**
 * Tests for v2.18 P2.1 + P2.2 — lib/preview-history
 * v9.0.4f: preview-history 写/读路径异步化 (走 DbDriver 双驱动), 测试改 async。
 *
 * 锁:
 *   - insertPreview / listForUser / countTodayForUser / deletePreview
 *   - getQuotaState 各 tier
 *   - PREVIEW_DAILY_LIMIT 表
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  insertPreview,
  listForUser,
  countTodayForUser,
  deletePreview,
  getQuotaState,
  PREVIEW_DAILY_LIMIT,
} from '@/lib/preview-history';

const TEST_USER_PREFIX = 'test-preview-user-';
let counter = 0;
function freshUserId(): string {
  return `${TEST_USER_PREFIX}${Date.now()}-${counter++}`;
}

beforeEach(() => {
  // 清理测试用户的 preview rows (避免跨用例污染)
  db.prepare(`DELETE FROM preview_history WHERE user_id LIKE 'test-preview-user-%'`).run();
});

describe('insertPreview + listForUser', () => {
  it('inserts and reads back a row with all fields', async () => {
    const u = freshUserId();
    const inserted = await insertPreview({
      userId: u,
      idea: '一个剑客的故事',
      style: 'Cinematic',
      aspect: '16:9',
      imageUrl: 'http://x/a.png',
      videoUrl: 'http://x/a.mp4',
      prompt: 'A single key shot ...',
      elapsedMs: 35000,
      warnings: ['no key'],
    });
    expect(inserted.id).toBeTruthy();
    expect(inserted.userId).toBe(u);

    const list = await listForUser(u);
    expect(list).toHaveLength(1);
    expect(list[0].idea).toBe('一个剑客的故事');
    expect(list[0].imageUrl).toBe('http://x/a.png');
    expect(list[0].videoUrl).toBe('http://x/a.mp4');
    expect(list[0].warnings).toEqual(['no key']);
    expect(list[0].elapsedMs).toBe(35000);
  });

  it('truncates idea to 500 + prompt to 400', async () => {
    const u = freshUserId();
    await insertPreview({
      userId: u,
      idea: 'X'.repeat(800),
      style: '',
      aspect: '16:9',
      prompt: 'P'.repeat(800),
      elapsedMs: 1000,
    });
    const list = await listForUser(u);
    expect(list[0].idea.length).toBe(500);
    expect(list[0].prompt!.length).toBe(400);
  });

  it('listForUser returns DESC by created_at, capped at 100', async () => {
    const u = freshUserId();
    for (let i = 0; i < 10; i++) {
      await insertPreview({
        userId: u,
        idea: `idea ${i}`,
        style: 'Cinematic',
        aspect: '16:9',
        elapsedMs: 1000,
      });
    }
    const list = await listForUser(u, 5);
    expect(list).toHaveLength(5);
    // last inserted should be first
    expect(list[0].idea).toBe('idea 9');
    expect(list[4].idea).toBe('idea 5');
  });

  it('listForUser filters by user (no cross-leak)', async () => {
    const u1 = freshUserId();
    const u2 = freshUserId();
    await insertPreview({ userId: u1, idea: 'mine', style: '', aspect: '16:9', elapsedMs: 1000 });
    await insertPreview({ userId: u2, idea: 'theirs', style: '', aspect: '16:9', elapsedMs: 1000 });
    expect((await listForUser(u1)).map((e) => e.idea)).toEqual(['mine']);
    expect((await listForUser(u2)).map((e) => e.idea)).toEqual(['theirs']);
  });

  it('limit clamped to [1, 100]', async () => {
    const u = freshUserId();
    for (let i = 0; i < 3; i++) {
      await insertPreview({ userId: u, idea: String(i), style: '', aspect: '16:9', elapsedMs: 1 });
    }
    expect(await listForUser(u, 0)).toHaveLength(1);   // clamps to 1
    expect(await listForUser(u, 999)).toHaveLength(3); // clamps to 100, but we have 3
  });
});

describe('countTodayForUser', () => {
  it('counts only today (UTC date prefix)', async () => {
    const u = freshUserId();
    await insertPreview({ userId: u, idea: 'today1', style: '', aspect: '16:9', elapsedMs: 1 });
    await insertPreview({ userId: u, idea: 'today2', style: '', aspect: '16:9', elapsedMs: 1 });
    expect(await countTodayForUser(u)).toBe(2);
  });

  it('returns 0 for user with no rows', async () => {
    expect(await countTodayForUser(freshUserId())).toBe(0);
  });

  it('respects refDate parameter (yesterday count = 0)', async () => {
    const u = freshUserId();
    await insertPreview({ userId: u, idea: 'today', style: '', aspect: '16:9', elapsedMs: 1 });
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    expect(await countTodayForUser(u, yesterday)).toBe(0);
  });
});

describe('deletePreview', () => {
  it('deletes only when id+user match', async () => {
    const u1 = freshUserId();
    const u2 = freshUserId();
    const e1 = await insertPreview({ userId: u1, idea: 'mine', style: '', aspect: '16:9', elapsedMs: 1 });
    expect(await deletePreview(e1.id, u2)).toBe(false); // wrong user
    expect(await deletePreview(e1.id, u1)).toBe(true);
    expect(await deletePreview(e1.id, u1)).toBe(false); // already gone
  });
});

describe('getQuotaState + PREVIEW_DAILY_LIMIT', () => {
  it('PREVIEW_DAILY_LIMIT shape: free < creator < pro < enterprise', () => {
    expect(PREVIEW_DAILY_LIMIT.free).toBeLessThan(PREVIEW_DAILY_LIMIT.creator);
    expect(PREVIEW_DAILY_LIMIT.creator).toBeLessThan(PREVIEW_DAILY_LIMIT.pro);
    expect(PREVIEW_DAILY_LIMIT.pro).toBeLessThan(PREVIEW_DAILY_LIMIT.enterprise);
  });

  it('free user @ 0 used → not blocked, remaining = limit', async () => {
    const q = await getQuotaState(freshUserId(), 'free');
    expect(q.used).toBe(0);
    expect(q.limit).toBe(PREVIEW_DAILY_LIMIT.free);
    expect(q.remaining).toBe(PREVIEW_DAILY_LIMIT.free);
    expect(q.blocked).toBe(false);
  });

  it('free user @ limit → blocked, remaining = 0', async () => {
    const u = freshUserId();
    for (let i = 0; i < PREVIEW_DAILY_LIMIT.free; i++) {
      await insertPreview({ userId: u, idea: String(i), style: '', aspect: '16:9', elapsedMs: 1 });
    }
    const q = await getQuotaState(u, 'free');
    expect(q.used).toBe(PREVIEW_DAILY_LIMIT.free);
    expect(q.remaining).toBe(0);
    expect(q.blocked).toBe(true);
  });

  it('pro user with 5 used → still has room', async () => {
    const u = freshUserId();
    for (let i = 0; i < 5; i++) {
      await insertPreview({ userId: u, idea: String(i), style: '', aspect: '16:9', elapsedMs: 1 });
    }
    const q = await getQuotaState(u, 'pro');
    expect(q.used).toBe(5);
    expect(q.remaining).toBe(PREVIEW_DAILY_LIMIT.pro - 5);
    expect(q.blocked).toBe(false);
  });
});
