#!/usr/bin/env node
/**
 * 把「标着已完成、其实一条片都没出」的项目改判为 failed(v12.433)。
 *
 * ## 为什么需要
 *
 * v12.433 之前,`create-pipeline` 收尾无条件写 `status: 'completed'` —— 视频那一段
 * 整个包在 try/catch 里,catch 只发一条会滚走的进度消息。于是「8 镜一条视频都没出」
 * 和「顺利完片」在库里是同一个词。代码已修,但**已经写坏的行不会自己变回来**。
 *
 * 本机实测:10 个 completed 项目里 1 个是这样(proj-1786416520904 —— 0 条 video、
 * 8 张 media_urls 为空的 storyboard,它自己的 timeline 质检写着「0 个有效视频片段」)。
 *
 * ## 判据
 *
 * 跟流水线用**同一份**:`isFalselyCompleted` + `countUsableAssets`(lib/pipeline-outcome)。
 * 修复脚本自己写一套判据是这个仓库反复栽过的坑 —— 线上判一套、修复判另一套,
 * 就会出现「脚本说没问题、用户看着还是坏的」。
 *
 * 「有没有产出」按**取得出非空 URL** 算,不按行数 —— 行在、文件空正是这批项目的实情。
 * 降级出的示意片算产出(次品不是没有),只抓「一条都没有」这一档。
 *
 * ## 跑法
 *   npm run repair:status              # 默认只预览,不改任何东西
 *   npm run repair:status -- --apply   # 真的改判
 *   npm run repair:status -- --restore # 把本脚本改过的全部还原成 completed
 *
 * 可逆:改判前把原状态记进 .tools/false-completed-repaired.json,--restore 逐条还原。
 */
import fs from 'node:fs';
import path from 'node:path';
import { isFalselyCompleted, countUsableAssets } from '../lib/pipeline-outcome.ts';
import { db } from '../lib/db.ts';
import { updateProjectById } from '../lib/repos/project-repo.ts';

const LEDGER = path.join(process.cwd(), '.tools', 'false-completed-repaired.json');
const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');

function assetsOf(projectId, type) {
  return db.prepare(
    'SELECT media_urls, persistent_url FROM project_assets WHERE project_id = ? AND type = ?',
  ).all(projectId, type);
}

async function main() {
  if (restore) {
    if (!fs.existsSync(LEDGER)) { console.log('没有账本 —— 本脚本没改判过任何项目。'); return; }
    const rows = JSON.parse(fs.readFileSync(LEDGER, 'utf-8'));
    let ok = 0;
    for (const r of rows) {
      try { await updateProjectById(r.id, { status: r.was }); ok++; console.log(`  ↩ ${r.id} → ${r.was}`); }
      catch (e) { console.error(`  ✗ ${r.id}: ${e?.message || e}`); }
    }
    console.log(`\n还原 ${ok}/${rows.length} 条。`);
    fs.unlinkSync(LEDGER);
    return;
  }

  const projects = db.prepare("SELECT id, title, status FROM projects WHERE status = 'completed'").all();
  const bad = [];
  for (const p of projects) {
    const videoCount = countUsableAssets(assetsOf(p.id, 'video'));
    const storyboardCount = assetsOf(p.id, 'storyboard').length;
    if (isFalselyCompleted({ status: p.status, videoCount, storyboardCount })) {
      bad.push({ ...p, videoCount, storyboardCount, usableBoards: countUsableAssets(assetsOf(p.id, 'storyboard')) });
    }
  }

  console.log(`completed 项目 ${projects.length} 个,其中标着完成却一条片都没出的:${bad.length} 个\n`);
  for (const b of bad) {
    console.log(`  · ${b.id}`);
    console.log(`    ${String(b.title || '').replace(/\s+/g, ' ').slice(0, 40)}`);
    console.log(`    可用视频 ${b.videoCount} · 分镜行 ${b.storyboardCount}(其中真有图 ${b.usableBoards})`);
  }
  if (!bad.length) { console.log('  (没有需要改判的)'); return; }

  if (!apply) {
    console.log('\n这是预览。真的改判请加 --apply;改判后可用 --restore 全部还原。');
    return;
  }

  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const done = [];
  for (const b of bad) {
    try {
      await updateProjectById(b.id, { status: 'failed' });
      done.push({ id: b.id, was: b.status });
      console.log(`  ✓ ${b.id} → failed`);
    } catch (e) {
      console.error(`  ✗ ${b.id}: ${e?.message || e}`);
    }
  }
  fs.writeFileSync(LEDGER, JSON.stringify(done, null, 2));
  console.log(`\n改判 ${done.length}/${bad.length} 条,账本已写 ${path.relative(process.cwd(), LEDGER)}`);
  console.log('还原:npm run repair:status -- --restore');
}

main().catch((e) => { console.error(e); process.exit(1); });
