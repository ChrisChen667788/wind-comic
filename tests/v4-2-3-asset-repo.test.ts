/**
 * v4.2.3 — asset-repo async (SQLite driver, 真 DB).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import {
  listProjectAssets,
  listAssetsByType,
  getAsset,
  createAsset,
  updateAsset,
  deleteAsset,
  countProjectAssets,
} from '@/lib/repos/asset-repo';

// project_assets.project_id 有 FK → projects(id); projects.user_id → users(id)
let projectId: string;
beforeAll(() => {
  const uid = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(uid, `${uid}@test.local`, 'x', uid, now());
  projectId = 'proj-' + nanoid();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, '', '[]', 'draft', ?, ?)`)
    .run(projectId, uid, 'asset-test', now(), now());
});

describe('v4.2.3 · asset-repo CRUD (async через DbDriver)', () => {
  it('create + get round-trip with JSON data', async () => {
    const a = await createAsset({ projectId, type: 'storyboard', name: '镜1', data: { description: '黎明' }, mediaUrls: ['https://x/1.png'], shotNumber: 1 });
    expect(a.id).toBeTruthy();
    const got = await getAsset(a.id);
    expect(got?.project_id).toBe(projectId);
    expect(JSON.parse(got!.data).description).toBe('黎明');
    expect(JSON.parse(got!.media_urls!)).toEqual(['https://x/1.png']);
  });

  it('listProjectAssets + listAssetsByType', async () => {
    await createAsset({ projectId, type: 'script', name: '剧本', data: {} });
    await createAsset({ projectId, type: 'storyboard', name: '镜2', shotNumber: 2 });
    const all = await listProjectAssets(projectId);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const boards = await listAssetsByType(projectId, 'storyboard');
    expect(boards.every((a) => a.type === 'storyboard')).toBe(true);
    expect(boards.length).toBeGreaterThanOrEqual(2);
  });

  it('updateAsset patches data + mediaUrls', async () => {
    const a = await createAsset({ projectId, type: 'video', name: 'v1', data: { duration: 5 } });
    expect(await updateAsset(a.id, { data: { duration: 8 }, mediaUrls: ['https://x/v.mp4'] })).toBe(true);
    const got = await getAsset(a.id);
    expect(JSON.parse(got!.data).duration).toBe(8);
    expect(JSON.parse(got!.media_urls!)).toEqual(['https://x/v.mp4']);
    expect(await updateAsset(a.id, {})).toBe(false); // empty patch
  });

  it('countProjectAssets reflects inserts', async () => {
    const before = await countProjectAssets(projectId);
    await createAsset({ projectId, type: 'music', name: 'bgm' });
    expect(await countProjectAssets(projectId)).toBe(before + 1);
  });

  it('deleteAsset removes', async () => {
    const a = await createAsset({ projectId, type: 'scene', name: 's1' });
    expect(await deleteAsset(a.id)).toBe(true);
    expect(await getAsset(a.id)).toBeNull();
  });
});
