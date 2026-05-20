/**
 * v4.0 — Cameo IP 经济单测 (纯权限逻辑 + 真 SQLite 持久化).
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import {
  licenseAllowsReuse,
  resolveAccess,
  accessCanReuse,
  issueIpToken,
  getIpToken,
  revokeIpToken,
  listMarketplaceTokens,
  listOwnerTokens,
  requestGrant,
  getGrant,
  decideGrant,
  listPendingGrantsForOwner,
  checkAccess,
  recordTokenUse,
  importCameoToLibrary,
} from '@/lib/cameo-ip';
import { db, now } from '@/lib/db';

// ─── 纯权限逻辑 ───────────────────────────────────────────────────────────

describe('v4.0 · licenseAllowsReuse', () => {
  it('view = no reuse, remix/commercial = reuse', () => {
    expect(licenseAllowsReuse('view')).toBe(false);
    expect(licenseAllowsReuse('remix')).toBe(true);
    expect(licenseAllowsReuse('commercial')).toBe(true);
  });
});

describe('v4.0 · resolveAccess', () => {
  const base = { ownerId: 'owner1', visibility: 'public' as const, license: 'remix' as const, status: 'active' as const };

  it('owner always owner', () => {
    expect(resolveAccess({ ...base, status: 'revoked' }, null, 'owner1')).toBe('owner');
  });
  it('public + remix → open for anyone', () => {
    expect(resolveAccess(base, null, 'stranger')).toBe('open');
  });
  it('public + view → not open (needs grant)', () => {
    expect(resolveAccess({ ...base, license: 'view' }, null, 'stranger')).toBe('denied');
  });
  it('revoked token → denied for non-owner', () => {
    expect(resolveAccess({ ...base, status: 'revoked' }, null, 'stranger')).toBe('denied');
  });
  it('approved grant → granted', () => {
    expect(resolveAccess({ ...base, visibility: 'private', license: 'view' }, { status: 'approved' }, 'g')).toBe('granted');
  });
  it('pending grant → pending', () => {
    expect(resolveAccess({ ...base, visibility: 'private', license: 'view' }, { status: 'pending' }, 'g')).toBe('pending');
  });
  it('revoked grant → denied', () => {
    expect(resolveAccess({ ...base, visibility: 'private', license: 'view' }, { status: 'revoked' }, 'g')).toBe('denied');
  });
});

describe('v4.0 · accessCanReuse', () => {
  it('owner/open/granted can; pending/denied cannot', () => {
    expect(accessCanReuse('owner')).toBe(true);
    expect(accessCanReuse('open')).toBe(true);
    expect(accessCanReuse('granted')).toBe(true);
    expect(accessCanReuse('pending')).toBe(false);
    expect(accessCanReuse('denied')).toBe(false);
  });
});

// ─── 持久化 ───────────────────────────────────────────────────────────────

describe('v4.0 · issueIpToken / get / revoke', () => {
  it('issues a token', () => {
    const charId = 'char-' + nanoid();
    const owner = 'owner-' + nanoid();
    const t = issueIpToken({ characterId: charId, ownerId: owner, name: '林晚', visibility: 'public', license: 'remix', royaltyCny: 5 });
    expect(t.id).toMatch(/^ipt_/);
    expect(t.name).toBe('林晚');
    expect(t.visibility).toBe('public');
    expect(t.royaltyCny).toBe(5);
    expect(getIpToken(t.id)?.characterId).toBe(charId);
  });

  it('UPSERT: same character updates not duplicates', () => {
    const charId = 'char-' + nanoid();
    const owner = 'owner-' + nanoid();
    const t1 = issueIpToken({ characterId: charId, ownerId: owner, name: 'A', license: 'view' });
    const t2 = issueIpToken({ characterId: charId, ownerId: owner, name: 'A2', license: 'commercial' });
    expect(t2.id).toBe(t1.id);
    expect(getIpToken(t1.id)?.license).toBe('commercial');
  });

  it('non-owner cannot re-issue same character', () => {
    const charId = 'char-' + nanoid();
    issueIpToken({ characterId: charId, ownerId: 'owner-a', name: 'A' });
    expect(() => issueIpToken({ characterId: charId, ownerId: 'owner-b', name: 'B' })).toThrow(/所有者/);
  });

  it('clamps negative royalty to 0', () => {
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: 'o-' + nanoid(), name: 'X', royaltyCny: -99 });
    expect(t.royaltyCny).toBe(0);
  });

  it('revoke flips status; non-owner cannot revoke', () => {
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: 'owner-c', name: 'C' });
    expect(() => revokeIpToken(t.id, 'someone-else')).toThrow(/所有者/);
    expect(revokeIpToken(t.id, 'owner-c')).toBe(true);
    expect(getIpToken(t.id)?.status).toBe('revoked');
  });
});

describe('v4.0 · marketplace + owner listing', () => {
  it('marketplace only shows public+active', () => {
    const owner = 'owner-mkt-' + nanoid();
    const pub = issueIpToken({ characterId: 'c1-' + nanoid(), ownerId: owner, name: 'pub', visibility: 'public', license: 'remix' });
    issueIpToken({ characterId: 'c2-' + nanoid(), ownerId: owner, name: 'priv', visibility: 'private' });
    const ids = listMarketplaceTokens().map((t) => t.id);
    expect(ids).toContain(pub.id);
    const list = listMarketplaceTokens();
    expect(list.every((t) => t.visibility === 'public' && t.status === 'active')).toBe(true);
  });

  it('owner listing shows all own tokens', () => {
    const owner = 'owner-list-' + nanoid();
    issueIpToken({ characterId: 'c1-' + nanoid(), ownerId: owner, name: 'a', visibility: 'private' });
    issueIpToken({ characterId: 'c2-' + nanoid(), ownerId: owner, name: 'b', visibility: 'public' });
    expect(listOwnerTokens(owner)).toHaveLength(2);
  });
});

describe('v4.0 · grant flow', () => {
  it('request → pending → approve → granted → reuse counts', () => {
    const charId = 'char-' + nanoid();
    const owner = 'owner-g-' + nanoid();
    const grantee = 'grantee-' + nanoid();
    const token = issueIpToken({ characterId: charId, ownerId: owner, name: 'G', visibility: 'unlisted', license: 'view' });

    // 非 public-remix → 陌生人需申请
    expect(checkAccess(token.id, grantee).level).toBe('denied');

    const g = requestGrant(token.id, grantee, '想用在我的项目');
    expect(g.status).toBe('pending');
    expect(checkAccess(token.id, grantee).level).toBe('pending');

    // 重复申请返回同一条
    expect(requestGrant(token.id, grantee).id).toBe(g.id);

    // owner 看到待批
    expect(listPendingGrantsForOwner(owner).some((x) => x.id === g.id)).toBe(true);

    // 批准
    const decided = decideGrant(g.id, owner, true);
    expect(decided.status).toBe('approved');
    expect(checkAccess(token.id, grantee).level).toBe('granted');

    // 复用计数
    expect(recordTokenUse(token.id, grantee)).toBe(true);
    expect(getIpToken(token.id)?.useCount).toBe(1);
    expect(getGrant(token.id, grantee)?.useCount).toBe(1);
  });

  it('owner cannot request grant on own token', () => {
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: 'owner-self', name: 'S' });
    expect(() => requestGrant(t.id, 'owner-self')).toThrow(/自己/);
  });

  it('reject sets revoked → denied', () => {
    const owner = 'owner-r-' + nanoid();
    const grantee = 'grantee-r-' + nanoid();
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: owner, name: 'R', visibility: 'private', license: 'view' });
    const g = requestGrant(t.id, grantee);
    decideGrant(g.id, owner, false);
    expect(checkAccess(t.id, grantee).level).toBe('denied');
  });

  it('non-owner cannot decide', () => {
    const owner = 'owner-d-' + nanoid();
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: owner, name: 'D', visibility: 'private' });
    const g = requestGrant(t.id, 'grantee-d');
    expect(() => decideGrant(g.id, 'not-owner', true)).toThrow(/所有者/);
  });

  it('public-remix token: stranger can reuse without grant', () => {
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: 'owner-open', name: 'Open', visibility: 'public', license: 'remix' });
    expect(recordTokenUse(t.id, 'random-user')).toBe(true);
    expect(getIpToken(t.id)?.useCount).toBe(1);
  });

  it('recordTokenUse denied for no-access user', () => {
    const t = issueIpToken({ characterId: 'char-' + nanoid(), ownerId: 'owner-x', name: 'X', visibility: 'private', license: 'view' });
    expect(recordTokenUse(t.id, 'random')).toBe(false);
    expect(getIpToken(t.id)?.useCount).toBe(0);
  });
});

// ─── v4.0.1 复用闭环: importCameoToLibrary ──────────────────────────────────

describe('v4.0.1 · importCameoToLibrary', () => {
  // character_library.user_id 有 FK → users(id), 先建真用户
  function seedUser(prefix = 'u'): string {
    const id = prefix + '-' + nanoid();
    const ts = now();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    ).run(id, `${id}@test.local`, 'x', id, ts);
    return id;
  }
  // 建一个真的源角色到 character_library (owner 必须是真用户)
  function seedCharacter(ownerId: string, name = '源角色'): string {
    const id = 'char-' + nanoid();
    const ts = now();
    db.prepare(
      `INSERT INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at)
       VALUES (?, ?, ?, '', '美少女', '[]', '["https://x/a.png"]', 'anime', 0, ?, ?)`,
    ).run(id, ownerId, name, ts, ts);
    return id;
  }

  it('imports a public-remix cameo into grantee library + records use', () => {
    const owner = seedUser('owner-imp');
    const grantee = seedUser('grantee-imp');
    const charId = seedCharacter(owner, '林晚');
    const token = issueIpToken({ characterId: charId, ownerId: owner, name: '林晚', visibility: 'public', license: 'remix' });

    const r = importCameoToLibrary(token.id, grantee);
    expect(r.ok).toBe(true);
    expect(r.alreadyImported).toBe(false);
    expect(r.characterId).toBeTruthy();

    // 新角色归属 grantee, 名字带联名, 带 source_token_id
    const copy = db.prepare(`SELECT * FROM character_library WHERE id=?`).get(r.characterId) as any;
    expect(copy.user_id).toBe(grantee);
    expect(copy.name).toContain('联名');
    expect(copy.source_token_id).toBe(token.id);
    expect(JSON.parse(copy.image_urls)).toEqual(['https://x/a.png']);

    // 复用计数 +1
    expect(getIpToken(token.id)?.useCount).toBe(1);
  });

  it('dedup: second import returns same id, no double count', () => {
    const owner = seedUser('owner-dd');
    const grantee = seedUser('grantee-dd');
    const charId = seedCharacter(owner);
    const token = issueIpToken({ characterId: charId, ownerId: owner, name: 'D', visibility: 'public', license: 'remix' });
    const r1 = importCameoToLibrary(token.id, grantee);
    const r2 = importCameoToLibrary(token.id, grantee);
    expect(r2.characterId).toBe(r1.characterId);
    expect(r2.alreadyImported).toBe(true);
    expect(getIpToken(token.id)?.useCount).toBe(1); // 只计一次
  });

  it('denies import without access', () => {
    const owner = seedUser('owner-na');
    const charId = seedCharacter(owner);
    const token = issueIpToken({ characterId: charId, ownerId: owner, name: 'NA', visibility: 'private', license: 'view' });
    const r = importCameoToLibrary(token.id, seedUser('stranger'));
    expect(r.ok).toBe(false);
  });

  it('granted user can import after approval', () => {
    const owner = seedUser('owner-ga');
    const grantee = seedUser('grantee-ga');
    const charId = seedCharacter(owner);
    const token = issueIpToken({ characterId: charId, ownerId: owner, name: 'GA', visibility: 'unlisted', license: 'view' });
    const g = requestGrant(token.id, grantee);
    expect(importCameoToLibrary(token.id, grantee).ok).toBe(false); // pending
    decideGrant(g.id, owner, true);
    expect(importCameoToLibrary(token.id, grantee).ok).toBe(true);  // approved
  });
});
