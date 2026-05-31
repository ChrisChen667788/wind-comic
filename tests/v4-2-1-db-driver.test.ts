/**
 * v4.2.1 — DB driver 抽象 + async user-repo 单测 (SQLite driver, 真 DB).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver, resetDbDriver } from '@/lib/db-driver';
import {
  findUserByEmail,
  findUserById,
  countUsers,
  createUser,
  updateUserPassword,
  updateUserSubscription,
} from '@/lib/repos/user-repo';

const savedEnv = { ...process.env };
afterEach(() => {
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, savedEnv);
  resetDbDriver();
});

describe('v4.2.1 · getDbDriver factory', () => {
  it('defaults to sqlite', () => {
    delete process.env.DB_DRIVER;
    resetDbDriver();
    expect(getDbDriver().dialect).toBe('sqlite');
  });
  it('DB_DRIVER=pg → postgres driver instance', () => {
    process.env.DB_DRIVER = 'pg';
    resetDbDriver();
    expect(getDbDriver().dialect).toBe('postgres');
    // 注意: 不真连 PG (没装 pg / 没 DATABASE_URL), 仅验证工厂选型
  });
  it('singleton: same instance until reset', () => {
    delete process.env.DB_DRIVER;
    resetDbDriver();
    expect(getDbDriver()).toBe(getDbDriver());
  });
});

describe('v4.2.1 · SqliteDriver query/get/run', () => {
  it('run INSERT reports changes; get reads back; query lists', async () => {
    const d = getDbDriver();
    const id = nanoid();
    const email = `drv-${id}@test.local`;
    const ins = await d.run(
      `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
      [id, email, 'h', 'Driver Test', new Date().toISOString()],
    );
    expect(ins.changes).toBe(1);

    const one = await d.get<{ id: string; email: string }>(`SELECT id, email FROM users WHERE id = ?`, [id]);
    expect(one?.email).toBe(email);

    const many = await d.query<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [id]);
    expect(many).toHaveLength(1);
  });

  it('get returns null when not found', async () => {
    const d = getDbDriver();
    expect(await d.get(`SELECT id FROM users WHERE id = ?`, ['nope-' + nanoid()])).toBeNull();
  });

  it('run UPDATE reports 0 changes for missing row', async () => {
    const d = getDbDriver();
    const r = await d.run(`UPDATE users SET name = ? WHERE id = ?`, ['x', 'ghost-' + nanoid()]);
    expect(r.changes).toBe(0);
  });
});

describe('v4.2.5 · SqliteDriver.transaction', () => {
  it('commits on success', async () => {
    const d = getDbDriver();
    const id = nanoid();
    await d.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
        [id, `tx-ok-${id}@test.local`, 'h', 'TxOK', new Date().toISOString()],
      );
    });
    const row = await d.get(`SELECT id FROM users WHERE id = ?`, [id]);
    expect(row).not.toBeNull();
  });

  it('rolls back on throw — no partial write', async () => {
    const d = getDbDriver();
    const id = nanoid();
    await expect(
      d.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
          [id, `tx-rb-${id}@test.local`, 'h', 'TxRB', new Date().toISOString()],
        );
        throw new Error('boom mid-transaction');
      }),
    ).rejects.toThrow(/boom/);
    // 回滚后该 user 不应存在
    const row = await d.get(`SELECT id FROM users WHERE id = ?`, [id]);
    expect(row).toBeNull();
  });

  it('returns fn result', async () => {
    const d = getDbDriver();
    const r = await d.transaction(async () => 42);
    expect(r).toBe(42);
  });
});

describe('v4.2.1 · user-repo (async, через driver)', () => {
  it('createUser + findByEmail + findById round-trip', async () => {
    const email = `repo-${nanoid()}@test.local`;
    const u = await createUser({ email, passwordHash: 'hash123', name: '小测' });
    expect(u.email).toBe(email);
    expect(u.role).toBe('user');
    expect(u.subscription_tier).toBe('free');

    const byEmail = await findUserByEmail(email);
    expect(byEmail?.id).toBe(u.id);
    const byId = await findUserById(u.id);
    expect(byId?.email).toBe(email);
  });

  it('createUser rejects duplicate email', async () => {
    const email = `dup-${nanoid()}@test.local`;
    await createUser({ email, passwordHash: 'h', name: 'A' });
    await expect(createUser({ email, passwordHash: 'h', name: 'B' })).rejects.toThrow(/已注册/);
  });

  it('countUsers increases after insert', async () => {
    const before = await countUsers();
    await createUser({ email: `cnt-${nanoid()}@test.local`, passwordHash: 'h', name: 'C' });
    const after = await countUsers();
    expect(after).toBe(before + 1);
  });

  it('updateUserPassword changes hash', async () => {
    const u = await createUser({ email: `pw-${nanoid()}@test.local`, passwordHash: 'old', name: 'P' });
    expect(await updateUserPassword(u.id, 'new-hash')).toBe(true);
    const reread = await findUserById(u.id);
    expect(reread?.password_hash).toBe('new-hash');
  });

  it('updateUserPassword returns false for missing user', async () => {
    expect(await updateUserPassword('ghost-' + nanoid(), 'x')).toBe(false);
  });

  // v9.0.2b — Stripe webhook 订阅落库 (只写真实列, 无 phantom updated_at)
  it('updateUserSubscription writes tier/status/customer + COALESCE keeps old customer', async () => {
    const u = await createUser({ email: `sub-${nanoid()}@test.local`, passwordHash: 'h', name: 'S' });
    expect(await updateUserSubscription(u.id, { tier: 'pro', status: 'active', stripeCustomerId: 'cus_123' })).toBe(true);
    expect((await findUserById(u.id))?.subscription_tier).toBe('pro');
    // status + customer id 不在 UserRow COLS, 用 driver 读
    const raw = await getDbDriver().get<{ subscription_status: string; stripe_customer_id: string }>(
      'SELECT subscription_status, stripe_customer_id FROM users WHERE id = ?', [u.id]);
    expect(raw?.subscription_status).toBe('active');
    expect(raw?.stripe_customer_id).toBe('cus_123');
    // 后续事件不带 customer id → COALESCE 保留旧值
    await updateUserSubscription(u.id, { tier: 'free', status: 'canceled', stripeCustomerId: null });
    const raw2 = await getDbDriver().get<{ subscription_tier: string; stripe_customer_id: string }>(
      'SELECT subscription_tier, stripe_customer_id FROM users WHERE id = ?', [u.id]);
    expect(raw2?.subscription_tier).toBe('free');
    expect(raw2?.stripe_customer_id).toBe('cus_123'); // 保留
  });

  it('updateUserSubscription returns false for missing user', async () => {
    expect(await updateUserSubscription('ghost-' + nanoid(), { tier: 'pro', status: 'active' })).toBe(false);
  });
});
