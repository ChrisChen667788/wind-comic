#!/usr/bin/env node
/**
 * v12.389:preflight 自称「与 CI Security job 同步」,而它一半的检查 CI 根本不跑。
 *
 * 实况:本地 preflight 8 步,CI security job 只有 4 步。
 * v12.378 的锚点门禁、v12.382 的付费端点门禁都是新建后**只挂在本地**的 ——
 * 而 preflight 跑完打印的是「✅ preflight: 8/8 通过(与 CI Security job 同步)」。
 * 那句话给人的印象是「这 8 条 CI 都会替我把关」,实际只有 4 条。
 * 真忘了跑 preflight 就推,CI 照样绿,门禁等于不存在 —— 又一种假绿,
 * 而且是**关于门禁本身**的假绿,最不该有。
 *
 * 这道元门禁的职责只有一条:**preflight 里没标 `(local only)` 的步骤,
 * 它的命令必须真的出现在 .github/workflows/ci.yml 里。**
 * 标了 `(local only)` 的则相反 —— 它不该出现在 CI 里(否则标签在骗人)。
 *
 * 判定按**脚本文件名**匹配,不按整行命令:CI 里写 `node scripts/x.mjs`、
 * preflight 里写 `npm run gate:x`,两者调的是同一个东西,不该因为写法不同而误报。
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PREFLIGHT = path.join(ROOT, 'scripts/preflight.mjs');
const CI = path.join(ROOT, '.github/workflows/ci.yml');

if (!fs.existsSync(PREFLIGHT) || !fs.existsSync(CI)) {
  console.log('❌ 找不到 preflight.mjs 或 ci.yml —— 无法核对同步性');
  process.exit(1);
}

const preSrc = fs.readFileSync(PREFLIGHT, 'utf-8');
const ciSrc = fs.readFileSync(CI, 'utf-8');

/** 从一条命令里取出它实际调用的脚本文件名(scripts/xxx.mjs → xxx.mjs) */
function scriptOf(cmd) {
  const m = cmd.match(/scripts\/([\w.-]+\.(?:mjs|ts|js))/);
  return m ? m[1] : null;
}

const steps = [];
for (const m of preSrc.matchAll(/\{\s*ci:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*cmd:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g)) {
  const label = m[2];
  const cmd = m[4];
  steps.push({ label, cmd, localOnly: label.includes('(local only)'), script: scriptOf(cmd) });
}

if (steps.length === 0) {
  console.log('❌ 没能从 preflight.mjs 里解析出任何步骤 —— 解析器该更新了');
  process.exit(1);
}

const missingInCi = [];
const unexpectedInCi = [];

for (const s of steps) {
  // 没有脚本文件的步骤(如 npm audit)按命令首词匹配
  const needle = s.script || s.cmd.split(/\s+/).slice(0, 2).join(' ');
  const inCi = ciSrc.includes(needle);
  if (!s.localOnly && !inCi) missingInCi.push(s);
  if (s.localOnly && inCi) unexpectedInCi.push(s);
}

if (missingInCi.length || unexpectedInCi.length) {
  console.log('\n❌ preflight 与 CI 不同步\n');
  for (const s of missingInCi) {
    console.log(`  「${s.label}」 preflight 说 CI 会跑,但 ci.yml 里找不到 ${s.script || s.cmd}`);
  }
  for (const s of unexpectedInCi) {
    console.log(`  「${s.label}」 标着 (local only),却出现在 ci.yml 里 —— 标签在骗人`);
  }
  console.log(`
怎么办:
  1. 这道检查该进 CI → 在 .github/workflows/ci.yml 的 security job 里加一步;
  2. 它确实只能本地跑(依赖本机环境/产物)→ 在 preflight 的 ci 字段里标上 (local only),
     并写清为什么不能进 CI。\n`);
  process.exit(1);
}

const ciCount = steps.filter((s) => !s.localOnly).length;
console.log(`✅ preflight/CI 同步(${steps.length} 步中 ${ciCount} 步在 CI 上跑,其余已如实标注 local only)`);
