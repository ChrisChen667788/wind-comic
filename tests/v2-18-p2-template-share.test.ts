/**
 * Tests for v2.18 P2.3 — lib/template-share + share API routes
 *
 * 锁:
 *   - createShareToken / getByToken / increment counters
 *   - 过期 token → null
 *   - listTokensForOwner / deleteToken (鉴权)
 *   - getTemplateAssetForToken 拒绝非 template 类型
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

// global_assets 有 FK to users — 用真实 seeded user.
// seed() 在 db init 时已写入一个 demo user. 我们查它然后所有"用户"都用同一个 id,
// 不同测试间用 owner 字段做隔离逻辑 (这里 user_id 都一样, 但 token.owner / asset 都属于真实 user).
let SEEDED_USER_ID = '';
let counter = 0;
function freshUserId(): string {
  // 因为 FK 约束, 多个 "用户" 实际上都映射到同一个 seeded user.
  // 测试隔离靠 asset id 不同 (createGlobalAsset 会生成新 id), 不再靠 user 区分.
  // 对于真要测"跨用户"的场景, 我们用 nonexistent user id (FK 不强制因为只往 share 表写).
  return SEEDED_USER_ID;
}
function nonExistentUserId(): string {
  // 用一个不在 users 表里的 id — global_assets 写入会 FK 失败, 但 share token 表不引用 users
  return `not-real-user-${counter++}`;
}

beforeEach(() => {
  if (!SEEDED_USER_ID) {
    const user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
    SEEDED_USER_ID = user?.id || '';
    if (!SEEDED_USER_ID) throw new Error('test setup: no seeded user found');
  }
  // 清理测试产物 (按 description 标识 — 不影响真实业务数据)
  db.prepare(`DELETE FROM template_share_tokens WHERE owner_user_id = ? OR owner_user_id LIKE 'not-real-user-%'`).run(SEEDED_USER_ID);
  db.prepare(`DELETE FROM global_assets WHERE user_id = ? AND name LIKE 'TEST-SHARE-%'`).run(SEEDED_USER_ID);
});

let assetCounter = 0;
function makeTemplateAsset(userId: string, name?: string) {
  return createGlobalAsset({
    userId,
    type: 'template',
    name: name || `TEST-SHARE-${++assetCounter}`,
    description: 'desc',
    metadata: {
      exampleIdea: '示例创意',
      structureHint: '结构提示',
      keyElements: ['元素 1'],
    },
  });
}

describe('createShareToken + getByToken', () => {
  it('creates a unique token bound to assetId + ownerUserId', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = createShareToken({ assetId: asset.id, ownerUserId: u });
    expect(t.token.length).toBeGreaterThan(8);
    expect(t.assetId).toBe(asset.id);
    expect(t.ownerUserId).toBe(u);
    expect(t.viewCount).toBe(0);
    expect(t.cloneCount).toBe(0);

    const fetched = getByToken(t.token);
    expect(fetched).not.toBeNull();
    expect(fetched!.assetId).toBe(asset.id);
  });

  it('two tokens for same asset are independent', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t1 = createShareToken({ assetId: asset.id, ownerUserId: u });
    const t2 = createShareToken({ assetId: asset.id, ownerUserId: u });
    expect(t1.token).not.toBe(t2.token);
    const list = listTokensForAsset(asset.id);
    expect(list.length).toBe(2);
  });

  it('returns null for non-existent token', () => {
    expect(getByToken('definitely-not-real-token-xyz')).toBeNull();
  });

  it('expired token returns null from getByToken', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const expired = new Date(Date.now() - 60_000).toISOString();
    const t = createShareToken({ assetId: asset.id, ownerUserId: u, expiresAt: expired });
    expect(getByToken(t.token)).toBeNull();
  });
});

describe('incrementViewCount / incrementCloneCount', () => {
  it('view count goes up on each call', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = createShareToken({ assetId: asset.id, ownerUserId: u });
    incrementViewCount(t.token);
    incrementViewCount(t.token);
    incrementViewCount(t.token);
    expect(getByToken(t.token)!.viewCount).toBe(3);
  });

  it('clone count is independent of view', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = createShareToken({ assetId: asset.id, ownerUserId: u });
    incrementViewCount(t.token);
    incrementCloneCount(t.token);
    incrementCloneCount(t.token);
    const fetched = getByToken(t.token)!;
    expect(fetched.viewCount).toBe(1);
    expect(fetched.cloneCount).toBe(2);
  });

  it('non-existent token: increment is silently no-op', () => {
    expect(() => incrementViewCount('not-a-token')).not.toThrow();
  });
});

describe('listTokensForOwner', () => {
  it('returns only that owner (其他 owner_user_id 隔离)', () => {
    const u1 = freshUserId(); // = SEEDED_USER_ID
    const otherOwner = nonExistentUserId(); // share 表不要求 FK, 直接用虚拟 id
    const a1 = makeTemplateAsset(u1);
    createShareToken({ assetId: a1.id, ownerUserId: u1 });
    createShareToken({ assetId: a1.id, ownerUserId: otherOwner });
    expect(listTokensForOwner(u1).length).toBeGreaterThanOrEqual(1);
    expect(listTokensForOwner(otherOwner)).toHaveLength(1);
    expect(listTokensForOwner('nobody-else-not-real')).toHaveLength(0);
  });
});

describe('deleteToken (auth)', () => {
  it('only owner can delete', () => {
    const u1 = freshUserId();
    const u2 = nonExistentUserId();
    const a1 = makeTemplateAsset(u1);
    const t = createShareToken({ assetId: a1.id, ownerUserId: u1 });
    expect(deleteToken(t.token, u2)).toBe(false); // wrong user
    expect(deleteToken(t.token, u1)).toBe(true);
    expect(deleteToken(t.token, u1)).toBe(false); // already gone
  });
});

describe('getTemplateAssetForToken', () => {
  it('happy path: returns { token, asset } for template asset', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u, '我的模板');
    const t = createShareToken({ assetId: asset.id, ownerUserId: u });
    const found = getTemplateAssetForToken(t.token);
    expect(found).not.toBeNull();
    expect(found!.asset.name).toBe('我的模板');
    expect(found!.token.token).toBe(t.token);
  });

  it('returns null when token not found', () => {
    expect(getTemplateAssetForToken('not-a-real-token')).toBeNull();
  });

  it('returns null when underlying asset has been deleted', () => {
    const u = freshUserId();
    const asset = makeTemplateAsset(u);
    const t = createShareToken({ assetId: asset.id, ownerUserId: u });
    db.prepare(`DELETE FROM global_assets WHERE id = ?`).run(asset.id);
    expect(getTemplateAssetForToken(t.token)).toBeNull();
  });

  it('returns null when asset type is not template', () => {
    const u = freshUserId();
    const sceneAsset = createGlobalAsset({
      userId: u,
      type: 'scene',
      name: 'a scene',
      description: 'x',
    });
    // 制造一个指向非 template asset 的 token (绕过路由层校验直接 lib 调)
    const t = createShareToken({ assetId: sceneAsset.id, ownerUserId: u });
    expect(getTemplateAssetForToken(t.token)).toBeNull();
  });
});
