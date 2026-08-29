#!/usr/bin/env node
/**
 * 回填 Character Bible(v12.369)。
 *
 * 病根:`/api/characters/bible/[name]` 的设计写得很清楚 —— 用户在创作工坊输入角色名,
 * 前端查历史 bible,命中就提示「已找到「李长安」—— 一键复用?」并回填图/特征/cw。
 * **这是跨项目角色一致性的核心机制。**
 *
 * 但实测:owner 的 `global_assets` 里有 **73 条**角色,**只有 2 条**带 `metadata.bible`。
 * 而端点要求 `bible.imageUrl` 非空,所以查任何角色都返回 `{found:false}` ——
 * 功能在数据层面覆盖率 **3%**,等于不存在。
 *
 * 原因是 bible 只在特定路径(锁定角色 upsert)写入,普通角色不写。
 * 本脚本从**已有的角色资产**(project_assets.character + character_library)补齐:
 *   imageUrl ← persistent_url(优先本地,外链会过期)
 *   traits   ← 角色库的 appearance / visual DNA
 *   role     ← 有 project_locked_characters 记录则用它,否则 'supporting'
 *   cw       ← 同上,默认 100
 *
 * **只补不覆盖**:已有 bible 的原样保留(那是真实使用过程中攒下的,比推断出来的可信)。
 *
 * 用法:node scripts/backfill-character-bible.mjs <userId> [--dry]
 */
import path from 'path';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const userId = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry');
if (!userId) { console.error('用法: node scripts/backfill-character-bible.mjs <userId> [--dry]'); process.exit(1); }

const db = new Database(path.join(process.cwd(), 'data/qfmj.db'));
const j = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

/** 角色名 → 最佳可用图(优先落盘的 persistent_url)。 */
const imgByName = new Map();
for (const r of db.prepare(`
  SELECT pa.name, pa.persistent_url, pa.media_urls, pa.updated_at
    FROM project_assets pa JOIN projects p ON p.id = pa.project_id
   WHERE p.user_id = ? AND pa.type = 'character'
   ORDER BY pa.updated_at DESC`).all(userId)) {
  if (imgByName.has(r.name)) continue;
  const url = r.persistent_url || (Array.isArray(j(r.media_urls)) ? j(r.media_urls)[0] : null);
  if (url) imgByName.set(r.name, url);
}

/** 角色名 → 角色库条目(v12.345 回填的,含人话档案与 DNA 标签)。 */
const libByName = new Map();
for (const r of db.prepare('SELECT name, description, appearance, visual_tags FROM character_library WHERE user_id = ?').all(userId)) {
  if (!libByName.has(r.name)) libByName.set(r.name, r);
}

/** 角色名 → 锁定记录(有则用它的 role/cw)。 */
const lockByName = new Map();
for (const r of db.prepare(`
  SELECT character_name, role, cw FROM project_locked_characters
   WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)`).all(userId)) {
  if (!lockByName.has(r.character_name)) lockByName.set(r.character_name, r);
}

/** 角色名 → 真实用过它的项目 id(v12.373:界面「N 个历史项目用过」靠这个)。 */
const projectsByName = new Map();
for (const r of db.prepare(`
  SELECT DISTINCT pa.name, pa.project_id
    FROM project_assets pa JOIN projects p ON p.id = pa.project_id
   WHERE p.user_id = ? AND pa.type = 'character'`).all(userId)) {
  if (!projectsByName.has(r.name)) projectsByName.set(r.name, []);
  projectsByName.get(r.name).push(r.project_id);
}

const rows = db.prepare("SELECT id, name, metadata, referenced_by_projects FROM global_assets WHERE user_id = ? AND type = 'character'").all(userId);
let filled = 0, kept = 0, noImage = 0;
console.log(`\nCharacter Bible 回填 · ${rows.length} 条角色资产${DRY ? '(干跑)' : ''}\n`);

for (const r of rows) {
  const md = j(r.metadata);
  if (md.bible?.imageUrl) {
    // v12.373:bible 不动(真实使用攒下的更可信),但 refs 该补还是要补 ——
    // 它是客观事实(哪些项目真的用过),不是推断。
    const pj = projectsByName.get(r.name) || [];
    const ex = (() => { try { return JSON.parse(r.referenced_by_projects || '[]'); } catch { return []; } })();
    if (!DRY && pj.length > ex.length) {
      db.prepare('UPDATE global_assets SET referenced_by_projects = ? WHERE id = ?').run(JSON.stringify(pj), r.id);
    }
    kept++; continue;
  }

  const imageUrl = imgByName.get(r.name);
  if (!imageUrl) { noImage++; continue; }         // 没图就没 bible —— 端点也要求 imageUrl

  const lib = libByName.get(r.name);
  const lock = lockByName.get(r.name);
  const bible = {
    role: lock?.role || 'supporting',
    cw: Number(lock?.cw) || 100,
    imageUrl,
    traits: lib ? {
      description: lib.description || undefined,
      appearance: lib.appearance || undefined,
      visualTags: j(lib.visual_tags),
    } : null,
    sampleFaces: [imageUrl],
    lastUsedProjectId: md.firstProjectId || undefined,
  };

  // v12.373:**同时补 referenced_by_projects。**
  // v12.369 只补了 bible,漏了这一列 —— 而界面上「N 个历史项目用过」正是靠它,
  // 于是 51 个角色里 42 个显示「0 个历史项目用过」,提示的可信度被自己抽空了。
  const projIds = projectsByName.get(r.name) || [];
  const existingRefs = (() => { try { return JSON.parse(r.referenced_by_projects || '[]'); } catch { return []; } })();
  const refs = existingRefs.length >= projIds.length ? existingRefs : projIds;

  console.log(`  ✅ ${r.name.padEnd(10)} role=${bible.role} cw=${bible.cw} traits=${bible.traits ? '有' : '无'} 项目${refs.length}`);
  if (!DRY) {
    db.prepare('UPDATE global_assets SET metadata = ?, referenced_by_projects = ? WHERE id = ?')
      .run(JSON.stringify({ ...md, bible }), JSON.stringify(refs), r.id);
  }
  filled++;
}
console.log(`\n  ${DRY ? '将补' : '已补'} ${filled} · 已有保留 ${kept} · 无图跳过 ${noImage}\n`);
