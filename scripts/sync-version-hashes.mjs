#!/usr/bin/env node
/**
 * v12.290 — 修复 VERSIONS.md 的**提交溯源列**,并让它不可能再写错。
 *
 * 病根是结构性的:**一个提交不可能包含自己的哈希**。
 * 而发版约定是「先 commit → 把短哈希 sed 进 VERSIONS.md → `git commit --amend`」——
 * amend 会产生**新的**提交对象,于是记进表里的是那个**被丢弃的、游离的**旧哈希。
 * 结果:498 条记录里 247 条(49.6%)在 main 历史中根本不存在。
 * 在我本机因为有 reflog 还能 `git show`,**换台机器 / 新 clone 一律失败** —— 溯源列名存实亡。
 *
 * 修法:**不再让提交自我引用**。哈希在**下一次发版时回填**(此时上一版的提交已定型),
 * 由本脚本从 `git log` 的提交信息里认版本号自动对齐,人手不参与。
 *
 * 用法:
 *   node scripts/sync-version-hashes.mjs           # 回填/修正
 *   node scripts/sync-version-hashes.mjs --check   # 只报不改(门禁用)
 *
 * 浅克隆(CI 默认 fetch-depth:1)下拿不到历史 → 自动跳过,不误报。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const FILE = 'VERSIONS.md';
const CHECK = process.argv.includes('--check');
/** 表格行:| **v12.289.0** | 2026-08-08 | `abc1234` | ... */
const ROW_RE = /^(\| \*\*v([0-9][0-9.]*)\*\* \| [0-9-]+ \| `)([a-f0-9]{6,}|待填)(`)/gm;

/** 版本号规范化成三段:12.288 → 12.288.0 */
export function normVersion(v) {
  const p = String(v).split('.');
  while (p.length < 3) p.push('0');
  return p.slice(0, 3).join('.');
}

/**
 * 提交信息里认版本号,四种写法都认(仓里四种都真实存在过):
 *   `v12.289: xxx`        → ['12.289.0']
 *   `v12.288.0 xxx`       → ['12.288.0']
 *   `v12.179-180 — xxx`   → ['12.179.0','12.180.0']  ← 两版并一次提交发的(区间)
 *   `v9.4.3 + v9.4.4 · xxx` → ['9.4.3','9.4.4']      ← 同上(并列)
 * 返回数组(区间会展开)。认不出返回空数组。
 */
export function versionsFromSubject(subject) {
  const s = String(subject || '');
  // 并列式必须先判,且只吃开头那一段 —— 标题正文里往往还有别的 `+`(如「Elements + 一键成片闭环」)
  const plus = s.match(/^v(\d+\.\d+(?:\.\d+)?)\s*\+\s*v(\d+\.\d+(?:\.\d+)?)(?=[:：\s·—-]|$)/);
  if (plus) return [normVersion(plus[1]), normVersion(plus[2])];
  const range = s.match(/^v(\d+)\.(\d+)\s*[-–]\s*(\d+)(?=[:：\s—-]|$)/);
  if (range) {
    const major = range[1];
    const a = Number(range[2]), b = Number(range[3]);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a < 50) {
      const out = [];
      for (let n = a; n <= b; n++) out.push(normVersion(`${major}.${n}`));
      return out;
    }
  }
  const m = s.match(/^v(\d+\.\d+(?:\.\d+)?)(?=[:：\s]|$)/);
  return m ? [normVersion(m[1])] : [];
}

function isShallow() {
  try {
    return execSync('git rev-parse --is-shallow-repository', { encoding: 'utf-8' }).trim() === 'true';
  } catch { return true; }
}

/** version → 短哈希(同版本多次提交时取**最早**那条:即该版真正的发版提交) */
/**
 * 从 `git log --format='%h\t%s'` 的原文构建「版本号 → 哈希」表。**纯函数**(v12.290 复核补强时抽出),
 * 好处是「同版本多次提交取哪一次」这条语义能在 CI 里被真正测到,而不必依赖完整克隆。
 *
 * git log 是**倒序**(新→旧):后遍历到的是更早的提交,`map.set` 覆盖后留下的是该版**最早**那次。
 * 这是刻意的 —— 最早那次才是发版提交,之后再提到同一版本号的多半是 hotfix / 补文档,
 * 变更日志该指向发版提交。
 */
