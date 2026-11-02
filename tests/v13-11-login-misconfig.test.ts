/**
 * v13.11 — 服务端配错时,登录/注册直接说原因(503),不再 500。
 *
 * NAS 实测的三种「首页正常、登录 500」:
 *   ① 没设 JWT_SECRET、② JWT_SECRET 是 .env.example 的公开占位串 —— 签令牌时抛错,密码对才 500;
 *   ③ 数据目录属主不是容器用户 —— lib/db.ts 顶层开库失败,所有 import 它的模块加载失败,密码对错都 500;
 *      开了 PIPELINE_QUEUE=1 时 instrumentation 一起失败,整站 500。
 *
 * 两侧都守:配错 → 503 + 原因 + 修法(且不泄露路径/异常原文/密钥值);配对 → 200;密码错 → 401;限流 → 429。
 * 「数据库打不开」用两种方式造:进程内 mock better-sqlite3 抛 SQLITE_CANTOPEN(走真路由),
 * 再起一个子进程对一个**真的不可写目录**导入 lib/db.ts(走真文件系统)—— 夹具要像真东西。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '@/lib/db';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { GET as meHandler } from '@/app/api/auth/me/route';
import { signToken } from '@/app/api/auth/lib';
import { _resetRateLimits } from '@/lib/rate-limit';
import {
  misconfigReason,
  JwtSecretError,
  DbUnavailableError,
  MISCONFIG_MESSAGES,
  withMisconfigGuard,
  unavailableDb,
} from '@/lib/server-misconfig';

const STRONG = () => crypto.randomBytes(32).toString('hex');
const PLACEHOLDER = 'change_me_to_a_random_32_char_string';
const BASE = 'http://192.168.1.10:3100';

const EMAIL = 'test-v13-11-misconfig@test.local';
const PASSWORD = 'misconfig-' + crypto.randomBytes(4).toString('hex');
const USER_ID = 'test-v13-11-misconfig-user';

function post(pathname: string, body: unknown): Request {
  return new Request(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify(body),
  });
}
const loginReq = (password = PASSWORD, email = EMAIL) => post('/api/auth/login', { email, password });

async function read(res: Response) {
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, text, body, setCookie: res.headers.get('set-cookie') };
}

/** 对外响应里绝不能出现的东西:路径、异常原文、密钥值。 */
function expectNoLeak(text: string, secret?: string) {
  expect(text).not.toMatch(/Sqlite|SQLITE_|qfmj|\.db\b|\/app\/|unable to open|stack|at \w+ \(/i);
  expect(text).not.toContain(process.cwd());
  if (secret) expect(text).not.toContain(secret);
}

beforeAll(() => {
  db.prepare('DELETE FROM users WHERE id = ? OR email = ?').run(USER_ID, EMAIL);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(USER_ID, EMAIL, bcrypt.hashSync(PASSWORD, 4), 'Misconfig', 'member', 'zh', new Date().toISOString());
});
afterAll(() => {
  db.prepare('DELETE FROM users WHERE id = ? OR email = ?').run(USER_ID, EMAIL);
});

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JWT_SECRET', STRONG());
  vi.stubEnv('COOKIE_SECURE', '');
  vi.stubEnv('BETA_INVITE_REQUIRED', 'false');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  _resetRateLimits();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('v13.11 · misconfigReason:只认带标记的错误', () => {
  it('JWT 两种原因原样带出', () => {
    expect(misconfigReason(new JwtSecretError('jwt_secret_missing', 'x'))).toBe('jwt_secret_missing');
    expect(misconfigReason(new JwtSecretError('jwt_secret_weak', 'x'))).toBe('jwt_secret_weak');
  });

  it('DbUnavailableError → db_unavailable', () => {
    expect(misconfigReason(new DbUnavailableError('SQLITE_CANTOPEN', 'unable to open database file'))).toBe('db_unavailable');
  });

  it('better-sqlite3 原样抛的「写不进」类错误码 → db_unavailable(库文件只读时注册会撞上)', () => {
    for (const code of ['SQLITE_CANTOPEN', 'SQLITE_READONLY', 'SQLITE_READONLY_DIRECTORY', 'SQLITE_PERM']) {
      expect(misconfigReason(Object.assign(new Error('x'), { code })), code).toBe('db_unavailable');
    }
  });

  it('其他错误一律不认(照旧 500,不把代码 bug 伪装成配置问题)', () => {
    for (const code of ['SQLITE_BUSY', 'SQLITE_CONSTRAINT_UNIQUE', 'ECONNREFUSED', 'EACCES']) {
      expect(misconfigReason(Object.assign(new Error('x'), { code })), code).toBeNull();
    }
    expect(misconfigReason(new Error('[auth] JWT_SECRET 未设置'))).toBeNull(); // 没有标记,光文案不算
    expect(misconfigReason({ code: 'JWT_SECRET_INVALID', reason: 'bogus' })).toBeNull();
    expect(misconfigReason(null)).toBeNull();
    expect(misconfigReason('DB_UNAVAILABLE')).toBeNull();
  });

  it('文案:JWT 两种都以「服务端没配置 JWT_SECRET」开头并给出 openssl 命令;数据库给 chown 与命名卷', () => {
    expect(MISCONFIG_MESSAGES.jwt_secret_missing.startsWith('服务端没配置 JWT_SECRET')).toBe(true);
    expect(MISCONFIG_MESSAGES.jwt_secret_weak.startsWith('服务端没配置 JWT_SECRET')).toBe(true);
    expect(MISCONFIG_MESSAGES.jwt_secret_missing).toContain('openssl rand -hex 32');
    expect(MISCONFIG_MESSAGES.jwt_secret_weak).toContain('openssl rand -hex 32');
    expect(MISCONFIG_MESSAGES.db_unavailable).toContain('chown -R 1001:1001');
    expect(MISCONFIG_MESSAGES.db_unavailable).toContain('命名卷');
    for (const m of Object.values(MISCONFIG_MESSAGES)) expectNoLeak(m);
  });
});

describe('v13.11 · withMisconfigGuard / unavailableDb', () => {
  it('配错 → 503 JSON;其他异常原样抛出', async () => {
    const guarded = withMisconfigGuard('t', async (e: unknown) => { throw e; });
    const r = await read(await guarded(new JwtSecretError('jwt_secret_missing', 'x')));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ code: 'server_misconfigured', reason: 'jwt_secret_missing', message: MISCONFIG_MESSAGES.jwt_secret_missing });
    const boom = new Error('boom');
    await expect(guarded(boom)).rejects.toBe(boom);
  });

  it('替身 db:任何使用都抛 DB_UNAVAILABLE;then / Symbol 放行(Promise 与 console.log 不炸)', async () => {
    const fake = unavailableDb<{ prepare: (s: string) => unknown }>('SQLITE_CANTOPEN', 'unable to open database file');
    expect(() => fake.prepare('SELECT 1')).toThrow(expect.objectContaining({ code: 'DB_UNAVAILABLE', sqliteCode: 'SQLITE_CANTOPEN' }));
    expect(await Promise.resolve(fake)).toBe(fake); // lib/db-driver 就是 import('./db').then(m => m.db)
    expect(() => String((fake as any)[Symbol.toPrimitive])).not.toThrow();
  });
});

