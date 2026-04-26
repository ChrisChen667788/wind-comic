/**
 * Beta 邀请码 + 注册门禁单测 (v2.0 Sprint 0 D4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createInviteCode,
  generateRandomCode,
  generateInviteCodes,
  getInviteCode,
  listInviteCodes,
  validateInviteCode,
  consumeInviteCode,
  revokeInviteCode,
  isInviteRequired,
} from '@/lib/invite-codes';
import {
  createWaitlistEntry,
  findWaitlistByEmail,
  approveWaitlistEntry,
  rejectWaitlistEntry,
} from '@/lib/waitlist';

const ADMIN_ID = 'test-admin-invite';

function seedUser(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, name, role, locale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `${id}@test.local`, 'x', id, 'member', 'zh', new Date().toISOString());
}

beforeEach(() => {
  seedUser(ADMIN_ID);
  // 预置被邀请码消费的测试用户，满足 FK 约束
  for (let i = 1; i <= 5; i++) seedUser(`test-invite-user-${i}`);
});

afterEach(() => {
  // 并行测试时共用同一 SQLite 文件，cleanup 期间暂时关 FK 检查
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("DELETE FROM invite_codes WHERE source = 'TEST' OR created_by = ?").run(ADMIN_ID);
    db.prepare("DELETE FROM waitlist WHERE email LIKE '%@test.local'").run();
    db.prepare("DELETE FROM users WHERE id LIKE 'test-admin-invite%' OR id LIKE 'test-invite-user-%'").run();
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

describe('generateRandomCode', () => {
  it('格式为 BETA 前缀 + 6 位', () => {
    const c = generateRandomCode();
    expect(c).toMatch(/^BETA[2-9A-HJKMNP-Z]{6}$/);
  });

  it('自定义前缀生效', () => {
    const c = generateRandomCode('PROMO');
    expect(c.startsWith('PROMO')).toBe(true);
    expect(c.length).toBe(11);
  });

  it('不包含易混字符 0/O/1/I/L', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateRandomCode();
      expect(c.slice(4)).not.toMatch(/[01OIL]/);
    }
  });
});

describe('createInviteCode / list / get', () => {
  it('显式指定 code 创建', () => {
    const invite = createInviteCode({ code: 'BETATEST1', createdBy: ADMIN_ID, source: 'TEST' });
    expect(invite.code).toBe('BETATEST1');
    expect(invite.status).toBe('unused');
    expect(invite.source).toBe('TEST');
  });

  it('未指定 code 随机生成且唯一', () => {
    const a = createInviteCode({ createdBy: ADMIN_ID, source: 'TEST' });
    const b = createInviteCode({ createdBy: ADMIN_ID, source: 'TEST' });
    expect(a.code).not.toBe(b.code);
  });

  it('批量生成 5 个', () => {
    const codes = generateInviteCodes(5, ADMIN_ID, 'TEST');
    expect(codes).toHaveLength(5);
    const uniq = new Set(codes.map(c => c.code));
    expect(uniq.size).toBe(5);
  });

  it('getInviteCode 忽略大小写', () => {
    createInviteCode({ code: 'BETAUPPER', createdBy: ADMIN_ID, source: 'TEST' });
    expect(getInviteCode('betaupper')).not.toBeNull();
  });

  it('listInviteCodes 按 source 筛选', () => {
    generateInviteCodes(3, ADMIN_ID, 'TEST');
    const listed = listInviteCodes({ source: 'TEST' });
    expect(listed.length >= 3).toBe(true);
  });
});

describe('validateInviteCode', () => {
  it('空字符串 → INVALID', () => {
    expect(validateInviteCode('')).toEqual({ ok: false, error: 'INVALID' });
  });

  it('不存在 → NOT_FOUND', () => {
    expect(validateInviteCode('NOPE')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('已使用 → ALREADY_USED', () => {
    createInviteCode({ code: 'BETAUSED1', createdBy: ADMIN_ID, source: 'TEST' });
    // 手动改为 used
    db.prepare("UPDATE invite_codes SET status = 'used' WHERE code = 'BETAUSED1'").run();
    expect(validateInviteCode('BETAUSED1').error).toBe('ALREADY_USED');
  });

  it('过期 → EXPIRED', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createInviteCode({ code: 'BETAEXP1', createdBy: ADMIN_ID, source: 'TEST', expiresAt: past });
    expect(validateInviteCode('BETAEXP1').error).toBe('EXPIRED');
  });

  it('有效 → ok', () => {
    createInviteCode({ code: 'BETAGOOD1', createdBy: ADMIN_ID, source: 'TEST' });
    const r = validateInviteCode('BETAGOOD1');
    expect(r.ok).toBe(true);
    expect(r.invite?.code).toBe('BETAGOOD1');
  });
});

describe('consumeInviteCode', () => {
  it('正常消费 → used 且绑定 user', () => {
    createInviteCode({ code: 'BETACONS1', createdBy: ADMIN_ID, source: 'TEST' });
    const r = consumeInviteCode('BETACONS1', 'test-invite-user-1');
    expect(r.ok).toBe(true);
    expect(r.invite?.status).toBe('used');
    expect(r.invite?.usedByUserId).toBe('test-invite-user-1');
    expect(r.invite?.usedAt).toBeTruthy();
  });

  it('同一码消费两次 → 第二次 ALREADY_USED', () => {
    createInviteCode({ code: 'BETACONS2', createdBy: ADMIN_ID, source: 'TEST' });
    const first = consumeInviteCode('BETACONS2', 'test-invite-user-1');
    const second = consumeInviteCode('BETACONS2', 'test-invite-user-2');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error).toBe('ALREADY_USED');
  });

  it('过期码消费 → EXPIRED 且自动标记 expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createInviteCode({
      code: 'BETACONS3',
      createdBy: ADMIN_ID,
      source: 'TEST',
      expiresAt: past,
    });
    const r = consumeInviteCode('BETACONS3', 'test-invite-user-3');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('EXPIRED');
    expect(getInviteCode('BETACONS3')?.status).toBe('expired');
  });

  it('前后空白容忍 + 大小写容忍', () => {
    createInviteCode({ code: 'BETALOWER', createdBy: ADMIN_ID, source: 'TEST' });
    const r = consumeInviteCode('  betalower  ', 'test-invite-user-4');
    expect(r.ok).toBe(true);
  });
});

describe('revokeInviteCode', () => {
  it('未使用码可撤销', () => {
    createInviteCode({ code: 'BETAREV1', createdBy: ADMIN_ID, source: 'TEST' });
    expect(revokeInviteCode('BETAREV1')).toBe(true);
    expect(getInviteCode('BETAREV1')?.status).toBe('revoked');
  });

  it('已撤销后 validate 返回 REVOKED', () => {
    createInviteCode({ code: 'BETAREV2', createdBy: ADMIN_ID, source: 'TEST' });
    revokeInviteCode('BETAREV2');
    expect(validateInviteCode('BETAREV2').error).toBe('REVOKED');
  });

  it('已使用码无法撤销', () => {
    createInviteCode({ code: 'BETAREV3', createdBy: ADMIN_ID, source: 'TEST' });
    consumeInviteCode('BETAREV3', 'test-invite-user-5');
    expect(revokeInviteCode('BETAREV3')).toBe(false);
  });
});

describe('isInviteRequired', () => {
  it('默认 true', () => {
    const orig = process.env.BETA_INVITE_REQUIRED;
    delete process.env.BETA_INVITE_REQUIRED;
    expect(isInviteRequired()).toBe(true);
    if (orig !== undefined) process.env.BETA_INVITE_REQUIRED = orig;
  });

  it('BETA_INVITE_REQUIRED=false → false', () => {
    const orig = process.env.BETA_INVITE_REQUIRED;
    process.env.BETA_INVITE_REQUIRED = 'false';
    expect(isInviteRequired()).toBe(false);
    if (orig !== undefined) process.env.BETA_INVITE_REQUIRED = orig;
    else delete process.env.BETA_INVITE_REQUIRED;
  });
});

// ──────────────────────────────────────────────────────────
// Waitlist
// ──────────────────────────────────────────────────────────

describe('waitlist', () => {
  it('create + find by email', () => {
    const e = createWaitlistEntry({
      email: 'WL1@test.local',
      purpose: 'for fun',
      source: 'landing',
    });
    expect(e.status).toBe('pending');
    expect(e.email).toBe('wl1@test.local'); // 小写化

    const found = findWaitlistByEmail('wl1@test.local');
    expect(found.length).toBeGreaterThan(0);
  });

  it('approveWaitlistEntry 生成码并绑定', () => {
    const e = createWaitlistEntry({ email: 'wl2@test.local', purpose: 'x' });
    const approved = approveWaitlistEntry(e.id, ADMIN_ID);
    expect(approved?.status).toBe('approved');
    expect(approved?.inviteCode).toBeTruthy();
    expect(approved?.approvedAt).toBeTruthy();

    // 生成的码能 validate 通过
    expect(validateInviteCode(approved!.inviteCode!).ok).toBe(true);
  });

  it('approveWaitlistEntry 对非 pending 状态抛错', () => {
    const e = createWaitlistEntry({ email: 'wl3@test.local', purpose: 'x' });
    approveWaitlistEntry(e.id, ADMIN_ID);
    expect(() => approveWaitlistEntry(e.id, ADMIN_ID)).toThrow(/Cannot approve/);
  });

  it('rejectWaitlistEntry', () => {
    const e = createWaitlistEntry({ email: 'wl4@test.local', purpose: 'x' });
    const r = rejectWaitlistEntry(e.id);
    expect(r?.status).toBe('rejected');
  });
});
