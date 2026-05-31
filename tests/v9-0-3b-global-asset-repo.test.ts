/**
 * v9.0.3b — global-asset-repo async (SQLite driver, 真 DB).
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver } from '@/lib/db-driver';
import {
  createGlobalAsset, getGlobalAssetById, listGlobalAssets,
  updateGlobalAsset, deleteGlobalAsset, recordAssetUsage,
  upsertCharacterBible, findCharacterBibleByName,
} from '@/lib/repos/global-asset-repo';

// global_assets.user_id 可能 FK → users(id); 先建真用户隔离
async function seedUser(): Promise<string> {
  const id = 'gu-' + nanoid();
  await getDbDriver().run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    [id, `${id}@t.local`, 'x', id, new Date().toISOString()],
  );
  return id;
}

describe('v9.0.3b · global-asset-repo (async через DbDriver)', () => {
  it('create + get round-trip (JSON 字段序列化)', async () => {
    const uid = await seedUser();
    const a = await createGlobalAsset({
      userId: uid, type: 'character', name: '林七', description: 'd',
      tags: ['武侠'], thumbnail: 'https://x/t.png', visualAnchors: ['黑发'],
      metadata: { k: 1 },
    });
    expect(a.id).toBeTruthy();
    const got = await getGlobalAssetById(a.id);
    expect(got?.name).toBe('林七');
    expect(got?.tags).toEqual(['武侠']);
    expect(got?.visualAnchors).toEqual(['黑发']);
    expect(got?.metadata).toEqual({ k: 1 });
    expect(got?.referencedByProjects).toEqual([]);
  });

  it('listGlobalAssets by type + q (仅本人)', async () => {
    const uid = await seedUser();
    await createGlobalAsset({ userId: uid, type: 'scene', name: '雪山客栈' });
    await createGlobalAsset({ userId: uid, type: 'scene', name: '竹林' });
    await createGlobalAsset({ userId: uid, type: 'character', name: '别人看不到', });
    const scenes = await listGlobalAssets({ userId: uid, type: 'scene' });
    expect(scenes).toHaveLength(2);
    expect(scenes.every((s) => s.userId === uid && s.type === 'scene')).toBe(true);
    const q = await listGlobalAssets({ userId: uid, q: '客栈' });
    expect(q.map((a) => a.name)).toEqual(['雪山客栈']);
  });

  it('updateGlobalAsset partial + owner 守卫', async () => {
    const uid = await seedUser();
    const a = await createGlobalAsset({ userId: uid, type: 'prop', name: '旧剑', description: 'old' });
    const up = await updateGlobalAsset(a.id, uid, { description: 'new', tags: ['利器'] });
    expect(up?.description).toBe('new');
    expect(up?.tags).toEqual(['利器']);
    expect(up?.name).toBe('旧剑'); // 未传不动
    // 非 owner → 抛
    await expect(updateGlobalAsset(a.id, 'intruder', { name: 'x' })).rejects.toThrow(/Forbidden/);
    // 不存在 → null
    expect(await updateGlobalAsset('nope', uid, { name: 'x' })).toBeNull();
  });

  it('recordAssetUsage 去重幂等', async () => {
    const uid = await seedUser();
    const a = await createGlobalAsset({ userId: uid, type: 'style', name: '水墨' });
    await recordAssetUsage(a.id, uid, 'proj-1');
    await recordAssetUsage(a.id, uid, 'proj-1'); // 重复
    const r = await recordAssetUsage(a.id, uid, 'proj-2');
    expect(r?.referencedByProjects.sort()).toEqual(['proj-1', 'proj-2']);
  });

  it('deleteGlobalAsset owner 守卫', async () => {
    const uid = await seedUser();
    const a = await createGlobalAsset({ userId: uid, type: 'prop', name: '删我' });
    await expect(deleteGlobalAsset(a.id, 'intruder')).rejects.toThrow(/Forbidden/);
    expect(await deleteGlobalAsset(a.id, uid)).toBe(true);
    expect(await getGlobalAssetById(a.id)).toBeNull();
    expect(await deleteGlobalAsset(a.id, uid)).toBe(false); // 已删
  });

  it('upsertCharacterBible: 新建 → 合并 sampleFaces + referenced_by + findByName', async () => {
    const uid = await seedUser();
    const r1 = await upsertCharacterBible({
      userId: uid, projectId: 'p1', name: '苏倾城',
      bible: { role: 'lead', cw: 100, imageUrl: 'https://x/face1.png', sampleFaces: ['https://x/face1.png'] },
    });
    expect(r1.type).toBe('character');
    expect((r1.metadata.bible as any).role).toBe('lead');

    // 二次 upsert 同名 → 合并新脸 + 累加项目
    const r2 = await upsertCharacterBible({
      userId: uid, projectId: 'p2', name: '苏倾城',
      bible: { role: 'lead', cw: 110, imageUrl: 'https://x/face2.png', sampleFaces: ['https://x/face2.png'] },
    });
    expect(r2.id).toBe(r1.id); // 同一行
    const bible = r2.metadata.bible as any;
    expect(bible.sampleFaces).toEqual(expect.arrayContaining(['https://x/face1.png', 'https://x/face2.png']));
    // 原行为 (faithful port): 首次 upsert 走 createGlobalAsset, referenced_by 留空;
    // 仅二次起 (走 UPDATE 分支) 才把 projectId 累加进 referenced_by → 这里只有 p2。
    expect(r2.referencedByProjects).toEqual(['p2']);

    // findCharacterBibleByName
    const hit = await findCharacterBibleByName(uid, ' 苏倾城 ');
    expect(hit?.usedInProjectsCount).toBe(1); // 同上, 仅 p2 记入 referenced_by
    expect(hit?.bible.imageUrl).toBe('https://x/face2.png');
    expect(await findCharacterBibleByName(uid, '查无此人')).toBeNull();
  });
});
