/**
 * v12.325 — 顶着红灯连推三版:本地门禁与 CI 门禁不对称。
 *
 * ── 病象 ──────────────────────────────────────────────────────────
 * v12.321 / 322 / 323 **连红三版**才被发现。代码没坏 —— 坏的是流程:
 * 我的发版流程跑 `gate:consumer` + `check:version-hashes` + 全量 vitest,
 * 而 CI 的 `Security + License` job 有**四步**,其中前两步
 * (`npm audit --audit-level=high`、`license-check`)**本地从来不跑**。
 * 于是一个真实的高危告警(nanoid <3.3.18,经 postcss 传递引入)在本地完全不可见。
 *
 * 更该记住的是**为什么没早发现**:我在 v12.320 查过一次 CI,之后就凭「本地全绿」
 * 一路推。「本地全绿」从来推不出「CI 会绿」—— 除非本地跑的**就是** CI 跑的那几条。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────
 * 加个 `npm run preflight` 只解决这一次;**它和 CI 会漂移**,过几版又对不上。
 * 所以这里直接**比对两边的命令清单**:CI Security job 里的每条 run,preflight
 * 必须有对应的一条。漂移即红。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const CI = fs.readFileSync('.github/workflows/ci.yml', 'utf-8');
const PRE = fs.readFileSync('scripts/preflight.mjs', 'utf-8');

/** 从 ci.yml 里切出 "Security + License" 这个 job 的正文 */
function securityJobBody(): string {
  const i = CI.indexOf('name: Security + License');
  expect(i, '找不到 Security + License job —— job 改名了就得同步这条测试').toBeGreaterThan(0);
  // 到下一个同级 job 的 name: 为止
  const rest = CI.slice(i + 10);
  const j = rest.search(/\n {4}name: /);
  return j > 0 ? rest.slice(0, j) : rest;
}

/** 该 job 里实际执行的命令(忽略 checkout / setup-node / npm ci 这类脚手架) */
function ciCommands(): string[] {
  const body = securityJobBody();
  const runs = [...body.matchAll(/run:\s*(.+)/g)].map((m) => m[1].trim());
  const scaffolding = /^(npm ci|npm install|actions\/)/;
  return runs.filter((r) => !scaffolding.test(r));
}

describe('v12.325 · preflight 必须与 CI 的 Security job 对齐', () => {
  it('CI 那个 job 确实有多于两条实质命令(前提校验)', () => {
    expect(ciCommands().length).toBeGreaterThanOrEqual(3);
  });

  it('**CI 跑的每条命令,preflight 里都有**(漂移即红)', () => {
    const missing = ciCommands().filter((cmd) => {
      // preflight 用 npx tsx / npm run 等等价写法,取命令的关键片段比对
      const key = cmd.replace(/^npx\s+/, '').split(/\s+/).slice(0, 3).join(' ');
      return !PRE.includes(key) && !PRE.includes(cmd);
    });
    expect(missing, `preflight 缺这些 CI 步骤: ${missing.join(' | ')}`).toEqual([]);
  });

  it('**npm audit 在列** —— 正是这一条缺失导致连红三版', () => {
    expect(PRE).toContain('npm audit --audit-level=high');
    expect(ciCommands().some((c) => c.startsWith('npm audit'))).toBe(true);
  });

  it('license-check 也在列(同批漏的另一条)', () => {
    expect(PRE).toContain('license-check.mjs');
  });

  it('preflight 已注册为 npm script(不在 package.json 里就没人会跑)', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    expect(pkg.scripts.preflight).toBeTruthy();
  });

  it('任一步失败必须 exit 1 —— 门禁不能只打印不拦', () => {
    expect(PRE).toMatch(/process\.exit\(1\)/);
  });

  it('失败时报出对应的 CI 步骤名(否则还得自己去比对)', () => {
    expect(PRE).toMatch(/ci:\s*'/);
    expect(PRE).toMatch(/这些正是 CI 会红的地方/);
  });
});

describe('v12.325 · 那条高危告警本身已清', () => {
  it('锁文件里的 nanoid 不低于 3.3.18(GHSA-2v37-7h3g-55p8)', () => {
    const lock = fs.readFileSync('package-lock.json', 'utf-8');
    const vulnerable = [...lock.matchAll(/nanoid\/-\/nanoid-(\d+)\.(\d+)\.(\d+)\.tgz/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
      .filter(([maj, min, pat]) => maj === 3 && (min < 3 || (min === 3 && pat < 18)));
    expect(vulnerable, `锁文件里仍有易受攻击的 nanoid: ${JSON.stringify(vulnerable)}`).toEqual([]);
  });
});
