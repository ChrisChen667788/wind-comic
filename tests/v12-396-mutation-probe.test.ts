/**
 * v12.396:「数断言」判不出测试的真实保护力。
 *
 * 一次静态扫描告诉我「全仓 106 个谓词里,12 个只有负例断言」。逐个实证之后
 * **只有 1 个是真的** —— 误报率 11/12。`isAncient` / `isHorror` 看着也只有
 * `toBe(false)`,但它们有**间接**正例覆盖(`detectGenreKind` 与 `lock()` 的
 * 「题材锁定」字段);`isDissolveTransition` 的正例在同文件更下面、
 * `parseEditIntent` 用的是 `toEqual` 而非 `toBe` —— 我的正则都没看见。
 *
 * 唯独 `isSad` 是真的:它落在 `detectedMoods` 这条支线上,
 * 而 `lock()` 提取的是「题材锁定」字段、不含「情绪基调」,所以没有任何间接覆盖。
 * 把它改成 `() => false`,全仓测试**照样全绿** —— 而它唯一的消费方
 * `prompt-templates` 会因此永远不给 LLM 加「悲情基调」:
 * owner 写悲剧题材时,脚本 prompt 里少了这一层情绪指示。
 *
 * 结论是方法论层面的:**一个断言有没有用,只有把实现改坏、看它红不红才知道。**
 * 所以留下 `scripts/mutation-probe.mjs` 这个按需工具 —— 它**不进 preflight**
 * (要改源文件并跑测试,太重;而且改源文件的东西不该在每次发版时自动跑)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const PROBE = path.join(ROOT, 'scripts/mutation-probe.mjs');

function runProbe(args: string[], cwd = ROOT) {
  try {
    return { code: 0, out: execFileSync('node', [PROBE, ...args], { cwd, encoding: 'utf-8' }) };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 造一个自带 vitest 的临时工程太重 —— 用真实仓库里已知的两个例子验行为 */
describe('变异探针', () => {
  it('isSad 现在有保护了(本版补的正例)', () => {
    const r = runProbe(['isSad', 'lib/genre-vocab.ts', 'tests/v12-362-genre-vocab.test.ts']);
    expect(r.out).toContain('有保护');
    expect(r.code).toBe(0);
  }, 180_000);

  it('探针跑完必须把源文件原样还原', () => {
    const before = fs.readFileSync(path.join(ROOT, 'lib/genre-vocab.ts'), 'utf-8');
    runProbe(['isHorror', 'lib/genre-vocab.ts', 'tests/v12-362-genre-vocab.test.ts']);
    const after = fs.readFileSync(path.join(ROOT, 'lib/genre-vocab.ts'), 'utf-8');
    expect(after, '探针改了源文件却没还原 —— 那比它要查的问题更糟').toBe(before);
  }, 180_000);

  it('参数不全 → 打用法并退出 2,不去碰任何文件', () => {
    const r = runProbe(['isSad']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('用法');
  });

  it('认不出定义形态 → 明确说出来,而不是假装通过', () => {
    const r = runProbe(['压根不存在的函数名', 'lib/genre-vocab.ts', 'tests/v12-362-genre-vocab.test.ts']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('认不出');
  });

  it('源文件/测试文件不存在 → 退出 2', () => {
    expect(runProbe(['isSad', 'lib/不存在.ts', 'tests/v12-362-genre-vocab.test.ts']).code).toBe(2);
    expect(runProbe(['isSad', 'lib/genre-vocab.ts', 'tests/不存在.test.ts']).code).toBe(2);
  });
});

describe('isSad 这条链现在锁住了', () => {
  it('单元层有正例', () => {
    const t = fs.readFileSync(path.join(ROOT, 'tests/v12-362-genre-vocab.test.ts'), 'utf-8');
    const i = t.indexOf('判为悲情');
    expect(i, '找不到正例用例').toBeGreaterThan(0);
    const win = t.slice(Math.max(0, i - 400), i + 200);
    expect(win, '窗口自证').toContain('isSad');
    expect(win).toMatch(/toBe\(true\)/);
  });

  it('全链路层锁到 prompt —— 单元正例证明不了「它真的进了给 LLM 的 prompt」', () => {
    const t = fs.readFileSync(path.join(ROOT, 'tests/prompt-templates.test.ts'), 'utf-8');
    expect(t).toMatch(/情绪基调[^\n]*悲情/);
    expect(t, '也要有反例,否则「永远加悲情基调」同样能绿').toMatch(/not\.toMatch\(\/悲情基调\//);
  });

  it('探针不在 preflight 里 —— 它会改源文件,不该每次发版自动跑', () => {
    const pre = fs.readFileSync(path.join(ROOT, 'scripts/preflight.mjs'), 'utf-8');
    expect(pre).not.toContain('mutation-probe');
  });
});
