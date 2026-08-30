#!/usr/bin/env node
/**
 * v12.382:付费端点门禁 —— 会花 owner 钱的路由必须先过鉴权。
 *
 * 由来:一次全仓扫描找出 **5 个完全没有鉴权的付费端点** ——
 *   · /api/voice-sample        裸 curl 即可用 owner 的 key 合成 TTS,且 text 无长度上限
 *   · /api/season/narrate      一次请求触发几十集 TTS,无集数上限
 *   · /api/polish-script       basic 模式绕过 checkPlan(它只在 pro 模式才调,
 *                              而且注释明说「未登录当 free」—— 不 401、只降级)
 *   · /api/master-prompt/refine
 *   · /api/short-video/plan
 * 同类端点(narration/synthesize、cameo/preview、character-traits/from-face)
 * 早就加了 guardPaidEndpoint,这几个是漏网的 —— 典型的「主路径修了旁路没修」。
 *
 * 危害不只是钱:**没有登录态就写不下 cost-log**,事后连「谁花的、花在哪」都查不到,
 * 只剩「余额怎么没了」。
 *
 * 判定:一个 route.ts 若出现「调用外部付费能力」的特征(见 PAID_SIGNALS),
 * 就必须同时出现一个鉴权/守卫调用(见 GUARD_SIGNALS)。
 * 走基线,只拦新增;豁免要写 `// paid-gate: ok — <为什么>`。
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'app/api');
const BASELINE = path.join(ROOT, 'lib/consumer-gate/paid-baseline.json');

/** 「这个路由会花钱」的特征。宁可少认,也不要把纯本地端点拖进来。 */
const PAID_SIGNALS = [
  /dispatchTTSGenerate/,
  /callLLMWithFallback/,
  /generateSpeech|synthesizeNarrationTrack/,
  /new MinimaxService|MinimaxService\(/,
  /generateImage|generateVideo|generateMusic/,
  /useCreative:\s*true/,

  // ── v12.388:间接付费路径 ────────────────────────────────────────────────
  // 上面那些认的都是「直接调付费 SDK」。而 /api/create 走的是
  // `new AgentOrchestrator()` + `startProduction(idea)` —— 一条特征都不命中,
  // 于是它顶着「完全无鉴权、单次 ¥5–30」大摇大摆通过了 v12.382 的门禁。
  // 一个只认直接调用的付费门禁,会漏掉所有把花钱包了一层的入口 ——
  // 而那恰恰是最贵的那类(编排器一跑就是整条管线)。
  /new AgentOrchestrator|AgentOrchestrator\(/,
  /new HybridOrchestrator|HybridOrchestrator\(/,
  /\.startProduction\(/,
  /runCreatePipeline|createPipeline\(/,
  /\bregenerateShot\(|\bgenerateStoryboard\(/,
];

/** 「已经守住了」的特征 */
const GUARD_SIGNALS = [
  /guardPaidEndpoint/,
  /requireUser\s*\(/,
  /getUserFromRequest\s*\(/,
  /requireProjectAccess/,
  /assertBudget/,
];

const EXEMPT_RE = /\/\/\s*paid-gate:\s*ok\s*[—-]\s*\S/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

const seen = [];

function scan() {
  if (!fs.existsSync(API_DIR)) return [];
  const findings = [];
  for (const file of walk(API_DIR).sort()) {
    const src = fs.readFileSync(file, 'utf-8');
    // 只看代码:注释里提到 dispatchTTSGenerate 不算「会花钱」,
    // **import 行也不算「已守卫」** —— 我第一版就栽在这:把守卫的调用删掉、
    // import 留着,门禁照样放行。和 indexOf 命中 import 是同一个坑,
    // 只不过这次是我刚写的门禁自己踩的。
    const body = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => !/^\s*import\s/.test(l))
      .join('\n');
    const paid = PAID_SIGNALS.find((re) => re.test(body));
    if (!paid) continue;
    // 豁免的路由**照样算识别到了** —— 它确实是付费路由,只是被明确放行。
    // 顺序写反(先跳过豁免再计数)会让「全仓只有一个付费端点且它被豁免」
    // 变成「一个都没识别出来」,自检误报。
    seen.push(path.relative(ROOT, file));
    if (EXEMPT_RE.test(src)) continue;
    if (GUARD_SIGNALS.some((re) => re.test(body))) continue;
    findings.push({ route: path.relative(ROOT, file), signal: String(paid) });
  }
  return findings;
}

const findings = scan();
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) : { entries: [] };
const known = new Set(baseline.entries.map((e) => e.route));

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({ entries: findings }, null, 2) + '\n');
  console.log(`✅ 付费端点基线已更新:${findings.length} 条`);
  process.exit(0);
}

const fresh = findings.filter((f) => !known.has(f.route));
if (fresh.length) {
  console.log(`\n❌ 付费端点门禁失败:新增 ${fresh.length} 个会花钱但没有鉴权的路由\n`);
  for (const f of fresh) {
    console.log(`  ${f.route}`);
    console.log(`    命中付费特征 ${f.signal},却没有 guardPaidEndpoint / requireUser / requireProjectAccess`);
  }
  console.log(`\n怎么办:
  1. 加 guardPaidEndpoint(request, { pendingCostCny: <估值> })（推荐:同时做鉴权与预算);
  2. 确属免费/本地能力 → 在文件里写 \`// paid-gate: ok — <为什么不花钱>\`;
  3. 批量重构时用 --update 收进基线(会在 diff 里被看见)。\n`);
  process.exit(1);
}
// 识别数为 0 说明**特征写得太窄**,门禁形同虚设 —— 那比不装门禁更危险:
// 它会给人「已经守住了」的错觉。这条自检必须在通过路径上,不能只在失败时报。
if (seen.length === 0) {
  console.log('\n❌ 付费端点门禁自检失败:一个付费端点都没识别出来 —— PAID_SIGNALS 该更新了\n');
  process.exit(1);
}
console.log(`✅ 付费端点门禁通过(识别出 ${seen.length} 个付费路由,均有守卫;基线内存量 ${baseline.entries.length} 条)`);
