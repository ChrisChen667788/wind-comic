/**
 * v12.303 — `upsertAsset` 的 check-then-insert 竞态。
 *
 * 「查到就更新、查不到就插入」两步之间没有任何互斥。pipeline job 被 requeue
 * (心跳超时 / 手动重试)时两个 worker 会同时走到这里:两次 UPDATE 都命中 0 行 →
 * 两次 INSERT 都成功 → **同一镜号出现两条资产行**。
 * 后果:render-loop 把 version 当 attempts 计数,取到错误行后 attempts 虚高;
 * export 与下游 `LIMIT 1` 子查询可能拿到旧行而不是最新产物。
 *
 * ── 我先修错了一次,值得记下来 ──────────────────────────────────────────
 * 第一版我加的是 `(project_id, type, shot_number)` 部分唯一索引。**测试当场抓住**:
 * voice-retake 的 take 历史**故意**为同一镜存多行(追加式历史),
 * 唯一索引会让「重录第二次」直接失败 —— 5 条测试全红。
 * **同一张表上既有 upsert 语义又有 append 语义,用表级约束就是选错了工具。**
 * (更早我还差点把索引写进主 schema 的 `db.exec` 大模板里 —— 存量库有重复行时
 *  整段 schema 一起炸,应用直接起不来。)
 *
 * 正解是驱动**本来就有**的 `transaction()`:把两步放进同一事务。
 * SQLite 走 BEGIN/COMMIT 同连接,PG 从池里 checkout 单 client 全程跑。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { isUniqueViolation } from '@/lib/repos/asset-repo';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const REPO = strip(fs.readFileSync('lib/repos/asset-repo.ts', 'utf-8'));
const DB = strip(fs.readFileSync('lib/db.ts', 'utf-8'));

describe('v12.303 · 两步进同一事务', () => {
  it('upsertAsset 用 driver.transaction 包住「更新 + 插入」', () => {
    const i = REPO.indexOf('export async function upsertAsset');
    const block = REPO.slice(i, i + 1400);
    expect(block).toContain('getDbDriver().transaction(');
    // 两步都必须用事务内的 executor,漏一个就等于没包
    expect(block).toMatch(/updateAssetBySelector\(input\.projectId, sel, patch, tx\)/);
    expect(block).toMatch(/createAsset\(input, tx\)/);
  });

  it('事务内插入后的回读也走同一 executor(PG 会从池里另取 client)', () => {
    expect(REPO).toContain('getAsset(id, exec)');
    const i = REPO.indexOf('export async function getAsset');
    expect(REPO.slice(i, i + 220)).toContain('exec ?? getDbDriver()');
  });

  it('两个被复用的写函数都支持传入 executor(而不是复制一份 SQL)', () => {
    expect(REPO).toMatch(/export async function createAsset\(input: CreateAssetInput, exec\?: DbExecutor\)/);
    expect(REPO).toMatch(/exec\?: DbExecutor,\n\): Promise<number>/);
  });
});

describe('v12.303 · 冲突判定(为将来的唯一约束留后路)', () => {
  it('认得 Postgres 23505 与 SQLite SQLITE_CONSTRAINT_*', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true);
  });

  it('无 code 时退回文案匹配(驱动包装过异常的情况)', () => {
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: project_assets.id'))).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(true);
  });

  it('别的错误一律不当成冲突(不能把真异常吞掉)', () => {
    expect(isUniqueViolation(new Error('database is locked'))).toBe(false);
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);   // undefined_table
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('非冲突异常必须原样抛出,不能被兜底路径吃掉', () => {
    const i = REPO.indexOf('if (!isUniqueViolation(e)) throw e');
    expect(i, '缺少「非冲突就抛」的守卫').toBeGreaterThan(0);
  });
});

describe('v12.303 · 那条错误的唯一索引不得回来', () => {
  it('**表上不许有 (project_id, type, shot_number) 唯一索引**', () => {
    expect(DB, 'take 历史故意同镜多行,唯一索引会让重录第二次失败')
      .not.toMatch(/UNIQUE INDEX[\s\S]{0,120}project_assets\(project_id, type, shot_number\)/);
    expect(DB).not.toContain('uq_project_assets_shot');
  });

  it('主 schema 的大 db.exec 里不得出现 project_assets 的唯一索引', () => {
    // 存量库若有重复行,建索引失败会让整段 schema 一起炸 → 应用起不来
    const i = DB.indexOf('CREATE TABLE IF NOT EXISTS project_assets');
    const j = DB.indexOf('`);', i);
    expect(DB.slice(i, j)).not.toMatch(/UNIQUE INDEX/);
  });

  it('take 历史确实是追加式的(这条约束的反例来源)', () => {
    const rt = fs.readFileSync('lib/voice-retake.ts', 'utf-8');
    expect(rt).toContain('createAsset({');
    expect(rt).toContain('TAKE_TYPE');
  });
});
