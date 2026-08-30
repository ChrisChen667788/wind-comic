#!/usr/bin/env node
/**
 * scripts/fake-green-gate.mjs — 揪出**会绿但什么都没验**的测试。v12.326。
 *
 * ── 为什么用 AST 而不是正则 ────────────────────────────────────────
 * 这个检查器我写废了两版:
 *   ① 数花括号时没排除字符串 → `indexOf('}')` 把配平算歪,报出一堆不存在的「零断言」;
 *   ② 换成括号配平后没排除**正则字面量** → `/foo\(/` 里的 `(` 又把它算歪,
 *      报出「4051 处悬空断言」。
 * 一个用来抓假绿的工具,自己连着给了两次假结果 —— 这本身就是本版最好的注脚。
 * 所以改用 TypeScript 自带的语法树:不猜词法,问编译器。
 *
 * ── 抓三类 ────────────────────────────────────────────────────────
 * 1. **零断言**:`it()` 体内一个 `expect(` 都没有 —— 跑了等于没跑。
 * 2. **悬空断言**:`expect(x);` 后面没有 matcher —— 永远不会失败。
 *
 * ── 刻意**不**抓的一类,以及为什么 ──────────────────────────────────
 * 曾加过「async 测试体里没有 await」这一项,跑出来两处 —— 一查都是**假阳性**:
 * 函数体全同步、只是多写了个 `async`;vitest 会 await 返回的 promise,断言抛错
 * 照样让测试失败。它不对应任何真实故障模式,**留着只会训练人忽略门禁**,故删除。
 * 真正危险的是「断言写在没人等的回调里」(setTimeout / 事件处理器),那需要
 * 数据流分析才能可靠判定,不在本门禁范围 —— 宁可少报,不可乱报。
 *
 * 白名单机制:确有理由的个例写进 ALLOW,**必须带一句为什么**。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** 例外:key = `文件 :: 测试名前缀`,value = 理由(必填,空理由视为未豁免) */
const ALLOW = {
  // 该用例断言的是「渲染不抛错」,断言由 testing-library 的 render 自身承担
};

const TEST_FNS = new Set(['it', 'test']);

// `--dir` 只为自测提速(全仓 473 个文件的 TS 解析约 11s,会顶穿测试超时)。
// **默认仍是 tests/**,且扫描根会打印出来 —— 想靠「只扫一个干净目录」蒙混,
// 输出里一眼看得见。发版流程与 CI 都用默认值。
const dirArg = process.argv.indexOf('--dir');
const ROOT = dirArg > -1 ? process.argv[dirArg + 1] : 'tests';

const files = [];
(function walkDir(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDir(p);
    else if (/\.test\.tsx?$/.test(e.name)) files.push(p);
  }
})(ROOT);

const findings = { zero: [], dangling: [], unwitnessed: [] };

for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const fn = node.expression;
      const name = ts.isIdentifier(fn) ? fn.text
        : ts.isPropertyAccessExpression(fn) && ts.isIdentifier(fn.expression) ? fn.expression.text : '';

      // ── 测试用例
      if (TEST_FNS.has(name) && node.arguments.length >= 2) {
        const title = ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : '<dynamic>';
        const body = node.arguments[1];
        if (body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) && body.body) {
          let hasExpect = false;
          // v12.390:第三类假绿 —— 「否定式断言 + 没有自证的窗口」。
          //   sliced   本 it 内由 .slice()/.substring() 得来的变量名
          //   negated  被 expect(V).not.xxx 断言过的变量名 → 行号
          //   positive 被 expect(V).<非 not matcher> 断言过的变量名
          const sliced = new Set();
          const negated = new Map();
          const positive = new Set();
          const scan = (n) => {
            if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
              const init = n.initializer.getText(src);
              if (/\.(slice|substring|substr)\s*\(/.test(init)) sliced.add(n.name.text);
            }
            if (ts.isCallExpression(n)) {
              const f = n.expression;
              const root = ts.isIdentifier(f) ? f.text
                : ts.isPropertyAccessExpression(f) ? rootIdent(f) : '';
              if (root === 'expect') hasExpect = true;

              if (ts.isPropertyAccessExpression(f)) {
                let inner = f.expression;
                let isNot = false;
                if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'not') {
                  isNot = true;
                  inner = inner.expression;
                }
                if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression)
                    && inner.expression.text === 'expect' && inner.arguments.length) {
                  const a0 = inner.arguments[0];
                  if (isNot) {
                    // 否定侧只认**裸变量**:expect(V).not.xxx —— 那才是会静默通过的形态
                    if (ts.isIdentifier(a0) && !negated.has(a0.text)) negated.set(a0.text, lineOf(n));
                  } else {
                    // 正向侧放宽到**根标识符**:expect(V.length).toBeGreaterThan(0)、
                    // expect(V.trim()).toContain(...) 都已经自证了窗口切到了东西。
                    // 判得太死会逼人补一条没意义的断言去哄门禁 —— 那本身就是新的假绿。
                    if (ts.isIdentifier(a0)) positive.add(a0.text);
                    else if (ts.isPropertyAccessExpression(a0) || ts.isCallExpression(a0)) {
                      const r = rootIdent(a0);
                      if (r) positive.add(r);
                    }
                  }
                }
              }
            }
            ts.forEachChild(n, scan);
          };
          ts.forEachChild(body.body, scan);

          for (const [v, ln] of negated) {
            if (sliced.has(v) && !positive.has(v)) {
              findings.unwitnessed.push(
                `${file}:${ln}  「${title}」 对切片变量 ${v} 只有 not.* 断言,没有正向断言自证窗口切对了`,
              );
            }
          }

          const key = `${file} :: ${title}`;
          const allowed = Object.keys(ALLOW).some((k) => key.startsWith(k) && ALLOW[k]);
          if (!allowed) {
            if (!hasExpect) findings.zero.push(`${file}:${lineOf(node)}  ${title}`);
          }
        }
      }

      // ── 悬空断言:expect(...) 直接作为语句,没接 matcher
      if (ts.isIdentifier(fn) && fn.text === 'expect' && ts.isExpressionStatement(node.parent)) {
        findings.dangling.push(`${file}:${lineOf(node)}  expect(...) 没有 matcher`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

function rootIdent(pa) {
  let e = pa;
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) e = e.expression;
  return ts.isIdentifier(e) ? e.text : '';
}

const total = findings.zero.length + findings.dangling.length + findings.unwitnessed.length;
const show = (label, arr) => {
  if (!arr.length) { console.log(`✅ ${label}: 0`); return; }
  console.log(`❌ ${label}: ${arr.length}`);
  arr.forEach((x) => console.log(`   ${x}`));
};
console.log(`扫描 ${files.length} 个测试文件(根目录: ${ROOT})\n`);
show('零断言(跑了等于没跑)', findings.zero);
show('悬空断言(永远不会失败)', findings.dangling);
show('否定式断言没有窗口自证(切错窗口会静默通过)', findings.unwitnessed);

if (total > 0) {
  console.error(`\n❌ fake-green: ${total} 处。测试是门禁,门禁自己不能是摆设。`);
  process.exit(1);
}
console.log('\n✅ fake-green: 无假绿测试');
