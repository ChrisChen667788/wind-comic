#!/usr/bin/env node
/**
 * scripts/twin-path-scan.mjs — 找「同一个下游能力被多个入口调用,而调法不一致」的地方。
 *
 * v12.400:这一轮 29 个版本里,**同一个病犯了至少八次**:
 *
 *   v12.375  主管线按角色名选音色,recompose 硬编码一个不存在的 id
 *   v12.381  localize 过滤多语稿,pull-sheet / recompose 直接取 [0]
 *   v12.383  上一版立了唯一入口,却只手工接了 3 个消费方 —— 实际有 11 个
 *   v12.385  项目级 regenerate-shot 落盘 + 标降级,顶层那个两样都没跟上
 *   v12.387  shot-audio 读手动音色覆盖,recompose 不读
 *   v12.388  付费门禁只认直接调用,漏掉编排器这条间接路径
 *   v12.393  refCount 被算了三遍,三种口径
 *   v12.399  sweepDir 有「一个都没被引用就停手」的自检,asset-storage 那条没有
 *
 * 每一次都是「主路径修好了、旁路没跟上」,而且**每一次都要等到出事才发现**。
 * consumer-gate 能拦「绕过唯一入口」,但拦不了「还没有唯一入口、两处各写各的」——
 * 那正是上面八条的共同形态。
 *
 * 这个扫描不下结论,只**把结构性风险摆出来**:某个下游函数被 N 个文件调用,
 * 而各调用点传的参数集合不一样 —— 那不一定是 bug(不同入口本来就可能需要不同参数),
 * 但它是「其中一处改了、别处没跟」的**必要条件**。
 *
 * 刻意做成**只报告不阻断**(不进 preflight):它的产出是一份供人过目的清单,
 * 不是能自动判对错的规则。一个会误报的门禁只会训练人忽略门禁 ——
 * 这条教训 fake-green-gate 的注释里也写过。
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app/api', 'lib', 'services'];
/** 关注这些「容易两套实现」的下游能力 —— 都对应上面那张表里的真实事故 */
const WATCH = [
  'dispatchTTSGenerate',
  'dispatchImageGenerate',
  'resolveAndPersistCast',
  'pickScriptAsset',
  'pickShotVoice',
  'effectiveVoice',
  'persistAsset',
  'guardPaidEndpoint',
  'requireProjectAccess',
  'shouldStopForQuota',
  'shouldRefuseSweep',
];

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const rel = path.join(dir, name);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
const report = [];

for (const fn of WATCH) {
  const callers = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    // 只看代码,不看注释与 import
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => !/^\s*import\s/.test(l))
      .join('\n');
    const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(code))) {
      // 粗略取实参片段(到同层右括号或 120 字符),用于比较「传了哪些命名参数」
      const seg = code.slice(m.index, m.index + 160);
      const named = [...seg.matchAll(/([a-zA-Z_$][\w$]*)\s*:/g)].map((x) => x[1]);
      callers.push({ file: f, named: [...new Set(named)].sort().join(',') });
    }
  }
  if (callers.length < 2) continue;
  const shapes = new Map();
  for (const c of callers) {
    if (!shapes.has(c.named)) shapes.set(c.named, []);
    shapes.get(c.named).push(c.file);
  }
  if (shapes.size > 1) report.push({ fn, callers: callers.length, shapes });
}

console.log(`扫描 ${files.length} 个文件 · 关注 ${WATCH.length} 个下游能力\n`);
if (!report.length) {
  console.log('✅ 关注的能力都被一致地调用(或调用点少于 2 处)');
  process.exit(0);
}
console.log(`⚠️  ${report.length} 个能力存在**调法不一致**的入口 —— 不一定是 bug,但请过目:\n`);
for (const r of report) {
  console.log(`  ${r.fn}(${r.callers} 处调用,${r.shapes.size} 种传参形态)`);
  for (const [shape, fs_] of r.shapes) {
    console.log(`    · [${shape || '(无命名参数)'}]`);
    for (const f of fs_.slice(0, 4)) console.log(`        ${f}`);
    if (fs_.length > 4) console.log(`        …还有 ${fs_.length - 4} 处`);
  }
  console.log('');
}
console.log('这是**报告不是门禁** —— 不同入口本来就可能需要不同参数。');
console.log('要看的是:其中有没有「一处后来加了参数、另一处忘了」的。\n');
