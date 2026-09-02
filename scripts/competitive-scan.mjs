#!/usr/bin/env node
/**
 * scripts/competitive-scan.mjs — 竞品分析的**到期检查 + 本轮任务书生成**。
 *
 * 为什么需要它:owner 的约定是「每次大版本同步都刷新竞品对比表」,而实际执行靠人记。
 * 上一轮核验是 2026-08-07,等我这次动手已经是 8-31 —— **三周多没更新**,
 * 而这三周里视频模型至少出了两轮新版本。对外 README 上挂着过期数字,
 * 比没有数字更糟:它看起来是核实过的。
 *
 * ── 为什么不是「全自动出报告」────────────────────────────────────────
 * 真正的竞品分析需要**联网检索 + 判断**,而且历史几轮的水准是:
 * 每个数值带来源 URL 与检索日期、关键数值经独立二次检索复核、
 * 区分「竞品有什么」与「我们接了没有 / 用了多少」。
 * 一个 shell/node 脚本产不出这个 —— 硬做只会得到一份看起来像分析的空壳,
 * 那正是这个项目一直在消灭的「假绿」。
 *
 * 所以这个脚本负责它**真能负责**的三件事:
 *   ① **到期检查** —— 距上次分析多久了,超期就报警(退出码 1,能被 CI/定时任务捕获);
 *   ② **把上一轮的结论变成本轮的待验假设** —— 读 claims.json,逐条列出「该复核什么」;
 *   ③ **生成任务书** —— 一份写好的调研指令,人或 agent 直接照着执行即可。
 *
 * 这是「策略迭代分析」的做法:每一轮的结论不是终点,而是下一轮的**可证伪假设**。
 * 上轮说「无一竞品同时具备节奏审计 + EDL/AAF + 开源自托管」——
 * 那就是一条会过期的断言,必须定期拿出来重新检验。
 *
 * 用法:
 *   node scripts/competitive-scan.mjs             # 检查 + 生成任务书
 *   node scripts/competitive-scan.mjs --check     # 只检查是否超期(退出码 1 = 超期)
 *   node scripts/competitive-scan.mjs --if-due    # 只在超期时才生成任务书,否则静默退出
 *   node scripts/competitive-scan.mjs --notify    # 超期时弹一条 macOS 通知
 *
 * ── 为什么定时任务用 `--if-due --notify` 而不是裸跑 ──────────────────────
 * 第一版的定时任务把输出重定向进 `~/Library/Logs/wind-comic-competitive.log` 就结束了。
 * **那个日志没有人会去打开。** 超期时 `exit 1` 落进一个没人读的文件,
 * 于是这个「自动化」只是看起来存在 —— 正是本项目一直在消灭的假绿:
 * 一道**通向不了人**的告警,和没有告警是一回事。
 *
 * 而它当时还是**无条件**生成任务书的:每周一都掉一个 `TASK-<日期>.md` 进工作区,
 * 不超期也掉。每周都出现的东西会在第三周变成噪音,到真超期那次反而没人看。
 *
 * 现在:超期才动作,动作就一定通向人 —— ① macOS 通知横幅(当场看见);
 * ② 任务书落进仓库工作区,`git status` 里是一条未跟踪文件(下次 owner 或我打开仓库必然撞见)。
 * 两条路径一条即时、一条持久,不依赖任何人记得去翻日志。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'docs/competitive');
const CLAIMS = path.join(DIR, 'claims.json');
/** 约定的最长间隔 —— owner 要求「最晚每 2 周一次」 */
const MAX_AGE_DAYS = 14;

function loadClaims() {
  if (!fs.existsSync(CLAIMS)) return null;
  try {
    return JSON.parse(fs.readFileSync(CLAIMS, 'utf-8'));
  } catch (e) {
    console.error(`[competitive-scan] claims.json 解析失败:${e instanceof Error ? e.message : e}`);
    return null;
  }
}

function daysSince(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / 86400000);
}

const claims = loadClaims();
if (!claims) {
  console.log('❌ 找不到或读不了 docs/competitive/claims.json —— 无法判断是否超期');
  process.exit(1);
}

const age = daysSince(claims.lastReviewedOn);
const overdue = age > MAX_AGE_DAYS;
const checkOnly = process.argv.includes('--check');
const ifDue = process.argv.includes('--if-due');
const wantNotify = process.argv.includes('--notify');

/** 超期时弹一条 macOS 通知 —— 让告警**通向人**,而不是通向一个没人读的日志文件。 */
function notifyOverdue(days) {
  if (!wantNotify || process.platform !== 'darwin') return;
  const msg = `竞品分析已超期 ${days} 天 —— README 上挂着的数字可能已过时`;
  try {
    execFileSync('/usr/bin/osascript', [
      '-e',
      `display notification ${JSON.stringify(msg)} with title "青枫漫剧 · 竞品分析到期"`,
    ], { timeout: 10_000 });
  } catch {
    // 通知失败不该让检查本身失败 —— 任务书落盘那条路径仍然有效
  }
}

