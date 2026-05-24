#!/usr/bin/env tsx
/**
 * v6.6 — 把全量 schema bootstrap 到 Postgres.
 *
 * 从活的 SQLite (sqlite_master) 导出 applyReady 的 PG DDL → 写一份 db/schema.pg.sql 留档 →
 * 顺序 apply 到 DATABASE_URL 指向的 PG. 幂等 (CREATE TABLE/INDEX IF NOT EXISTS).
 *
 * 用法:  DATABASE_URL=postgres://postgres:pw@localhost:5434/wind npm run pg:migrate
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { exportPostgresSchema } from '../lib/db-schema-export';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('⏭️  未设置 DATABASE_URL — 跳过. 见 docs/postgres-migration.md');
    process.exit(0);
  }

  const ddl = exportPostgresSchema({ applyReady: true });
  const outPath = resolve('db/schema.pg.sql');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, ddl + '\n');
  console.log(`📝 PG schema 已写入 ${outPath}`);

  const pg = await import('pg');
  const Pool = (pg as any).Pool || (pg as any).default?.Pool;
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });

  const statements = ddl
    .split(';')
    .map((s) => s.replace(/--[^\n]*/g, '').trim()) // 去掉头部 + 残留行注释 (否则首块注释会粘住第一条建表)
    .filter(Boolean);

  let applied = 0;
  try {
    console.log('🔌 连接 Postgres …');
    await pool.query('SELECT 1');
    for (const st of statements) {
      await pool.query(st);
      applied++;
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'",
    );
    console.log(`✅ 应用 ${applied} 条 DDL; public schema 现有 ${rows[0].c} 张表.`);
    console.log('   下一步: npm run pg:verify (async repo 真连 PG 往返)');
    process.exit(0);
  } catch (e) {
    console.error('❌ migrate 失败:', e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