describe('v13.11 · 登录:配置正确(对照组)', () => {
  it('密码对 → 200 + 令牌 + 会话 cookie', async () => {
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(200);
    expect(typeof r.body.token).toBe('string');
    expect(r.setCookie).toMatch(/^qfmj-session=/);
  });

  it('密码错 → 401(不变)', async () => {
    const r = await read(await loginHandler(loginReq('wrong-password')));
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ message: 'Invalid credentials' });
  });

  it('开发环境不设 JWT_SECRET → 照旧能登录(进程级随机密钥),不被 503 误伤', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('JWT_SECRET', '');
    expect((await loginHandler(loginReq())).status).toBe(200);
  });
});

describe('v13.11 · 登录:JWT_SECRET 配错 → 503', () => {
  it('没设:密码对 → 503 jwt_secret_missing,文案说「服务端没配置 JWT_SECRET」,不发令牌不发 cookie', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ code: 'server_misconfigured', reason: 'jwt_secret_missing', message: MISCONFIG_MESSAGES.jwt_secret_missing });
    expect(r.body.message).toContain('服务端没配置 JWT_SECRET');
    expect(r.setCookie).toBeNull();
    expectNoLeak(r.text);
  });

  it('没设:密码错也 503 —— 不再「密码错 401、密码对 500」让人以为自己记错了密码', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await loginHandler(loginReq('wrong-password')));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('jwt_secret_missing');
  });

  it('公开占位串(含大小写/空格变体)→ 503 jwt_secret_weak,响应里不回显那串值', async () => {
    for (const v of [PLACEHOLDER, `  ${PLACEHOLDER.toUpperCase()} `, 'changeme']) {
      vi.stubEnv('JWT_SECRET', v);
      const r = await read(await loginHandler(loginReq()));
      expect(r.status, v).toBe(503);
      expect(r.body.reason).toBe('jwt_secret_weak');
      expect(r.body.message.startsWith('服务端没配置 JWT_SECRET')).toBe(true);
      expectNoLeak(r.text, v.trim());
    }
  });

  it('服务端日志留原文(排障文档教用户 grep「JWT_SECRET 未设置」)', async () => {
    vi.stubEnv('JWT_SECRET', '');
    await loginHandler(loginReq());
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('503 server_misconfigured/jwt_secret_missing');
    expect(logged).toContain('JWT_SECRET 未设置');
  });

  it('限流照旧 429(先于配置检查)', async () => {
    vi.stubEnv('VITEST', ''); // isRateLimitActive 在测试环境默认关
    vi.stubEnv('JWT_SECRET', '');
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await loginHandler(loginReq('x', 'ratelimit-v13-11@test.local'))).status;
    expect(last).toBe(429);
  });

  it('缺字段照旧 400', async () => {
    vi.stubEnv('JWT_SECRET', '');
    expect((await loginHandler(post('/api/auth/login', { email: EMAIL }))).status).toBe(400);
  });
});

