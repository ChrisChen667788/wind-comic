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
  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const db = await this.db();
    // better-sqlite3 同步, BEGIN…COMMIT 同连接顺序执行即原子 (fn 内只做 DB + 同步计算)
    db.prepare('BEGIN').run();
    try {
      const result = await fn(this);
      db.prepare('COMMIT').run();
      return result;
    } catch (e) {
      try { db.prepare('ROLLBACK').run(); } catch { /* ignore */ }
      throw e;
    }
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
