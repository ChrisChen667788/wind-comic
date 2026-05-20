/**
 * v4.2 — 从活的 SQLite 导出 Postgres 兼容 schema DDL.
 *
 * 读 sqlite_master 拿所有 CREATE TABLE / INDEX, 逐条过 translateDDL, 拼成可在 PG
 * 执行的建表脚本. 给迁移 runbook 用 (docs/postgres-migration.md).
 */

import { db } from './db';
import { translateDDL } from './db-dialect';

/** 导出 PG 兼容的 schema DDL 字符串 (建表 + 索引). */
export function exportPostgresSchema(): string {
  const rows = db.prepare(
    `SELECT type, name, sql FROM sqlite_master
     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
  ).all() as Array<{ type: string; name: string; sql: string }>;

  const parts: string[] = [
    '-- v4.2 auto-generated Postgres schema (translated from SQLite)',
    '-- 注意: 时间戳列用 TEXT (ISO 字符串), 与现有代码一致. 真要 timestamptz 需配套改读写.',
    '',
  ];
  for (const r of rows) {
    const ddl = translateDDL(r.sql).trim();
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
