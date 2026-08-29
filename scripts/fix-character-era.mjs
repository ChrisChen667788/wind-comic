#!/usr/bin/env node
/**
 * 修正角色概念图 prompt 里的错误年代设定(v12.358)。
 *
 * 病根见 `lib/mckee-skill.detectEra` 的注释:旧实现用单个常用汉字 + 无词界的英文片段
 * 去 match 角色自由文本 —— `ai` 命中 `hair`、`修` 命中「修长」、`清` 命中「清澈」——
 * 于是年代设定基本是随机的。owner 的 61 个角色里 21 个被写成 cyberpunk,
 * 包括一部农家院年代剧的女主角。
 *
 * 代码已修(往后不再产生),但**已经写进库的错 prompt 不会自己变好**。
 * 本脚本按**项目实际题材**重判,只改年代片段,其余描述一字不动。
 *
 * 用法:node scripts/fix-character-era.mjs [--dry]
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DRY = process.argv.includes('--dry');
const ROOT = process.cwd();
const db = new Database(path.join(ROOT, 'data/qfmj.db'));

/** 库里出现过的全部年代片段 —— 要替换的就是它们。 */
const ERA_FRAGMENTS = [
  'ancient Chinese hanfu era, period-accurate silk costume and hair, ',
  'futuristic sci-fi setting, cyberpunk costume with high-tech accessories, ',
  'medieval fantasy setting, period costume and accessories, ',
  'Republic of China era (1920s-1940s), cheongsam or zhongshan suit, ',
  'modern contemporary setting, ',
];

/** 按**项目标题 + 剧本简介**判题材 —— 这才是权威依据,而不是角色的外貌描述。 */
function eraForProject(text) {
  const t = (text || '').toLowerCase();
  if (/古装|古风|汉服|武侠|仙侠|修仙|宫廷|朝代|年代剧|鳏夫|嫂子|土院|柳如烟|侠客|竹影|斩龙|执棋|贵妃/.test(t))
    return ERA_FRAGMENTS[0];
  if (/赛博|科幻|未来|太空|机甲|机器人|ai觉醒|全息|量子|意识核心/.test(t))
    return ERA_FRAGMENTS[1];
  if (/民国|旗袍|中山装/.test(t)) return ERA_FRAGMENTS[3];
  if (/现代|都市|电商|广告|职场|便利店|出租车|汽车|咖啡|耳机|榨汁|保温杯|精华|燕麦/.test(t))
    return ERA_FRAGMENTS[4];
  return null;   // 判不出 → 不动,交给人
}

const rows = db.prepare(`
  SELECT pa.id, pa.name, pa.data, p.title, p.description AS pdesc
    FROM project_assets pa JOIN projects p ON p.id = pa.project_id
   WHERE pa.type = 'character'`).all();

let fixed = 0, ok = 0, skipped = 0;
console.log(`\n角色概念图年代修正${DRY ? '(干跑)' : ''} · 共 ${rows.length} 个\n`);

for (const r of rows) {
  let d; try { d = JSON.parse(r.data || '{}'); } catch { continue; }
  const prompt = d.description || '';
  const current = ERA_FRAGMENTS.find((f) => prompt.includes(f));
  if (!current) { skipped++; continue; }

  // **只看 title** —— 它是用户自己写的创意原文,唯一没被污染的字段。
  //
  // 踩过两次才找对:
  //   ① 先用了 script_data.synopsis —— 里面是 prompt 脚手架,含
  //      「4. 题材锁定:古装(用户已指定,严格遵守)」;
  //   ② 换成 projects.description —— **它也不是描述,同样是 prompt 脚手架**,同一句话又在里面。
  // 而那句「古装」正是 detectGenre 单字误判的产物(`古` 命中「复古」等)。
  // 拿被污染的字段当依据,只是把同一个错误换个地方再犯一遍
  // (前两版干跑都把新能源汽车广告判成了 hanfu)。
  const want = eraForProject(String(r.title || ''));

  if (!want) { skipped++; console.log(`  ？ ${r.name.padEnd(8)} 判不出题材,不动 —— ${String(r.title).split('\n')[0].slice(0, 26)}`); continue; }
  if (want === current) { ok++; continue; }

  const next = prompt.replace(current, want);
  const label = `${current.split(',')[0]} → ${want.split(',')[0]}`;
  console.log(`  ✏️ ${r.name.padEnd(8)} ${label}`);
  console.log(`     ${String(r.title).split('\n')[0].slice(0, 40)}`);
  if (!DRY) {
    d.description = next;
    db.prepare('UPDATE project_assets SET data = ? WHERE id = ?')
      .run(JSON.stringify(d), r.id);
  }
  fixed++;
}
console.log(`\n  ${DRY ? '将修正' : '已修正'} ${fixed} · 本就正确 ${ok} · 跳过 ${skipped}\n`);
