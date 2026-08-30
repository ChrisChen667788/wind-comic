#!/usr/bin/env node
/**
 * scripts/mutation-probe.mjs — 变异探针:把一个函数改坏,看测试抓不抓得到。
 *
 * v12.396:一次静态扫描告诉我「全仓有 12 个谓词只有负例断言」。
 * 实证之后只有 **1 个是真的** —— 误报率 11/12。
 * `isAncient` / `isHorror` 看着也只有 `toBe(false)`,但它们有**间接**正例覆盖
 * (`detectGenreKind` 和 `lock()` 的「题材锁定」字段);唯独 `isSad` 落在
 * `detectedMoods` 这条支线上,没有任何东西验它。
 *
 * 教训是方法论层面的:**「数断言」这种静态启发式判不出测试的真实保护力**。
 * 一个断言有没有用,只有把实现改坏、看它红不红才知道。
 *
 * 所以留下这个按需工具(**不进 preflight** —— 它要改源文件并跑测试,太重;
 * 而且改源文件的东西不该在每次发版时自动跑)。用法:
 *
 *   node scripts/mutation-probe.mjs <函数名> <源文件> <测试文件>
 *   node scripts/mutation-probe.mjs isSad lib/genre-vocab.ts tests/v12-362-genre-vocab.test.ts
 *
 * 输出「变红 = 有保护」/「仍绿 = 这个函数可以整个失效而没人发现」。
 *
 * 安全:改动前备份原文件,finally 里无条件还原 —— 即使测试进程被杀也不留残骸。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const [fn, src, test] = process.argv.slice(2);
if (!fn || !src || !test) {
  console.log('用法: node scripts/mutation-probe.mjs <函数名> <源文件> <测试文件>');
  process.exit(2);
}
for (const [label, p] of [['源文件', src], ['测试文件', test]]) {
  if (!fs.existsSync(path.join(process.cwd(), p))) {
    console.log(`❌ 找不到${label}: ${p}`);
    process.exit(2);
  }
}

const abs = path.join(process.cwd(), src);
const orig = fs.readFileSync(abs, 'utf-8');

/** 几种常见定义形态 → 恒 false / 恒 undefined */
function mutate(code) {
  const arrow = new RegExp(`export const ${fn} = \\([^)]*\\)(\\s*:[^=]+)? =>[^;]+;`);
  if (arrow.test(code)) return code.replace(arrow, `export const ${fn} = (..._probe: any[]): any => false;`);
  const decl = new RegExp(`export function ${fn}\\s*\\([^)]*\\)([^{]*)\\{`);
  if (decl.test(code)) return code.replace(decl, `export function ${fn}(..._probe: any[]): any { return false; if (false) {`);
  return null;
}

const mutated = mutate(orig);
if (!mutated) {
  console.log(`❌ 认不出 ${fn} 的定义形态(只支持 export const 箭头函数 / export function)`);
  process.exit(2);
}

let red = false;
let out = '';
try {
  fs.writeFileSync(abs, mutated);
  try {
    out = execFileSync('npx', ['vitest', 'run', test], { encoding: 'utf-8', stdio: 'pipe' });
  } catch (e) {
    red = true;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
} finally {
  fs.writeFileSync(abs, orig);   // 无条件还原
}

const failed = (out.match(/(\d+) failed/) || [])[1];
if (red) {
  console.log(`✅ ${fn} 有保护 —— 改成恒 false 后 ${test} 变红${failed ? `(${failed} 条失败)` : ''}`);
  process.exit(0);
}
console.log(`❌ ${fn} **没有保护** —— 把它整个改成 \`() => false\`,${test} 仍然全绿。`);
console.log(`   也就是说这个函数可以完全失效而没人发现。请补一条正例断言。`);
process.exit(1);
