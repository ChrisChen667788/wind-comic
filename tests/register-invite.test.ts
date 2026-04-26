/**
 * 注册接口 Beta 邀请码门禁集成测试 (v2.0 Sprint 0 D4)
 *
 * 直接调用 route handler，不起 Next dev server。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { createInviteCode, getInviteCode } from '@/lib/invite-codes';

const TEST_EMAIL_PREFIX = 'test-reg-invite-';

function mkReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // 强制启用门禁
  process.env.BETA_INVITE_REQUIRED = 'true';

  // 准备一个管理员用户作为码签发者（FK 需要）
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, locale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('test-reg-admin', 'test-reg-admin@test.local', 'x', 'admin', 'admin', 'zh', new Date().toISOString());
});

afterEach(() => {
  // 清理测试数据。由于 vitest 并行执行多个测试文件时共用同一 SQLite 文件，
  // 这里临时关 FK 检查避免误杀并行测试插入的中间状态数据。
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("DELETE FROM invite_codes WHERE source = 'TEST_REG'").run();
    db.prepare("DELETE FROM users WHERE email LIKE ?").run(`${TEST_EMAIL_PREFIX}%`);
    db.prepare("DELETE FROM users WHERE id = 'test-reg-admin'").run();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

describe('POST /api/auth/register (invite gate)', () => {
  it('无邀请码 → 403 INVITE_REQUIRED', async () => {
    const res = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}no-code@test.local`,
        password: 'pw12345',
        name: 'NoCode',
      }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('INVITE_REQUIRED');
  });

  it('错误的邀请码 → 403 NOT_FOUND', async () => {
    const res = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}bad@test.local`,
        password: 'pw12345',
        name: 'Bad',
        inviteCode: 'NONEXISTENTXXX',
      }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('NOT_FOUND');
  });

  it('有效邀请码 → 201 + 码状态变 used', async () => {
    createInviteCode({ code: 'BETAOK001', createdBy: 'test-reg-admin', source: 'TEST_REG' });
    const res = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}ok@test.local`,
        password: 'pw12345',
        name: 'OK',
        inviteCode: 'BETAOK001',
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.token).toBeTruthy();
    expect(data.user.email).toBe(`${TEST_EMAIL_PREFIX}ok@test.local`);

    // 码被标记为 used
    const invite = getInviteCode('BETAOK001');
    expect(invite?.status).toBe('used');
    expect(invite?.usedByUserId).toBe(data.user.id);
  });

  it('同一邀请码二次注册 → 403 ALREADY_USED', async () => {
    createInviteCode({ code: 'BETAONCE1', createdBy: 'test-reg-admin', source: 'TEST_REG' });

    const r1 = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}once-a@test.local`,
        password: 'pw12345',
        name: 'A',
        inviteCode: 'BETAONCE1',
      }),
    );
    expect(r1.status).toBe(201);

    const r2 = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}once-b@test.local`,
        password: 'pw12345',
        name: 'B',
        inviteCode: 'BETAONCE1',
      }),
    );
    expect(r2.status).toBe(403);
    expect((await r2.json()).code).toBe('ALREADY_USED');
  });

  it('BETA_INVITE_REQUIRED=false 时无需邀请码', async () => {
    process.env.BETA_INVITE_REQUIRED = 'false';
    const res = await registerHandler(
      mkReq({
        email: `${TEST_EMAIL_PREFIX}open@test.local`,
        password: 'pw12345',
        name: 'Open',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('缺字段 → 400', async () => {
    const res = await registerHandler(mkReq({ email: 'x@test.local' }));
    expect(res.status).toBe(400);
  });
});
