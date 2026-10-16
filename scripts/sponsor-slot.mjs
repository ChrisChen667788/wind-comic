#!/usr/bin/env node
/**
 * v13.1 — README 赞助位上下架。
 *
 * 赞助位(`## 💎 Sponsors · 赞助商`,README 中英各一份)是对外收益位:金主续费就挂、停费就下。
 * 原来上下架靠手改两份 README —— 下架容易,再上架时要把 logo、文案、带 `?s=wind-comic` 分成参数的
 * 落地页链接原样拼回来,漏一个参数金主就统计不到导流。现在原文按金主存档在
 * `docs/sponsors/<id>/README.md.snippet` 与 `README.zh-CN.md.snippet`(逐字节从当时的 README 取出),
 * README 里只留两行看不见的 HTML 注释作锚点,上下架都只动锚点之间的内容。
 *
 * 用法:
 *   npm run sponsor -- status        # 两份 README 现在挂的是谁
 *   npm run sponsor -- on metaso     # 上架(把存档原样放回锚点之间)
 *   npm run sponsor -- off           # 下架(清空锚点之间,存档不动)
 * 改完会自动重跑 gen-modelscope-intro,ModelScope 介绍页跟着变;之后照常 commit / push / ms:sync。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SLOT_START = '<!-- sponsor-slot:start -->';
export const SLOT_END = '<!-- sponsor-slot:end -->';
export const READMES = ['README.md', 'README.zh-CN.md'];
const ARCHIVE = 'docs/sponsors';

/** 锚点之间的原文;没有锚点或锚点不成对时抛错(宁可报错,不猜位置) */
export function readSlot(readme) {
  const a = readme.indexOf(SLOT_START);
  const b = readme.indexOf(SLOT_END);
  if (a < 0 || b < 0 || b < a || readme.indexOf(SLOT_START, a + 1) >= 0 || readme.indexOf(SLOT_END, b + 1) >= 0) {
    throw new Error('README 里找不到成对且唯一的 sponsor-slot 锚点');
  }
  return readme.slice(a + SLOT_START.length + 1, b);   // +1:开始锚点后的换行
}

/** 把锚点之间换成 content('' = 下架);content 须以换行结尾或为空 */
export function writeSlot(readme, content) {
  readSlot(readme);   // 先校验锚点
  const a = readme.indexOf(SLOT_START) + SLOT_START.length + 1;
  const b = readme.indexOf(SLOT_END);
  return readme.slice(0, a) + content + readme.slice(b);
}

/** 存档里的金主列表 */
export function listSponsors(root = '.') {
  const dir = path.join(root, ARCHIVE);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()) : [];
}

/** 读某个金主给某份 README 的存档原文,并核对:logo 文件在、分成追踪参数没丢 */
export function loadSnippet(id, readmeName, root = '.') {
  const p = path.join(root, ARCHIVE, id, `${readmeName}.snippet`);
  if (!fs.existsSync(p)) throw new Error(`没有 ${id} 给 ${readmeName} 的存档:${p}`);
  const s = fs.readFileSync(p, 'utf-8');
  for (const m of s.matchAll(/src="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1]) && !fs.existsSync(path.join(root, m[1]))) throw new Error(`${p} 引用的图片不存在:${m[1]}`);
  }
  if (id === 'metaso' && !s.includes('?s=wind-comic')) throw new Error(`${p} 里的落地页丢了 ?s=wind-comic 分成参数`);
  return s.endsWith('\n') ? s : s + '\n';
}

/** 锚点之间现在是谁:'' = 空位;否则按存档逐字比对,对不上的返回 'unknown' */
export function whoIsOn(readme, readmeName, root = '.') {
  const cur = readSlot(readme);
  if (cur.trim() === '') return '';
  return listSponsors(root).find((id) => {
    try { return loadSnippet(id, readmeName, root) === cur; } catch { return false; }
  }) ?? 'unknown';
}

function main() {
  const [cmd, id] = process.argv.slice(2);
  if (cmd === 'status' || !cmd) {
    for (const r of READMES) {
      const who = whoIsOn(fs.readFileSync(r, 'utf-8'), r);
      console.log(`[sponsor] ${r}:${who === '' ? '空位(已下架)' : who === 'unknown' ? '有内容,但与存档对不上(手改过?)' : `挂着 ${who}`}`);
    }
    console.log(`[sponsor] 存档:${listSponsors().join(', ') || '(无)'}`);
    return;
  }
  if (cmd !== 'on' && cmd !== 'off') { console.error('用法:npm run sponsor -- status | on <id> | off'); process.exit(2); }
  if (cmd === 'on' && !id) { console.error(`缺金主 id;存档里有:${listSponsors().join(', ')}`); process.exit(2); }
  for (const r of READMES) {
    const before = fs.readFileSync(r, 'utf-8');
    const after = writeSlot(before, cmd === 'on' ? loadSnippet(id, r) : '');
    fs.writeFileSync(r, after);
    console.log(`[sponsor] ${r}:${cmd === 'on' ? `已上架 ${id}` : '已下架'}${before === after ? '(本来就是这样)' : ''}`);
  }
  execFileSync(process.execPath, ['scripts/gen-modelscope-intro.mjs'], { stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
