/**
 * v9.3.4 — lib/budget-enforce 单测 (用户预算持久化 + 当月花费 + assertBudget 裁决).
 * 用真 SQLite 种 user(含 budget 列) + cost_log。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { getUserBudget, setUserBudget, monthSpentCny, assertBudget } from '@/lib/budget-enforce';

const U = 'bg_test_user';
let _n = 0;

function seedUser() {
  db.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at) VALUES (?,?,?,?,?,?)`,
  ).run(U, `${U}@x.com`, 'h', 'T', 'creator', new Date().toISOString());
}
function seedCost(cost: number, when: string) {
  db.prepare(
    `INSERT INTO cost_log (id, user_id, project_id, engine, resolution, duration_sec, cost_cny, metadata, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(`bgc_${++_n}`, U, 'p', 'kling3', '720p', 5, cost, '{}', when);
}
function clean() {
  db.prepare('DELETE FROM cost_log WHERE user_id = ?').run(U);
  db.prepare('DELETE FROM users WHERE id = ?').run(U);
}

beforeEach(() => { clean(); seedUser(); });
afterEach(() => { clean(); });

describe('v9.3.4 · budget-enforce', () => {
  it('setUserBudget / getUserBudget 往返; null 与 <=0 清除', async () => {
    await setUserBudget(U, { capCny: 100, hardCapCny: 150 });
    expect(await getUserBudget(U)).toEqual({ capCny: 100, hardCapCny: 150 });
    await setUserBudget(U, { capCny: null });
    expect(await getUserBudget(U)).toEqual({ capCny: null, hardCapCny: null });
    await setUserBudget(U, { capCny: 0 });
    expect((await getUserBudget(U)).capCny).toBeNull();
  });

  it('monthSpentCny 只算当月, 跨月不计', async () => {
    const now = new Date();
    seedCost(3, now.toISOString());
    seedCost(2, now.toISOString());
    seedCost(99, new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString()); // 去年同月
    expect(await monthSpentCny(U, now)).toBe(5);
  });

  it('assertBudget: 无预算 → 放行 none', async () => {
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(true);
    expect(r.guard.level).toBe('none');
  });

  it('assertBudget: 花费低于阈值 → ok 放行', async () => {
    await setUserBudget(U, { capCny: 100 });
    seedCost(30, new Date().toISOString());
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(true);
    expect(r.guard.level).toBe('ok');
  });

  it('assertBudget: 当月已达硬上限(软=硬) → hard_block 拦', async () => {
    await setUserBudget(U, { capCny: 50 });
    seedCost(50, new Date().toISOString());
    const r = await assertBudget({ userId: U });
    expect(r.allow).toBe(false);
    expect(r.guard.level).toBe('hard_block');
  });

  it('assertBudget: pending 会越硬上限 → 拦', async () => {
    await setUserBudget(U, { capCny: 100, hardCapCny: 100 });
    seedCost(90, new Date().toISOString());
    const r = await assertBudget({ userId: U, pendingCostCny: 20 }); // 90+20=110 > 100
    expect(r.allow).toBe(false);
    expect(r.guard.projectedAfterCny).toBe(110);
  });
});
