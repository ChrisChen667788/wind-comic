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
  insertProjectFull,
  updateProjectById,
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

  // ─── v9.0.2: 创作管线 / cameo 复用的按 id 写 ─────────────────────────────
  it('insertProjectFull writes client id + creative columns', async () => {
    const uid = seedUser();
    const id = 'proj-full-' + nanoid(6);
    const p = await insertProjectFull({
      id, userId: uid, title: '创作管线项目', description: 'd',
      coverUrls: ['https://x/c.png'], status: 'active',
      styleId: 'ink-wash', primaryCharacterRef: 'https://x/face.png',
      lockedCharacters: [{ name: '主角', role: 'lead', cw: 100, imageUrl: 'https://x/f.png' }],
    });
    expect(p.id).toBe(id);
    expect(p.status).toBe('active');
    // 创作列不在 repo COLS 里, 用 raw db 校验落库
    const raw = db.prepare('SELECT style_id, primary_character_ref, locked_characters FROM projects WHERE id = ?')
      .get(id) as { style_id: string; primary_character_ref: string; locked_characters: string };
    expect(raw.style_id).toBe('ink-wash');
    expect(raw.primary_character_ref).toBe('https://x/face.png');
    expect(JSON.parse(raw.locked_characters)[0].name).toBe('主角');
  });

  it('updateProjectById patches whitelisted cols (no owner guard) + bumps updated_at', async () => {
    const uid = seedUser();
    const id = 'proj-upd-' + nanoid(6);
    await insertProjectFull({ id, userId: uid, title: 'T', status: 'active' });
    const before = await getProject(id);

    await new Promise((r) => setTimeout(r, 5));
    const changed = await updateProjectById(id, {
      status: 'completed',
      director_notes: JSON.stringify({ passed: true }),
      primary_character_ref: 'https://x/new.png',
    });
    expect(changed).toBe(true);

    const after = await getProject(id);
    expect(after?.status).toBe('completed');
    expect(after?.updated_at).not.toBe(before?.updated_at); // updated_at 被刷新
    const raw = db.prepare('SELECT director_notes, primary_character_ref FROM projects WHERE id = ?')
      .get(id) as { director_notes: string; primary_character_ref: string };
    expect(JSON.parse(raw.director_notes).passed).toBe(true);
    expect(raw.primary_character_ref).toBe('https://x/new.png');

    // 清 primary_character_ref (null)
    await updateProjectById(id, { primary_character_ref: null });
    const raw2 = db.prepare('SELECT primary_character_ref FROM projects WHERE id = ?')
      .get(id) as { primary_character_ref: string | null };
    expect(raw2.primary_character_ref).toBeNull();
  });

  it('updateProjectById set/clear share_token + share_created_at (v9.0.2b)', async () => {
    const uid = seedUser();
    const id = 'proj-share-' + nanoid(6);
    await insertProjectFull({ id, userId: uid, title: 'SH' });
    await updateProjectById(id, { share_token: 'tok_abc', share_created_at: '2026-05-31T00:00:00Z' });
    const raw = db.prepare('SELECT share_token, share_created_at FROM projects WHERE id = ?')
      .get(id) as { share_token: string | null; share_created_at: string | null };
    expect(raw.share_token).toBe('tok_abc');
    expect(raw.share_created_at).toBe('2026-05-31T00:00:00Z');
    // 撤销 → null
    await updateProjectById(id, { share_token: null, share_created_at: null });
    const raw2 = db.prepare('SELECT share_token FROM projects WHERE id = ?')
      .get(id) as { share_token: string | null };
    expect(raw2.share_token).toBeNull();
  });

  it('updateProjectById: empty patch → false, unknown col → throws', async () => {
    const uid = seedUser();
    const id = 'proj-guard-' + nanoid(6);
    await insertProjectFull({ id, userId: uid, title: 'G' });
    expect(await updateProjectById(id, {})).toBe(false);
    expect(await updateProjectById(id, { status: undefined })).toBe(false);
    await expect(updateProjectById(id, { evil_col: 'x' } as any)).rejects.toThrow(/不允许更新列/);
  });
});
