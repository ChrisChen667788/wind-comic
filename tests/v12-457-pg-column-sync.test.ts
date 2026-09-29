/**
 * v12.457 · 后加的列必须也能落到 Postgres 上。
 *
 * 病象(v12.454 对抗复查挖出,但问题自 addColumnIfMissing 诞生起就在):加列走的是
 * `PRAGMA table_info` + `ALTER TABLE`(**SQLite 专有**),而 PG 迁移只从 sqlite_master 导出
 * `CREATE TABLE IF NOT EXISTS` —— 表已存在就整条 no-op。于是**已经在跑的 PG 部署**每次升级
 * 都拿不到新列,新功能全线 `column "x" does not exist`;全新部署却一切正常,所以一直没人看见。
 *
 * 这里锁三件事:①生成的补列 DDL 覆盖 lib/db.ts 里**每一处** addColumnIfMissing(漂移守卫);
 * ②语句本身在老表上执行得下去(幂等、不带会失败的 NOT NULL / 主键);③迁移脚本真的用了它
 *(本仓最常见的坏法:能力造好了没接线)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { exportPostgresColumnSync, listColumnDefs } from '@/lib/db-column-sync';
import { buildPgMigrationDdl, exportPostgresSchema } from '@/lib/db-schema-export';
import { db } from '@/lib/db';

const SYNC = exportPostgresColumnSync();
const alters = SYNC.split('\n').filter((l) => l.startsWith('ALTER TABLE'));

describe('v12.457 · 补列 DDL', () => {
  it('lib/db.ts 里每一处 addColumnIfMissing 的列都在补列 DDL 里(漂移守卫)', () => {
    const src = fs.readFileSync('lib/db.ts', 'utf-8');
    const calls = [...src.matchAll(/addColumnIfMissing\(\s*'([^']+)'\s*,\s*'([^']+)'/g)]
      .map((m) => ({ table: m[1], column: m[2] }));
    expect(calls.length, '一处 addColumnIfMissing 都没解析到,守卫是空的').toBeGreaterThan(20);
    const missing = calls.filter((c) => !alters.some((l) => l.includes(`"${c.table}" ADD COLUMN IF NOT EXISTS "${c.column}"`)));
    expect(missing, `这些后加的列不会被补到 PG 上:${JSON.stringify(missing)}`).toEqual([]);
  });

  it('v12.454 的 canvas_layout 在里面 —— 就是它让这条漂移第一次被看见', () => {
    expect(alters).toContain('ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "canvas_layout" TEXT;');
  });

  it('每条都带 IF NOT EXISTS(幂等:迁移脚本会被反复执行)', () => {
    expect(alters.length).toBeGreaterThan(50);
    expect(alters.every((l) => l.includes('ADD COLUMN IF NOT EXISTS'))).toBe(true);
  });

  it('**没有默认值的 NOT NULL 不带 NOT NULL** —— 老表已有行,那样 ALTER 会直接失败', () => {
    const defs = listColumnDefs();
    const notNullNoDefault = defs.filter((d) => /\bNOT NULL\b/.test(d.definition) && !/DEFAULT/i.test(d.definition));
    expect(notNullNoDefault, `这些列会让整条迁移在老库上失败:${JSON.stringify(notNullNoDefault.slice(0, 5))}`).toEqual([]);
    // 有默认值的可以带:老行会被填上默认值
    const withDefault = defs.filter((d) => /DEFAULT/i.test(d.definition) && /\bNOT NULL\b/.test(d.definition));
    expect(withDefault.length, '带默认值的 NOT NULL 列一条都没有,样本不对').toBeGreaterThan(0);
  });

  it('表名与列名全是小写普通标识符 —— 补列时加了双引号,驼峰名会在 PG 里补出另一列', () => {
    // 建表语句里的标识符没加引号,PG 折成小写;ALTER 里的 "fooBar" 则区分大小写 —— 两者不是同一列。
    const defs = listColumnDefs();
    expect(defs.length).toBeGreaterThan(50);
    const bad = defs.filter((d) => !/^[a-z_][a-z0-9_]*$/.test(d.table) || !/^[a-z_][a-z0-9_]*$/.test(d.column));
    expect(bad, `这些名字在 PG 上会被补成另一列,先想清楚再加:${JSON.stringify(bad.slice(0, 5))}`).toEqual([]);
  });

  it('主键列不补(加列不是重建表)', () => {
    const pk = db.prepare(`PRAGMA table_info("projects")`).all() as Array<{ name: string; pk: number }>;
    const pkName = pk.find((c) => c.pk)!.name;
    expect(alters.some((l) => l.includes(`"projects" ADD COLUMN IF NOT EXISTS "${pkName}"`))).toBe(false);
  });

  it('类型按 PG 翻译(DATETIME→TEXT、BLOB→BYTEA),不把 SQLite 专有类型直接甩给 PG', () => {
    expect(SYNC).not.toMatch(/\bDATETIME\b/);
    expect(SYNC).not.toMatch(/\bBLOB\b/);
    expect(alters.every((l) => /(TEXT|INTEGER|REAL|BYTEA|NUMERIC|BOOLEAN|BIGSERIAL|BIGINT)/i.test(l))).toBe(true);
  });

  it('补的列都真实存在于 SQLite(生成的不是想象出来的列)', () => {
    const sample = alters.slice(0, 40).map((l) => /ALTER TABLE "([^"]+)" ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(l)!);
    for (const m of sample) {
      const cols = db.prepare(`PRAGMA table_info("${m[1]}")`).all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name), `${m[1]} 没有列 ${m[2]}`).toContain(m[2]);
    }
  });
});

describe('v12.457 · 迁移脚本真的用了它', () => {
  const stmts = (ddl: string) => ddl.split(';').map((s) => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean);

  it('buildPgMigrationDdl = 建表 → 补列 → 索引:建表与索引一条不少、一条不多(老行为零回归)', () => {
    const all = stmts(buildPgMigrationDdl());
    const old = stmts(exportPostgresSchema({ applyReady: true }));
    const alterCount = all.filter((s) => s.startsWith('ALTER TABLE')).length;
    expect(alterCount).toBe(alters.length);
    expect(all.filter((s) => !s.startsWith('ALTER TABLE')).sort()).toEqual([...old].sort());
  });

  it('**补列排在所有索引之前** —— 否则给新列建的索引会在老部署上先于补列执行而中止迁移', () => {
    const all = stmts(buildPgMigrationDdl());
    const lastCreateTable = all.map((s, i) => (/^CREATE TABLE/i.test(s) ? i : -1)).reduce((a, b) => Math.max(a, b));
    const firstAlter = all.findIndex((s) => s.startsWith('ALTER TABLE'));
    const lastAlter = all.map((s, i) => (s.startsWith('ALTER TABLE') ? i : -1)).reduce((a, b) => Math.max(a, b));
    const firstIndex = all.findIndex((s) => /^CREATE (UNIQUE )?INDEX/i.test(s));
    expect(firstIndex, '样本里一条索引都没有,这条断言是空的').toBeGreaterThan(0);
    expect(lastCreateTable).toBeLessThan(firstAlter);
    expect(lastAlter).toBeLessThan(firstIndex);
  });

  it('pg-migrate 应用的就是这一份(不是只建表的那一份)', () => {
    const src = fs.readFileSync('scripts/pg-migrate.ts', 'utf-8');
    expect(src).toContain('buildPgMigrationDdl()');
    expect(src, '还在只用建表那一份').not.toMatch(/const ddl = exportPostgresSchema\(/);
  });

  it('按分号切句后,补列语句不会被注释粘住(脚本就是这么切的)', () => {
    const statements = buildPgMigrationDdl()
      .split(';')
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter(Boolean);
    const alterStatements = statements.filter((s) => s.startsWith('ALTER TABLE'));
    expect(alterStatements.length).toBe(alters.length);
    expect(alterStatements.every((s) => !s.includes('--'))).toBe(true);
  });
});
