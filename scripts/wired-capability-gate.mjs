#!/usr/bin/env node
/**
 * scripts/wired-capability-gate.mjs — 「造好了没接线」门禁(v12.409)。
 *
 * ## 为什么需要它
 * 这是本项目最常犯、也最难自查的一类病:**能力造好了,但没有任何调用方**。
 * 它不会让任何测试变红 —— 函数有单测、类型也对、CI 全绿,
 * 只是**产品里没有一条路会走到它**。于是 README 上写着的功能,
 * 在真实出片时一次都不会发生。
 *
 * v12.407 的 `generateExtended()` 和 v12.408 的 `editImage()` 分流就是这样:
 * 两版都写了「已接入」,而竞品复核的 agent 逐处 grep 后指出全仓零命中 —— 它是对的。
 * 更难堪的是,v12.408 的说明里我亲手写下「造好不接线正是这一版要治的病本身」。
 *
 * 靠人记不住,靠下一轮 agent 抓也太晚。所以固化成门禁。
 *
 * ## 它怎么判
 * 维护一张「能力 → 必须存在的消费方」表。对每一项:
 *   · 在**生产方以外**的文件里找调用点(剥掉注释,免得被自己写的说明骗过);
 *   · 一个都找不到 → 红。
 *
 * ## 它不判什么
 * 不判「调用得对不对」——那是单测的事。它只回答一个问题:
 * **这条能力,产品里有没有一条路会走到它?**
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

/** 能力清单:name = 说人话的名字;symbol = 要找的调用符号;producer = 生产方(不算调用方);consumers = 允许出现调用的范围 */
const CAPABILITIES = [
  {
    name: 'Veo Scene Extension(把成片接长)',
    symbol: 'generateExtended(',
    producer: 'services/veo.service.ts',
    consumers: ['services', 'app', 'lib'],
    why: 'v12.407 造好后零调用 —— 剧本要 15s 的镜,走 Veo 只出 8s 且不报错',
  },
  {
    name: 'Kontext 局部重绘(弱镜只改问题处)',
    symbol: 'editImage(',
    producer: 'services/fal-flux.service.ts',
    consumers: ['app', 'services', 'lib'],
    why: 'v12.408 造好分流后零调用 —— 整张重生会把已经对的部分一起重新掷骰子',
  },
  {
    name: '弱镜修复分流(局部重绘 vs 整张重生)',
    symbol: 'chooseRepairStrategy(',
    producer: 'lib/repair-strategy.ts',
    consumers: ['app', 'services', 'lib'],
    why: '决策造出来没人消费,等于没有决策',
  },
];

/** 剥注释 —— 否则会被「说明里提到过这个符号」骗过,那正是本门禁要防的自欺 */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .map((l) => l.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

let failed = 0;
const lines = [];

for (const cap of CAPABILITIES) {
  const files = cap.consumers.flatMap((d) => walk(path.join(ROOT, d)));
  const producer = path.resolve(ROOT, cap.producer);
  const hits = [];

  for (const f of files) {
    if (path.resolve(f) === producer) continue;
    let src;
    try { src = strip(fs.readFileSync(f, 'utf-8')); } catch { continue; }
    if (src.includes(cap.symbol)) hits.push(path.relative(ROOT, f));
  }

  if (hits.length === 0) {
    failed++;
    lines.push(`❌ ${cap.name}`);
    lines.push(`   符号 \`${cap.symbol}\` 在 ${cap.producer} 之外**零命中** —— 造好了没接线。`);
    lines.push(`   为什么要管:${cap.why}`);
  } else {
    lines.push(`✅ ${cap.name} — ${hits.length} 处调用(${hits.slice(0, 2).join(', ')}${hits.length > 2 ? ' …' : ''})`);
  }
}

// 自检:清单为空时不许假绿
if (CAPABILITIES.length === 0) {
  console.error('[wired-gate] 能力清单是空的 —— 那这道门禁在放行一切');
  process.exit(1);
}

console.log(lines.join('\n'));
if (failed > 0) {
  console.error(`\n[wired-gate] ${failed} 项能力没有任何调用方。`);
  console.error('能力存在 ≠ 产品里有一条路会走到它。要么接上线,要么从这张表里删掉并说明理由。');
  process.exit(1);
}
console.log(`\n[wired-gate] ✅ ${CAPABILITIES.length} 项能力都有真实调用方`);
