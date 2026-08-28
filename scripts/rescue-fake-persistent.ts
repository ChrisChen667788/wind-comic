/**
 * 抢救「假持久」资产(v12.347)。
 *
 * `persistent_url` 这一列的承诺是「这份不会消失」,但三处代码曾写
 * `persistentUrl: url.startsWith('http') ? url : null` —— 把会过期的引擎外链
 * 直接塞了进去。库里因此留下若干条:看着有持久副本,其实一到期就 403。
 *
 * 本脚本把**仍然活着**的那些抓回本地存储,并改写 persistent_url 指向本地副本。
 * 已经死掉的只报告、不动(无从抢救,留着让人知道丢了什么)。
 *
 * 复用仓库里的 `persistAsset` —— 不另造一套落盘逻辑(同一语义两份实现是本项目的老毛病)。
 *
 * 用法:npx tsx scripts/rescue-fake-persistent.ts [--dry]
 */
import { db } from '../lib/db';
import { persistAsset } from '../lib/asset-storage';

const DRY = process.argv.includes('--dry');

type Row = { id: string; type: string; name: string; persistent_url: string; media_urls: string };

async function main() {
  const rows = db.prepare(
    `SELECT id, type, name, persistent_url, media_urls FROM project_assets
      WHERE persistent_url LIKE 'http%'`).all() as Row[];

  console.log(`\n假持久资产 ${rows.length} 条${DRY ? '(干跑)' : ''}\n`);
  if (!rows.length) return;

  let saved = 0, dead = 0, failed = 0;
  for (const r of rows) {
    const url = r.persistent_url;
    // 先探活 —— 已死的没必要走下载
    let alive = false;
    try {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      alive = head.ok;
    } catch { alive = false; }

    if (!alive) {
      dead++;
      console.log(`  💀 ${r.type}/${r.name.slice(0, 22)} —— 外链已失效,无从抢救`);
      continue;
    }
    if (DRY) { saved++; console.log(`  + ${r.type}/${r.name.slice(0, 22)} —— 仍存活,可抢救`); continue; }

    const p = await persistAsset(url).catch(() => null);
    if (!p?.url) { failed++; console.log(`  ❌ ${r.type}/${r.name.slice(0, 22)} —— 下载失败`); continue; }

    // media_urls 里那条外链一并换成本地副本(其余保持原样)
    let media: string[] = [];
    try { media = JSON.parse(r.media_urls || '[]'); } catch { media = []; }
    const newMedia = media.map((m) => (m === url ? p.url : m));
    if (!newMedia.includes(p.url)) newMedia.unshift(p.url);

    db.prepare('UPDATE project_assets SET persistent_url = ?, media_urls = ? WHERE id = ?')
      .run(p.url, JSON.stringify(newMedia), r.id);
    saved++;
    console.log(`  ✅ ${r.type}/${r.name.slice(0, 22)} → ${p.url.slice(0, 46)} (${Math.round(p.size / 1024)}KB)`);
  }

  console.log(`\n  ${DRY ? '可抢救' : '已抢救'} ${saved} · 外链已死 ${dead} · 下载失败 ${failed}`);
  if (!DRY) {
    const left = db.prepare(`SELECT COUNT(*) c FROM project_assets WHERE persistent_url LIKE 'http%'`).get() as { c: number };
    console.log(`  剩余假持久:${left.c} 条${left.c ? '(均为已失效外链)' : ''}\n`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
