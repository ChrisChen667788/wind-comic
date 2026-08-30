/**
 * v12.390:否定式断言天然容易假绿 —— 把它做成第三类检测。
 *
 * `expect(win).not.toContain('x')` 在窗口切歪时**必然通过**:
 * indexOf 返回 -1、右界排在左界之前、目标文件读错 —— 任何一种都会切出空串或错段,
 * 而否定断言在空串上永远成立。这一轮我反复栽在这个形态上:
 *   · v12.340  锚点落在注释上,窗口切到 line 19–61,而要验的代码在 67 —— 真假绿;
 *   · v12.384  我自己写的测试因请求体缺字段 400 早退,`not.toHaveBeenCalled()`
 *              「通过」了却什么都没验;
 *   · v12.385  `toContain` 命中批量路径,单镜路径从没被验过。
 *
 * 手工加「窗口自证」加了好几次,现在固化:
 * **同一个 it 里,若某个来自 slice/substring 的变量只被 not.* 断言过、
 * 没有任何正向断言,就判为假绿。**
 *
 * 全仓扫出 **9 处**(含我前一版刚写的 v12-389),已逐条补上自证。
 *
 * 判定刻意做成「否定侧严格、正向侧放宽」:正向侧认根标识符,
 * 所以 `expect(win.length).toBeGreaterThan(0)` 也算自证 ——
 * 判得太死会逼人补一条没意义的断言去哄门禁,那本身就是新的假绿。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const GATE = path.join(ROOT, 'scripts/fake-green-gate.mjs');

function scanWith(testSrc: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tests'));
    fs.writeFileSync(path.join(tmp, 'tests/a.test.ts'), testSrc);
    try {
      return { code: 0, out: execFileSync('node', [GATE], { cwd: tmp, encoding: 'utf-8' }) };
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('第三类假绿:否定式断言没有窗口自证', () => {
  it('切片变量只有 not.* → 拦', () => {
    const r = scanWith("it('t', () => {\n  const win = SRC.slice(1, 9);\n  expect(win).not.toContain('x');\n});\n");
    expect(r.code).toBe(1);
    expect(r.out).toContain('没有正向断言自证');
  });

  it('有正向断言 → 放行', () => {
    const r = scanWith("it('t', () => {\n  const win = SRC.slice(1, 9);\n  expect(win).toContain('anchor');\n  expect(win).not.toContain('x');\n});\n");
    expect(r.code).toBe(0);
  });

  it('对长度的正向断言也算自证 —— 别逼人写哄门禁的断言', () => {
    const r = scanWith("it('t', () => {\n  const w = SRC.slice(1, 9);\n  expect(w.length).toBeGreaterThan(0);\n  expect(w).not.toContain('x');\n});\n");
    expect(r.code).toBe(0);
  });

  it('非切片变量的 not.* 不管 —— 只盯「窗口」这个真实风险源', () => {
    const r = scanWith("it('t', () => {\n  const v = compute();\n  expect(v).not.toContain('x');\n});\n");
    expect(r.code).toBe(0);
  });

  it('前两类检测没被这次改动弄坏', () => {
    expect(scanWith("it('t', () => {\n  const a = 1;\n});\n").out).toContain('零断言');
    expect(scanWith("it('t', () => {\n  const a = 1;\n});\n").code).toBe(1);
    expect(scanWith("it('t', () => {\n  expect(1);\n});\n").code).toBe(1);
  });
});

describe('全仓现状', () => {
  it('三类都为 0', () => {
    const out = execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf-8' });
    expect(out).toContain('无假绿测试');
    expect(out).toMatch(/否定式断言没有窗口自证[^\n]*: 0/);
  });

  it('这道门禁自己也进了 CI', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toContain('fake-green-gate.mjs');
  });

  it('preflight 9 步里 8 步在 CI —— 只剩媒体体积预算是本地的', () => {
    // v12.391 修正:第一版这里跑的是 `npm run preflight` 整条命令 ——
    // 于是 preflight 里**任何一步**失败都会连累这条测试,而它想验的只是
    // 「有几步标了 CI 会跑」。实际就栽了:一次 rebase 改写了提交哈希,
    // version-hash 那步判红,这条无关的测试跟着红。
    // 单元测试不该依赖一条会因无关原因失败的重命令 —— 直接读 STEPS 数就够了。
    const pre = fs.readFileSync(path.join(ROOT, 'scripts/preflight.mjs'), 'utf-8');
    const steps = [...pre.matchAll(/\{\s*ci:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
    expect(steps.length, '解析不出步骤,解析器该更新了').toBeGreaterThanOrEqual(9);
    const localOnly = steps.filter((t) => t.includes('(local only)'));
    expect(steps.length - localOnly.length, 'CI 上跑的步数').toBeGreaterThanOrEqual(8);
    expect(localOnly.length, '只剩媒体体积预算留在本地').toBeLessThanOrEqual(1);
  });
});
