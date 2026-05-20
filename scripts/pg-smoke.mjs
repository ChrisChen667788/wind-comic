#!/usr/bin/env node
/**
 * v4.2.3 — Postgres 连接冒烟 / 灰度试跑.
 *
 * 真连 DATABASE_URL 指向的 Postgres, 验证我们的 dual-driver SQL 在 PG 上能跑:
 *   1. 连接
 *   2. 建临时表 (PG 语法: TEXT PK + BIGSERIAL)
 *   3. 参数化 INSERT / SELECT / UPDATE / DELETE (用 $1,$2 — 即 db-dialect 翻译后的形态)
 *   4. ON CONFLICT upsert
 *   5. 清理 + 报告
 *
 * 用法:
 *   npm i pg
 *   DATABASE_URL=postgres://user:pass@localhost:5432/wind npm run pg:smoke
 *
 * 没装 pg / 没 DATABASE_URL → 打印安装步骤, exit 0 (不算失败, 方便 CI 跳过).
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.log('⏭️  未设置 DATABASE_URL — 跳过 PG 冒烟.');
  console.log('   要真跑 Postgres 灰度试跑:');
  console.log('     1) 起 PG:  docker run -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:16');
  console.log('     2) 装客户端: npm i pg');
  console.log('     3) DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm run pg:smoke');
  console.log('   完整迁移见 docs/postgres-migration.md');
  process.exit(0);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.log("⏭️  未安装 'pg' — 运行 `npm i pg` 后重试.");
  process.exit(0);
}

const Pool = pg.Pool || pg.default?.Pool;
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
const T = 'wind_pg_smoke';

function assert(cond, msg) {
  if (!cond) { throw new Error('断言失败: ' + msg); }
}

try {
  console.log('🔌 连接 Postgres …');
  await pool.query('SELECT 1');
  console.log('✅ 连接成功');

  // 模拟 db-dialect.translateDDL 产出 (TEXT PK / BIGSERIAL / BYTEA)
  await pool.query(`DROP TABLE IF EXISTS ${T}`);
  await pool.query(`CREATE TABLE ${T} (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,
    name TEXT NOT NULL,
    blob BYTEA,
    created_at TEXT NOT NULL
  )`);
  console.log('✅ 建表 (TEXT PK + BIGSERIAL + BYTEA)');

  // 参数化 INSERT — 即 sqliteParamsToPg('?') 翻译后的 $1,$2 形态
  const id = 'sm_' + Date.now();
  await pool.query(
    `INSERT INTO ${T} (id, name, blob, created_at) VALUES ($1, $2, $3, $4)`,
    [id, '林晚', Buffer.from('hi'), new Date().toISOString()],
  );
  const { rows } = await pool.query(`SELECT id, name, seq FROM ${T} WHERE id = $1`, [id]);
  assert(rows[0]?.name === '林晚', 'SELECT 读回 name');
  assert(Number(rows[0]?.seq) >= 1, 'BIGSERIAL 自增');
  console.log('✅ 参数化 INSERT/SELECT ($n 占位符)');

  // ON CONFLICT upsert (即 translateUpsert 产出)
  await pool.query(
    `INSERT INTO ${T} (id, name, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id, '林晚v2', new Date().toISOString()],
  );
  const upd = await pool.query(`SELECT name FROM ${T} WHERE id = $1`, [id]);
  assert(upd.rows[0]?.name === '林晚v2', 'ON CONFLICT upsert');
  console.log('✅ ON CONFLICT upsert');

  const del = await pool.query(`DELETE FROM ${T} WHERE id = $1`, [id]);
  assert(del.rowCount === 1, 'DELETE rowCount');
  await pool.query(`DROP TABLE IF EXISTS ${T}`);
  console.log('✅ DELETE + 清理');

  console.log('\n🎉 PG 灰度试跑全部通过 — dual-driver SQL 在 Postgres 上工作正常.');
  console.log('   下一步: DB_DRIVER=pg 启动, 让 auth/projects/assets 域走 PG.');
  process.exit(0);
} catch (e) {
  console.error('❌ PG 冒烟失败:', e instanceof Error ? e.message : e);
  try { await pool.query(`DROP TABLE IF EXISTS ${T}`); } catch { /* ignore */ }
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
