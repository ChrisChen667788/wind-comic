#!/usr/bin/env node
/**
 * v12.335 — README 媒体体积治理 + 门禁。
 *
 * ── 病根 ──────────────────────────────────────────────────────────
 * 仓库主页的图片/GIF「加载不出来」,查下来**文件一个都没坏**:
 *   · 无认证 `github.com/<repo>/raw/main/<path>`  → 404
 *   · 无认证 `raw.githubusercontent.com/...`      → **429**  ← 诚实的状态码
 *   · 带认证 API `contents`                       → 200,字节数完全正确
 * 也就是说 GitHub 的匿名媒体端点在限流,而 `/raw/` 路径**把 429 显示成 404**,
 * 于是看起来像「文件没了」。
 *
 * 为什么会被限流:README 一次要拉 **37 个文件 / 23.2 MB**,其中截图是
 * 2880×1800 的视网膜全屏图,而 GitHub 正文栏只有约 980px 宽 —— 等于把 9 倍的
 * 像素传过去再缩掉。看几次页面就是上百个 raw 请求、上百 MB。
 *
 * ── 处置 ──────────────────────────────────────────────────────────
 * 截图一律压到**显示宽度的 2 倍**(1600px)并转 JPEG q85。实测同一张:
 * 2.04M → 0.15M(省 92%),而按访客实际看到的尺寸(1600 图显示在 ~800px)
 * 把两版并排裁开对比,**肉眼无差**。转 JPEG 前逐个查 alpha,有透明通道的不转。
 *
 * 光压一次没用 —— 下一版新截图又是 2880×1800。所以 `--check` 做成门禁:
 * README 引用的媒体总量与单文件大小都有预算,超了就红。
 *
 * 用法:
 *   node scripts/optimize-media.mjs           # 压缩 + 改引用
 *   node scripts/optimize-media.mjs --check   # 只核预算(门禁用)
 *   node scripts/optimize-media.mjs --dry-run # 只报要动谁
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** README 引用媒体的总预算(字节)。超了访客就得替我们扛下载量。 */
export const TOTAL_BUDGET = 12 * 1024 * 1024;

/**
 * 单文件预算的豁免名单 —— **必须写理由**,否则这里会变成"压不动就加一行"的垃圾场。
 * 参照 fake-green-gate 的 ALLOW 口径。
 */
export const ALLOW = {
  'assets/promo/wind-comic-promo.gif':
    'GIF 压不动:实测降到 48 色就出明显色带(脸变平涂蓝灰、背景块状),32 色更糟;' +
    '只缩尺寸(保 192~256 色)仅省 17~36% 且图会明显变小;缩时长等于砍掉一半宣传内容。' +
    '这条片子卖的就是画质,压花了等于自毁招牌 —— 宁可留着 4.89M。' +
    '真要减,方向是换成 <video>+MP4(保画质且体积小一个量级),但那要先确认 GitHub 的 ' +
    '<video> 渲染与 LFS 带宽配额,属于单独一版的事。',
};
/** 单个文件预算。压完的截图普遍落在 130~260KB,300KB 留了余量又不至于放水。 */
export const FILE_BUDGET = 300 * 1024;
/** 目标宽度 = 显示宽度(~800px)的 2 倍,视网膜屏也够清晰。 */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 85;
/** 逐档降质的阶梯:先试最好的,进不了预算就往下走。 */
const QUALITY_LADDER = [85, 72, 60, 50, 42];

const README_FILES = ['README.md', 'README.zh-CN.md'];

/** 从 markdown/HTML 里抠出本仓引用的媒体路径(排除外链)。 */
export function mediaRefsIn(text) {
  const out = new Set();
  const add = (p) => { if (p && !/^https?:\/\//.test(p)) out.add(p); };
  for (const m of text.matchAll(/(?:src|srcset)="([^"]+\.(?:png|jpe?g|gif|webp))"/g)) add(m[1]);
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|webp))\)/g)) add(m[1]);
  return [...out];
}

/** 收集所有 README 引用的媒体(去重,保持稳定顺序)。 */
export function collectRefs(readFile = (f) => fs.readFileSync(f, 'utf-8')) {
  const seen = new Set();
  for (const f of README_FILES) {
    if (!fs.existsSync(f)) continue;
    for (const r of mediaRefsIn(readFile(f))) seen.add(r);
  }
  return [...seen].sort();
}

/** 预算核算 —— 纯函数,便于单测。 */
export function auditBudget(entries, total = TOTAL_BUDGET, per = FILE_BUDGET) {
  const sum = entries.reduce((a, e) => a + e.size, 0);
  const oversized = entries.filter((e) => e.size > per && !ALLOW[e.file]).sort((a, b) => b.size - a.size);
  return { sum, overTotal: sum > total, oversized, ok: sum <= total && oversized.length === 0 };
}

const MB = (n) => (n / 1048576).toFixed(2) + 'M';

