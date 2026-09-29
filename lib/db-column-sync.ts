/**
 * lib/db-column-sync — 把 SQLite 上后加的列补到 Postgres 上。v12.457。
 *
 * ── 病象(v12.454 对抗复查挖出,但问题比那一版老得多)──────────────────
 * 全仓加列走的是 `lib/db.ts` 的 `addColumnIfMissing`,它的实现是
 * `PRAGMA table_info(...)` + `ALTER TABLE ... ADD COLUMN` —— **SQLite 专有**。
 * 而 Postgres 一侧的迁移(`scripts/pg-migrate.ts`)只从 `sqlite_master` 导出
 * `CREATE TABLE IF NOT EXISTS`:**表已存在就整条 no-op**。
 *
 * 于是:全新 PG 部署没事(建表语句里就带着新列),而**已经在跑的 PG 部署**
 * 每次升级都拿不到新列 —— 新功能的读写全部报 `column "x" does not exist`。
 * 这不是某一版的疏忽,是自 addColumnIfMissing 诞生起每一次加列都有的漂移;
 * v12.454 的 `canvas_layout` 只是让它第一次被看见。
 *
 * ── 修法 ────────────────────────────────────────────────────────────
 * 从同一份真相(SQLite 的表结构)再导出一份 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`,
 * 建表之后顺序执行。两点分寸:
 *   · **NOT NULL 且没有默认值的列不补 NOT NULL** —— 老表里已有行,PG 会直接拒绝;
 *     宁可让新列在老部署上可空,也不要整条迁移失败。
 *   · **PRIMARY KEY / UNIQUE 之类的列级约束不带进 ALTER** —— 加列不是重建表,
 *     约束要单独想清楚再说。
 */
import { db } from './db';
import { translateDDL } from './db-dialect';

export interface ColumnDef {
  table: string;
  column: string;
  /** 已翻成 PG 的类型(含默认值,若原表有) */
  definition: string;
}

const SKIP_TABLE = /^sqlite_/i;

/** 列级约束里**不能**跟着 ADD COLUMN 走的部分 */
function safeColumnDefinition(type: string, notNull: boolean, dflt: string | null): string {
  const t = translateDDL(type || 'TEXT').trim() || 'TEXT';
  const parts = [t];
  if (dflt != null && String(dflt).trim() !== '') parts.push(`DEFAULT ${dflt}`);
  // 有默认值才敢带 NOT NULL:老表已有行,没默认值的 NOT NULL 会让 ALTER 直接失败
  if (notNull && dflt != null && String(dflt).trim() !== '') parts.push('NOT NULL');
  return parts.join(' ');
}

/** 列出所有用户表的列(读 SQLite 真结构 —— 与 addColumnIfMissing 同一份真相) */
export function listColumnDefs(): ColumnDef[] {
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all() as Array<{ name: string }>;
  const out: ColumnDef[] = [];
  for (const { name } of tables) {
    if (SKIP_TABLE.test(name)) continue;
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{
      name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
    }>;
    for (const c of cols) {
      // 主键列必然在建表语句里,ALTER 补主键没有意义(也会因表已有行而失败)
      if (c.pk) continue;
      out.push({ table: name, column: c.name, definition: safeColumnDefinition(c.type, !!c.notnull, c.dflt_value) });
    }
  }
  return out;
}

/**
 * 生成「把缺的列补上」的 DDL。幂等:`IF NOT EXISTS`,重复执行无副作用。
 * 需要 PostgreSQL 9.6+(`ADD COLUMN IF NOT EXISTS` 自 9.6 起支持)。
 *
 * 表名、列名一律加双引号。这只在**全是小写**时安全:建表语句里的标识符没加引号,PG 会折成小写;
 * 若哪天出现驼峰列名 `fooBar`,建表时它成了 `foobar`,这里的 `"fooBar"` 就会补出**另一列**。
 * 现有 46 张表没有一个大写列名,由测试守住(tests/v12-457-pg-column-sync.test.ts)。
 */
export function exportPostgresColumnSync(): string {
  const lines = [
    '-- v12.457 auto-generated: 把 SQLite 上后加的列补到已存在的 PG 表上',
    '-- CREATE TABLE IF NOT EXISTS 对已存在的表是 no-op —— 升级部署拿不到新列,全靠这一段。',
    '',
  ];
  for (const c of listColumnDefs()) {
    lines.push(`ALTER TABLE "${c.table}" ADD COLUMN IF NOT EXISTS "${c.column}" ${c.definition};`);
  }
  return lines.join('\n');
}
