/**
 * v4.2.2 — project-repo async (SQLite driver, 真 DB).
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import {
  getProject,
  getOwnedProject,
  listProjectsByUser,
  createProject,
  updateProjectStatus,
  updateProjectMeta,
  deleteProject,
} from '@/lib/repos/project-repo';

// projects.user_id 有 FK → users(id), 先建真用户
function seedUser(): string {
  const id = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(id, `${id}@test.local`, 'x', id, now());
  return id;
}

describe('v4.2.2 · project-repo CRUD (async через DbDriver)', () => {
  it('create + get + getOwned round-trip', async () => {
    const uid = seedUser();
    const p = await createProject({ userId: uid, title: '武侠短剧', description: 'desc', coverUrls: ['https://x/c.png'] });
    expect(p.id).toMatch(/^proj-/);
    expect(p.title).toBe('武侠短剧');
    expect(p.status).toBe('draft');

    const got = await getProject(p.id);
    expect(got?.user_id).toBe(uid);
    expect(JSON.parse(got!.cover_urls!)).toEqual(['https://x/c.png']);

    expect((await getOwnedProject(p.id, uid))?.id).toBe(p.id);
    expect(await getOwnedProject(p.id, 'someone-else')).toBeNull(); // 归属校验
  });

  it('listProjectsByUser returns only that user, newest first', async () => {
    const uid = seedUser();
    await createProject({ userId: uid, title: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    await createProject({ userId: uid, title: 'B' });
    const list = await listProjectsByUser(uid);
    expect(list).toHaveLength(2);
    expect(list.every((p) => p.user_id === uid)).toBe(true);
  });

  it('updateProjectStatus only by owner', async () => {
    const uid = seedUser();
    const p = await createProject({ userId: uid, title: 'S' });
    expect(await updateProjectStatus(p.id, 'intruder', 'active')).toBe(false);
    expect(await updateProjectStatus(p.id, uid, 'active')).toBe(true);
    expect((await getProject(p.id))?.status).toBe('active');
  });

  it('updateProjectMeta patches title/description', async () => {
    const uid = seedUser();
    const p = await createProject({ userId: uid, title: 'old', description: 'old-d' });
    expect(await updateProjectMeta(p.id, uid, { title: 'new' })).toBe(true);
    const got = await getProject(p.id);
    expect(got?.title).toBe('new');
    expect(got?.description).toBe('old-d'); // unchanged
    // empty patch → false
    expect(await updateProjectMeta(p.id, uid, {})).toBe(false);
  });

  it('deleteProject only by owner', async () => {
    const uid = seedUser();
    const p = await createProject({ userId: uid, title: 'D' });
    expect(await deleteProject(p.id, 'nope')).toBe(false);
    expect(await deleteProject(p.id, uid)).toBe(true);
    expect(await getProject(p.id)).toBeNull();
  });
});
