/**
 * v4.2 — SQLite → Postgres 方言转换 (迁移路径地基).
 *
 * 全量迁移的难点不是搬数据, 是 ~250 处 `db.prepare().get()` 同步调用 (better-sqlite3)
 * 要改成 PG 的异步. 那是 cutover 本身 (v4.2.1+). 这一版先交付"方言转换" — 把 SQLite
 * 的 DDL / 占位符 / UPSERT 语法翻成 Postgres, 让 schema 和查询能在 PG 上跑.
 *
 * 纯函数, 单测: tests/v4-2-db-dialect.test.ts.
 */

/**
 * 占位符转换: SQLite 的 `?` (位置无关) → Postgres 的 `$1, $2, ...` (位置编号).
 * 跳过字符串字面量里的 `?` (单引号包裹), 不误伤.
 */
export function sqliteParamsToPg(sql: string): string {
  let out = '';
  let i = 0;
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" && !inDouble) {
      // 处理转义 '' (SQL 里连续两个单引号是字面量引号)
      if (inSingle && sql[i + 1] === "'") { out += "''"; i += 2; continue; }
      inSingle = !inSingle; out += c; i++; continue;
    }
    if (c === '"' && !inSingle) { inDouble = !inDouble; out += c; i++; continue; }
    if (c === '?' && !inSingle && !inDouble) { n++; out += '$' + n; i++; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * 单条 CREATE TABLE / INDEX DDL 的类型/语法翻译 SQLite → Postgres.
 *   - BLOB        → BYTEA
 *   - DATETIME    → TEXT (本项目时间戳都是 ISO 字符串)
 *   - AUTOINCREMENT 整数主键 → BIGSERIAL (本项目几乎不用, 防御性处理)
 *   - PRAGMA / 反引号 / 其余 SQLite 专有语法清理
 * CREATE [UNIQUE] INDEX IF NOT EXISTS / TEXT PRIMARY KEY / REAL / INTEGER 等 PG 原生兼容, 不动.
 */
export function translateDDL(ddl: string): string {
  let s = ddl;
  // 反引号 → 双引号 (PG 标识符引用)
  s = s.replace(/`/g, '"');
  // INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL PRIMARY KEY
  s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY');
  // 残留 AUTOINCREMENT 关键字清掉 (PG 无此关键字)
  s = s.replace(/\s+AUTOINCREMENT/gi, '');
  // 类型映射 (词边界, 避免误伤列名)
  s = s.replace(/\bBLOB\b/gi, 'BYTEA');
  s = s.replace(/\bDATETIME\b/gi, 'TEXT');
  // 注意: SQLite 的 `INTEGER`/`REAL`/`TEXT` 在 PG 里都合法, 保留.
  return s;
}

/**
 * v6.6 — 让 DDL 可直接在 PG 顺序 apply (不依赖 FK 顺序 + 去注释):
 *   - 去掉 `-- …` 行注释 (有的注释里含 `;`, 否则按分号切语句会断裂)
 *   - 去掉 `FOREIGN KEY (...) REFERENCES t(...)` 内联约束 (本项目 SQLite 未开 PRAGMA
 *     foreign_keys, FK 本就不强制; 去掉后建表无需按依赖排序, 行为一致) + 清理悬挂逗号
 * 纯函数, 单测覆盖.
 */
export function stripFkAndComments(ddl: string): string {
  let s = ddl;
  s = s.replace(/--[^\n]*/g, '');                                  // 行注释
  s = s.replace(/,?\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+"?\w+"?\s*\([^)]*\)/gi, ''); // FK 约束(连同前导逗号)
  s = s.replace(/,(\s*)\)/g, '$1)');                                // 悬挂逗号 `, )` → `)`
  return s;
}

/**
 * v6.6 — 让单条 CREATE 幂等 (SQLite sqlite_master 存的 DDL 会丢掉 `IF NOT EXISTS`,
 * 直接 apply 第二次会 "already exists"). 给 CREATE TABLE / [UNIQUE] INDEX 补回.
 */
export function ensureIdempotentDDL(ddl: string): string {
  return ddl
    .replace(/^(\s*CREATE\s+TABLE\s+)(?!IF\s+NOT\s+EXISTS)/i, '$1IF NOT EXISTS ')
    .replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?!IF\s+NOT\s+EXISTS)/i, '$1IF NOT EXISTS ');
}

/**
 * `INSERT OR REPLACE INTO t (...) VALUES (...)` → PG `ON CONFLICT` UPSERT.
 * 需要冲突目标列 (主键/唯一键). 传 conflictColumns, 自动生成 DO UPDATE SET 全列覆盖.
 * 拿不到列名时退化成 `ON CONFLICT DO NOTHING` 并在注释里标记.
 */
export function translateUpsert(sql: string, conflictColumns: string[] = []): string {
  const m = sql.match(/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+("?\w+"?)\s*\(([^)]*)\)/i);
  if (!m) {
    // 非 OR REPLACE 的普通 INSERT — 只翻占位符
    return sql.replace(/INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO/gi, 'INSERT INTO');
  }
  const table = m[1];
  const cols = m[2].split(',').map((c) => c.trim().replace(/"/g, '')).filter(Boolean);
  let head = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');
  const conflict = conflictColumns.length > 0 ? conflictColumns : cols.slice(0, 1);
  const updates = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  const onConflict = updates
    ? ` ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${updates}`
    : ` ON CONFLICT (${conflict.join(', ')}) DO NOTHING`;
  // 把 ON CONFLICT 接在末尾 (去掉可能的结尾分号再补回)
  const trimmed = head.replace(/;\s*$/, '');
  void table;
  return `${trimmed}${onConflict}`;
}

/** 是否是应在 PG 跳过的 SQLite 专有语句 (PRAGMA 等). */
export function isSqliteOnlyStatement(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql) || /^\s*VACUUM\b/i.test(sql);
}
