/**
 * v13.12 — `DB_DRIVER=pg` 时 PostgreSQL 连不上 / 配错,登录也回 503 说原因(v13.11 只覆盖了 SQLite)。
 *
 * 此前 pg 的原始错误(ECONNREFUSED、28P01 密码错、3D000 库不存在……)一路抛到登录路由 → 裸 500;
 * /api/health 笼统报 db_unavailable,给的修法(chown 数据目录)对 PG 是错的。
 *
 * 两侧都守:
 *   - 连接 / 鉴权类失败 → 503 `db_unreachable` + PG 修法,响应里没有 DATABASE_URL 的任何片段(账号、密码、主机、端口、库名);
 *   - 连得上、SQL 本身出错(语法错 42601、唯一冲突 23505、表不存在 42P01)→ 照旧 500,不把代码 bug 伪装成配置问题;
 *   - 裸的 ECONNREFUSED 等网络码 misconfigReason 仍然不认 —— 只有 PG 驱动在自己的调用上把它们换成带标记的错误。
 *
 * 夹具要像真东西:用真 `pg` 客户端连 ① 本机一个关掉的端口(真 ECONNREFUSED;`localhost` 走双栈是真 AggregateError)、
 * ② `.invalid` 域名(真 ENOTFOUND)、③ 一个按 PG 线协议回字节的假服务端(真 pg 解析出的 DatabaseError,带 SQLSTATE)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import net from 'node:net';
import fs from 'node:fs';
import { getDbDriver, resetDbDriver, isUniqueViolation } from '@/lib/db-driver';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { GET as healthHandler } from '@/app/api/health/route';
import {
  misconfigReason,
  pgUnreachableCode,
  DbUnreachableError,
  MISCONFIG_MESSAGES,
} from '@/lib/server-misconfig';

const BASE = 'http://192.168.1.10:3100';
// DATABASE_URL 里每一段都用好认的串:响应里出现任何一段都算泄露
const PG_USER = 'wcpguser7f3';
const PG_PASS = 'Pw-9d1e2c-secret';
const PG_DB = 'wcpgdb5a8';

const pgUrl = (host: string, port: number) => `postgresql://${PG_USER}:${PG_PASS}@${host}:${port}/${PG_DB}`;

function post(pathname: string, body: unknown): Request {
  return new Request(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify(body),
  });
}
const loginReq = (password = 'whatever-pw') => post('/api/auth/login', { email: 'pg-user@test.local', password });
const registerReq = () => post('/api/auth/register', { email: 'pg-new@test.local', password: 'pw-123456', name: 'N' });

async function read(res: Response) {
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, text, body };
}

/** 响应里不许出现连接串的任何一段,也不许有 pg 的原始报错。 */
function expectNoPgLeak(text: string, host: string, port?: number) {
  for (const s of [PG_USER, PG_PASS, PG_DB, host, 'postgresql://', 'ECONNREFUSED', 'ENOTFOUND', 'password authentication', 'fake ']) {
    expect(text, `响应泄露了「${s}」`).not.toContain(s);
  }
  if (port) expect(text).not.toContain(String(port));
}

/** 拿一个此刻没人听的本机端口(先听再关)。 */
async function closedPort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

// ─── 假 PG 服务端:只实现到「建连 / 简单查询 / 扩展查询」够 pg 客户端走完一轮 ───────────────

const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s: string) => Buffer.from(`${s}\0`, 'utf8');
function msg(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from(type, 'latin1'), int32(body.length + 4), body]);
}
function errorResponse(code: string, message: string, severity: 'ERROR' | 'FATAL') {
  return msg('E', Buffer.concat([cstr(`S${severity}`), cstr(`V${severity}`), cstr(`C${code}`), cstr(`M${message}`), Buffer.from([0])]));
}
const READY = () => msg('Z', Buffer.from('I'));

