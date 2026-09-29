/**
 * v4.2 — 从活的 SQLite 导出 Postgres 兼容 schema DDL.
 *
 * 读 sqlite_master 拿所有 CREATE TABLE / INDEX, 逐条过 translateDDL, 拼成可在 PG
 * 执行的建表脚本. 给迁移 runbook 用 (docs/postgres-migration.md).
 */

import { db } from './db';
import { translateDDL, stripFkAndComments, ensureIdempotentDDL } from './db-dialect';
import { exportPostgresColumnSync } from './db-column-sync';

/**
 * 导出 PG 兼容的 schema DDL 字符串 (建表 + 索引).
 * @param opts.applyReady true → 去 FK/注释, 产出可直接顺序 apply 的 DDL (v6.6 pg:migrate 用);
 *                        默认 false → 保留原样供 runbook 人读 (v4.2 行为不变).
 * @param opts.part       v12.457:只要建表段('tables',含文件头)或只要其余段('rest':索引等);
 *                        不传 = 全部(原行为)。给 buildPgMigrationDdl 在两段之间插补列用。
 */
export function exportPostgresSchema(opts: { applyReady?: boolean; part?: 'tables' | 'rest' } = {}): string {
  const rows = db.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
  ).all() as Array<{ type: string; name: string; sql: string }>;

  const wanted = rows.filter((r) => !opts.part || (opts.part === 'tables') === (r.type === 'table'));
  const parts: string[] = opts.part === 'rest' ? [] : [
    '-- v4.2 auto-generated Postgres schema (translated from SQLite)',
    '-- 注意: 时间戳列用 TEXT (ISO 字符串), 与现有代码一致. 真要 timestamptz 需配套改读写.',
    ...(opts.applyReady ? ['-- v6.6 applyReady: 已去 FK 约束 (SQLite 未开 FK 强制) + 行注释, 可直接顺序执行.'] : []),
    '',
  ];
  for (const r of wanted) {
    let ddl = translateDDL(r.sql).trim();
    if (opts.applyReady) ddl = ensureIdempotentDDL(stripFkAndComments(ddl).trim()).trim();
    parts.push(`${ddl};`);
  }
  return parts.join('\n');
}

/** 列出所有用户表名 (迁移数据时按表搬). */
export function listUserTables(): string[] {
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * v12.457 — `pg:migrate` 真正要 apply 的那一份:**建表 + 补列**。
 *
 * 只建表是不够的:`CREATE TABLE IF NOT EXISTS` 对已存在的表是 no-op,
 * 于是已经在跑的 PG 部署永远拿不到 `addColumnIfMissing`(SQLite 专有)后加的列,
 * 升级后新功能全线 `column "x" does not exist`。
 *
 * 顺序是**建表 → 补列 → 索引等其余对象**:补列必须在索引之前 —— 哪天有人给新加的列建索引,
 * 老部署上那条 `CREATE INDEX` 若排在补列前面,会因列还不存在而让整条迁移中止。
 */
export function buildPgMigrationDdl(): string {
  return [
    exportPostgresSchema({ applyReady: true, part: 'tables' }),
    exportPostgresColumnSync(),
    exportPostgresSchema({ applyReady: true, part: 'rest' }),
  ].join('\n\n');
}
