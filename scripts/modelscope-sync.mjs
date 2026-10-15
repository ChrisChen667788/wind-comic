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
 * 先读环境变量 `MODELSCOPE_API_TOKEN`;没有就在终端里**隐藏输入**(v13.0:不回显、不进 shell 历史、
 * 也不出现在命令原文里 —— 此前要用户把占位符换成令牌再跑,占位文字被原样执行过两次)。
 * **不写盘、不打印**。失败输出里可能带 `oauth2:<令牌>@` 形式的远端地址,已做掩码。
 *
 * 用法:
 *   npm run ms:sync                                       # 提示时粘贴令牌(ms- 开头,不回显)
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

/**
 * v12.458:令牌格式预检。返回 null = 通过;否则返回一句人话 —— **绝不含令牌本身**。
 *
 * 实际发生过两次:一次把占位文字「你的令牌」原样传进来,一次首字符是 macOS 上 ⌥V 打出的「√」
 * (粘贴应是 ⌘V)。两次都一路走到 modelscope CLI 里,炸成几十行 `UnicodeEncodeError: 'latin-1'`
 * 的 Python traceback(令牌被塞进 Cookie 头,HTTP 头只收 latin-1)—— 看不出是令牌错了,
 * 还白白导出了一遍 2000 多个文件。令牌只会是可打印 ASCII,在这里拦下并说清楚。
 */
export function tokenProblem(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '缺 MODELSCOPE_API_TOKEN(不写盘:请在提示处粘贴,或设环境变量)';
  // v13.0:整段「变量名=令牌」被粘进来(命令行习惯带过来的),令牌本身不含「=」前缀
  if (/^[A-Z][A-Z0-9_]*=/.test(t)) return '看起来粘的是「变量名=令牌」,只需要粘令牌本身(ModelScope 访问令牌,ms- 开头)';
  for (let i = 0; i < t.length; i++) {
    const code = t.charCodeAt(i);
    if (code >= 0x21 && code <= 0x7e) continue;
    const ch = t[i];
    const hint = ch === '√' ? ' —— macOS 上 ⌥V 会打出「√」,粘贴请用 ⌘V'
      : /[\u3400-\u9fff]/.test(ch) ? ' —— 看起来还是占位文字,请换成 ModelScope 个人中心「访问令牌」里的真实令牌'
      : /\s/.test(ch) ? ' —— 令牌中间不该有空白,可能粘贴时混进了换行或空格'
      : '';
    return `MODELSCOPE_API_TOKEN 第 ${i + 1} 个字符不是可打印 ASCII(共 ${t.length} 个字符)${hint}`;
  }
  return null;
}

/**
 * 隐藏输入的按键处理(纯函数,v13.0):剥掉 bracketed paste 的 ESC[200~ / ESC[201~,
 * 回车结束、Ctrl-C / Ctrl-D 放弃、退格删一位。终端粘贴常一次送来整段,所以按「块」处理而不是按键。
 * raw 模式下 Ctrl-D 不是 EOF,而是一个 0x04 字节 —— 不单独处理就会被悄悄拼进令牌。
 */
export function applyTokenKeystrokes(buf, chunk) {
  let b = buf;
  for (const ch of String(chunk).replace(/\x1b\[20[01]~/g, '')) {
    if (ch === '\r' || ch === '\n') return { buf: b, done: true, abort: false };
    if (ch === '\u0003' || ch === '\u0004') return { buf: '', done: false, abort: true };
    if (ch === '\u007f' || ch === '\b') { b = b.slice(0, -1); continue; }
    b += ch;
  }
  return { buf: b, done: false, abort: false };
}

/**
 * 没有环境变量时在终端里隐藏输入令牌。非交互环境(没有 TTY)直接返回空串,交给 tokenProblem 报「缺令牌」——
 * 不会挂在那里等一个永远来不了的输入。
 */
function promptHiddenToken() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    stdout.write('[ms-sync] 粘贴 ModelScope 访问令牌(ms- 开头)后回车,输入不回显:');
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let buf = '';
    // 等输入时被 kill / 关终端:不先退出 raw 模式,用户的终端会一直不回显
    const onSignal = (sig) => { cleanup(); process.exit(sig === 'SIGHUP' ? 129 : 143); };
    const cleanup = () => {
      stdin.off('data', onData); process.off('SIGTERM', onSignal); process.off('SIGHUP', onSignal);
      // SIGHUP 时终端可能已经关了,setRawMode 会抛 —— 抛了就走不到 process.exit
      try { stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); } catch { /* 终端已不在 */ }
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);
    function onData(chunk) {
      const r = applyTokenKeystrokes(buf, chunk);
      buf = r.buf;
      if (r.abort) { cleanup(); process.exit(130); }
      if (r.done) { cleanup(); resolve(buf); }
    }
    stdin.on('data', onData);
  });
}

async function fetchCard() {
  const r = await fetch(`${RESOLVE}/README.md`, { headers: { 'User-Agent': 'wind-comic-sync' } });
  return r.ok ? await r.text() : '';
}

async function main() {
  const argv = process.argv.slice(2);
  const cardOnly = argv.includes('--card-only');
  const preview = argv.includes('--preview-deletes');
  // --preview-deletes 只读公开接口,不需要令牌
  if (!preview) {
    let token = process.env.MODELSCOPE_API_TOKEN;
    if (!token) token = await promptHiddenToken();
    const bad = tokenProblem(token);
    if (bad) {
      console.error(`[ms-sync] ${bad}`);
      process.exit(2);
    }
    // 首尾空白(粘贴常带换行)去掉;交给 modelscope CLI 只走环境变量
    process.env.MODELSCOPE_API_TOKEN = token.trim();
  }

  if (preview) {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-preview-'));
    let local;
    try { local = new Set(exportTracked(dest)); } finally { fs.rmSync(dest, { recursive: true, force: true }); }
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
    // v12.458:导出的是整仓 2000 多个文件的副本 —— 成功失败都要删(此前失败时每次留下一份)
    try {
      const files = exportTracked(dest);
      if (files.some((f) => f === '.env.local')) throw new Error('导出里出现 .env.local —— 中止');
      console.log(`[ms-sync] 导出 ${files.length} 个 git 跟踪文件 → ${dest}`);
      console.log('[ms-sync] 上传中(不带 --sync:它会删掉远端独有文件,曾因此丢过 configuration.json)…');
      const out = sh('modelscope', ['upload', REPO, '.', '--repo-type', 'model'], { cwd: dest });
      console.log(redact(out).split('\n').filter((l) => /Existed|Uploaded|Failed|Committed|Elapsed/.test(l)).join('\n'));
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
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