interface FakePgOpts {
  /** 建连阶段就回 FATAL + 这个 SQLSTATE 并断开 —— 和真 PG 的密码错 / 库不存在 / 连接数满同一形态 */
  startupError?: string;
  /** SQL 命中时回 ERROR + 这个 SQLSTATE(语法错、唯一冲突……) */
  queryError?: { match: RegExp; code: string };
}

async function fakePg(opts: FakePgOpts = {}, listenPort = 0) {
  const sockets = new Set<net.Socket>();
  const queries: string[] = [];
  const reply = (sql: string, extended: boolean) => {
    if (opts.queryError && opts.queryError.match.test(sql)) {
      return Buffer.concat([errorResponse(opts.queryError.code, 'fake query failure', 'ERROR'), READY()]);
    }
    const head = extended ? [msg('1'), msg('2'), msg('n')] : []; // ParseComplete / BindComplete / NoData
    return Buffer.concat([...head, msg('C', cstr('SELECT 0')), READY()]);
  };
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => { /* 客户端断开 */ });
    let buf = Buffer.alloc(0);
    let started = false;
    let parsedSql = '';
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) { // StartupMessage 没有类型字节:Int32 长度 + Int32 协议号 + 参数
          if (buf.length < 8 || buf.length < buf.readInt32BE(0)) return;
          const len = buf.readInt32BE(0);
          const proto = buf.readInt32BE(4);
          buf = buf.subarray(len);
          if (proto === 80877103) { sock.write('N'); continue; } // SSLRequest → 不支持
          started = true;
          if (opts.startupError) { sock.end(errorResponse(opts.startupError, 'fake startup failure', 'FATAL')); return; }
          sock.write(Buffer.concat([msg('R', int32(0)), READY()])); // AuthenticationOk + ReadyForQuery
          continue;
        }
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) return;
        const type = String.fromCharCode(buf[0]);
        const body = buf.subarray(5, 1 + buf.readInt32BE(1));
        buf = buf.subarray(1 + buf.readInt32BE(1));
        if (type === 'Q') {
          const sql = body.toString('utf8', 0, body.length - 1);
          queries.push(sql);
          sock.write(reply(sql, false));
        } else if (type === 'P') { // Parse:语句名\0 SQL\0 …
          const nameEnd = body.indexOf(0);
          parsedSql = body.toString('utf8', nameEnd + 1, body.indexOf(0, nameEnd + 1));
          queries.push(parsedSql);
        } else if (type === 'S') { // Sync:pg 在 Execute 后立刻发,这里一次回完整轮
          sock.write(reply(parsedSql, true));
        } else if (type === 'X') {
          sock.end();
          return;
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(listenPort, '127.0.0.1', r));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    queries,
    sockets,
    /** 服务端掐断所有连接(模拟 PG 重启)并停止监听 */
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let servers: Array<{ close: () => Promise<void> }> = [];
async function startFakePg(opts: FakePgOpts = {}) {
  const s = await fakePg(opts);
  servers.push(s);
  vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', s.port));
  return s;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JWT_SECRET', crypto.randomBytes(32).toString('hex'));
  vi.stubEnv('BETA_INVITE_REQUIRED', 'false');
  vi.stubEnv('DB_DRIVER', 'pg');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetDbDriver();
});
afterEach(async () => {
  for (const s of servers) await s.close();
  servers = [];
  await new Promise((r) => setTimeout(r, 20)); // 让被掐断的空闲连接把 'error' 发完,再撤掉 console 桩
  resetDbDriver();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('v13.12 · pgUnreachableCode:只认连接 / 鉴权类', () => {
  it('建连阶段的网络错误码与 PG 建连 SQLSTATE → 原样返回', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL',
      '28P01', '28000', '3D000', '57P03', '53300']) {
      expect(pgUnreachableCode(Object.assign(new Error('x'), { code })), code).toBe(code);
    }
  });

  it('AggregateError:顶层 code 是别的,成员里有连不上的也认', () => {
    const agg = Object.assign(new AggregateError([Object.assign(new Error('a'), { code: 'EPERM' }), Object.assign(new Error('b'), { code: 'ECONNREFUSED' })]), { code: 'EPERM' });
    expect(pgUnreachableCode(agg)).toBe('ECONNREFUSED');
  });

  it('SQL 本身的错误、连上之后的断连、SQLite 错误、无 code → null(照旧 500)', () => {
    for (const code of ['42601', '23505', '42P01', '57014', '40001', 'ECONNRESET', 'EPIPE', 'SQLITE_CANTOPEN', 'DB_UNAVAILABLE']) {
      expect(pgUnreachableCode(Object.assign(new Error('x'), { code })), code).toBeNull();
    }
    expect(pgUnreachableCode(new Error('Connection terminated unexpectedly'))).toBeNull(); // 只看 code,不看文案
    expect(pgUnreachableCode(null)).toBeNull();
    expect(pgUnreachableCode('ECONNREFUSED')).toBeNull();
  });

  it('misconfigReason 认 DbUnreachableError;裸的网络码 / SQLSTATE 不认(连外网失败不能报成数据库)', () => {
    expect(misconfigReason(new DbUnreachableError('ECONNREFUSED', 'x'))).toBe('db_unreachable');
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', '28P01', '3D000']) {
      expect(misconfigReason(Object.assign(new Error('x'), { code })), code).toBeNull();
    }
  });

  it('文案:给 PG 的修法(DATABASE_URL / 服务是否启动 / 账号密码与库名),不提 chown', () => {
    const m = MISCONFIG_MESSAGES.db_unreachable;
    expect(m).toContain('PostgreSQL');
    expect(m).toContain('DATABASE_URL');
    expect(m).toContain('账号密码');
    expect(m).toContain('库名');
    expect(m).not.toContain('chown');
  });
});

