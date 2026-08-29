#!/usr/bin/env node
/**
 * 对齐年代片段与负向词(v12.359)。
 *
 * v12.358 修年代时**只换了年代片段,负向词原样留着** —— 于是产生自相矛盾的 prompt:
 *   · 柳如烟 改成 hanfu,负向词却仍是 `--no historical --no ancient --no hanfu`
 *     → **要古风又禁古风**。她重生出来的图穿古装却配现代高跟鞋,根因就在这里;
 *       我当时把它误判成「生成模型的残留」,是错的。
 *   · 苏砚青 改成 modern,负向词却仍是 `--no hoodie --no sneakers --no modern`
 *     → **要现代又禁现代**。
 *
 * 年代和负向词是同一个决定的两面,分开处理必然出这种事。本脚本按当前年代片段
 * 把负向词强制对齐,**不重新判定年代**(那已经在 v12.358 定好了)。
 *
 * 用法:node scripts/fix-era-negatives.mjs [--dry]
 */
import path from 'path';
import Database from 'better-sqlite3';

const DRY = process.argv.includes('--dry');
const db = new Database(path.join(process.cwd(), 'data/qfmj.db'));

/** 年代片段 → 它应有的负向词。与 lib/mckee-skill 的 ERA_RULES 保持一致。 */
const WANT = new Map([
  ['ancient Chinese hanfu era', ' --no hoodie --no sneakers --no modern --no jeans --no t-shirt'],
  ['futuristic sci-fi setting', ' --no historical --no ancient --no hanfu'],
  ['medieval fantasy setting', ' --no modern --no contemporary'],
  ['Republic of China era', ''],
  ['modern contemporary setting', ''],
]);
const ALL_NEG = [...WANT.values()].filter(Boolean);

const rows = db.prepare(`SELECT id, name, data FROM project_assets WHERE type = 'character'`).all();
let fixed = 0, ok = 0, skipped = 0;
console.log(`\n年代/负向词对齐${DRY ? '(干跑)' : ''} · 共 ${rows.length} 个\n`);

for (const r of rows) {
  let d; try { d = JSON.parse(r.data || '{}'); } catch { skipped++; continue; }
  const t = d.description || '';
  const era = [...WANT.keys()].find((e) => t.includes(e));
  if (!era) { skipped++; continue; }

  const want = WANT.get(era);
  const present = ALL_NEG.find((n) => t.includes(n)) || '';
  if (present === want) { ok++; continue; }

  let next = t;
  if (present) next = next.replace(present, want);
  else if (want) next = next + want;

  const why = present && want ? '换' : present ? '删' : '补';
  console.log(`  ✏️ ${r.name.padEnd(8)} [${era.slice(0, 26)}] ${why}负向词`);
  if (!DRY) {
    d.description = next;
    db.prepare('UPDATE project_assets SET data = ? WHERE id = ?').run(JSON.stringify(d), r.id);
  }
  fixed++;
}
console.log(`\n  ${DRY ? '将对齐' : '已对齐'} ${fixed} · 本就一致 ${ok} · 跳过 ${skipped}\n`);
