/**
 * v4.2.1 — 用户仓库 (async, 走 DbDriver).
 *
 * auth 域 PG 迁移试水: 用户读写全部通过异步 DbDriver, SQLite/PG 都能跑.
 * 这是"分模块异步化"策略的第一个模块 — 验证抽象层可用, 后续 projects/assets 照搬.
 *
 * 占位符统一 SQLite 风格 `?`, PG driver 自动翻 `$n`.
 *
 * 单测: tests/v4-2-1-db-driver.test.ts.
 */

import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  avatar_url: string | null;
  locale: string | null;
  subscription_tier: string;
  created_at: string;
}

const SELECT_COLS =
  'id, email, password_hash, name, role, avatar_url, locale, subscription_tier, created_at';

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return getDbDriver().get<UserRow>(
    `SELECT ${SELECT_COLS} FROM users WHERE email = ?`,
    [email],
  );
}

export async function findUserById(id: string): Promise<UserRow | null> {
  return getDbDriver().get<UserRow>(
    `SELECT ${SELECT_COLS} FROM users WHERE id = ?`,
    [id],
  );
}

export async function countUsers(): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(`SELECT COUNT(*) AS c FROM users`, []);
  return r?.c ?? 0;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role?: string;
  avatarUrl?: string | null;
  locale?: string;
}

/** 建用户. email 已存在则抛 (依赖 UNIQUE 约束). 返回新行. */
export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const driver = getDbDriver();
  const existing = await findUserByEmail(input.email);
  if (existing) throw new Error('该邮箱已注册');
  const id = nanoid();
  const createdAt = new Date().toISOString();
  await driver.run(
    `INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, subscription_tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'free', ?)`,
    [
      id, input.email, input.passwordHash, input.name,
      input.role || 'user', input.avatarUrl ?? null, input.locale || 'zh', createdAt,
    ],
  );
  const row = await findUserById(id);
  if (!row) throw new Error('createUser: 插入后读取失败');
  return row;
}

/** 改密码哈希 (找回密码 / 改密用). */
export async function updateUserPassword(id: string, passwordHash: string): Promise<boolean> {
  const r = await getDbDriver().run(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id]);
  return r.changes > 0;
}

/**
 * v9.0.2b: Stripe webhook 落订阅状态.
 * 只写真实存在的 3 列 (subscription_tier/status + stripe_customer_id);
 * stripeCustomerId 为空时 COALESCE 保留旧值 (首次 checkout 才带, 后续事件可能不带)。
 * (注: 旧实现还写 users.updated_at, 但该列 SQLite/PG 都没有, 整条 UPDATE 会报错 → 此处去掉, 顺带修历史 bug。)
 */
export async function updateUserSubscription(
  id: string,
  patch: { tier: string; status: string | null; stripeCustomerId?: string | null },
): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE users
       SET subscription_tier = ?,
           subscription_status = ?,
           stripe_customer_id = COALESCE(?, stripe_customer_id)
     WHERE id = ?`,
    [patch.tier, patch.status, patch.stripeCustomerId ?? null, id],
  );
  return r.changes > 0;
}