describe('v13.12 · PG 驱动:真 pg 客户端连不上 → 带标记的 DbUnreachableError', () => {
  it('关掉的端口(127.0.0.1)→ get / run / transaction 都抛 DB_UNREACHABLE(ECONNREFUSED)', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', await closedPort()));
    const d = getDbDriver();
    const want = { code: 'DB_UNREACHABLE', failure: 'ECONNREFUSED' };
    await expect(d.get('SELECT 1')).rejects.toMatchObject(want);
    await expect(d.run('UPDATE users SET name = ? WHERE id = ?', ['n', 'x'])).rejects.toMatchObject(want);
    const fn = vi.fn(async () => 1);
    await expect(d.transaction(fn)).rejects.toMatchObject(want);
    expect(fn).not.toHaveBeenCalled();
  });

  it('localhost 关掉的端口(双栈,Node 抛 AggregateError)→ DB_UNREACHABLE', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('localhost', await closedPort()));
    await expect(getDbDriver().get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'ECONNREFUSED' });
  });

  it('域名解析不到(.invalid,RFC 6761 保证不存在)→ DB_UNREACHABLE(ENOTFOUND)', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('wc-pg-nowhere.invalid', 5432));
    await expect(getDbDriver().get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'ENOTFOUND' });
  });

  it.each(['28P01', '28000', '3D000', '57P03', '53300'])('PG 建连时回 FATAL %s → DB_UNREACHABLE', async (code) => {
    await startFakePg({ startupError: code });
    await expect(getDbDriver().get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: code });
  });

  it('没设 DATABASE_URL → DB_UNREACHABLE(database_url_missing)', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(getDbDriver().get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'database_url_missing' });
  });

  it('没装 pg → DB_UNREACHABLE(pg_not_installed)', async () => {
    // 不 resetModules:health 路由是动态 import db-driver 的,重置注册表会让它拿到另一份单例,后面的用例互相串
    vi.doMock('pg', () => { throw new Error("Cannot find module 'pg'"); });
    try {
      vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', 5432));
      await expect(getDbDriver().get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'pg_not_installed' });
    } finally {
      vi.doUnmock('pg');
    }
  });

  it('事务里 client.query 的建连类错误也换标记(BEGIN 撞上 53300)', async () => {
    await startFakePg({ queryError: { match: /^BEGIN/, code: '53300' } });
    await expect(getDbDriver().transaction(async () => 1)).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: '53300' });
  });

  it('对照:连得上 → 查询正常返回;SQL 错误原样透出(42601 / 42P01 不换标记)', async () => {
    const pg = await startFakePg({ queryError: { match: /FROM nope/, code: '42P01' } });
    const d = getDbDriver();
    await expect(d.get('SELECT 1 AS ok')).resolves.toBeNull(); // 假服务端回 0 行
    const err = await d.get('SELECT * FROM nope WHERE id = ?', ['x']).catch((e) => e);
    expect(err.code).toBe('42P01');
    expect(err.name).not.toBe('DbUnreachableError');
    expect(pg.queries).toContain('SELECT * FROM nope WHERE id = $1'); // ? → $n 照旧
  });

  it('对照:唯一冲突 23505 原样透出,isUniqueViolation 照旧认得', async () => {
    await startFakePg({ queryError: { match: /^INSERT/, code: '23505' } });
    const err = await getDbDriver().run('INSERT INTO users (id) VALUES (?)', ['x']).catch((e) => e);
    expect(err.code).toBe('23505');
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('PG 晚于本服务起来:先 DB_UNREACHABLE,库起来后同一个驱动直接连上(不用重启服务)', async () => {
    const first = await fakePg();
    const port = first.port;
    await first.close(); // 端口此刻没人听
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', port));
    const d = getDbDriver();
    await expect(d.get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'ECONNREFUSED' });
    const again = await fakePg({}, port);
    servers.push(again);
    await expect(d.get('SELECT 1 AS ok')).resolves.toBeNull();
  });

  it('池里的空闲连接被服务端掐断(PG 重启)→ 记一行日志,进程不崩;之后连不上走 DB_UNREACHABLE', async () => {
    const pg = await startFakePg();
    const d = getDbDriver();
    await d.get('SELECT 1 AS ok'); // 连接用完回到池里空闲
    expect(pg.sockets.size).toBe(1);
    await pg.close();
    servers = [];
    await new Promise((r) => setTimeout(r, 50));
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('[db-driver] PostgreSQL 空闲连接断开');
    await expect(d.get('SELECT 1')).rejects.toMatchObject({ code: 'DB_UNREACHABLE', failure: 'ECONNREFUSED' });
  });
});

