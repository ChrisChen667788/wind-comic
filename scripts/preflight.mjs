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
  { ci: 'fake-green 测试门禁(三类假绿)', cmd: 'node scripts/fake-green-gate.mjs' },
  // v12.378:锚点歧义也是一种假绿 —— indexOf 命中 import/注释时,not.toMatch 会在无关代码里静静通过
  { ci: '锚点门禁(indexOf 锚点须唯一)', cmd: 'node scripts/anchor-gate.mjs' },
  // v12.382:会花 owner 钱的路由必须先鉴权 —— 一次扫描找出 5 个裸奔的
  { ci: '付费端点门禁(会花钱的路由须鉴权)', cmd: 'node scripts/paid-endpoint-gate.mjs' },
  // v12.335:README 媒体体积预算。仓库主页图片「加载不出来」的真因是匿名 raw 端点限流
  // (/raw/ 把 429 显示成 404),而诱因是一次页面要拉 37 个文件 / 23MB。压完不设防,
  // 下一版新截图又是 2880×1800 塞回来,所以必须每次发版前问一句。
  // v12.389:元门禁 —— 防止「preflight 自称与 CI 同步、实际没同步」再次发生
  { ci: 'preflight/CI 同步核对', cmd: 'node scripts/preflight-parity.mjs' },
  { ci: '(local only) README 媒体体积预算', cmd: 'node scripts/optimize-media.mjs --check' },
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
// v12.389:原文案是「(与 CI Security job 同步)」—— 而当时 8 步里只有 4 步在 CI 上。
// 那句话给人的印象是「这些 CI 都会替我把关」,于是新建的门禁只挂本地也没人察觉。
// 现在如实报数,并由 scripts/preflight-parity.mjs 在 CI 上核对这个数字。
const _ciSteps = STEPS.filter((s) => !s.ci.includes('(local only)')).length;
console.log(
  `\n✅ preflight: ${STEPS.length}/${STEPS.length} 通过` +
    `(其中 ${_ciSteps} 步 CI 也会跑,${STEPS.length - _ciSteps} 步仅本地)`,
);
