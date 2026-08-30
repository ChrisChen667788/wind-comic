/**
 * v12.389:preflight 自称「与 CI Security job 同步」,而它一半的检查 CI 根本不跑。
 *
 * 实况:本地 preflight 8 步,CI security job 只有 4 步。
 * v12.378 的锚点门禁、v12.382 的付费端点门禁都是新建后**只挂在本地**的 ——
 * 而 preflight 跑完打印的是「✅ preflight: 8/8 通过(与 CI Security job 同步)」。
 * 那句话给人的印象是「这 8 条 CI 都会替我把关」,实际只有 4 条。
 * 真忘了跑 preflight 就推,CI 照样绿,门禁等于不存在 ——
 * 又一种假绿,而且是**关于门禁本身**的假绿,最不该有。
 *
 * 本版做三件事:
 *   ① 把两道纯静态门禁放进 CI(它们只读源码,没有任何理由留在本地);
 *   ② 结语改成如实报数「N 步中 M 步 CI 也会跑」;
 *   ③ 加一道**元门禁** —— 没标 (local only) 的步骤必须真在 ci.yml 里,
 *      标了的则不该在。它自己也进 CI,防的是**下一次**漂移。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const GATE = path.join(ROOT, 'scripts/preflight-parity.mjs');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const PRE = read('scripts/preflight.mjs');
const CI = read('.github/workflows/ci.yml');

describe('两道门禁真的进了 CI', () => {
  it.each([
    ['anchor-gate.mjs', '锚点门禁'],
    ['paid-endpoint-gate.mjs', '付费端点门禁'],
    ['preflight-parity.mjs', '元门禁自己'],
  ])('%s 出现在 ci.yml', (script) => {
    expect(CI).toContain(script);
  });

  it('这三道在 preflight 里也不再标 (local only)', () => {
    for (const s of ['anchor-gate.mjs', 'paid-endpoint-gate.mjs', 'preflight-parity.mjs']) {
      const i = PRE.indexOf(s);
      expect(i).toBeGreaterThan(0);
      // 往前找到这一条的 ci 标签
      const lineStart = PRE.lastIndexOf('{ ci:', i);
      expect(lineStart, '找不到这一条的 ci 标签起点').toBeGreaterThan(0);
      const label = PRE.slice(lineStart, i);
      expect(label, '窗口自证:必须切到 ci 字段').toContain('{ ci:');
      expect(label, `${s} 已进 CI,不该再标 local only`).not.toContain('(local only)');
    }
  });
});

describe('结语不再撒谎', () => {
  it('不再写死「与 CI Security job 同步」', () => {
    // 只看代码 —— 那句话仍留在文件抬头的注释里,因为它正是本版要讲的病根。
    // 「把问题讲清楚」不该让断言报警(consumer-gate contracts.ts 的设计原则第 2 条)。
    const code = PRE.split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toContain('与 CI Security job 同步');
    // 而注释里保留它是有意的:删掉就没人知道这句话曾经骗过人
    expect(PRE).toContain('与 CI Security job 同步');
  });

  it('改成按实际数量报 —— 数字由代码算出,不是手写', () => {
    expect(PRE).toMatch(/_ciSteps/);
    expect(PRE).toMatch(/CI 也会跑/);
  });
});

describe('元门禁本身', () => {
  function parityIn(preflight: string, ciYml: string) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
    try {
      fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'scripts/preflight.mjs'), preflight);
      fs.writeFileSync(path.join(tmp, '.github/workflows/ci.yml'), ciYml);
      try {
        return { code: 0, out: execFileSync('node', [GATE], { cwd: tmp, encoding: 'utf-8' }) };
      } catch (e: any) {
        return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const stepAaa = "const STEPS = [\n  { ci: 'A 检查', cmd: 'node scripts/aaa.mjs' },\n];";

  it('preflight 说 CI 会跑、ci.yml 里没有 → 拦', () => {
    const r = parityIn(stepAaa, 'jobs:\n  security:\n    steps:\n      - run: npm ci\n');
    expect(r.code).toBe(1);
    expect(r.out).toContain('aaa.mjs');
  });

  it('两边都有 → 放行', () => {
    const r = parityIn(stepAaa, 'jobs:\n  security:\n    steps:\n      - run: node scripts/aaa.mjs\n');
    expect(r.code).toBe(0);
  });

  it('标了 (local only) 却出现在 CI 里 → 也拦(标签在骗人)', () => {
    const r = parityIn(
      "const STEPS = [\n  { ci: '(local only) A 检查', cmd: 'node scripts/aaa.mjs' },\n];",
      'jobs:\n  security:\n    steps:\n      - run: node scripts/aaa.mjs\n',
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain('标签在骗人');
  });

  it('标了 (local only) 且 CI 里确实没有 → 放行', () => {
    const r = parityIn(
      "const STEPS = [\n  { ci: '(local only) A 检查', cmd: 'node scripts/aaa.mjs' },\n];",
      'jobs:\n  security:\n    steps:\n      - run: npm ci\n',
    );
    expect(r.code).toBe(0);
  });

  it('解析不出任何步骤 → 失败而不是「通过」', () => {
    // 一个什么都没解析到却报绿的元门禁,正是它自己要防的那种假绿
    const r = parityIn('const STEPS = [];', 'jobs:\n  security:\n    steps:\n      - run: npm ci\n');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/解析器该更新/);
  });

  it('按脚本文件名匹配,不因 npm run 与 node 写法不同而误报', () => {
    const r = parityIn(
      "const STEPS = [\n  { ci: 'A 检查', cmd: 'npm run gate:aaa' },\n];",
      'jobs:\n  security:\n    steps:\n      - run: node scripts/aaa.mjs\n',
    );
    // preflight 用 npm run(取不到脚本名)→ 退回命令首词匹配,ci.yml 里没有 "npm run" → 拦。
    // 这是刻意的保守:匹配不上就报,让人去确认,而不是假装同步。
    expect(r.code).toBe(1);
  });
});
