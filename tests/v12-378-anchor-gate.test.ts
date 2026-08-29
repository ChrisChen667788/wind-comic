/**
 * v12.378:「indexOf 命中第一处」这个坑,我一天之内栽了三次。
 *
 *   · v12.369 `findCharacterBibleByName` 命中 import(偏移 808)而不是调用点(1988);
 *   · v12.375 `for (const c of clips)` 在广告净化段先出现过,窗口长度变负、切出空串,
 *              断言以**错误的理由**变红;
 *   · v12.377 `send('complete')` 命中早退分支;`shouldStopForQuota` 命中 import 语句。
 *
 * 危害双向,而假绿那面更隐蔽:锚点落在 import 或注释上时,
 * `not.toMatch(...)` 会在一段无关代码里**静静通过** ——
 * 被断言保护的那段代码其实从来没被检查过。
 *
 * 全仓扫描找到 8 处歧义锚点,逐条核对后确认 **v12-340 那处是真的假绿**:
 * 'publish-preflight' 在 distribution-panel.tsx 出现 3 次,第一处是 line 19 的注释,
 * 窗口切成 line 19→61,而真正的预检 fetch 在 line 67 —— 在窗口之外。
 * 那条「不该把预检失败塞进主错误态」的断言,验的是一段与预检无关的代码。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const GATE = path.join(process.cwd(), 'scripts/anchor-gate.mjs');
const BASELINE = path.join(process.cwd(), 'lib/consumer-gate/anchor-baseline.json');

function runGate(cwd = process.cwd()) {
  try {
    return { code: 0, out: execFileSync('node', [GATE], { cwd, encoding: 'utf-8' }) };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('锚点门禁', () => {
  it('当前仓库无新增歧义锚点', () => {
    const r = runGate();
    expect(r.out).toContain('锚点门禁通过');
    expect(r.code).toBe(0);
  });

  it('门禁真的能检出歧义锚点(造一个给它抓)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-gate-'));
    try {
      fs.mkdirSync(path.join(tmp, 'tests'));
      fs.mkdirSync(path.join(tmp, 'src'));
      // 目标源码里 'doThing' 出现两次:import 一次、调用一次 —— 正是本 bug 的形态
      fs.writeFileSync(path.join(tmp, 'src/target.ts'),
        "import { doThing } from './x';\nexport function run() {\n  return doThing(1);\n}\n");
      fs.writeFileSync(path.join(tmp, 'tests/a.test.ts'),
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/target.ts'), 'utf-8');\n" +
        "const i = SRC.indexOf('doThing');\n");
      const r = runGate(tmp);
      expect(r.code).toBe(1);
      expect(r.out).toContain('新增');
      expect(r.out).toContain('doThing');
      expect(r.out).toContain('出现 2 次');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('唯一锚点不误报', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-gate-ok-'));
    try {
      fs.mkdirSync(path.join(tmp, 'tests'));
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.writeFileSync(path.join(tmp, 'src/target.ts'), "export function run() {\n  return uniqueThing(1);\n}\n");
      fs.writeFileSync(path.join(tmp, 'tests/a.test.ts'),
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/target.ts'), 'utf-8');\n" +
        "const i = SRC.indexOf('uniqueThing');\n");
      expect(runGate(tmp).code).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('豁免注释生效,但必须写出理由', () => {
    const mk = (comment: string) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-gate-ex-'));
      fs.mkdirSync(path.join(tmp, 'tests'));
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.writeFileSync(path.join(tmp, 'src/target.ts'), "import { doThing } from './x';\nexport const y = doThing(1);\n");
      fs.writeFileSync(path.join(tmp, 'tests/a.test.ts'),
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/target.ts'), 'utf-8');\n" +
        `${comment}\nconst i = SRC.indexOf('doThing');\n`);
      const r = runGate(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
      return r.code;
    };
    expect(mk('// anchor-gate: ok — 第一处就是要验的那处'), '带理由的豁免应放行').toBe(0);
    expect(mk('// anchor-gate: ok'), '不写理由的豁免不该放行').toBe(1);
    expect(mk('// 随便写点别的'), '普通注释不是豁免').toBe(1);
  });

  it('基线里的存量都还对得上(基线不是许可证,是待办清单)', () => {
    const b = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
    expect(Array.isArray(b.entries)).toBe(true);
    for (const e of b.entries) {
      expect(fs.existsSync(path.join(process.cwd(), e.test)), `${e.test} 已不存在,基线该清理`).toBe(true);
      expect(fs.existsSync(path.join(process.cwd(), e.target)), `${e.target} 已不存在`).toBe(true);
    }
  });
});

describe('那处被抓出来的假绿,现在是真的验过了', () => {
  const PANEL = fs.readFileSync(path.join(process.cwd(), 'components/project/distribution-panel.tsx'), 'utf-8');

  it('预检 URL 在文件里出现不止一次 —— 所以锚点必须带反引号', () => {
    expect(PANEL.split('publish-preflight').length - 1).toBeGreaterThan(1);
    expect(PANEL.split('publish-preflight`').length - 1).toBe(1);
  });

  it('从 URL 往回找 fetch 起点,窗口才含得住整个调用', () => {
    const urlAt = PANEL.indexOf('publish-preflight`');
    const i = PANEL.lastIndexOf('fetch(', urlAt);
    const end = PANEL.indexOf('}, [projectId]);', i);
    expect(i).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(i);
    const block = PANEL.slice(i, end);
    expect(block).toContain('fetch(');
    expect(block).toContain('publish-preflight');
    expect(block).toContain('setPreflightNote');
  });
});
