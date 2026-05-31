/**
 * v9.0.3 — invite-repo async (SQLite driver, 真 DB).
 */
import { describe, it, expect } from 'vitest';
import { getDbDriver } from '@/lib/db-driver';
import {
  createInviteCode,
  generateInviteCodes,
  getInviteCode,
  listInviteCodes,
  validateInviteCode,
  consumeInviteCodeTx,
  revokeInviteCode,
  isInviteRequired,
} from '@/lib/repos/invite-repo';

// invite_codes.used_by_user_id 有 FK → users(id); 消费前先建真用户 (与 register 同事务里先插 user 一致)
async function seedUser(id: string) {
  await getDbDriver().run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    [id, `${id}@t.local`, 'x', id, new Date().toISOString()],
  );
}

describe('v9.0.3 · invite-repo (async через DbDriver)', () => {
  it('createInviteCode + getInviteCode round-trip (大小写归一)', async () => {
    const inv = await createInviteCode({ code: 'betaRepo1', source: 'unit', createdBy: 'admin-1' });
    expect(inv.code).toBe('BETAREPO1'); // upper-cased
    expect(inv.status).toBe('unused');
    expect(inv.source).toBe('unit');
    const got = await getInviteCode('betarepo1'); // 查询也归一
    expect(got?.code).toBe('BETAREPO1');
  });

  it('generateInviteCodes(n) + listInviteCodes by source', async () => {
    const src = 'batch-' + Math.floor(Date.now() / 1000); // 唯一 source 隔离
    const created = await generateInviteCodes(3, 'admin-2', src);
    expect(created).toHaveLength(3);
    expect(new Set(created.map((c) => c.code)).size).toBe(3); // 互不重复
    const listed = await listInviteCodes({ source: src });
    expect(listed).toHaveLength(3);
    expect(listed.every((c) => c.status === 'unused')).toBe(true);
  });

  it('validateInviteCode: 各种状态', async () => {
    await createInviteCode({ code: 'BETAVAL1', createdBy: 'admin-3' });
    expect((await validateInviteCode('BETAVAL1')).ok).toBe(true);
    expect((await validateInviteCode('')).error).toBe('INVALID');
    expect((await validateInviteCode('NOPE-NONEXIST')).error).toBe('NOT_FOUND');
    // 过期码
    await createInviteCode({ code: 'BETAEXP1', createdBy: 'admin-3', expiresAt: '2000-01-01T00:00:00Z' });
    expect((await validateInviteCode('BETAEXP1')).error).toBe('EXPIRED');
  });

  it('consumeInviteCodeTx 在 DbDriver 事务里占用 + 防重复', async () => {
    await seedUser('inv-user-a');
    await createInviteCode({ code: 'BETACONSUME', createdBy: 'admin-4' });
    const r1 = await getDbDriver().transaction((tx) => consumeInviteCodeTx(tx, 'betaconsume', 'inv-user-a'));
    expect(r1.ok).toBe(true);
    expect((await getInviteCode('BETACONSUME'))?.status).toBe('used');
    // 再消费 → ALREADY_USED (在 UPDATE 前就返回, 不触发 FK)
    const r2 = await getDbDriver().transaction((tx) => consumeInviteCodeTx(tx, 'BETACONSUME', 'inv-user-b'));
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('ALREADY_USED');
  });

  it('revokeInviteCode: 未用可撤, 已用不可撤; 撤后 validate=REVOKED', async () => {
    await createInviteCode({ code: 'BETAREVK1', createdBy: 'admin-5' });
    expect(await revokeInviteCode('betarevk1')).toBe(true);
    expect((await validateInviteCode('BETAREVK1')).error).toBe('REVOKED');
    // 已用的撤不动
    await seedUser('inv-user-c');
    await createInviteCode({ code: 'BETAREVK2', createdBy: 'admin-5' });
    await getDbDriver().transaction((tx) => consumeInviteCodeTx(tx, 'BETAREVK2', 'inv-user-c'));
    expect(await revokeInviteCode('BETAREVK2')).toBe(false);
  });

  it('isInviteRequired 读 env (纯函数)', () => {
    const saved = process.env.BETA_INVITE_REQUIRED;
    process.env.BETA_INVITE_REQUIRED = 'false';
    expect(isInviteRequired()).toBe(false);
    process.env.BETA_INVITE_REQUIRED = 'true';
    expect(isInviteRequired()).toBe(true);
    if (saved === undefined) delete process.env.BETA_INVITE_REQUIRED; else process.env.BETA_INVITE_REQUIRED = saved;
  });
});
