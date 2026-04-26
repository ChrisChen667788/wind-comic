/**
 * 全局资产 DAO 单测 (v2.0 Sprint 0 D4)
 *
 * 直接打在真实 SQLite（data/qfmj.db），每个 case 自己清理，避免互相污染。
 * 由于 lib/db.ts 会跑一次 seed，DB 内必定存在一个 demo user，
 * 我们复用它作为测试 userId。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createGlobalAsset,
  listGlobalAssets,
  getGlobalAssetById,
  updateGlobalAsset,
  deleteGlobalAsset,
  recordAssetUsage,
} from '@/lib/global-assets';

let TEST_USER_ID: string;
let OTHER_USER_ID: string;

beforeEach(() => {
  // 保证有一个 demo user
  const first = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  if (!first) throw new Error('DB has no user; seed must have failed');
  TEST_USER_ID = first.id;

  // 再造一个"其它用户"用于权限测试
  const otherId = 'test-other-user-' + Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, locale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(otherId, `other-${Date.now()}@test.local`, 'x', 'other', 'user', 'zh', new Date().toISOString());
  OTHER_USER_ID = otherId;
});

afterEach(() => {
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("DELETE FROM global_assets WHERE name LIKE 'TEST_%'").run();
    db.prepare("DELETE FROM users WHERE id LIKE 'test-other-user-%'").run();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

describe('lib/global-assets CRUD', () => {
  it('createGlobalAsset + getGlobalAssetById roundtrip', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'character',
      name: 'TEST_A',
      description: '测试角色',
      tags: ['少女', '忧郁'],
      thumbnail: 'https://example.com/a.jpg',
      visualAnchors: ['长发', '红衣', '古风'],
      metadata: { age: 18, gender: 'female' },
    });

    expect(a.id).toBeTruthy();
    expect(a.userId).toBe(TEST_USER_ID);
    expect(a.type).toBe('character');
    expect(a.name).toBe('TEST_A');
    expect(a.tags).toEqual(['少女', '忧郁']);
    expect(a.visualAnchors).toEqual(['长发', '红衣', '古风']);
    expect(a.metadata).toEqual({ age: 18, gender: 'female' });
    expect(a.referencedByProjects).toEqual([]);
    expect(a.createdAt).toBeTruthy();
    expect(a.updatedAt).toBeTruthy();

    const fetched = getGlobalAssetById(a.id);
    expect(fetched).toEqual(a);
  });

  it('listGlobalAssets 按 user_id 过滤', () => {
    createGlobalAsset({ userId: TEST_USER_ID, type: 'character', name: 'TEST_A1' });
    createGlobalAsset({ userId: TEST_USER_ID, type: 'scene', name: 'TEST_A2' });
    createGlobalAsset({ userId: OTHER_USER_ID, type: 'character', name: 'TEST_OTHER' });

    const mine = listGlobalAssets({ userId: TEST_USER_ID });
    const mineNames = mine.map(a => a.name).filter(n => n.startsWith('TEST_'));
    expect(mineNames).toContain('TEST_A1');
    expect(mineNames).toContain('TEST_A2');
    expect(mineNames).not.toContain('TEST_OTHER');
  });

  it('listGlobalAssets 支持 type 过滤', () => {
    createGlobalAsset({ userId: TEST_USER_ID, type: 'character', name: 'TEST_C1' });
    createGlobalAsset({ userId: TEST_USER_ID, type: 'scene', name: 'TEST_S1' });
    createGlobalAsset({ userId: TEST_USER_ID, type: 'prop', name: 'TEST_P1' });

    const chars = listGlobalAssets({ userId: TEST_USER_ID, type: 'character' });
    const charNames = chars.map(a => a.name).filter(n => n.startsWith('TEST_'));
    expect(charNames).toContain('TEST_C1');
    expect(charNames).not.toContain('TEST_S1');
    expect(charNames).not.toContain('TEST_P1');
  });

  it('listGlobalAssets 支持 q 模糊搜索', () => {
    createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'character',
      name: 'TEST_青枫',
      description: 'sword girl',
    });
    createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'character',
      name: 'TEST_yunyan',
      description: '云岚 描述',
    });

    // name 匹配
    const byName = listGlobalAssets({ userId: TEST_USER_ID, q: '青枫' });
    expect(byName.some(a => a.name === 'TEST_青枫')).toBe(true);
    expect(byName.some(a => a.name === 'TEST_yunyan')).toBe(false);

    // description 匹配
    const byDesc = listGlobalAssets({ userId: TEST_USER_ID, q: '云岚' });
    expect(byDesc.some(a => a.name === 'TEST_yunyan')).toBe(true);
  });

  it('updateGlobalAsset 部分更新生效', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'character',
      name: 'TEST_UPD',
      tags: ['old'],
      metadata: { v: 1 },
    });

    const updated = updateGlobalAsset(a.id, TEST_USER_ID, {
      name: 'TEST_UPD_new',
      tags: ['new1', 'new2'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('TEST_UPD_new');
    expect(updated!.tags).toEqual(['new1', 'new2']);
    // 未传的字段保持原值
    expect(updated!.metadata).toEqual({ v: 1 });
    // updated_at 刷新
    expect(updated!.updatedAt >= a.updatedAt).toBe(true);
  });

  it('updateGlobalAsset 跨用户操作抛 Forbidden', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'character',
      name: 'TEST_PERM',
    });
    expect(() =>
      updateGlobalAsset(a.id, OTHER_USER_ID, { name: 'TEST_HACKED' }),
    ).toThrow(/Forbidden/);
  });

  it('deleteGlobalAsset 正常删除', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'scene',
      name: 'TEST_DEL',
    });
    expect(deleteGlobalAsset(a.id, TEST_USER_ID)).toBe(true);
    expect(getGlobalAssetById(a.id)).toBeNull();
  });

  it('deleteGlobalAsset 跨用户抛 Forbidden', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'scene',
      name: 'TEST_DEL_PERM',
    });
    expect(() => deleteGlobalAsset(a.id, OTHER_USER_ID)).toThrow(/Forbidden/);
  });

  it('recordAssetUsage 追加项目并去重', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'style',
      name: 'TEST_USAGE',
    });

    let r = recordAssetUsage(a.id, TEST_USER_ID, 'project-A');
    expect(r!.referencedByProjects).toEqual(['project-A']);

    r = recordAssetUsage(a.id, TEST_USER_ID, 'project-B');
    expect(r!.referencedByProjects.sort()).toEqual(['project-A', 'project-B']);

    // 重复加同一个 projectId —— 幂等
    r = recordAssetUsage(a.id, TEST_USER_ID, 'project-A');
    expect(r!.referencedByProjects.sort()).toEqual(['project-A', 'project-B']);
  });

  it('recordAssetUsage 跨用户抛 Forbidden', () => {
    const a = createGlobalAsset({
      userId: TEST_USER_ID,
      type: 'prop',
      name: 'TEST_USAGE_PERM',
    });
    expect(() => recordAssetUsage(a.id, OTHER_USER_ID, 'p')).toThrow(/Forbidden/);
  });

  it('getGlobalAssetById 不存在返回 null', () => {
    expect(getGlobalAssetById('not-exist-xyz')).toBeNull();
  });
});
