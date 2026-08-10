/**
 * v12.306 — 两处并发写覆盖(与 v12.303 的 upsert 竞态同族,不同表现)。
 *
 * **① `setSeriesAnchor` 的 UPDATE-then-INSERT。**
 * `series_anchors.series_id` 是主键。批量多集生成时两集几乎同时完成:两次 UPDATE 都命中 0 行 →
 * 两次 INSERT,后者**抛主键冲突** → 那一集的 job 被标 `failed`,剧集管理页显示某集出错,
 * 而它的视频其实早就好了。**报错的是无辜的那一集。**
 *
 * **② `lipsync-align` 的读-合并-删-插。** 这个更隐蔽 —— 不报错,**默默丢数据**:
 *   A 读到 `{shot1:80}`,合并 shot2 → `{shot1:80, shot2:90}`
 *   B 读到 `{shot1:80}`,合并 shot3 → `{shot1:80, shot3:70}`
 *   A 删+插,B 删+插 → **A 的 shot2 被彻底覆盖,再也不会出现**。
 * 而 publish-readiness 拿这份分做发布门禁 —— 漏掉的镜头会让门禁**错误地放行**。
 *
 * 两处都用同一招:整体放进 `driver.transaction()`。
 * 顺带把 v12.303 写在 `repos/asset-repo` 的 `isUniqueViolation` 收口到 `lib/db-driver` ——
 * 它是驱动级概念,而 series-repo 也要用;repo 侧只 re-export,既有引用不变。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { isUniqueViolation } from '@/lib/db-driver';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SERIES = strip(fs.readFileSync('lib/repos/series-repo.ts', 'utf-8'));
const LIP = strip(fs.readFileSync('app/api/projects/[id]/lipsync-align/route.ts', 'utf-8'));
const ASSET = strip(fs.readFileSync('lib/repos/asset-repo.ts', 'utf-8'));

describe('v12.306 · setSeriesAnchor 不再因并发把无辜的一集标 failed', () => {
  it('UPDATE 与 INSERT 在同一事务里', () => {
    const i = SERIES.indexOf('export async function setSeriesAnchor');
    const block = SERIES.slice(i, i + 1200);
    expect(block).toContain('getDbDriver().transaction(');
    expect(block, '两步都要用事务内的 tx').toMatch(/tx\.run\([\s\S]*UPDATE series_anchors/);
    expect(block).toMatch(/tx\.run\([\s\S]*INSERT INTO series_anchors/);
  });

  it('真撞主键冲突时改为更新,而不是把异常抛给 job(那会让整集被标失败)', () => {
    const i = SERIES.indexOf('export async function setSeriesAnchor');
    const block = SERIES.slice(i, i + 1200);
    expect(block).toContain('isUniqueViolation');
    expect(block, '非冲突异常必须原样抛出').toMatch(/if \(!isUniqueViolation\(e\)\) throw e/);
    // 兜底后要真的再更新一次,否则这次写入就丢了
    const j = block.indexOf('isUniqueViolation');
    expect(block.slice(j, j + 300)).toMatch(/UPDATE series_anchors/);
  });
});

describe('v12.306 · lipsync-align 的读-改-写整体原子', () => {
  it('读、合并、删、插全在同一事务内', () => {
    const i = LIP.indexOf('getDbDriver().transaction(');
    expect(i, '未包事务').toBeGreaterThan(0);
    const block = LIP.slice(i, i + 900);
    expect(block, '读也必须在事务内,否则读到的是别人删之前的旧值').toContain('readScores(id, tx)');
    expect(block).toContain("deleteAssetsByType(id, 'lipsync-align', tx)");
    expect(block).toMatch(/createAsset\(\{[\s\S]*\}, tx\)/);
  });

  it('事务外不得再有一份「先读后写」的残留', () => {
    // 旧代码是 `const merged = { ...(await readScores(id)) }` 直接在顶层
    expect(LIP).not.toMatch(/const merged: Record<string, number> = \{ \.\.\.\(await readScores\(id\)\) \}/);
  });

  it('三个仓库函数都支持传入 executor(复用同一份实现,不复制 SQL)', () => {
    expect(ASSET).toMatch(/deleteAssetsByType\(projectId: string, type: string, exec\?: DbExecutor\)/);
    expect(ASSET).toMatch(/listAssetsByType\(projectId: string, type: string, exec\?: DbExecutor\)/);
    expect(ASSET).toMatch(/exec \?\? getDbDriver\(\)/);
  });
});

describe('v12.306 · isUniqueViolation 收口到驱动层', () => {
  it('asset-repo 只 re-export,不再自带一份', () => {
    expect(ASSET).toContain("export { isUniqueViolation } from '../db-driver'");
    expect(ASSET, '不该还有第二份实现').not.toMatch(/export function isUniqueViolation/);
  });

  it('认得两种驱动的冲突码,含主键冲突(series_anchors 撞的正是主键)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true);
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: series_anchors.series_id'))).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(true);
  });

  it('别的错误不当成冲突(不能把真异常吞掉)', () => {
    expect(isUniqueViolation(new Error('database is locked'))).toBe(false);
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('v12.306 · 行为对照:后写覆盖 vs 合并', () => {
  /** 复刻「各读各的、各写各的」—— 后写者会抹掉先写者的字段 */
  const lostUpdate = (base: Record<string, number>, a: Record<string, number>, b: Record<string, number>) => {
    const wroteA = { ...base, ...a };   // A 基于 base 合并后整体覆盖
    const wroteB = { ...base, ...b };   // B 也基于 base —— 没看见 A 写的
    return { final: wroteB, lost: Object.keys(wroteA).filter((k) => !(k in wroteB)) };
  };

  it('对照:A 的 shot2 分数被 B 彻底覆盖', () => {
    const r = lostUpdate({ shot1: 80 }, { shot2: 90 }, { shot3: 70 });
    expect(r.final).toEqual({ shot1: 80, shot3: 70 });
    expect(r.lost, 'shot2 再也不会出现').toEqual(['shot2']);
  });

  it('串行(事务保证的效果)下两份分数都在', () => {
    const afterA = { shot1: 80, shot2: 90 };
    const afterB = { ...afterA, shot3: 70 };   // B 读到的是 A 已提交的结果
    expect(afterB).toEqual({ shot1: 80, shot2: 90, shot3: 70 });
  });
});
