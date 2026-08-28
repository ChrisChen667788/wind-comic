#!/usr/bin/env node
/**
 * 角色库回填(v12.345)——把项目里的角色提升进「角色库」。
 *
 * 病根:`/api/characters` 读 `character_library`,而这张表**只有测试夹具在写**
 * (owner-dd / grantee / @test.local 那 84 条)。真实用户跑完整条管线、产出 61 个角色资产,
 * 却没有任何一条路径把它们提升进角色库 —— 于是「角色库」对真实用户**永远是空的**。
 *
 * 组装来源(取最好的那一份,而不是就近取):
 *   name        ← project_assets(type='character').name
 *   description ← 剧本 script_data.characterArcs 的人话档案(arc/desire/need/flaw/说话方式)
 *                 —— 角色资产自己的 description 存的是**图像生成 prompt**,不适合给人看
 *   appearance  ← character-dna 资产的 dna.promptBlock(五官签名),回落到资产 description
 *   imageUrls   ← persistent_url(优先)/ media_urls
 *   visualTags  ← dna.signature 的键值摘要
 *
 * 幂等:按 (user, name) 去重 —— 已在库里的跳过,重复跑不会产生副本。
 *
 * 用法:
 *   node scripts/backfill-character-library.mjs <userId> [--dry]
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const userId = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry');
if (!userId) { console.error('用法: node scripts/backfill-character-library.mjs <userId> [--dry]'); process.exit(1); }

const db = new Database(path.join(ROOT, 'data/qfmj.db'));
const j = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// ---- 1. 人话档案:剧本里的 characterArcs(跨项目合并,后出现的不覆盖先出现的) ----
const arcs = new Map();
for (const p of db.prepare('SELECT script_data FROM projects WHERE user_id = ?').all(userId)) {
  for (const a of (j(p.script_data).characterArcs || [])) {
    if (a?.name && !arcs.has(a.name)) arcs.set(a.name, a);
  }
}

// ---- 2. 视觉 DNA ----
const dnas = new Map();
for (const r of db.prepare(
  `SELECT name, data FROM project_assets WHERE type='character-dna'
     AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`).all(userId)) {
  const d = j(r.data).dna;
  if (d && !dnas.has(r.name)) dnas.set(r.name, d);
}

// ---- 3. 角色资产(按名去重,优先取有图的那条) ----
const chars = new Map();
for (const r of db.prepare(
  `SELECT pa.name, pa.data, pa.persistent_url, pa.media_urls, p.style_id, p.title
     FROM project_assets pa JOIN projects p ON p.id = pa.project_id
    WHERE p.user_id = ? AND pa.type='character'
    ORDER BY pa.updated_at DESC`).all(userId)) {
  const prev = chars.get(r.name);
  if (!prev || (!prev.persistent_url && r.persistent_url)) chars.set(r.name, r);
}

const existing = new Set(
  db.prepare('SELECT name FROM character_library WHERE user_id = ?').all(userId).map((r) => r.name));

function describe(name) {
  const a = arcs.get(name);
  if (!a) return '';
  return [
    a.arc && `成长弧线:${a.arc}`,
    a.desire && `渴望:${a.desire}`,
    a.need && `真正需要:${a.need}`,
    a.flaw && `缺陷:${a.flaw}`,
    a.speechPattern && `说话方式:${a.speechPattern}`,
  ].filter(Boolean).join(' · ');
}

const ins = db.prepare(
  `INSERT INTO character_library
     (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords,
      usage_count, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

let added = 0, skipped = 0, noImage = 0;
const ts = new Date().toISOString();
console.log(`\n角色库回填 · 用户 ${userId}${DRY ? ' · 干跑' : ''}`);
console.log(`  项目角色 ${chars.size} 个 · 剧本档案 ${arcs.size} 份 · 视觉 DNA ${dnas.size} 份`);
console.log(`  角色库现有 ${existing.size} 个\n`);

for (const [name, r] of [...chars].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
  if (existing.has(name)) { skipped++; continue; }
  const dna = dnas.get(name);
  const urls = r.persistent_url ? [r.persistent_url] : (j(r.media_urls).length ? j(r.media_urls) : []);
  if (!urls.length) noImage++;
  const desc = describe(name);
  const appearance = dna?.promptBlock || j(r.data).appearance || j(r.data).description || '';
  const tags = dna?.signature ? Object.entries(dna.signature).map(([k, v]) => `${k}:${String(v).split(',')[0]}`) : [];

  if (DRY) {
    console.log(`  + ${name.padEnd(8)} 图${urls.length ? '✓' : '✗'} 档案${desc ? '✓' : '✗'} DNA${dna ? '✓' : '✗'}  ${desc.slice(0, 46) || '(无剧本档案)'}`);
  } else {
    ins.run(nanoid(), userId, name, desc, appearance, JSON.stringify(tags), JSON.stringify(urls),
            r.style_id || '', 0, ts, ts);
    console.log(`  ✅ ${name.padEnd(8)} 图${urls.length ? '✓' : '✗'} 档案${desc ? '✓' : '✗'} DNA${dna ? '✓' : '✗'}`);
  }
  added++;
}
console.log(`\n  ${DRY ? '将新增' : '已新增'} ${added} · 已存在跳过 ${skipped} · 其中无图 ${noImage}`);
console.log(`  ${DRY ? '(干跑,未写库)' : `角色库现共 ${db.prepare('SELECT COUNT(*) c FROM character_library WHERE user_id=?').get(userId).c} 个`}\n`);
