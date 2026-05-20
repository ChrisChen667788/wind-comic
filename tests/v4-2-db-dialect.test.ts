/**
 * v4.2 — SQLite → Postgres 方言转换单测.
 */

import { describe, it, expect } from 'vitest';
import {
  sqliteParamsToPg,
  translateDDL,
  translateUpsert,
  isSqliteOnlyStatement,
} from '@/lib/db-dialect';
import { exportPostgresSchema, listUserTables } from '@/lib/db-schema-export';

describe('v4.2 · sqliteParamsToPg', () => {
  it('numbers placeholders positionally', () => {
    expect(sqliteParamsToPg('INSERT INTO t (a,b,c) VALUES (?, ?, ?)'))
      .toBe('INSERT INTO t (a,b,c) VALUES ($1, $2, $3)');
  });
  it('handles WHERE with multiple params', () => {
    expect(sqliteParamsToPg('SELECT * FROM t WHERE a=? AND b=?'))
      .toBe('SELECT * FROM t WHERE a=$1 AND b=$2');
  });
  it('does not touch ? inside string literals', () => {
    expect(sqliteParamsToPg("SELECT * FROM t WHERE label='what?' AND x=?"))
      .toBe("SELECT * FROM t WHERE label='what?' AND x=$1");
  });
  it('handles escaped quotes inside literal', () => {
    const out = sqliteParamsToPg("INSERT INTO t (a) VALUES ('it''s ok?') -- x=?");
    // ? inside literal untouched; the one in comment after literal IS converted (we do not parse comments)
    expect(out).toContain("'it''s ok?'");
  });
  it('no placeholders → unchanged', () => {
    expect(sqliteParamsToPg('SELECT 1')).toBe('SELECT 1');
  });
});

describe('v4.2 · translateDDL', () => {
  it('maps BLOB → BYTEA', () => {
    expect(translateDDL('CREATE TABLE t (data BLOB NOT NULL)')).toContain('BYTEA');
  });
  it('maps DATETIME → TEXT', () => {
    expect(translateDDL('CREATE TABLE t (ts DATETIME)')).toContain('ts TEXT');
  });
  it('converts INTEGER PRIMARY KEY AUTOINCREMENT → BIGSERIAL', () => {
    const out = translateDDL('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)');
    expect(out).toContain('BIGSERIAL PRIMARY KEY');
    expect(out).not.toMatch(/AUTOINCREMENT/i);
  });
  it('leaves TEXT PRIMARY KEY untouched (PG compatible)', () => {
    const out = translateDDL('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER DEFAULT 0)');
    expect(out).toContain('id TEXT PRIMARY KEY');
    expect(out).toContain('n INTEGER DEFAULT 0');
  });
  it('backticks → double quotes', () => {
    expect(translateDDL('CREATE TABLE `t` (`x` TEXT)')).toContain('"t"');
  });
  it('keeps CREATE UNIQUE INDEX IF NOT EXISTS (PG native)', () => {
    const out = translateDDL('CREATE UNIQUE INDEX IF NOT EXISTS idx ON t(a, b)');
    expect(out).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
  });
});

describe('v4.2 · translateUpsert', () => {
  it('converts INSERT OR REPLACE → ON CONFLICT DO UPDATE', () => {
    const out = translateUpsert(
      `INSERT OR REPLACE INTO t (id, a, b) VALUES (?, ?, ?)`,
      ['id'],
    );
    expect(out).toContain('INSERT INTO t');
    expect(out).toContain('ON CONFLICT (id) DO UPDATE SET');
    expect(out).toContain('a = EXCLUDED.a');
    expect(out).toContain('b = EXCLUDED.b');
    expect(out).not.toMatch(/OR\s+REPLACE/i);
  });
  it('infers conflict col from first column when not given', () => {
    const out = translateUpsert(`INSERT OR REPLACE INTO t (pk, v) VALUES (?, ?)`);
    expect(out).toContain('ON CONFLICT (pk)');
  });
  it('INSERT OR IGNORE → plain INSERT', () => {
    expect(translateUpsert(`INSERT OR IGNORE INTO t (a) VALUES (?)`)).toContain('INSERT INTO t');
  });
  it('plain INSERT passes through', () => {
    const sql = `INSERT INTO t (a) VALUES (?)`;
    expect(translateUpsert(sql)).toBe(sql);
  });
  it('single-column upsert → DO NOTHING (nothing to update)', () => {
    const out = translateUpsert(`INSERT OR REPLACE INTO t (id) VALUES (?)`, ['id']);
    expect(out).toContain('DO NOTHING');
  });
});

describe('v4.2 · isSqliteOnlyStatement', () => {
  it('flags PRAGMA + VACUUM', () => {
    expect(isSqliteOnlyStatement('PRAGMA journal_mode = WAL')).toBe(true);
    expect(isSqliteOnlyStatement('  vacuum')).toBe(true);
    expect(isSqliteOnlyStatement('SELECT 1')).toBe(false);
  });
});

describe('v4.2 · schema export (live SQLite)', () => {
  it('exports translated DDL for known tables', () => {
    const schema = exportPostgresSchema();
    expect(schema).toContain('CREATE TABLE');
    // 已知表应出现
    expect(schema).toContain('users');
    expect(schema).toContain('projects');
    // 不应残留 SQLite 专有 BLOB (yjs_docs.state) — 应翻成 BYTEA
    expect(schema).not.toMatch(/\bBLOB\b/);
  });
  it('lists user tables incl. v3/v4 additions', () => {
    const tables = listUserTables();
    expect(tables).toContain('plugin_chain_events');
    expect(tables).toContain('shot_vision_audits');
    expect(tables).toContain('character_ip_tokens');
    expect(tables).toContain('agent_workflows');
    expect(tables).not.toContain('sqlite_sequence');
  });
});
