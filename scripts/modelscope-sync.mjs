#!/usr/bin/env node
/**
 * ModelScope 代码镜像 + 模型卡同步 —— v12.340。
 *
 * ## 为什么要有这个脚本
 *
 * 这套同步有三个**每次都要按顺序做、漏一步就出事**的动作,此前全靠人记:
 *
 * 1. **只传 git 跟踪的内容**。直接传工作目录会把 `.env.local`、`node_modules`、
 *    未提交的草稿一起送出去。必须 `git archive HEAD` 导出。
 *
 * 2. **文件夹上传会用仓库根的 README.md 覆盖模型卡**。而 GitHub 版 README 里是
 *    相对路径图片,在 ModelScope 上一张都渲染不出来。**传完必须立刻用
 *    `docs/modelscope-intro.md` 重刷一次模型卡** —— 这一步我已经漏过两次,
 *    最近一次(v12.339)覆盖后卡上留下 30 处相对路径图片。
 *
 * 3. **`--sync` 会删掉「远端有、本地无」的文件**。平台建库时自带的
 *    `configuration.json` 不在 git 里,曾因此被删且无法找回(ModelScope 没有
 *    可用的提交历史 API)。所以默认**不带 --sync**;确需清理陈旧文件时,
 *    先用 `--preview-deletes` 只读地列出会删什么。
 *
 * ## 令牌
 * 从环境变量 `MODELSCOPE_API_TOKEN` 读,**不写盘、不打印**。失败输出里可能带
 * `oauth2:<令牌>@` 形式的远端地址,已做掩码。
 *
 * 用法:
 *   MODELSCOPE_API_TOKEN=... node scripts/modelscope-sync.mjs
 *   node scripts/modelscope-sync.mjs --preview-deletes    # 只读:列出 --sync 会删什么
 *   node scripts/modelscope-sync.mjs --card-only          # 只重刷模型卡
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = 'haozi667788/wind-comic';
const CARD_SRC = 'docs/modelscope-intro.md';
const RESOLVE = `https://modelscope.cn/models/${REPO}/resolve/master`;

/** 令牌绝不能进终端/日志 —— 见过失败信息里带 oauth2:<令牌>@ 的远端 URL。 */
const redact = (s) => String(s)
  .replace(/ms-[0-9a-f-]{8,}/gi, 'ms-***')
  .replace(/oauth2:[^@\s]+@/g, 'oauth2:***@');

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 1 << 28, ...opts });
  } catch (e) {
    throw new Error(redact(`${e.stdout || ''}${e.stderr || ''}${e.message}`).slice(0, 800));
  }
}

/** 导出 git 跟踪的内容到临时目录 —— 绝不直接传工作目录。 */
export function exportTracked(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = sh('git', ['archive', 'HEAD'], { encoding: 'buffer' });
  const tmp = path.join(dest, '.export.tar');
  fs.writeFileSync(tmp, tar);
  sh('tar', ['-xf', tmp, '-C', dest]);
  fs.unlinkSync(tmp);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      e.isDirectory() ? walk(p) : files.push(path.relative(dest, p));
    }
  })(dest);
  return files;
}

/** 模型卡自检:GitHub 版 README 的特征是相对路径图片,它在 ModelScope 上渲染不出来。 */
export function cardLooksClobbered(markdown) {
  const rel = (markdown.match(/(?:src|srcset)="assets\//g) || []).length;
  const ms = (markdown.match(/modelscope\.cn\/models\/[^/]+\/[^/]+\/resolve/g) || []).length;
  return { rel, ms, clobbered: rel > 0 };
}

async function fetchCard() {
  const r = await fetch(`${RESOLVE}/README.md`, { headers: { 'User-Agent': 'wind-comic-sync' } });
  return r.ok ? await r.text() : '';
}

async function main() {
  const argv = process.argv.slice(2);
  const cardOnly = argv.includes('--card-only');
  const preview = argv.includes('--preview-deletes');
  if (!process.env.MODELSCOPE_API_TOKEN) {
    console.error('[ms-sync] 缺 MODELSCOPE_API_TOKEN(不写盘,只从环境变量读)');
    process.exit(2);
  }

  if (preview) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-preview-'));
    const local = new Set(exportTracked(dest));
    const roots = ['', 'assets', 'docs', 'docs/screenshots', 'scripts', 'lib', 'services'];
    const remote = new Set();
    for (const root of roots) {
      const u = `https://modelscope.cn/api/v1/models/${REPO}/repo/files?Revision=master&Root=${encodeURIComponent(root)}`;
      try {
        const d = await (await fetch(u)).json();
        for (const f of d?.Data?.Files || []) {
          const p = f.Path || f.Name;
          if (p && !(f.Type === 'tree' || f.IsDir)) remote.add(p);
        }
      } catch { /* 列不到就不猜 */ }
    }
    const gone = [...remote].filter((r) => !local.has(r)).sort();
    console.log(`[ms-sync] 抽样 ${roots.length} 个目录:远端 ${remote.size} · 本地 ${local.size}`);
    console.log(`[ms-sync] --sync 会删除 ${gone.length} 个(**抽样结果,不是全量**):`);
    for (const g of gone.slice(0, 30)) console.log('   ✗', g);
    console.log('[ms-sync] ⚠️ 抽样不等于完整清单;不确定就别带 --sync。');
    return;
  }

  if (!cardOnly) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-sync-'));
    const files = exportTracked(dest);
    if (files.some((f) => f === '.env.local')) { console.error('[ms-sync] 导出里出现 .env.local —— 中止'); process.exit(1); }
    console.log(`[ms-sync] 导出 ${files.length} 个 git 跟踪文件 → ${dest}`);
    console.log('[ms-sync] 上传中(不带 --sync:它会删掉远端独有文件,曾因此丢过 configuration.json)…');
    const out = sh('modelscope', ['upload', REPO, '.', '--repo-type', 'model'], { cwd: dest });
    console.log(redact(out).split('\n').filter((l) => /Existed|Uploaded|Failed|Committed|Elapsed/.test(l)).join('\n'));
  }

  // **必做**:文件夹上传会用仓库根的 README.md 覆盖模型卡
  console.log('[ms-sync] 重刷模型卡(文件夹上传会用 GitHub 版 README 覆盖它)…');
  sh('modelscope', ['upload', REPO, CARD_SRC, 'README.md', '--repo-type', 'model']);

  const card = await fetchCard();
  const { rel, ms, clobbered } = cardLooksClobbered(card);
  console.log(`[ms-sync] 校验:模型卡 ${card.length} 字符 · ModelScope 自托管图 ${ms} · 残留相对图 ${rel}`);
  if (clobbered) { console.error('[ms-sync] ❌ 模型卡仍是 GitHub 版(相对路径图片渲染不出来)'); process.exit(1); }
  console.log('[ms-sync] ✅ 同步完成');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('[ms-sync]', redact(e?.message || e)); process.exit(1); });
}
