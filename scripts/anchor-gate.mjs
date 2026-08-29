#!/usr/bin/env node
/**
 * v12.378:锚点门禁 —— 断言切窗口用的 indexOf 锚点必须在目标源码里唯一。
 *
 * 由来:「indexOf 命中第一处」这个坑,我一天之内栽了三次。
 *   · v12.369:`findCharacterBibleByName` 命中的是 import(偏移 808)而不是调用点(1988);
 *   · v12.375:`for (const c of clips)` 在广告净化段先出现过一次,窗口长度变负、切出空串,
 *              断言以**错误的理由**变红;
 *   · v12.377:`send('complete')` 命中早退分支;`shouldStopForQuota` 命中 import 语句。
 *
 * 危害是双向的,而且假绿那一面更隐蔽:
 *   · 假红 —— 窗口切歪,断言以错误的理由失败,人跑去改根本没坏的实现;
 *   · 假绿 —— 锚点恰好落在 import 或注释上,`toContain('xxx')` 在错误的窗口里通过了,
 *            被断言保护的那段代码其实**从来没被检查过**。
 *
 * 检测思路:在测试文件里建立「变量 → 它 readFileSync 的源文件」映射,
 * 再看 `VAR.indexOf('literal')` 的字面量在那个源文件里出现几次。
 * 出现多次 = 锚点有歧义。
 *
 * 判定刻意保守 —— 只报**能确定**的:变量能对上文件、文件读得到、字面量非空。
 * 解析不了的一律放过(宁可漏报,不可让门禁本身变成噪音源)。
 *
 * 和 consumer-gate 一样按基线运作:存量记在 baseline 里,只拦新增。
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, 'lib/consumer-gate/anchor-baseline.json');

const READ_RE = /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*fs\.readFileSync\(\s*(?:path\.join\(\s*process\.cwd\(\)\s*,\s*)?['"]([^'"]+)['"]/g;
const IDX_RE = /\b(\w+)\.indexOf\(\s*(['"])((?:\\.|(?!\2)[^\\])*)\2\s*\)/g;
/** 行内写 `// anchor-gate: ok — 理由` 即豁免(理由是硬要求 —— 豁免必须留下为什么) */
const EXEMPT_RE = /\/\/\s*anchor-gate:\s*ok\s*[—-]\s*\S/;

function scan() {
  const findings = [];
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) return findings;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) continue;
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf-8');
    const lines = src.split('\n');

    const varmap = new Map();
    READ_RE.lastIndex = 0;
    for (let m; (m = READ_RE.exec(src)); ) {
      const target = m[2];
      if (!/\.(ts|tsx|mjs|js|md|json)$/.test(target)) continue;
      varmap.set(m[1], target);
    }
    if (!varmap.size) continue;

    IDX_RE.lastIndex = 0;
    for (let m; (m = IDX_RE.exec(src)); ) {
      const [, varName, , literalRaw] = m;
      const target = varmap.get(varName);
      if (!target) continue;
      const abs = path.join(ROOT, target);
      if (!fs.existsSync(abs)) continue;

      // 反转义:测试里写的是 JS 字面量,要还原成实际字符串再去数
      let literal;
      try { literal = JSON.parse(`"${literalRaw.replace(/"/g, '\\"')}"`); } catch { continue; }
      if (!literal) continue;

      const lineNo = src.slice(0, m.index).split('\n').length;
      const around = [lines[lineNo - 2], lines[lineNo - 1], lines[lineNo]].join('\n');
      if (EXEMPT_RE.test(around)) continue;

      const body = fs.readFileSync(abs, 'utf-8');
      let count = 0, at = 0;
      while ((at = body.indexOf(literal, at)) !== -1) { count++; at += literal.length; }
      if (count > 1) {
        findings.push({ test: `tests/${name}`, line: lineNo, literal: literal.slice(0, 60), count, target });
      }
    }
  }
  return findings;
}

const key = (f) => `${f.test}::${f.literal}`;
const findings = scan();
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) : { entries: [] };
const known = new Set(baseline.entries.map((e) => `${e.test}::${e.literal}`));

if (process.argv.includes('--update')) {
  const entries = findings.map((f) => ({ test: f.test, literal: f.literal, count: f.count, target: f.target }));
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ entries }, null, 2) + '\n');
  console.log(`✅ 锚点基线已更新:${entries.length} 条`);
  process.exit(0);
}

const fresh = findings.filter((f) => !known.has(key(f)));
if (fresh.length) {
  console.log(`\n❌ 锚点门禁失败:新增 ${fresh.length} 处有歧义的 indexOf 锚点\n`);
  for (const f of fresh) {
    console.log(`  ${f.test}:${f.line}`);
    console.log(`    锚点「${f.literal}」在 ${f.target} 中出现 ${f.count} 次 —— indexOf 只会命中第一处`);
  }
  console.log(`\n怎么办:
  1. 换一个**语义唯一**的锚点(调用点而不是裸函数名、代码行而不是注释行);
  2. 确属合法(第一处就是要验的那处)→ 在该行上方写 \`// anchor-gate: ok — <为什么>\`;
  3. 批量重构时用 --update 收进基线(会在 diff 里被看见)。\n`);
  process.exit(1);
}
console.log(`✅ 锚点门禁通过(无新增歧义锚点;基线内存量 ${baseline.entries.length} 条)`);
