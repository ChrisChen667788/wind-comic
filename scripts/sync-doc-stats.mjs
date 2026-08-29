#!/usr/bin/env node
/**
 * v12.276 — 对外文档数字单一真源(测试数 + 版本号)。
 *
 * 病根:「N 个单测」「vN 版本」这类数字**手抄在 5 份对外文档的 17 处**,每次发版必漂。
 * 实测发现时:README 徽章已是 3586,而 alt 文本仍写 3507、贡献指南写 3507/3507、
 * MARKETING-zh/en 与 modelscope-profile 里散着 9 处 3507 和过期的 v12.263。
 * 这与本轮反复在治的病同源(VideoEngine 两套类型、VOICE_CATALOG 与 VOICE_PROFILES 两张表)——
 * **同一事实抄在多处,必然漂**。
 *
 * 真源:
 *   · 版本号 ← package.json
 *   · 测试数 ← `npx vitest list`(只列举不执行)的行数;也可用 --tests=N 显式传入,
 *     发版流程里通常已跑过全量,直接把那个数传进来更快。
 *
 * 用法:
 *   node scripts/sync-doc-stats.mjs                 # 自动跑 vitest list 取数(约 1 分钟)
 *   node scripts/sync-doc-stats.mjs --tests=3586    # 直接给数(发版流程推荐)
 *   node scripts/sync-doc-stats.mjs --check         # 只检查不改,有漂移则退出码 1(可作门禁)
 */
import fs from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const testsArg = args.find((a) => a.startsWith('--tests='));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;                       // 12.276.0
// v12.370.1:原来是 `version.replace(/\.0$/, '')` —— **只去掉结尾的 `.0`**。
// 12.370.0 → v12.370 ✓,但 12.370.1 → v12.370.1 ✗,而门禁(tests/v12-291)
// 要求头部是 major.minor 短号 —— **补丁版发布必红**,而且红在「文档没同步」这种
// 看起来像流程问题、实则是脚本 bug 的地方。写入端与门禁口径必须一致:一律取前两段。
const vShort = `v${version.split('.').slice(0, 2).join('.')}`;  // 12.370.1 → v12.370

/**
 * v12.326:骤降防护。
 *
 * 原先只挡 `<= 0`。但真正咬过人的是**骤降但仍为正**:v12.321 时 `.claude/` 里
 * 装进来的第三方技能自带 `*.test.mjs`,`vitest list` 收集期抛错把清单从 **4131
 * 截断成 683**,而 683 是个正数,一路畅通差点把「683/683 通过」写进对外徽章。
 * 徽章是对外承诺,**数字本身必须可信**,否则所有绿灯都失去意义。
 * 阈值取 20%:正常删测试不会一次少两成;真要大改用 --force 明示。
 */
function assertPlausible(n) {
  let prev = 0;
  try {
    const m = fs.readFileSync('README.md', 'utf-8').match(/Tests-(\d+)%2F/);
    if (m) prev = parseInt(m[1], 10);
  } catch { /* README 读不到就没得比,放行 */ }
  if (prev > 0 && n < prev * 0.8 && !args.includes('--force')) {
    throw new Error(
      `测试数骤降:${prev} → ${n}(少了 ${(100 - (n / prev) * 100).toFixed(1)}%)。\n`
      + `  这通常不是真的删了测试,而是收集期出错把清单截断了(v12.321 就是这么来的)。\n`
      + `  先跑 \`npx vitest list | tail\` 看有没有收集错误;确属预期请加 --force。`,
    );
  }
  return n;
}

