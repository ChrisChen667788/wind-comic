/**
 * v12.326 — 审计透镜①:**会绿但什么都没验的测试**。
 *
 * ── 为什么这一版的检查器写废了两遍(值得写下来)────────────────────
 * ① 第一版数花括号切 `it()` 体,没排除字符串 —— `indexOf('}')` 把配平算歪,
 *    报出一堆并不存在的「零断言」;
 * ② 第二版改括号配平,没排除**正则字面量** —— `/foo\(/` 里的 `(` 再次算歪,
 *    报出「**4051 处**悬空断言」。
 * 一个用来抓假绿的工具,自己连着给了两次假结果。第三版改用 **TypeScript 语法树**:
 * 不猜词法,问编译器。473 个文件扫出 **3 处**,量级本身就说明前两版是垃圾。
 *
 * ── 抓到的真问题 ──────────────────────────────────────────────────
 * `tests/v3-0-ws-server-e2e.test.ts` 的「rejects invalid doc names」**一个断言都没有**:
 * 它在 'close' 或 **1500ms 超时**时都 resolve。于是服务端即便**不拒绝**非法 doc name,
 * 这条用例照样绿 —— 一条守护 doc 名白名单的测试,从写下起没验过任何东西。
 *
 * ── 刻意删掉的一类检查 ────────────────────────────────────────────
 * 曾加过「async 测试体没有 await」,跑出两处**全是假阳性**:函数体本就同步、
 * 只是多写了个 `async`;vitest 会 await 返回的 promise,断言抛错照样失败。
 * 它不对应任何真实故障模式 —— **留着只会训练人忽略门禁**,故删除。
 * 宁可少报,不可乱报。
 *
 * ── 门禁必须自证能抓 ──────────────────────────────────────────────
 * 「跑了没报错」不等于「它抓得住」。下面用**故意造的假绿代码**喂给它,
 * 断言两类都被抓出来 —— 否则这个门禁自己就是下一个假绿。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 每条自测都要另起一个 node 进程并 `import typescript` —— 光这一步就约 8s
// (与被扫文件数无关,是包体加载成本),所以下面统一给 30s 超时。
const GATE = 'scripts/fake-green-gate.mjs';
const raw = fs.readFileSync(GATE, 'utf-8');

function runGateOn(files: Record<string, string>): { code: number; out: string } {
  // 在 tests/ 下临时造探针目录 —— 门禁固定扫 tests/,不接受路径参数(刻意:
  // 可传路径的门禁容易被「只扫一个干净目录」绕过)。
  const dir = path.join('tests', `__probe_${Math.abs(Date.now() % 1e6)}__`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    try {
      // 自测只扫探针目录 —— 全仓解析约 11s,会顶穿测试超时。--dir 会把扫描根打印
      // 出来,所以「缩小范围」这件事在输出里是可见的,不构成绕过。
      const out = execFileSync('node', [GATE, '--dir', dir], { encoding: 'utf-8' });
      return { code: 0, out };
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('v12.326 · 门禁自证:抓得住故意造的假绿', () => {
  it('**零断言**被抓出来', () => {
    const r = runGateOn({
      'p.test.ts': `import { it } from 'vitest';\nit('什么都没验', () => { const x = 1; void x; });\n`,
    });
    expect(r.code, '零断言未被拦下').toBe(1);
    expect(r.out).toMatch(/零断言/);
    expect(r.out).toContain('什么都没验');
  }, 30_000);

  it('**悬空断言**(expect 没接 matcher)被抓出来', () => {
    const r = runGateOn({
      'p.test.ts': `import { it, expect } from 'vitest';\nit('没有 matcher', () => { expect(1 + 1); });\n`,
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/悬空断言/);
  }, 30_000);

  it('**正常测试不被误报**(误报比漏报更快让人无视门禁)', () => {
    const r = runGateOn({
      'p.test.ts': `import { it, expect } from 'vitest';\n`
        + `it('正常', () => { expect(1 + 1).toBe(2); });\n`
        // 下面这些正是把前两版检查器坑翻的写法
        + `it('字符串里有花括号', () => { expect('}{'.length).toBe(2); });\n`
        + `it('正则里有括号', () => { expect(/foo\\(/.test('foo(')).toBe(true); });\n`
        + `it('async 但体内同步', async () => { expect(1).toBe(1); });\n`,
    });
    expect(r.code, `正常测试被误报:\n${r.out}`).toBe(0);
  }, 30_000);
});

describe('v12.326 · 仓库当前无假绿', () => {
  it('全仓扫描通过(这条刻意走默认根,慢一点也要真扫)', () => {
    let out = '', code = 0;
    try { out = execFileSync('node', [GATE], { encoding: 'utf-8' }); }
    catch (e: any) { code = e.status ?? 1; out = `${e.stdout || ''}${e.stderr || ''}`; }
    expect(out, '必须打印扫描根,便于识别「只扫干净目录」').toMatch(/根目录: tests/);
    expect(code, out).toBe(0);
  }, 60_000);

  it('那条 ws 测试补上了真断言(原先超时也算过)', () => {
    const t = fs.readFileSync('tests/v3-0-ws-server-e2e.test.ts', 'utf-8');
    const i = t.indexOf("rejects invalid doc names");
    const block = t.slice(i, i + 900);
    expect(block).toMatch(/expect\(closed/);
    expect(block, '超时路径必须判为失败,不能也算通过').toMatch(/done\(false\)/);
  });
});

describe('v12.326 · 门禁本身的取舍写在代码里', () => {
  it('用 AST 而不是正则,并记下前两版为什么废了', () => {
    expect(raw).toMatch(/typescript|ts\.createSourceFile/);
    expect(raw).toMatch(/正则字面量/);
  });

  it('记下了「刻意不抓 async-无-await」及其理由', () => {
    expect(raw).toMatch(/假阳性/);
    expect(raw).toMatch(/宁可少报,不可乱报/);
  });

  it('豁免必须带理由(空理由不算豁免)', () => {
    expect(raw).toMatch(/ALLOW/);
    expect(raw).toMatch(/理由(必填|)/);
    expect(raw).toContain('ALLOW[k]');   // 空字符串理由 → falsy → 不豁免
  });

  it('已进 preflight(不进发版流程的门禁等于没有)', () => {
    const pre = fs.readFileSync('scripts/preflight.mjs', 'utf-8');
    expect(pre).toContain('fake-green-gate.mjs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts['gate:fake-green']).toBeTruthy();
  });
});

describe('v12.326 · 统计数字本身必须可信(骤降防护)', () => {
  const SYNC = 'scripts/sync-doc-stats.mjs';
  const run = (args: string[]) => {
    try { return { code: 0, out: execFileSync('node', [SYNC, ...args], { encoding: 'utf-8' }) }; }
    catch (e: any) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
  };

  it('**骤降会被拦下** —— v12.321 的 683 是个正数,原先一路畅通', () => {
    const r = run(['--tests=683', '--check']);
    expect(r.code, '683 竟被放行').not.toBe(0);
    expect(r.out).toMatch(/骤降/);
    expect(r.out, '要说清是多少 → 多少').toMatch(/→ 683/);
  });

  it('报错要指出**大概率原因**,而不是只说「非法」', () => {
    const r = run(['--tests=683', '--check']);
    expect(r.out).toMatch(/收集期出错|截断/);
    expect(r.out, '要给出下一步怎么查').toMatch(/vitest list/);
  });

  it('0 仍被拦(原有防护未被改坏)', () => {
    expect(run(['--tests=0', '--check']).code).not.toBe(0);
  });

  it('**--force 可明示放行** —— 真要大改测试时不能被门禁锁死', () => {
    const src = fs.readFileSync(SYNC, 'utf-8');
    expect(src).toContain("args.includes('--force')");
  });

  it('阈值与理由写在代码里', () => {
    const src = fs.readFileSync(SYNC, 'utf-8');
    expect(src).toMatch(/0\.8/);
    expect(src).toMatch(/徽章是对外承诺/);
  });
});