describe('v13.12 · 登录 / 注册:PG 连不上 → 503 db_unreachable;SQL 出错照旧 500', () => {
  it('关掉的端口:登录(密码对错都一样)→ 503 + PG 修法,响应里没有连接串的任何一段', async () => {
    const port = await closedPort();
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', port));
    for (const pw of ['right-or-wrong', 'another']) {
      const r = await read(await loginHandler(loginReq(pw)));
      expect(r.status, pw).toBe(503);
      expect(r.body).toEqual({ code: 'server_misconfigured', reason: 'db_unreachable', message: MISCONFIG_MESSAGES.db_unreachable });
      expectNoPgLeak(r.text, '127.0.0.1', port);
    }
  });

  it('服务端日志留原因(排障表教用户 grep「PostgreSQL」)', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', await closedPort()));
    await loginHandler(loginReq());
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('503 server_misconfigured/db_unreachable');
    expect(logged).toContain('[db] PostgreSQL 连不上或没配好(ECONNREFUSED)');
  });

  it('域名解析不到 → 503,响应里没有主机名', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('wc-pg-nowhere.invalid', 5432));
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unreachable');
    expectNoPgLeak(r.text, 'wc-pg-nowhere');
  });

  it.each(['28P01', '3D000'])('PG 回 FATAL %s(密码错 / 库不存在)→ 登录 503', async (code) => {
    const pg = await startFakePg({ startupError: code });
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unreachable');
    expectNoPgLeak(r.text, '127.0.0.1', pg.port);
  });

  it('没设 DATABASE_URL → 登录 503', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unreachable');
  });

  it('注册:PG 连不上 → 503 db_unreachable', async () => {
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', await closedPort()));
    const r = await read(await registerHandler(registerReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('db_unreachable');
  });

  it('JWT_SECRET 没设 + PG 连不上 → 先报密钥(检查在查库之前,与 SQLite 一致)', async () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', await closedPort()));
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('jwt_secret_missing');
  });

  it('对照:连得上、查用户的 SQL 出错(42601)→ 登录照旧抛出(Next 回 500),不是 503', async () => {
    await startFakePg({ queryError: { match: /FROM users WHERE email/, code: '42601' } });
    await expect(loginHandler(loginReq())).rejects.toMatchObject({ code: '42601' });
  });

  it('对照:连得上、用户不存在 → 401(PG 路径本身没被 503 误伤)', async () => {
    await startFakePg();
    const r = await read(await loginHandler(loginReq()));
    expect(r.status).toBe(401);
  });

  it('对照:注册写库撞唯一冲突(23505)→ 照旧 500「注册失败」', async () => {
    await startFakePg({ queryError: { match: /^INSERT INTO users/, code: '23505' } });
    const r = await read(await registerHandler(registerReq()));
    expect(r.status).toBe(500);
    expect(r.body.message).toMatch(/注册失败/);
  });
});