describe('v13.11 · 注册:JWT_SECRET 配错 → 503,且不留半个账号', () => {
  const NEW_EMAIL = 'test-v13-11-register@test.local';
  const cleanup = () => db.prepare('DELETE FROM users WHERE email = ?').run(NEW_EMAIL);
  beforeEach(cleanup);
  afterAll(cleanup);

  it('没设 → 503 jwt_secret_missing,users 表里没有这个邮箱(此前先插行再炸,再注册就「已被注册」)', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await registerHandler(post('/api/auth/register', { email: NEW_EMAIL, password: 'pw-123456', name: 'N' })));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('jwt_secret_missing');
    expect(db.prepare('SELECT id FROM users WHERE email = ?').get(NEW_EMAIL)).toBeUndefined();
  });

  it('占位串 → 503 jwt_secret_weak', async () => {
    vi.stubEnv('JWT_SECRET', PLACEHOLDER);
    const r = await read(await registerHandler(post('/api/auth/register', { email: NEW_EMAIL, password: 'pw-123456', name: 'N' })));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('jwt_secret_weak');
  });

  it('对照:配置正确 → 201,行已写入', async () => {
    const r = await read(await registerHandler(post('/api/auth/register', { email: NEW_EMAIL, password: 'pw-123456', name: 'N' })));
    expect(r.status).toBe(201);
    expect(db.prepare('SELECT id FROM users WHERE email = ?').get(NEW_EMAIL)).toBeTruthy();
  });
});

describe('v13.11 · 注册:库文件只读(写的时候才失败)→ 503;别的写库错误照旧 500', () => {
  async function registerWith(txError: Error) {
    vi.resetModules();
    vi.doMock('@/lib/db-driver', () => ({
      getDbDriver: () => ({
        dialect: 'sqlite',
        get: async () => null,
        query: async () => [],
        run: async () => ({ changes: 0 }),
        transaction: async () => { throw txError; },
      }),
    }));
    try {
      const { POST } = await import('@/app/api/auth/register/route');
      return await read(await POST(post('/api/auth/register', { email: 'ro@test.local', password: 'pw-123456', name: 'N' })));
    } finally {
      vi.doUnmock('@/lib/db-driver');
      vi.resetModules();
    }
  }

  it('SQLITE_READONLY → 503 db_unavailable(此前是笼统的「注册失败」500)', async () => {
    const r = await registerWith(Object.assign(new Error('attempt to write a readonly database'), { code: 'SQLITE_READONLY' }));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unavailable');
    expectNoLeak(r.text);
  });

  it('对照:普通写库失败 → 500「注册失败」不变', async () => {
    const r = await registerWith(new Error('boom'));
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/注册失败/);
  });
});

