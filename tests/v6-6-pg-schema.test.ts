/**
 * v6.6 — PG 全量切换: schema 翻译 apply-ready 化 单测.
 */

import { describe, it, expect } from 'vitest';
import { stripFkAndComments, ensureIdempotentDDL, translateDDL } from '@/lib/db-dialect';
import { exportPostgresSchema } from '@/lib/db-schema-export';

describe('v6.6 · stripFkAndComments', () => {
  it('去掉 FK 约束 + 前导逗号 + 悬挂逗号', () => {
    const ddl = `CREATE TABLE t (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;
    const out = stripFkAndComments(ddl);
    expect(out).not.toMatch(/FOREIGN KEY/i);
    expect(out).not.toMatch(/,\s*\)/); // 无悬挂逗号
    expect(out).toMatch(/user_id TEXT NOT NULL/);
  });

  it('多个 FK 全去掉', () => {
    const ddl = `CREATE TABLE t (
  a TEXT,
  FOREIGN KEY (a) REFERENCES x(id),
  FOREIGN KEY (b) REFERENCES y(id)
)`;
    expect(stripFkAndComments(ddl)).not.toMatch(/FOREIGN KEY/i);
  });

  it('去掉行注释 (包括含分号的注释)', () => {
    const ddl = `CREATE TABLE t (
  id TEXT, -- 这是注释; 含分号会坑按分号切语句
  name TEXT
)`;
    const out = stripFkAndComments(ddl);
    expect(out).not.toMatch(/--/);
    expect(out).not.toContain('含分号');
    expect(out).toMatch(/name TEXT/);
  });
});

describe('v6.6 · ensureIdempotentDDL', () => {
  it('给 CREATE TABLE 补 IF NOT EXISTS', () => {
    expect(ensureIdempotentDDL('CREATE TABLE foo (id TEXT)')).toMatch(/CREATE TABLE IF NOT EXISTS foo/);
  });
  it('给 CREATE INDEX / UNIQUE INDEX 补', () => {
    expect(ensureIdempotentDDL('CREATE INDEX i ON t(a)')).toMatch(/CREATE INDEX IF NOT EXISTS i/);
    expect(ensureIdempotentDDL('CREATE UNIQUE INDEX u ON t(a)')).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS u/);
  });
  it('已有 IF NOT EXISTS 不重复加', () => {
    const s = 'CREATE TABLE IF NOT EXISTS foo (id TEXT)';
    expect(ensureIdempotentDDL(s)).toBe(s);
  });
});

describe('v6.6 · translateDDL (沿用 v4.2, 回归)', () => {
  it('BLOB→BYTEA, AUTOINCREMENT→BIGSERIAL', () => {
    expect(translateDDL('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, b BLOB)'))
      .toMatch(/BIGSERIAL PRIMARY KEY.*BYTEA/s);
  });
});

describe('v6.6 · exportPostgresSchema applyReady', () => {
  const ddl = exportPostgresSchema({ applyReady: true });

  it('含核心表 + 阶段八新表', () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS users/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS projects/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS team_invites/);   // v6.5.1
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS pipeline_reruns/); // v6.4.1
  });

  it('apply-ready: 无 FK 约束 / 无 AUTOINCREMENT', () => {
    expect(ddl).not.toMatch(/FOREIGN KEY/i);
    expect(ddl).not.toMatch(/AUTOINCREMENT/i);
  });

  it('每条建表/索引语句都幂等 (IF NOT EXISTS)', () => {
    const creates = ddl
      .split(';')
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter((s) => /^CREATE\s+(TABLE|(UNIQUE\s+)?INDEX)/i.test(s));
    expect(creates.length).toBeGreaterThan(10);
    expect(creates.every((s) => /IF\s+NOT\s+EXISTS/i.test(s))).toBe(true);
  });

  it('默认模式 (非 applyReady) 保留 FK (v4.2 行为不变)', () => {
    expect(exportPostgresSchema()).toMatch(/FOREIGN KEY/i);
  });
});