console.log(`竞品分析上次核验:${claims.lastReviewedOn}(${age} 天前)· 约定间隔 ${MAX_AGE_DAYS} 天`);

if (checkOnly) {
  if (overdue) {
    console.log(`\n⚠️  已超期 ${age - MAX_AGE_DAYS} 天。对外 README 上挂着的数字可能已经过时 ——`);
    console.log('   而过时的数字比没有数字更糟:它看起来是核实过的。');
    console.log('   跑 `node scripts/competitive-scan.mjs` 生成本轮任务书。\n');
    notifyOverdue(age - MAX_AGE_DAYS);
    process.exit(1);
  }
  console.log('✅ 未超期');
  process.exit(0);
}

if (ifDue && !overdue) {
  // 没超期就什么都不做 —— 不生成文件、不发通知。
  // 每周都出现的东西会变成噪音,到真超期那次反而没人看。
  console.log('✅ 未超期,不生成任务书');
  process.exit(0);
}

// ── 生成本轮任务书 ────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const out = path.join(DIR, `TASK-${today}.md`);
const lines = [];

lines.push(`# 竞品分析任务书 · ${today}`);
lines.push('');
lines.push(`> 自动生成(\`scripts/competitive-scan.mjs\`)。上次核验 **${claims.lastReviewedOn}**,距今 **${age} 天**${overdue ? ' —— **已超期**' : ''}。`);
lines.push('> 这份任务书列出「上一轮的结论里,哪些今天必须重新验证」。');
lines.push('> **每一轮的结论都是下一轮的可证伪假设** —— 不是查完就算数的事实。');
lines.push('');
lines.push('## 0. 执行标准(不得低于历史几轮)');
lines.push('');
lines.push('- **必须联网**核实,不得凭模型记忆(训练数据一定落后于当下);');
lines.push('- 每个数值给 **来源 URL + 检索日期**;查不到写「未核实」,不要猜;');
lines.push('- 关键数值(Elo / 价格 / 时长 / 分辨率 / 星数)**独立二次检索复核**;');
lines.push('- 分清三件事:**竞品有什么** / **我们接了没有** / **我们用了多少** ——');
lines.push('  「provider 已接入」不等于「特色能力已用上」,历史几轮的差距多数出在第三列;');
lines.push('- 结论要可证伪:写成「截至 X 日,无竞品同时具备 A+B+C」这种能被下一轮推翻的形式。');
lines.push('');
lines.push('## 1. 待复核的结论(上一轮留下的假设)');
lines.push('');
for (const c of claims.claims || []) {
  const cAge = daysSince(c.assertedOn);
  lines.push(`### ${c.id} — ${c.statement}`);
  lines.push('');
  lines.push(`- **断言于**:${c.assertedOn}(${cAge} 天前)`);
  lines.push(`- **类型**:${c.kind}`);
  if (c.evidence) lines.push(`- **当时依据**:${c.evidence}`);
  lines.push(`- **怎样才算被推翻**:${c.falsifyBy}`);
  lines.push('');
}
lines.push('## 2. 本轮固定要查的对象');
lines.push('');
for (const w of claims.watchlist || []) {
  lines.push(`- **${w.area}**:${w.targets.join(' · ')}`);
}
lines.push('');
lines.push('## 3. 产出');
lines.push('');
lines.push('1. 更新 `README.md` / `README.zh-CN.md` / `docs/modelscope-intro.md` 的竞品对比表;');
lines.push('2. 写一份 `docs/COMPETITIVE-GAP-<年月>.md`(沿用历史格式:现状速览 → 竞品单点最强/我们接了没有/用了多少 → 可交付缺口);');
lines.push('3. **更新 `docs/competitive/claims.json`** —— 把本轮的新结论写成下一轮的待验假设,并刷新 `lastReviewedOn`;');
lines.push('4. 差距条目落进版本迭代计划,标注目标版本号。');
lines.push('');

fs.writeFileSync(out, lines.join('\n'));
console.log(`\n📋 已生成任务书:${path.relative(ROOT, out)}`);
console.log(`   待复核结论 ${(claims.claims || []).length} 条 · 固定观察对象 ${(claims.watchlist || []).length} 组`);
if (overdue) {
  console.log(`\n⚠️  已超期 ${age - MAX_AGE_DAYS} 天,请尽快执行。\n`);
  notifyOverdue(age - MAX_AGE_DAYS);
  process.exit(1);
}
console.log('');