describe('v13.11 · 数据库打不开(进程内:better-sqlite3 抛 SQLITE_CANTOPEN,走真路由)', () => {
  type Mods = {
    dbMod: typeof import('@/lib/db');
    login: typeof import('@/app/api/auth/login/route');
    register: typeof import('@/app/api/auth/register/route');
    me: typeof import('@/app/api/auth/me/route');
    auth: typeof import('@/app/api/auth/lib');
    health: typeof import('@/app/api/health/route');
  };
  let m: Mods;
  let bootLog = '';

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => ({
      default: class {
        constructor() {
          throw Object.assign(new Error('unable to open database file'), { code: 'SQLITE_CANTOPEN' });
        }
      },
    }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 模块加载本身不许失败 —— 这正是此前「密码对错都 500」的根因
    m = {
      dbMod: await import('@/lib/db'),
      login: await import('@/app/api/auth/login/route'),
      register: await import('@/app/api/auth/register/route'),
      me: await import('@/app/api/auth/me/route'),
      auth: await import('@/app/api/auth/lib'),
      health: await import('@/app/api/health/route'),
    };
    bootLog = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    errSpy.mockRestore();
  });
  afterAll(() => {
    vi.doUnmock('better-sqlite3');
    vi.resetModules();
  });

  it('lib/db 照常加载,报出原因;开机日志一行说清原因和修法', () => {
    expect(m.dbMod.dbUnavailable()).toMatchObject({ code: 'DB_UNAVAILABLE', sqliteCode: 'SQLITE_CANTOPEN' });
    expect(() => m.dbMod.db.prepare('SELECT 1')).toThrow(expect.objectContaining({ code: 'DB_UNAVAILABLE' }));
    expect(bootLog).toContain('[db] 数据库打不开(SQLITE_CANTOPEN: unable to open database file)');
    expect(bootLog).toContain('1001:1001');
  });

  it('登录:密码对错都 503 db_unavailable,文案给 chown / 命名卷,不泄露路径和异常原文', async () => {
    for (const pw of [PASSWORD, 'wrong-password']) {
      const r = await read(await m.login.POST(loginReq(pw)));
      expect(r.status, pw).toBe(503);
      expect(r.body).toEqual({ code: 'server_misconfigured', reason: 'db_unavailable', message: MISCONFIG_MESSAGES.db_unavailable });
      expectNoLeak(r.text);
    }
  });

  it('注册 → 503 db_unavailable', async () => {
    const r = await read(await m.register.POST(post('/api/auth/register', { email: 'x@test.local', password: 'pw-123456', name: 'N' })));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unavailable');
  });

  it('/api/auth/me 带着旧令牌(页面一加载就会调)→ 503,不是 500', async () => {
    const token = m.auth.signToken({ id: 'someone', role: 'member' });
    const r = await read(await m.me.GET(new Request(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unavailable');
  });

  it('/api/health:503 db_unavailable,鉴权单独判定为 ok(此前只能标 unknown)', async () => {
    const res = await m.health.GET();
    const r = await read(res);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, checks: { db: 'fail', auth: 'ok' }, reasons: ['db_unavailable'] });
    expectNoLeak(r.text);
  });

  it('/api/health:库打不开 + 没设 JWT_SECRET → 两个原因一次报全', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await m.health.GET());
    expect(r.body.reasons).toEqual(['db_unavailable', 'jwt_secret_missing']);
    expect(r.body.checks).toEqual({ db: 'fail', auth: 'fail' });
  });

  it('库打不开 + 没设 JWT_SECRET 时登录先报密钥(检查在查库之前)', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await m.login.POST(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('jwt_secret_missing');
  });
});

describe('v13.11 · /api/health 原因代码与登录同一套', () => {
  async function hit() {
    const { GET } = await import('@/app/api/health/route');
    return read(await GET());
  }
  it('没设 → jwt_secret_missing;占位串 → jwt_secret_weak;配好 → 200', async () => {
    vi.stubEnv('JWT_SECRET', '');
    expect((await hit()).body.reasons).toEqual(['jwt_secret_missing']);
    vi.stubEnv('JWT_SECRET', PLACEHOLDER);
    const weak = await hit();
    expect(weak.body.reasons).toEqual(['jwt_secret_weak']);
    expectNoLeak(weak.text, PLACEHOLDER);
    vi.stubEnv('JWT_SECRET', STRONG());
    const ok = await hit();
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, checks: { db: 'ok', auth: 'ok' } });
  });
});