describe('v13.12 · /api/health:PG 连不上报 db_unreachable(与登录同一套)', () => {
  it('关掉的端口 → 503 reasons [db_unreachable],鉴权照查为 ok,不泄露连接串', async () => {
    const port = await closedPort();
    vi.stubEnv('DATABASE_URL', pgUrl('127.0.0.1', port));
    const r = await read(await healthHandler());
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false, checks: { db: 'fail', auth: 'ok' }, reasons: ['db_unreachable'] });
    expectNoPgLeak(r.text, '127.0.0.1', port);
  });

  it('PG 回 28P01 + 没设 JWT_SECRET → 两个原因一次报全', async () => {
    await startFakePg({ startupError: '28P01' });
    vi.stubEnv('JWT_SECRET', '');
    const r = await read(await healthHandler());
    expect(r.body.reasons).toEqual(['db_unreachable', 'jwt_secret_missing']);
  });

  it('对照:PG 连得上 → 200', async () => {
    await startFakePg();
    const r = await read(await healthHandler());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, checks: { db: 'ok', auth: 'ok' } });
  });
});

describe('v13.12 · 文档与新行为一致', () => {
  const docs = {
    'README.md': fs.readFileSync('README.md', 'utf-8'),
    'README.zh-CN.md': fs.readFileSync('README.zh-CN.md', 'utf-8'),
    'docs/DEPLOYMENT.md': fs.readFileSync('docs/DEPLOYMENT.md', 'utf-8'),
  };

  it('三份排障表都有 db_unreachable 这一行,且给的日志前缀就是代码里打的那句', () => {
    for (const [name, src] of Object.entries(docs)) {
      expect(src, name).toMatch(/\|[^\n]*`db_unreachable`[^\n]*\|[^\n]*\[db\] PostgreSQL 连不上或没配好/);
    }
    expect(fs.readFileSync('lib/server-misconfig.ts', 'utf-8')).toContain('[db] PostgreSQL 连不上或没配好(');
  });

  it('不再写「PG 连不上时登录仍是 500」;健康检查表里 db_unavailable 不再包揽 PG', () => {
    const dep = docs['docs/DEPLOYMENT.md'];
    expect(dep).not.toMatch(/PG 连不上[^\n]*登录仍是 500/);
    expect(dep).not.toMatch(/\["db_unavailable"\]`\s*\|[^\n]*PG/);
    expect(dep).toMatch(/`503 … "reasons":\["db_unreachable"\]`/);
  });
});
