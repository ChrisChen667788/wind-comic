/**
 * v4.2.1 — DB driver 抽象 (SQLite ↔ Postgres 双驱动).
 *
 * 全站迁 PG 的第一步: 给数据访问加一层 **异步接口**, SQLite 和 PG 各实现一份,
 * `DB_DRIVER` env 切换. 业务 repo 只依赖这个接口, 不直接碰 better-sqlite3.
 *
 *   - SqliteDriver: 包现有同步 better-sqlite3, 用 Promise.resolve 适配成异步
 *   - PgDriver: 懒加载 `pg` (没装就报清晰错误, 不做硬依赖), 占位符 `?`→`$n` 自动转
 *
 * repo 统一写 SQLite 风格 `?` 占位符, PG driver 自动翻译, 一套 SQL 两边跑.
 *
 * 单测: tests/v4-2-1-db-driver.test.ts.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { sqliteParamsToPg } from './db-dialect';

export type DbDialect = 'sqlite' | 'postgres';

export interface DbRunResult {
  /** 影响行数. */
  changes: number;
  /** 自增主键 (SQLite); PG 无则 undefined. */
  lastInsertRowid?: number | bigint;
}

/** 查询执行器 (事务内/外通用接口). */
export interface DbExecutor {
  /** SELECT 多行. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** SELECT 单行 (无则 null). */
  get<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  /** INSERT / UPDATE / DELETE. */
  run(sql: string, params?: unknown[]): Promise<DbRunResult>;
}

export interface DbDriver extends DbExecutor {
  readonly dialect: DbDialect;
  /**
   * v4.2.5: 原子事务. fn 抛错则全回滚. fn 收到一个 tx 作用域的 executor —
   * 写事务逻辑 (如注册: 插 user + 消费邀请码) 必须用它, 不能混用全局 driver.
   * SQLite: BEGIN/COMMIT 同连接; PG: 从池 checkout 单 client 全程跑.
   */
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
}

// ─── SQLite driver (包现有同步 db) ──────────────────────────────────────────

class SqliteDriver implements DbDriver {
  readonly dialect = 'sqlite' as const;
  private dbPromise: Promise<any> | null = null;

  private async db() {
    if (!this.dbPromise) {
      this.dbPromise = import('./db').then((m) => m.db);
    }
    return this.dbPromise;
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = await this.db();
    return db.prepare(sql).all(...params) as T[];
  }
  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const db = await this.db();
    return (db.prepare(sql).get(...params) as T) ?? null;
  }
  async run(sql: string, params: unknown[] = []): Promise<DbRunResult> {
    const db = await this.db();
    const r = db.prepare(sql).run(...params);
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }
  /**
   * v12.449:**同一连接上的事务必须排队。**
   *
   * 原实现是「BEGIN → await fn → COMMIT」,注释假设 fn「只做 DB + 同步计算」—— 但全仓 13 处调用
   * 在 fn 里 await(动态 import、异步查询),一让出执行权,同进程另一个事务就在同一连接上再 BEGIN,
   * 抛 `cannot start a transaction within a transaction`;抛错那一方的 catch 还会 ROLLBACK,
   * **把先开的那个事务一起回滚**,先开的那个随后 COMMIT 又因「没有活动事务」失败 —— 两边全挂。
   * v12.448 用真库测「同一镜并发保存参考视频」当场撞出(导演台站位保存是同一写法)。
   *
   * 修法:事务按到达顺序排队,前一个结束(不论成败)才开下一个。
   * 嵌套(fn 里又调 transaction)同一连接做不到,排队会自己等自己 —— 用 AsyncLocalStorage 认出来,**立即报错**而不是挂死。
   * 已知仍在:事务开着时,别处**不带 tx 的**普通读写也走这条连接,会落进这个事务(better-sqlite3 单连接的固有限制,与本修无关)。
   */
  private txTail: Promise<unknown> = Promise.resolve();
  private readonly txScope = new AsyncLocalStorage<true>();

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    if (this.txScope.getStore()) {
      throw new Error('SQLite 不支持嵌套事务:当前已在一个事务里 —— 内层请改用外层传进来的 tx,不要再调 transaction()');
    }
    const run = () => this.txScope.run(true, async () => {
      const db = await this.db();
      db.prepare('BEGIN').run();
      try {
        const result = await fn(this);
        db.prepare('COMMIT').run();
        return result;
      } catch (e) {
        try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
        throw e;
      }
    });
    const p = this.txTail.then(run, run);
    this.txTail = p.catch(() => { /* 前一个失败不影响后面排队 */ });
    return p;
  }
}

