/**
 * v12.307 — 模板评分的**聚合回写**存在 lost update(并发类三连的最后一条)。
 *
 * 容易看漏的地方在于:**单条评分的写入本来就是原子的** ——
 * `INSERT ... ON CONFLICT (template_id, user_id) DO UPDATE` 一句到底,没有竞态。
 * 坏的是它后面那段「SELECT COUNT/SUM → UPDATE 冗余列」:
 *
 *   A 插入 → A 读到 c=6 → B 插入 → B 读到 c=7 → B 写 7 → **A 用 6 覆盖**
 *
 * 于是 B 那一票在模板市场展示的均分/人数里凭空消失 —— 而 `template_ratings`
 * 明细表里它明明在。**展示值与明细对不上账**,且这种偏差不会自愈。
 *
 * 与 v12.303 / v12.306 同一招:插入 + 聚合 + 回写整体进事务,**读也在事务内**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const TPL = strip(fs.readFileSync('lib/repos/template-repo.ts', 'utf-8'));

/** 取某个导出函数的**函数体**(到下一个 export 为止)—— 窗口开大了会切进邻居函数,
 *  第一次写就栽在这:1600 字符的窗口切到了 toggleFavorite,那里的 d.run 让断言误红。 */
const bodyOf = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  if (i < 0) return '';
  const j = src.indexOf('\nexport ', i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};

describe('v12.307 · 聚合回写整体原子', () => {
  it('插入 / 聚合 / 回写三步都在同一事务里', () => {
    const block = bodyOf(TPL, 'rateTemplate');
    expect(block).toContain('getDbDriver().transaction(');
    expect(block, '插入要用 tx').toMatch(/tx\.run\([\s\S]*INSERT INTO template_ratings/);
    expect(block, '**读也必须在事务内**,否则包了等于白包').toMatch(/tx\.get<\{ c: number; s: number \}>/);
    expect(block, '回写要用 tx').toMatch(/tx\.run\(`UPDATE film_templates SET rating_sum/);
  });

  it('事务外不得残留旧的 d.run / d.get 调用', () => {
    const block = bodyOf(TPL, 'rateTemplate');
    expect(block).not.toMatch(/await d\.run\(/);
    expect(block).not.toMatch(/await d\.get</);
  });

  it('单条评分仍走 ON CONFLICT(本来就没问题的部分不要改坏)', () => {
    expect(TPL).toContain('ON CONFLICT (template_id, user_id) DO UPDATE');
  });

  it('toggleFavorite 没有聚合回写,不该被顺手改动(它本来就没这个病)', () => {
    const block = bodyOf(TPL, 'toggleFavorite');
    expect(block).toContain('ON CONFLICT (user_id, template_id) DO NOTHING');
    expect(block, '没有冗余计数列要维护,不需要事务').not.toContain('transaction(');
  });
});

describe('v12.307 · 行为对照:lost update 长什么样', () => {
  /** 复刻「各读各的、各写各的」的聚合回写 */
  const raceWrite = (readA: number, readB: number) => {
    let stored = 0;
    stored = readB;   // B 先落
    stored = readA;   // A 后落 —— 用的是它更早读到的旧值
    return stored;
  };

  it('对照:A 的陈旧读覆盖了 B 的正确值', () => {
    expect(raceWrite(6, 7), 'A 读到 6 时 B 还没插入').toBe(6);
  });

  it('串行(事务保证的效果)下计数正确', () => {
    // A 提交后 B 才读 → B 读到 7,最终 7
    let stored = 6;      // A 事务提交
    stored = 7;          // B 在 A 之后读并写
    expect(stored).toBe(7);
  });

  it('偏差不会自愈:除非有人再评一次,展示值一直是错的', () => {
    const shown = 6, actual = 7;
    expect(shown).not.toBe(actual);
  });
});