describe('v13.11 · instrumentation:库打不开时降级,不拖垮整站', () => {
  const ensurePipelineWorker = vi.fn();
  const loadModelOverridesIntoEnv = vi.fn(async () => 0);
  const scheduleLegacyAspectRepair = vi.fn();

  async function boot(dbError: Error | null, workerThrows = false, dialect: 'sqlite' | 'postgres' = 'sqlite') {
    vi.resetModules();
    vi.doMock('@/lib/db-driver', () => ({ getDbDriver: () => ({ dialect }) }));
    ensurePipelineWorker.mockReset();
    if (workerThrows) ensurePipelineWorker.mockImplementation(() => { throw new Error('worker boom'); });
    loadModelOverridesIntoEnv.mockClear();
    scheduleLegacyAspectRepair.mockClear();
    vi.doMock('@/lib/db', () => ({ dbUnavailable: () => dbError }));
    vi.doMock('@/lib/pipeline-worker', () => ({ ensurePipelineWorker }));
    vi.doMock('@/lib/model-overrides', () => ({ loadModelOverridesIntoEnv }));
    vi.doMock('@/lib/legacy-aspect-repair', () => ({ scheduleLegacyAspectRepair }));
    vi.doMock('@/lib/telemetry', () => ({ initSentry: async () => {} }));
    vi.doMock('@/lib/server-proxy', () => ({ installServerProxy: async () => null }));
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('PIPELINE_QUEUE', '1');
    try {
      const { register } = await import('@/instrumentation');
      await register();
    } finally {
      for (const id of ['@/lib/db', '@/lib/db-driver', '@/lib/pipeline-worker', '@/lib/model-overrides', '@/lib/legacy-aspect-repair', '@/lib/telemetry', '@/lib/server-proxy']) vi.doUnmock(id);
      vi.resetModules();
    }
  }

  it('库打不开 + PIPELINE_QUEUE=1:register() 正常返回,不启 worker、不跑模型覆盖重放,日志一行说明', async () => {
    await expect(boot(new DbUnavailableError('SQLITE_CANTOPEN', 'unable to open database file'))).resolves.toBeUndefined();
    expect(ensurePipelineWorker).not.toHaveBeenCalled();
    expect(loadModelOverridesIntoEnv).not.toHaveBeenCalled();
    // v13.3 的旧库画幅修复同样要库开得成(打不开时排上去只会 15 秒后再记一行「自动修复失败」)
    expect(scheduleLegacyAspectRepair).not.toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[instrumentation] 数据库打不开');
  });

  it('对照:库正常 → 启 worker、跑模型覆盖重放、排程旧库画幅修复', async () => {
    await boot(null);
    expect(ensurePipelineWorker).toHaveBeenCalledTimes(1);
    expect(loadModelOverridesIntoEnv).toHaveBeenCalledTimes(1);
    expect(scheduleLegacyAspectRepair).toHaveBeenCalledTimes(1);
  });

  it('DB_DRIVER=pg:本地 SQLite 打不开不连累 PG 上的 worker 和模型覆盖', async () => {
    await boot(new DbUnavailableError('SQLITE_CANTOPEN', 'unable to open database file'), false, 'postgres');
    expect(ensurePipelineWorker).toHaveBeenCalledTimes(1);
    expect(loadModelOverridesIntoEnv).toHaveBeenCalledTimes(1);
    expect(scheduleLegacyAspectRepair).toHaveBeenCalledTimes(1);
  });

  it('worker 启动本身抛错 → 只记日志,register() 不抛', async () => {
    await expect(boot(null, true)).resolves.toBeUndefined();
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('任务队列 worker 开机启动失败');
  });
});

