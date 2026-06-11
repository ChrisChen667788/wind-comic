/**
 * v10.6.0 — 项目级画幅持久化单测(真 DB):
 * insertProjectFull 写入 9:16 round-trip;不传默认 16:9(旧调用零回归);白名单可 update。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { insertProjectFull, getProject, updateProjectById } from '@/lib/repos/project-repo';

let userId: string;
beforeAll(() => {
  userId = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(userId, `${userId}@test.local`, 'x', userId, now());
});

describe('v10.6.0 · projects.aspect', () => {
  it('写入 9:16 round-trip', async () => {
    const id = 'proj-' + nanoid();
    await insertProjectFull({ id, userId, title: '竖屏片', description: '', coverUrls: [], status: 'active', aspect: '9:16' });
    expect((await getProject(id))!.aspect).toBe('9:16');
  });

  it('不传 → 默认 16:9(既有调用方零回归)', async () => {
    const id = 'proj-' + nanoid();
    await insertProjectFull({ id, userId, title: '横屏片', description: '', coverUrls: [], status: 'active' });
    expect((await getProject(id))!.aspect).toBe('16:9');
  });

  it('白名单允许 update(换画幅重跑场景)', async () => {
    const id = 'proj-' + nanoid();
    await insertProjectFull({ id, userId, title: 'x', description: '', coverUrls: [], status: 'active' });
    await updateProjectById(id, { aspect: '9:16' });
    expect((await getProject(id))!.aspect).toBe('9:16');
  });
});
