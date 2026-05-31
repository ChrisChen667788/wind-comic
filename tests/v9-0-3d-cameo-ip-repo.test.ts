/**
 * v9.0.3d — cameo-ip-repo async (SQLite driver, 真 DB).
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver } from '@/lib/db-driver';
import {
  issueIpToken, getIpToken, revokeIpToken, listMarketplaceTokens, listOwnerTokens,
  requestGrant, decideGrant, getGrant, listPendingGrantsForOwner,
  checkAccess, recordTokenUse, importCameoToLibrary,
} from '@/lib/repos/cameo-ip-repo';

async function seedUser(): Promise<string> {
  const id = 'ipu-' + nanoid();
  await getDbDriver().run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    [id, `${id}@t.local`, 'x', id, new Date().toISOString()]);
  return id;
}
async function seedCharacter(userId: string, name = 'Hero'): Promise<string> {
  const id = 'ipc-' + nanoid();
  await getDbDriver().run(
    `INSERT INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '[]', '["https://x/h.png"]', '', 0, ?, ?)`,
    [id, userId, name, new Date().toISOString(), new Date().toISOString()]);
  return id;
}

describe('v9.0.3d · cameo-ip-repo (async через DbDriver)', () => {
  it('issueIpToken upsert + get + market/owner 列表', async () => {
    const owner = await seedUser();
    const charId = await seedCharacter(owner);
    const t = await issueIpToken({ characterId: charId, ownerId: owner, name: '联名角色', visibility: 'public', license: 'remix', royaltyCny: 9.9 });
    expect(t.status).toBe('active');
    expect(t.royaltyCny).toBe(9.9);
    expect((await getIpToken(t.id))?.name).toBe('联名角色');
    // upsert: 同 character 再 issue → 同 id, 改名
    const t2 = await issueIpToken({ characterId: charId, ownerId: owner, name: '改名', visibility: 'public', license: 'remix' });
    expect(t2.id).toBe(t.id);
    expect(t2.name).toBe('改名');
    expect((await listMarketplaceTokens()).some((x) => x.id === t.id)).toBe(true);
    expect((await listOwnerTokens(owner)).some((x) => x.id === t.id)).toBe(true);
    // 非所有者不能改
    await expect(issueIpToken({ characterId: charId, ownerId: 'intruder', name: 'x' })).rejects.toThrow(/所有者/);
  });

  it('checkAccess: owner / open(public+remix) / denied(view)', async () => {
    const owner = await seedUser();
    const charId = await seedCharacter(owner);
    const tok = await issueIpToken({ characterId: charId, ownerId: owner, name: 'A', visibility: 'public', license: 'remix' });
    expect((await checkAccess(tok.id, owner)).level).toBe('owner');
    expect((await checkAccess(tok.id, 'stranger')).level).toBe('open');
    // view license private → 陌生人 denied
    const tok2 = await issueIpToken({ characterId: await seedCharacter(owner), ownerId: owner, name: 'B', visibility: 'private', license: 'view' });
    expect((await checkAccess(tok2.id, 'stranger')).level).toBe('denied');
  });

  it('grant 流程: request → pending → decide approve → granted; recordTokenUse 计数', async () => {
    const owner = await seedUser();
    const grantee = await seedUser();
    const tok = await issueIpToken({ characterId: await seedCharacter(owner), ownerId: owner, name: 'P', visibility: 'private', license: 'view' });
    const g = await requestGrant(tok.id, grantee, 'pls');
    expect(g.status).toBe('pending');
    expect((await getGrant(tok.id, grantee))?.status).toBe('pending');
    const pend = await listPendingGrantsForOwner(owner);
    expect(pend.some((p) => p.id === g.id && p.tokenName === 'P')).toBe(true);
    // 批准 → granted
    const decided = await decideGrant(g.id, owner, true);
    expect(decided.status).toBe('approved');
    expect((await checkAccess(tok.id, grantee)).level).toBe('granted');
    // recordTokenUse: token + grant use_count ++
    expect(await recordTokenUse(tok.id, grantee)).toBe(true);
    expect((await getIpToken(tok.id))?.useCount).toBe(1);
    expect((await getGrant(tok.id, grantee))?.useCount).toBe(1);
  });

  it('importCameoToLibrary: 授权后导入 + dedup; revoke 后陌生人 denied', async () => {
    const owner = await seedUser();
    const grantee = await seedUser();
    const charId = await seedCharacter(owner, '原角色');
    const tok = await issueIpToken({ characterId: charId, ownerId: owner, name: 'IMP', visibility: 'public', license: 'commercial' });
    const r1 = await importCameoToLibrary(tok.id, grantee);
    expect(r1.ok).toBe(true);
    expect(r1.alreadyImported).toBe(false);
    const imported = await getDbDriver().get<any>('SELECT * FROM character_library WHERE id = ?', [r1.characterId]);
    expect(imported.name).toBe('原角色 (联名)');
    expect(imported.source_token_id).toBe(tok.id);
    // 再导 → dedup
    const r2 = await importCameoToLibrary(tok.id, grantee);
    expect(r2.alreadyImported).toBe(true);
    expect(r2.characterId).toBe(r1.characterId);
    // revoke → 非 owner denied, 不能再导新
    expect(await revokeIpToken(tok.id, owner)).toBe(true);
    expect((await getIpToken(tok.id))?.status).toBe('revoked');
    const grantee2 = await seedUser();
    expect((await importCameoToLibrary(tok.id, grantee2)).ok).toBe(false);
  });
});
