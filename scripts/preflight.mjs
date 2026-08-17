#!/usr/bin/env node
/**
 * scripts/preflight.mjs — 发版前把 **CI 的 Security + License job 原样跑一遍**。v12.325。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────
 * v12.321/322/323 **连红三版**才被发现。原因不是代码坏,是**本地门禁和 CI 门禁不对称**:
 * 我的发版流程跑 `gate:consumer` + `check:version-hashes` + 全量 vitest,
 * 而 CI 的 Security job 有**四步**,前两步(`npm audit --audit-level=high`、
 * `license-check`)本地从来不跑。于是一个真实的高危告警(nanoid <3.3.18,经 postcss
 * 传递引入)在本地完全不可见,我顶着红灯连推了三版。
 *
 * 「本地全绿」从来推不出「CI 会绿」—— 除非本地跑的**就是** CI 跑的那几条。
 * 这个脚本就是那个「就是」:步骤与 ci.yml 的 Security job 一一对应,顺序一致。
 *
 * 用法:`npm run preflight`(发版前必跑)。任一步失败即 exit 1 并指出对应的 CI 步骤名。
 */
import { execSync } from 'node:child_process';

/** 与 .github/workflows/ci.yml → job "Security + License" 的步骤一一对应 */
const STEPS = [
  { ci: 'npm audit (block on high/critical)', cmd: 'npm audit --audit-level=high' },
  { ci: 'License check (copyleft gate)', cmd: 'node scripts/license-check.mjs' },
  { ci: 'Consumer gate (唯一入口不得被绕过)', cmd: 'npx tsx scripts/consumer-gate.mjs' },
  { ci: 'Version hash provenance (变更日志可溯源)', cmd: 'npm run check:version-hashes' },
  // v12.326:本地额外多跑一条 —— CI 尚未纳入,但「测试自己是不是摆设」值得每次发版前问一句。
  { ci: '(local only) fake-green 测试门禁', cmd: 'node scripts/fake-green-gate.mjs' },
];

let failed = 0;
for (const [i, s] of STEPS.entries()) {
  const label = `[${i + 1}/${STEPS.length}] ${s.ci}`;
  try {
    execSync(s.cmd, { stdio: 'pipe', encoding: 'utf-8' });
    console.log(`✅ ${label}`);
  } catch (e) {
    failed++;
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
    console.error(`❌ ${label}`);
    console.error(`   命令: ${s.cmd}`);
    console.error(out.split('\n').slice(-14).map((l) => `   ${l}`).join('\n'));
  }
}

if (failed > 0) {
  console.error(`\n❌ preflight: ${failed}/${STEPS.length} 步失败 —— 这些正是 CI 会红的地方,别推。`);
  process.exit(1);
}
console.log(`\n✅ preflight: ${STEPS.length}/${STEPS.length} 通过(与 CI Security job 同步)`);
