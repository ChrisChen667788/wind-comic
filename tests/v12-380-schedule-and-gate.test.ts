/**
 * v12.380:我建的门禁只防了一半,当天就撞上了它没防的那一半。
 *
 * v12.378 的锚点门禁只查「锚点出现 >1 次」(有歧义)。可 v12.379 撞上的是另一半:
 * v12.374 的断言锚在 `const musicRaw` 上,而那版把它改名成 musicCandidates/musicPick,
 * 锚点在源码里变成**出现 0 次** —— indexOf 返回 -1,`slice(-1, X)` 切出的东西
 * 必然不是想验的那段,断言以完全错误的理由变红(BGM 的行为其实更强了)。
 * 0 次比多次更狠:多次至少还切到了某段真代码,0 次连位置都是假的。
 *
 * 补的时候还发现门禁自己的一个精度问题:变量映射是**文件级**的,
 * 而 `const src = fs.readFileSync(...)` 常常是函数内的局部变量,
 * 同一个名字在一个测试文件里可以指向好几个源文件,后写的覆盖先写的。
 * 按原实现扫,会报出 7 处「0 次锚点」——**全是误报**。
 * 解析真作用域太重,取保守解:同名变量指向过不同文件就整个放弃它。
 * 门禁宁可漏报,也不能让人对着一条假线索去改没坏的测试。
 *
 * 另一条线:每日重跑的定时任务此前**只存在于一台机器的 ~/Library/LaunchAgents 里**,
 * 仓库既没有生成它的脚本也没有文档 —— 换台机器就没了,想知道「几点跑、日志写哪」
 * 也无从查起。而它的 StandardOutPath 与 rerun-cron.sh 自己写的日志是**两个文件**,
 * 这一点真正误导过人:打开 .out.log 看到 0 字节,会直接得出「从没执行过」的
 * 错误结论(实际它 9:00 准时跑了,只是写在另一个文件里)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const GATE = path.join(process.cwd(), 'scripts/anchor-gate.mjs');
const INSTALLER = path.join(process.cwd(), 'scripts/install-rerun-schedule.sh');

function gateIn(files: Record<string, string>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    try {
      return { code: 0, out: execFileSync('node', [GATE], { cwd: tmp, encoding: 'utf-8' }) };
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('锚点门禁:0 次和多次都要拦', () => {
  it('锚点在源码里一次都不出现 → 拦(v12.379 撞的就是这个)', () => {
    const r = gateIn({
      'src/t.ts': 'export function run() {\n  return ok(1);\n}\n',
      'tests/a.test.ts':
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/t.ts'), 'utf-8');\n" +
        "const i = SRC.indexOf('const goneAway');\n",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('一次都不出现');
  });

  it('锚点出现多次 → 仍然拦(v12.378 原有的那一半)', () => {
    const r = gateIn({
      'src/t.ts': "import { doThing } from './x';\nexport const y = doThing(1);\n",
      'tests/a.test.ts':
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/t.ts'), 'utf-8');\n" +
        "const i = SRC.indexOf('doThing');\n",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('出现 2 次');
  });

  it('恰好一次 → 放行', () => {
    const r = gateIn({
      'src/t.ts': 'export const y = uniqueThing(1);\n',
      'tests/a.test.ts':
        "const SRC = fs.readFileSync(path.join(process.cwd(), 'src/t.ts'), 'utf-8');\n" +
        "const i = SRC.indexOf('uniqueThing');\n",
    });
    expect(r.code).toBe(0);
  });

  it('同名变量指向过不同文件 → 整个放弃它,不猜(否则 7 处全是误报)', () => {
    const r = gateIn({
      'src/a.ts': 'export const y = 1;\n',
      'src/b.ts': 'export const z = 2;\n',
      'tests/a.test.ts':
        // 同一个名字先后指向两个文件 —— 真实测试里这就是两个函数内的局部 const
        "const src = fs.readFileSync(path.join(process.cwd(), 'src/a.ts'), 'utf-8');\n" +
        "const src2 = fs.readFileSync(path.join(process.cwd(), 'src/b.ts'), 'utf-8');\n" +
        "const src = fs.readFileSync(path.join(process.cwd(), 'src/b.ts'), 'utf-8');\n" +
        "const i = src.indexOf('完全不存在的锚点');\n",
    });
    expect(r.code, '有歧义的变量应当放过而不是误报').toBe(0);
  });
});

describe('定时任务纳入版本控制', () => {
  const plist = execFileSync('bash', [INSTALLER, '--print'], { encoding: 'utf-8' });

  it('--print 只输出 plist,不碰系统', () => {
    expect(plist).toContain('<?xml');
    expect(plist).toContain('ai.qfmanju.rerun');
    expect(plist).toContain('scripts/rerun-cron.sh');
  });

  it('三处日志路径必须是同一个文件 —— 不一致会让人误判「任务从没跑过」', () => {
    const outs = [...plist.matchAll(/<key>Standard(?:Out|Error)Path<\/key><string>([^<]+)<\/string>/g)].map((m) => m[1]);
    expect(outs.length).toBe(2);
    expect(new Set(outs).size, 'stdout 与 stderr 应写同一个文件').toBe(1);
    // 与 rerun-cron.sh 自己 append 的那个也必须一致
    const cron = fs.readFileSync(path.join(process.cwd(), 'scripts/rerun-cron.sh'), 'utf-8');
    const m = cron.match(/WC_CRON_LOG:-\$HOME(\/[^\}"]+)/);
    expect(m, '找不到脚本自身的日志路径').toBeTruthy();
    expect(outs[0].endsWith(m![1]), `plist 写 ${outs[0]},脚本写 …${m![1]} —— 不是同一个文件`).toBe(true);
  });

  it('一天多个时段 —— 配额刷新并不对齐某一刻', () => {
    const hours = [...plist.matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer>/g)].map((m) => Number(m[1]));
    expect(hours.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hours).size, '时段不能重复').toBe(hours.length);
    for (const h of hours) expect(h).toBeGreaterThanOrEqual(0), expect(h).toBeLessThan(24);
  });

  it('不在加载时立刻跑 —— 装一次就烧一轮额度不合理', () => {
    expect(plist).toMatch(/<key>RunAtLoad<\/key><false\/>/);
  });

  it('安装器幂等:先 unload 再 load', () => {
    const sh = fs.readFileSync(INSTALLER, 'utf-8');
    const i = sh.indexOf('launchctl load');
    expect(i).toBeGreaterThan(0);
    expect(sh.slice(Math.max(0, i - 200), i)).toContain('launchctl unload');
  });
});