export function buildVersionMapFromLog(raw) {
  const map = new Map();
  for (const line of String(raw).split('\n')) {
    const i = line.indexOf('\t');
    if (i < 0) continue;
    const hash = line.slice(0, i).replace(/^'/, '');
    for (const v of versionsFromSubject(line.slice(i + 1))) map.set(v, hash);
  }
  return map;
}

function buildVersionMap() {
  return buildVersionMapFromLog(
    execSync("git log --format='%h\t%s' HEAD", { encoding: 'utf-8', maxBuffer: 1 << 28 }),
  );
}

/**
 * 核对 / 回填的**纯核心**(v12.290 复核补强时抽出)。
 * 抽成纯函数的原因:此前所有实质判定都埋在 main() 里,只能靠「完整克隆 + 真跑一遍」来测,
 * 而 CI 是浅克隆 → 那些测试全被 skipIf(shallow) 跳过,CI 里剩下的只有格式断言。
 * 现在判定逻辑不依赖 git、不依赖克隆深度,CI 里跑的是真行为。
 *
 * `待填` **只允许出现在当前正在发的那一版**(= package.json 的版本号):它的提交此刻尚不存在,
 * 由下一版发版时回填。其余任何一行还是 `待填`,都意味着**发版漏跑了本脚本**,或提交信息没写成
 * 能被 versionsFromSubject 认出的格式(如 `feat: v12.291 …`,v 不在开头)——
 * 旧实现把这两种一律归进 pending 并 exit 0,门禁看不见,`待填` 可以永久留存。
 * 注:VERSIONS.md 里有多张表(早期表升序在前、主表倒序在后),故**不能**用行号判断「最新一行」。
 *
 * @param src        VERSIONS.md 全文
 * @param map        版本号(三段) → 真实哈希
 * @param currentVer package.json 里的当前版本号
 */
export function auditVersionRows(src, map, currentVer) {
  const CURRENT = normVersion(currentVer || '');
  let fixed = 0, filled = 0, unresolved = 0, alreadyOk = 0, pending = 0;
  const problems = [];
  const stale = [];

  const out = String(src).replace(ROW_RE, (whole, head, version, hash, tail) => {
    const isCurrent = normVersion(version) === CURRENT;
    const real = map.get(normVersion(version));
    if (hash === '待填' && isCurrent) { pending++; return whole; }  // 本版待填:正常
    if (!real) {
      // git log 里找不到该版的提交(极早期版本无 vX 前缀等)—— 保持原样,只统计
      if (hash === '待填') stale.push(`v${version}:待填,且 git 历史里找不到它的提交(提交信息未以 \`v${version}:\` 开头?)`);
      else unresolved++;
      return whole;
    }
    if (hash !== '待填') {
      if (real.startsWith(hash) || hash.startsWith(real)) { alreadyOk++; return whole; }
      fixed++; problems.push(`v${version}: ${hash} → ${real}`);
    } else {
      // 非本版却还写着待填,而历史里明明找得到 —— 同样是漏跑,回填并计为待修
      filled++; stale.push(`v${version}:待填,但历史里找得到 ${real}(发版时漏跑回填)`);
    }
    return `${head}${real}${tail}`;
  });

  return { out, fixed, filled, unresolved, alreadyOk, pending, problems, stale };
}

function main() {
  if (isShallow()) {
    console.log('[version-hashes] 浅克隆,拿不到完整历史 → 跳过(非失败)');
    process.exit(0);
  }
  const map = buildVersionMap();
  const src = fs.readFileSync(FILE, 'utf-8');
  const pkgVer = JSON.parse(fs.readFileSync('package.json', 'utf-8')).version || '';
  const { out, fixed, filled, unresolved, alreadyOk, pending, problems, stale } =
    auditVersionRows(src, map, pkgVer);

  if (CHECK) {
    const bad = fixed + filled + stale.length;
    const totalRows = alreadyOk + fixed + filled + unresolved + pending +
      stale.filter((s) => s.includes('找不到它的提交')).length;   // 可回填的陈旧行已计入 filled,不重复计
    console.log(`[version-hashes] 核对 ${totalRows} 行:` +
      ` ✅ 正确 ${alreadyOk} · ❌ 错误 ${fixed} · 可回填 ${filled} · 本版待填 ${pending}` +
      ` · 陈旧待填 ${stale.length} · 无法解析 ${unresolved}`);
    for (const s of stale) console.log(`   ⚠️ ${s}`);
    if (stale.length > 0) {
      console.log('   成因:发版时漏跑 sync-version-hashes,或提交信息没以 `vX.Y:` 开头(脚本认不出版本号)。');
    }
    if (bad > 0) {
      for (const p of problems.slice(0, 10)) console.log(`   ${p}`);
      if (problems.length > 10) console.log(`   …还有 ${problems.length - 10} 条`);
      console.log('   修复:node scripts/sync-version-hashes.mjs');
      process.exit(1);
    }
    process.exit(0);
  }

  if (out !== src) fs.writeFileSync(FILE, out);
  console.log(`[version-hashes] ✅ 修正 ${fixed} 条 · 回填 ${filled} 条 · 本就正确 ${alreadyOk} 条 · 无法解析 ${unresolved} 条`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