function resolveTestCount() {
  if (testsArg) {
    const n = parseInt(testsArg.split('=')[1], 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--tests 非法: ${testsArg}`);
    return assertPlausible(n);
  }
  // vitest list 只列举不执行;每行一个用例
  const out = execSync('npx vitest list', { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return assertPlausible(out.split('\n').filter((l) => l.trim().length > 0).length);
}

// v12.336:**惰性求值**。此前是顶层直接算,于是任何 `import` 本模块的测试都会真的去跑
// `npx vitest list` —— 单个用例因此耗时 72 秒,凭空给全量测试加了一分多钟。
// 纯函数(syncOne / syncPromoFrame 等)被单测导入时根本不需要这个数字。
let _testsCache = null;
function tests() {
  if (_testsCache === null) _testsCache = resolveTestCount();
  return _testsCache;
}

/** 要同步的对外文档。 */
const FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/MARKETING-zh.md',
  'docs/MARKETING-en.md',
  'docs/modelscope-profile.md',
  'VERSIONS.md',   // v12.291:只同步抬头区,见 syncVersionsHeader —— 正文全是历史陈述,不能动
  // v12.336:宣传片片尾卡的「测试通过 NNNN」此前是**硬编码**,每次发版即过期 ——
  // 实测成片上写着 4131 而当时已是 4311(数字还被转置了)。片尾卡是对外的事实陈述,不该靠人记。
  'videos/wind-comic-promo/compositions/frames/08-your-keys.html',
];

/**
 * ⚠️ 血的教训:**必须跳过表格行**。
 *
 * 首版规则 `/\b\d{3,5}\s+tests\b/` 看似安全,实测把**历史版本表**里的记录也改了:
 *   `| **v10 · …** … **2135 tests** green |`      → 3586  ❌
 *   `| **v12.49–v12.80 …** … **2712 tests** …|`   → 3586  ❌
 *   `| **v10 · 配音口型…** … **2135 单测**双驱动全绿 |` → 3586  ❌
 * 那些是**当时的历史事实**,改掉等于让文档说谎(而且是不可逆的信息丢失)。
 *
 * 现行策略:凡以 `|` 开头的行(Markdown 表格行)一律不动 —— 版本历史表、竞品矩阵都在表格里,
 * 而需要同步的三处(徽章 `<img>`、`### 10.` 标题、贡献指南编号列表)都不是表格行。
 */
function isTableRow(line) {
  return line.trimStart().startsWith('|');
}

/**
 * 替换规则。刻意**只匹配带上下文的写法**(如「3507 tests」「3507 个单测」),
 * 不做裸数字全局替换 —— 否则会误伤版本号、Elo 分数、价格等无关数字。
 */
function syncLine(line) {
  if (isTableRow(line)) return line; // ← 保护历史记录
  let s = line;
  const T = String(tests());
  const rules = [
    // 徽章 + alt
    [/Tests-\d+%2F\d+-2ea44f/g, `Tests-${T}%2F${T}-2ea44f`],
    [/alt="\d+ tests passing"/g, `alt="${T} tests passing"`],
    // 英文写法
    [/\b\d{3,5}\s+(vitest\s+)?tests\b/gi, (m) => m.replace(/\d{3,5}/, T)],
    [/\bVitest\s+\d{3,5}\/\d{3,5}\b/g, `Vitest ${T}/${T}`],
    [/\b\d{3,5}\/\d{3,5}\s+tests\b/g, `${T}/${T} tests`],
    // 中文写法
    [/\b\d{3,5}\s*个单测/g, `${T} 个单测`],
    [/\b\d{3,5}\s*单测/g, `${T} 单测`],
    [/\b\d{3,5}\s*测试全过/g, `${T} 测试全过`],
    [/### 10\. \*\*\d{3,5} tests/g, `### 10. **${T} tests`],
    // 版本号(仅「vX.Y」形态的自述位置,避免动到历史版本表)
    [/v2\.0 → v12\.\d+/g, `v2.0 → ${vShort}`],
    [/\bv12\.\d+\s*·\s*\d{3,5}\s*单测/g, `${vShort} · ${T} 单测`],
  ];
  for (const [re, rep] of rules) s = s.replace(re, rep);
  return s;
}

/** 逐行处理,表格行原样透传。 */
/**
 * 宣传片片尾卡:只替换紧跟在「测试通过」标签后面那一格的数字。
 * **锚定标签而不是锚定数字** —— 同一张卡上还有 MIT、版本号,误伤的代价是对外素材说谎。
 */
export function syncPromoFrame(text, n = tests()) {
  // v12.338:**容忍任意属性**。首版把标记逐字锚死(`<div class="k cn">测试通过</div>…`),
  // 结果 HyperFrames 工具给每个元素注入 `data-hf-id="…"` 之后正则整条失配 ——
  // 门禁不再报红、数字也不再同步,而且是**静默**的。锚「测试通过」这个标签本身,
  // 属性怎么加都不影响。
  return text.replace(
    /(<div\b[^>]*class="k cn"[^>]*>测试通过<\/div>\s*<div\b[^>]*class="v"[^>]*>)(\d+)(<\/div>)/,
    (_m, a, _old, b) => `${a}${n}${b}`,
  );
}

function syncOne(text) {
  return text.split('\n').map(syncLine).join('\n');
}

/**
 * v12.291:VERSIONS.md 的**开头叙述**也纳入同步 —— 此前它是全仓最后一处手工维护的版本号/测试数,
 * 每次发版都得记得改,忘了就靠 `tests/v12-234-recheck2` 事后报红(本版就是这么被抓到的)。
 *
 * ⚠️ 但这个文件与其它文档**性质不同**:整篇都是历史陈述,每条版本记录下面的正文里写着
 * 「当时」的测试数与版本号(如「截至 v12.226:2135 tests」),那些一个字都不能动 ——
 * v12.276 我就是用脚本改 VERSIONS.md 伤过历史记录。
 *
 * 因此**只处理第一条表格行之前的抬头区**(前言那几行),往后一律原样透传。
 * 这个边界是结构性的:表格一开始,后面全是历史。
 */
function syncVersionsHeader(text) {
  const lines = text.split('\n');
  const firstRow = lines.findIndex((l) => /^\| \*\*v[0-9]/.test(l));
  if (firstRow < 0) return text;                    // 没有版本表 → 不敢动,原样返回
  const head = lines.slice(0, firstRow).map((l) => {
    let s = syncLine(l);
    // 抬头里的「到当前 (**v12.290**)」「截至 **v12.290**:」
    s = s.replace(/\(\*\*v\d+\.\d+(?:\.\d+)?\*\*\)/g, `(**${vShort}**)`);
    s = s.replace(/截至 \*\*v\d+\.\d+(?:\.\d+)?\*\*/g, `截至 **${vShort}**`);
    // 抬头里的「vitest 3739 全绿」
    s = s.replace(/vitest\s+\d{3,5}\s*全绿/gi, `vitest ${tests()} 全绿`);
    return s;
  });
  return [...head, ...lines.slice(firstRow)].join('\n');
}

/**
 * v12.336:**主流程收进 main(),由主模块守卫触发。**
 *
 * 此前整个同步流程写在模块顶层 —— 于是单测只要 `import` 本模块拿纯函数(syncOne /
 * syncPromoFrame),就会**真的把全仓文档同步一遍**并 `process.exit(0)`:
 * 一条用例跑了 77 秒(因为顺带执行了 `npx vitest list`),而且**真的改了工作区的文件**。
 * 脚本能被 import 就必须假定有人会 import 它。
 */
function main() {
  let drifted = 0;
  const report = [];
  for (const f of FILES) {
    if (!fs.existsSync(f)) continue;
    const before = fs.readFileSync(f, 'utf-8');
    const after = f === 'VERSIONS.md' ? syncVersionsHeader(before)
      : f.endsWith('08-your-keys.html') ? syncPromoFrame(before)
      : syncOne(before);
    if (after !== before) {
      drifted++;
      // 统计变了几行,便于人工核对
      const bl = before.split('\n'), al = after.split('\n');
      const changed = bl.reduce((n, l, i) => n + (l !== al[i] ? 1 : 0), 0);
      report.push(`  ${f} — ${changed} 行`);
      if (!checkOnly) fs.writeFileSync(f, after);
    }
  }

  console.log(`[doc-stats] 真源:版本 ${vShort} · 测试 ${tests()}`);
  if (drifted === 0) {
    console.log('[doc-stats] ✅ 全部对外文档已一致,无漂移');
    process.exit(0);
  }
  console.log(`[doc-stats] ${checkOnly ? '❌ 检测到漂移' : '✅ 已同步'}(${drifted} 个文件):`);
  for (const r of report) console.log(r);
  if (checkOnly) {
    console.log('[doc-stats] 提示:运行 `npm run sync-doc-stats -- --tests=<全量测试数>` 修复');
    process.exit(1);
  }

}

if (import.meta.url === `file://${process.argv[1]}`) main();