describe('v13.11 · 真文件系统:数据目录对进程不可写(子进程导入 lib/db.ts)', () => {
  const REPO = process.cwd();
  /** 在独立 cwd 起真进程:导入 lib/db + user-repo,走一遍登录要用的查库链路 */
  function probe(cwd: string): Record<string, unknown> {
    const script = `
      const db = await import(${JSON.stringify(path.join(REPO, 'lib/db.ts'))});
      const repo = await import(${JSON.stringify(path.join(REPO, 'lib/repos/user-repo.ts'))});
      const m = db.dbUnavailable ? db : db.default;
      const out = { loaded: true, unavailable: m.dbUnavailable()?.sqliteCode ?? null };
      try { m.db.prepare('SELECT 1').get(); out.prepare = 'ok'; } catch (e) { out.prepare = e.code; }
      const r = repo.findUserByEmail ? repo : repo.default;
      try { await r.findUserByEmail('nobody@test.local'); out.repo = 'ok'; } catch (e) { out.repo = e.code; }
      console.log('PROBE=' + JSON.stringify(out));
    `;
    let res: string;
    try {
      res = execFileSync('npx', ['tsx', '--input-type=module', '-e', script], {
        cwd,
        env: { ...process.env, VITEST: '', NODE_ENV: 'production', JWT_SECRET: STRONG(), SEED_DEMO_USER: '0' },
        encoding: 'utf-8',
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // 只留错误行、去掉子进程的堆栈行:vitest 会顺着消息里的「at <文件>」去读 source map,
      // 读到 better_sqlite3.node 这种二进制就自己崩成 Test Run Error,反而看不出是哪条红了
      const x = e as { status?: number | null; stderr?: string };
      const errLines = String(x.stderr ?? '').split('\n').filter((l) => l.trim() && !/^\s*at /.test(l)).slice(-8).join('\n');
      throw new Error(`子进程导入 lib/db.ts 失败(退出码 ${x.status}),模块加载期就抛了:\n${errLines}`);
    }
    const line = res.split('\n').find((l) => l.startsWith('PROBE='));
    if (!line) throw new Error(`子进程没报结果:\n${res.slice(-400)}`);
    return JSON.parse(line.slice('PROBE='.length));
  }

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qfmj-v13-11-')));
  afterAll(() => {
    try { fs.chmodSync(path.join(tmp, 'ro', 'data'), 0o755); } catch { /* 没建成 */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('不可写(0555,模拟 NAS 属主不对)→ 模块照常加载,查库抛 DB_UNAVAILABLE(SQLITE_CANTOPEN)', () => {
    // root 无视权限位,这条在 root 下没有意义;CI(runner 用户)与本机都不是 root
    expect(process.getuid?.(), '以 root 跑时目录权限拦不住,本用例无法造出故障').not.toBe(0);
    const dir = path.join(tmp, 'ro');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.chmodSync(path.join(dir, 'data'), 0o555);
    expect(probe(dir)).toEqual({ loaded: true, unavailable: 'SQLITE_CANTOPEN', prepare: 'DB_UNAVAILABLE', repo: 'DB_UNAVAILABLE' });
  }, 180000);

  it('对照:目录可写 → 正常开库,查库成功', () => {
    const dir = path.join(tmp, 'rw');
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    expect(probe(dir)).toEqual({ loaded: true, unavailable: null, prepare: 'ok', repo: 'ok' });
    expect(fs.existsSync(path.join(dir, 'data', 'qfmj.db'))).toBe(true);
  }, 180000);
});

describe('v13.11 · 文档与新行为一致', () => {
  const docs = {
    'README.md': fs.readFileSync('README.md', 'utf-8'),
    'README.zh-CN.md': fs.readFileSync('README.zh-CN.md', 'utf-8'),
    'docs/DEPLOYMENT.md': fs.readFileSync('docs/DEPLOYMENT.md', 'utf-8'),
  };

  it('三份排障表都列出三个 reason 代码和登录页那句「服务端没配置 JWT_SECRET」', () => {
    for (const [name, src] of Object.entries(docs)) {
      for (const code of ['db_unavailable', 'jwt_secret_missing', 'jwt_secret_weak']) expect(src, `${name} 缺 ${code}`).toContain(code);
      expect(src, name).toContain('服务端没配置 JWT_SECRET');
    }
  });

  it('不再把「登录返回 500」写成现状(只允许作为 v13.11 之前的历史出现)', () => {
    expect(docs['README.md']).not.toMatch(/Login returns 500/);
    expect(docs['README.zh-CN.md']).not.toMatch(/登录却返回 500/);
    expect(docs['docs/DEPLOYMENT.md']).not.toMatch(/登录必 500|登录一律 500|所有认证接口 500/);
    expect(docs['docs/DEPLOYMENT.md'], '健康检查表不该再有 jwt_secret_invalid 这一行').not.toMatch(/\|\s*`503 … "reasons":\["jwt_secret_invalid"\]`/);
  });

  it('/api/health 文档列的原因代码就是代码里会出现的那些', () => {
    const health = fs.readFileSync('app/api/health/route.ts', 'utf-8');
    const rows = [...docs['docs/DEPLOYMENT.md'].matchAll(/`503 … "reasons":\["(\w+)"\]`/g)].map((m) => m[1]);
    // v13.12 加了 db_unreachable(DB_DRIVER=pg 连不上),见 tests/v13-12-login-pg-misconfig
    expect(rows.sort()).toEqual(['db_not_writable', 'db_unavailable', 'db_unreachable', 'jwt_secret_missing', 'jwt_secret_weak']);
    for (const r of ['db_not_writable', 'db_unavailable', 'db_unreachable']) expect(health).toContain(`'${r}'`);
  });
});
