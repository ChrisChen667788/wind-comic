#!/usr/bin/env node
/**
 * 重生「年代设定被修正过」的角色图(v12.359)。
 *
 * v12.358 修了 28 个角色的年代片段,v12.359 又对齐了配套负向词 ——
 * **但库里的图还是按旧(错的)prompt 生成的**。改了 prompt 不重生,等于没改。
 *
 * 只重生**确实被改过**的那些(清单由与备份库对比得出,不是凭印象),
 * 断点续跑:已按新 prompt 重生过的跳过。
 *
 * 用法:node scripts/regen-fixed-characters.mjs <namesJson> [--dry]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const args = process.argv.slice(2);
const listPath = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry');
const BASE = process.env.WC_BASE || 'http://localhost:3000';
if (!listPath) { console.error('用法: node scripts/regen-fixed-characters.mjs <namesJson> [--dry]'); process.exit(1); }

const ROOT = process.cwd();
function env(k) {
  const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.slice(k.length + 1).trim() : '';
}
function signJwt(sub) {
  const secret = env('JWT_SECRET');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const b = b64({ sub, role: 'user', iat: now, exp: now + 10800 });
  return `${h}.${b}.${crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')}`;
}

const targets = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const db = new Database(path.join(ROOT, 'data/qfmj.db'), { readonly: true });
const uid = db.prepare('SELECT user_id FROM projects WHERE id = ?').get(targets[0].pid).user_id;
const H = { Authorization: `Bearer ${signJwt(uid)}`, 'Content-Type': 'application/json' };

/** 这一条的图是不是**在 prompt 修正之后**才生成的(是则已重生过,跳过)。 */
const FIX_AT = Number(process.env.WC_FIX_AT || 0);   // epoch ms;0 = 不跳过
function alreadyRegenerated(assetId) {
  if (!FIX_AT) return false;
  const r = db.prepare('SELECT updated_at FROM project_assets WHERE id = ?').get(assetId);
  return r?.updated_at ? new Date(r.updated_at).getTime() > FIX_AT : false;
}

console.log(`\n重生年代已修正的角色图 · ${targets.length} 个${DRY ? ' · 干跑' : ''}\n`);
let ok = 0, skip = 0, fail = 0;
const t0 = Date.now();

for (const [i, t] of targets.entries()) {
  const tag = `[${String(i + 1).padStart(2)}/${targets.length}] ${t.name.padEnd(8)}`;
  if (alreadyRegenerated(t.id)) { skip++; console.log(`  ⏭ ${tag} 已按新 prompt 重生过`); continue; }
  if (DRY) { console.log(`  · ${tag} ${t.title}`); continue; }

  const st = Date.now();
  try {
    const res = await fetch(`${BASE}/api/projects/${t.pid}/regenerate-asset-image`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ type: 'character', name: t.name }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.imageUrl) {
      fail++;
      console.log(`  ❌ ${tag} ${(j?.error || `HTTP ${res.status}`).slice(0, 70)}`);
      // 额度类错误没必要继续烧
      if (/额度|quota|balance|402|budget/i.test(JSON.stringify(j))) {
        console.log(`\n  ⛔ 判定额度受限,停止剩余 ${targets.length - i - 1} 个\n`);
        break;
      }
      continue;
    }
    ok++;
    console.log(`  ✅ ${tag} ${((Date.now() - st) / 1000).toFixed(0)}s  ${t.title}`);
  } catch (e) {
    fail++;
    console.log(`  ❌ ${tag} ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`);
  }
}
console.log(`\n  重生 ${ok} · 跳过 ${skip} · 失败 ${fail} · 耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟\n`);