// ─── PG driver (懒加载 pg, 软依赖) ──────────────────────────────────────────

class PgDriver implements DbDriver {
  readonly dialect = 'postgres' as const;
  private poolPromise: Promise<any> | null = null;

  private async pool() {
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        let pg: any;
        // 变量 specifier + @vite-ignore: 阻止打包器在构建期静态解析未安装的可选依赖 pg
        const pkg = 'pg';
        try {
          pg = await import(/* @vite-ignore */ /* webpackIgnore: true */ pkg);
        } catch {
          throw new Error(
            "DB_DRIVER=pg 但未安装 'pg'. 运行 `npm i pg` 后重试 (见 docs/postgres-migration.md).",
          );
        }
        const Pool = pg.Pool || pg.default?.Pool;
        // v6.6: int8/bigint (OID 20) 默认被 pg 解析成 string (COUNT(*) / BIGSERIAL).
        // 全站 repo (countUsers / countProjectAssets 等) 按 number 用 → 统一解析成 Number,
        // 与 SQLite 行为一致 (计数不会到 2^53, 安全). 一处修, 所有 count/bigint 列受益.
        const pgTypes = pg.types || pg.default?.types;
        pgTypes?.setTypeParser?.(20, (val: string) => (val == null ? null : Number(val)));
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) throw new Error('DB_DRIVER=pg 需要 DATABASE_URL 环境变量');
        return new Pool({ connectionString });
      })();
    }
    return this.poolPromise;
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.pool();
    const r = await pool.query(sqliteParamsToPg(sql), params);
    return r.rows as T[];
  }
  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
  async run(sql: string, params: unknown[] = []): Promise<DbRunResult> {
    const pool = await this.pool();
    const r = await pool.query(sqliteParamsToPg(sql), params);
    return { changes: r.rowCount ?? 0 };
  }
  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const pool = await this.pool();
    const client = await pool.connect();
    // tx 作用域 executor — 全程同一 client (池里别的连接拿不到这个事务)
    const tx: DbExecutor = {
      query: async <U = any>(sql: string, params: unknown[] = []) =>
        (await client.query(sqliteParamsToPg(sql), params)).rows as U[],
      get: async <U = any>(sql: string, params: unknown[] = []) =>
        ((await client.query(sqliteParamsToPg(sql), params)).rows[0] ?? null) as U | null,
      run: async (sql: string, params: unknown[] = []) =>
        ({ changes: (await client.query(sqliteParamsToPg(sql), params)).rowCount ?? 0 }),
    };
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

// ─── 工厂 (单例) ────────────────────────────────────────────────────────────

let singleton: DbDriver | null = null;

export function getDbDriver(): DbDriver {
  if (singleton) return singleton;
  const want = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
  singleton = want === 'pg' || want === 'postgres' ? new PgDriver() : new SqliteDriver();
  return singleton;
}

/** 测试用: 重置单例 (切 env 后). */
export function resetDbDriver(): void {
  singleton = null;
}

/**
 * v12.306:唯一/主键冲突的**跨驱动判定**。v12.303 时先写在 `repos/asset-repo`,
 * 但 series-repo 也要用 —— 它是驱动级概念,收口到这里,repo 侧只 re-export 保持既有引用。
 * SQLite: `SQLITE_CONSTRAINT_*`(better-sqlite3);Postgres: `23505` unique_violation。
 */
export function isUniqueViolation(e: unknown): boolean {
  const any = e as any;
  const code = String(any?.code || '');
  if (code === '23505') return true;
  if (code.startsWith('SQLITE_CONSTRAINT')) return true;
  const msg = String(any?.message || e || '').toLowerCase();
  return msg.includes('unique constraint') || msg.includes('duplicate key')
    || msg.includes('primary key');
}
