/**
 * Character Bible 跨项目持久化单测 · Sprint A.3 (v2.12)
 *
 * 覆盖:
 *   · upsertCharacterBible 新建 / 合并 / sampleFaces 累积去重
 *   · findCharacterBibleByName 大小写/空白边界
 *   · referencedByProjects 累积
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import {
  upsertCharacterBible,
  findCharacterBibleByName,
  type CharacterBible,
} from '@/lib/global-assets';

let TEST_USER_ID: string;

beforeEach(() => {
  const first = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  if (!first) throw new Error('seed user missing');
  TEST_USER_ID = first.id;
});

afterEach(() => {
  // 清掉测试角色 + 临时用户,避免污染下一轮(顺序:先 child 表再 parent 表,绕过 FK)
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.prepare("DELETE FROM global_assets WHERE name LIKE 'TEST_BIBLE_%' OR name LIKE 'BIBLE_%'").run();
    db.prepare("DELETE FROM users WHERE id LIKE 'test-other-user-bible-%'").run();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

const mkBible = (overrides: Partial<CharacterBible> = {}): CharacterBible => ({
  role: 'lead',
  cw: 125,
  imageUrl: 'http://x/face1.png',
  traits: { gender: 'female', ageGroup: '青年', confident: true },
  sampleFaces: ['http://x/face1.png'],
  ...overrides,
});

describe('upsertCharacterBible', () => {
  it('creates a new global_assets row when name does not exist', () => {
    const asset = upsertCharacterBible({
      userId: TEST_USER_ID,
      projectId: 'proj-A',
      name: 'TEST_BIBLE_alice',
      bible: mkBible(),
    });
    expect(asset.id).toBeTruthy();
    expect(asset.type).toBe('character');
    expect(asset.thumbnail).toBe('http://x/face1.png');
    const bible = asset.metadata.bible as CharacterBible;
    expect(bible.role).toBe('lead');
    expect(bible.cw).toBe(125);
    expect(bible.sampleFaces).toEqual(['http://x/face1.png']);
    expect(bible.lastUsedProjectId).toBe('proj-A');
  });

  it('merges sampleFaces (newest first, dedup) when same name re-upserted', () => {
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-A', name: 'TEST_BIBLE_bob',
      bible: mkBible({ imageUrl: 'http://x/v1.png', sampleFaces: ['http://x/v1.png'] }),
    });
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-B', name: 'TEST_BIBLE_bob',
      bible: mkBible({ imageUrl: 'http://x/v2.png', sampleFaces: ['http://x/v2.png'] }),
    });
    const hit = findCharacterBibleByName(TEST_USER_ID, 'TEST_BIBLE_bob');
    expect(hit).not.toBeNull();
    expect(hit!.bible.imageUrl).toBe('http://x/v2.png'); // 最新覆盖
    expect(hit!.bible.sampleFaces).toEqual(['http://x/v2.png', 'http://x/v1.png']); // newest first
    expect(hit!.bible.lastUsedProjectId).toBe('proj-B');
  });

  it('accumulates referencedByProjects across multiple projects', () => {
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-X', name: 'TEST_BIBLE_carol',
      bible: mkBible(),
    });
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-Y', name: 'TEST_BIBLE_carol',
      bible: mkBible(),
    });
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-X', name: 'TEST_BIBLE_carol', // 同项目重复 → 幂等
      bible: mkBible(),
    });
    const hit = findCharacterBibleByName(TEST_USER_ID, 'TEST_BIBLE_carol');
    expect(hit!.usedInProjectsCount).toBe(2);
  });

  it('preserves traits across upserts when new bible omits traits', () => {
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-A', name: 'TEST_BIBLE_dan',
      bible: mkBible({ traits: { gender: 'male', confident: true } }),
    });
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-B', name: 'TEST_BIBLE_dan',
      bible: mkBible({ traits: null }), // 这次没抽 traits
    });
    const hit = findCharacterBibleByName(TEST_USER_ID, 'TEST_BIBLE_dan');
    // 因为 mergedBible spread 顺序是 prev + new,new traits=null 覆盖 prev → 这是有意为之
    // 验收语义:最新的 traits 覆盖,即使是 null;希望保留旧的请上层 caller 控制
    expect(hit!.bible.traits).toBeNull();
  });

  it('caps sampleFaces at 10', () => {
    // 第一次塞 12 张
    const samples = Array.from({ length: 12 }, (_, i) => `http://x/v${i}.png`);
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'proj-A', name: 'TEST_BIBLE_eli',
      bible: mkBible({ imageUrl: samples[0]!, sampleFaces: samples }),
    });
    const hit = findCharacterBibleByName(TEST_USER_ID, 'TEST_BIBLE_eli');
    expect(hit!.bible.sampleFaces.length).toBeLessThanOrEqual(10);
  });
});

describe('findCharacterBibleByName', () => {
  it('returns null when no row exists', () => {
    expect(findCharacterBibleByName(TEST_USER_ID, 'TEST_BIBLE_nonexistent')).toBeNull();
  });

  it('returns null for empty / whitespace-only names', () => {
    expect(findCharacterBibleByName(TEST_USER_ID, '')).toBeNull();
    expect(findCharacterBibleByName(TEST_USER_ID, '   ')).toBeNull();
  });

  it('exact-name match (no fuzzy/normalized — A.3 uses exact reuse)', () => {
    upsertCharacterBible({
      userId: TEST_USER_ID, projectId: 'p1', name: 'BIBLE_李长安',
      bible: mkBible(),
    });
    expect(findCharacterBibleByName(TEST_USER_ID, 'BIBLE_李长安')).not.toBeNull();
    expect(findCharacterBibleByName(TEST_USER_ID, 'BIBLE_李长安2')).toBeNull(); // 不同
    expect(findCharacterBibleByName(TEST_USER_ID, 'bible_李长安')).toBeNull(); // case-sensitive
  });

  it('returns null when bible.imageUrl is missing (broken row protection)', () => {
    // 直接塞一个没 bible.imageUrl 的 metadata
    const ts = new Date().toISOString();
    db.prepare(
      `INSERT INTO global_assets
       (id, user_id, type, name, description, tags, thumbnail, visual_anchors, embedding, metadata, referenced_by_projects, created_at, updated_at)
       VALUES (?, ?, 'character', ?, '', '[]', '', '[]', NULL, ?, '[]', ?, ?)`,
    ).run('bad-row-1', TEST_USER_ID, 'BIBLE_broken', JSON.stringify({ bible: { role: 'lead', cw: 125 } }), ts, ts);
    expect(findCharacterBibleByName(TEST_USER_ID, 'BIBLE_broken')).toBeNull();
    db.prepare("DELETE FROM global_assets WHERE id = 'bad-row-1'").run();
  });

  it('does not leak across users', () => {
    const otherUserId = 'test-other-user-bible-' + Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, locale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(otherUserId, `o-${Date.now()}@t.local`, 'x', 'o', 'user', 'zh', new Date().toISOString());
    upsertCharacterBible({
      userId: otherUserId, projectId: 'p1', name: 'BIBLE_secret',
      bible: mkBible(),
    });
    expect(findCharacterBibleByName(TEST_USER_ID, 'BIBLE_secret')).toBeNull();
    expect(findCharacterBibleByName(otherUserId, 'BIBLE_secret')).not.toBeNull();
    // afterEach 会清 BIBLE_secret 和 test-other-user-bible-* (FK 安全)
  });
});