function hasAlpha(f) {
  try { return /hasAlpha:\s*yes/.test(execFileSync('sips', ['-g', 'hasAlpha', f], { encoding: 'utf-8' })); }
  catch { return true; } // 查不出就当有,宁可不转
}

function entriesFor(refs) {
  return refs.filter((r) => fs.existsSync(r)).map((r) => ({ file: r, size: fs.statSync(r).size }));
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const dry = argv.includes('--dry-run');
  const refs = collectRefs();
  const entries = entriesFor(refs);
  const before = auditBudget(entries);

  console.log(`[media] README 引用本仓媒体 ${entries.length} 个,合计 ${MB(before.sum)}(预算 ${MB(TOTAL_BUDGET)})`);

  if (check) {
    if (before.ok) { console.log('[media] ✅ 在预算内'); process.exit(0); }
    if (before.overTotal) console.log(`[media] ❌ 总量超预算 ${MB(before.sum)} > ${MB(TOTAL_BUDGET)}`);
    for (const e of before.oversized.slice(0, 10)) console.log(`   · ${MB(e.size)}  ${e.file}(单文件上限 ${MB(FILE_BUDGET)})`);
    console.log('   修复:node scripts/optimize-media.mjs');
    process.exit(1);
  }

  const renames = [];
  let saved = 0;
  for (const { file, size } of entries) {
    if (size <= FILE_BUDGET) continue;
    if (ALLOW[file]) { console.log(`[media] 豁免(有理由):${file}`); continue; }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.gif') { console.log(`[media] 跳过 GIF(单独处理):${file}`); continue; }
    if (hasAlpha(file)) { console.log(`[media] 跳过(有透明通道,转 JPEG 会丢 alpha):${file}`); continue; }
    const out = file.replace(/\.(png|jpe?g|webp)$/i, '.jpg');
    if (dry) { console.log(`[media] 将压缩 ${file} (${MB(size)}) → ${out}`); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // 逐档降质,直到进预算 —— 单跑一档 85 是不够的:
    // 抓图脚本出的是 q72,拿 q85 重编码只会**变大**。而旧版把变大的结果照单收下
    // (jpg 的 in/out 同路径,直接覆盖掉了更小的原文件),还照样打印「✅ 省下 -0.35M」。
    // **压完更大就必须丢弃**;一个把东西改坏还报成功的工具,比没有更危险。
    const tmp = out + '.opt.tmp.jpg';
    let best = null;
    for (const q of QUALITY_LADDER) {
      execFileSync('sips', ['-Z', String(MAX_WIDTH), '-s', 'format', 'jpeg',
        '-s', 'formatOptions', String(q), file, '--out', tmp], { stdio: 'ignore' });
      const n = fs.statSync(tmp).size;
      if (!best || n < best.size) best = { size: n, buf: fs.readFileSync(tmp) };
      if (n <= FILE_BUDGET) break;
    }
    fs.rmSync(tmp, { force: true });
    if (!best || best.size >= size) {
      console.log(`[media] 压不动(${MB(size)} → 最优 ${best ? MB(best.size) : 'n/a'}),保持原样:${file}`);
      continue;
    }
    fs.writeFileSync(out, best.buf);
    const now = best.size;
    saved += size - now;
    console.log(`[media] ${MB(size)} → ${MB(now)}${now > FILE_BUDGET ? ' ⚠ 仍超单文件预算' : ''}  ${file}${out !== file ? ' → ' + path.basename(out) : ''}`);
    if (out !== file) { fs.unlinkSync(file); renames.push([file, out]); }
  }

  if (dry) return;

  // 改引用:只替换**确实改过名的那些精确路径**,不做模糊匹配
  if (renames.length) {
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf-8' }).split('\n')
      .filter((f) => /\.(md|mjs|ts|tsx|json|yml|html)$/.test(f) && fs.existsSync(f));
    let touched = 0;
    for (const f of tracked) {
      let t = fs.readFileSync(f, 'utf-8');
      const orig = t;
      for (const [from, to] of renames) t = t.split(from).join(to);
      if (t !== orig) { fs.writeFileSync(f, t); touched++; }
    }
    console.log(`[media] 改名 ${renames.length} 个,更新引用的文件 ${touched} 个`);
  }

  const after = auditBudget(entriesFor(collectRefs()));
  const clean = !after.overTotal && after.oversized.length === 0;
  // ✅ 只在**真的进预算**时打。旧版无论如何都打 ✅,于是「还超 3.6M」被一个绿勾盖住了。
  console.log(`[media] ${clean ? '✅' : '❌'} 省下 ${MB(saved)};现在 ${MB(after.sum)} / 预算 ${MB(TOTAL_BUDGET)}`);
  if (!clean) {
    if (after.overTotal) console.log(`[media] ❌ 总量仍超 ${MB(after.sum - TOTAL_BUDGET)}`);
    for (const e of after.oversized) console.log(`[media] ❌ 单文件仍超:${MB(e.size)} ${e.file}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
