/**
 * Tests for v2.18 P2.3 — lib/template-share + share API routes
 * (v9.0.4b: template-share 全量异步化, 测试同步改 async/await)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createShareToken,
  getByToken,
  incrementViewCount,
  incrementCloneCount,
  listTokensForOwner,
  listTokensForAsset,
  deleteToken,
  getTemplateAssetForToken,
} from '@/lib/template-share';
import { createGlobalAsset } from '@/lib/global-assets';

let SEEDED_USER_ID = '';
let counter = 0;
function freshUserId(): string { return SEEDED_USER_ID; }
function nonExistentUserId(): string { return `not-real-user-${counter++}`; }

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    SEEDED_USER_ID = user?.id || '';
    if (!SEEDED_USER_ID) throw new Error('test setup: no seeded user found');
  }
  db.prepare(`DELETE FROM template_share_tokens WHERE owner_user_id = ? OR owner_user_id LIKE 'not-real-user-%'`).run(SEEDED_USER_ID);
  db.prepare(`DELETE FROM global_assets WHERE user_id = ? AND name LIKE 'TEST-SHARE-%'`).run(SEEDED_USER_ID);
});

let assetCounter = 0;
function makeTemplateAsset(userId: string, name?: string) {
  // lib/global-assets sync 版仍在 (其自身单测用); 这里建测试 asset 用它 (写同一 SQLite)
  return createGlobalAsset({
    userId,
    type: 'template',
    name: name || `TEST-SHARE-${++assetCounter}`,
    description: 'desc',
    metadata: { exampleIdea: '示例创意', structureHint: '结构提示', keyElements: ['元素 1'] },
  });
}

describe('createShareToken + getByToken', () => {
  it('creates a unique token bound to assetId + ownerUserId', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u });
    expect(t.token.length).toBeGreaterThan(8);
    expect(t.assetId).toBe(asset.id);
    expect(t.ownerUserId).toBe(u);
    expect(t.viewCount).toBe(0);
    expect(t.cloneCount).toBe(0);

    const fetched = await getByToken(t.token);
    expect(fetched).not.toBeNull();
    expect(fetched!.assetId).toBe(asset.id);
  });

  it('two tokens for same asset are independent', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t1 = await createShareToken({ assetId: asset.id, ownerUserId: u });
    const t2 = await createShareToken({ assetId: asset.id, ownerUserId: u });
    expect(t1.token).not.toBe(t2.token);
    const list = await listTokensForAsset(asset.id);
    expect(list.length).toBe(2);
  });

  it('returns null for non-existent token', async () => {
    expect(await getByToken('definitely-not-real-token-xyz')).toBeNull();
  });

  it('expired token returns null from getByToken', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const expired = new Date(Date.now() - 60_000).toISOString();
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u, expiresAt: expired });
    expect(await getByToken(t.token)).toBeNull();
  });
});

describe('incrementViewCount / incrementCloneCount', () => {
  it('view count goes up on each call', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u });
    await incrementViewCount(t.token);
    await incrementViewCount(t.token);
    await incrementViewCount(t.token);
    expect((await getByToken(t.token))!.viewCount).toBe(3);
  });

  it('clone count is independent of view', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u });
    await incrementViewCount(t.token);
    await incrementCloneCount(t.token);
    await incrementCloneCount(t.token);
    const fetched = (await getByToken(t.token))!;
    expect(fetched.viewCount).toBe(1);
    expect(fetched.cloneCount).toBe(2);
  });

  it('non-existent token: increment is silently no-op', async () => {
    await expect(incrementViewCount('not-a-token')).resolves.toBeUndefined();
  });
});

describe('listTokensForOwner', () => {
  it('returns only that owner (其他 owner_user_id 隔离)', async () => {
    const u1 = freshUserId();
    const otherOwner = nonExistentUserId();
    const a1 = makeTemplateAsset(u1);
    await createShareToken({ assetId: a1.id, ownerUserId: u1 });
    await createShareToken({ assetId: a1.id, ownerUserId: otherOwner });
    expect((await listTokensForOwner(u1)).length).toBeGreaterThanOrEqual(1);
    expect(await listTokensForOwner(otherOwner)).toHaveLength(1);
    expect(await listTokensForOwner('nobody-else-not-real')).toHaveLength(0);
  });
});

describe('deleteToken (auth)', () => {
  it('only owner can delete', async () => {
    const u1 = freshUserId();
    const u2 = nonExistentUserId();
    const a1 = makeTemplateAsset(u1);
    const t = await createShareToken({ assetId: a1.id, ownerUserId: u1 });
    expect(await deleteToken(t.token, u2)).toBe(false);
    expect(await deleteToken(t.token, u1)).toBe(true);
    expect(await deleteToken(t.token, u1)).toBe(false);
  });
});

describe('getTemplateAssetForToken', () => {
  it('happy path: returns { token, asset } for template asset', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u, '我的模板');
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u });
    const found = await getTemplateAssetForToken(t.token);
    expect(found).not.toBeNull();
    expect(found!.asset.name).toBe('我的模板');
    expect(found!.token.token).toBe(t.token);
  });

  it('returns null when token not found', async () => {
    expect(await getTemplateAssetForToken('not-a-real-token')).toBeNull();
  });

  it('returns null when underlying asset has been deleted', async () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = await createShareToken({ assetId: asset.id, ownerUserId: u });
    db.prepare(`DELETE FROM global_assets WHERE id = ?`).run(asset.id);
    expect(await getTemplateAssetForToken(t.token)).toBeNull();
  });

  it('returns null when asset type is not template', async () => {
    const u = freshUserId();
    const sceneAsset = createGlobalAsset({ userId: u, type: 'scene', name: 'a scene', description: 'x' });
    const t = await createShareToken({ assetId: sceneAsset.id, ownerUserId: u });
    expect(await getTemplateAssetForToken(t.token)).toBeNull();
  });
});
