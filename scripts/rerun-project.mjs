#!/usr/bin/env node
/**
 * 项目素材重跑(v12.343)—— 把 cleanup 误删的素材按管线顺序重新生成。
 *
 * 背景:v12.342 之前 `cleanup()` 按 mtime 删文件、从不查引用,30 天定时任务把
 * owner 全部 30 个项目、534 个素材清零。剧本/分镜描述/角色设定都还在库里,
 * 丢的只是**图片和视频文件**,所以可以按原描述重生。
 *
 * 顺序有依赖,不能乱:
 *   角色图 → (作 cref 锁脸) → 场景图 → 分镜图 → (作首帧) → 视频
 *
 * 断点续跑:每一步先看该资产的 persistent_url 是否已能在盘上找到,能找到就跳过。
 * 中断后重跑同一条命令即可,不会重复烧钱。
 *
 * 用法:
 *   node scripts/rerun-project.mjs <projectId> [--only=chars,scenes,boards,videos] [--dry]
 *   node scripts/rerun-project.mjs <projectId> --limit=1     # 只跑 1 镜,验证效果
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const ROOT = process.cwd();
const BASE = process.env.WC_BASE || 'http://localhost:3000';
const STORAGE = path.join(ROOT, 'data/storage/assets');

const args = process.argv.slice(2);
const projectId = args.find((a) => !a.startsWith('--'));
const DRY = args.includes('--dry');
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
const STEPS = only ? new Set(only.split(',')) : new Set(['chars', 'scenes', 'boards', 'videos']);
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '').replace('--limit=', '')) || Infinity;
const PROVIDER = process.env.WC_PROVIDER || 'kling';

if (!projectId) { console.error('用法: node scripts/rerun-project.mjs <projectId> [--only=...] [--limit=N] [--dry]'); process.exit(1); }

// ---- 令牌:直接用 JWT_SECRET 现签,不落盘长期令牌 ----
function env(k) {
  const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.slice(k.length + 1).trim() : '';
}
function signJwt(sub) {
  const secret = env('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET 未设置,无法签发脚本令牌');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'user', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 172800 });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const db = new Database(path.join(ROOT, 'data/qfmj.db'), { readonly: true });
const project = db.prepare('SELECT id, user_id, title, script_data FROM projects WHERE id = ?').get(projectId);
if (!project) { console.error(`项目不存在: ${projectId}`); process.exit(1); }
const TOKEN = signJwt(project.user_id);
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

/** 这一行视频资产是不是 Ken Burns 占位(不是真 AI 视频,明天要重做)。 */
function isAnimaticRow(row) {
  if (!row?.data) return false;
  try { return JSON.parse(row.data)?.isAnimatic === true; } catch { return false; }
}

/** 该 key 的文件是否已在盘上(与 resolveByKey 同语义:前缀匹配)。 */
function onDisk(persistentUrl) {
  if (!persistentUrl) return false;
  const m = String(persistentUrl).match(/key=([0-9a-zA-Z_-]+)/);
  if (!m) return false;
  try { return fs.readdirSync(STORAGE).some((f) => f.startsWith(m[1])); } catch { return false; }
}

/** 消费 SSE,返回 {ok, url, error}。 */
async function sse(url, body, pick) {
  const res = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text()).slice(0, 160)}` };
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', out = null, err = null;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      const d = ev.data || ev;
      if (ev.type === 'error') err = d?.message || JSON.stringify(d).slice(0, 160);
      const u = pick(ev, d); if (u) out = u;
    }
  }
  if (err && !out) return { ok: false, error: err };
  return out ? { ok: true, url: out } : { ok: false, error: err || '未拿到产物 URL' };
}

const sd = JSON.parse(project.script_data || '{}');
const shots = (sd.shots || []).slice(0, LIMIT === Infinity ? undefined : LIMIT);
console.log(`\n═══ ${project.title.split('\n')[0].slice(0, 40)}`);
console.log(`    ${projectId} · ${shots.length} 镜 · 引擎 ${PROVIDER}${DRY ? ' · 干跑' : ''}\n`);

const stat = { done: 0, skip: 0, fail: 0, animatic: 0 };
const t0 = Date.now();
function log(tag, name, r, ms) {
  if (r === 'skip') { stat.skip++; return console.log(`  ⏭  ${tag} ${name} —— 已在盘上`); }
  if (r.ok) { stat.done++; return console.log(`  ✅ ${tag} ${name}  ${(ms / 1000).toFixed(0)}s`); }
  stat.fail++; console.log(`  ❌ ${tag} ${name}  ${r.error}`);
}

// ---------- 1. 角色图(作 cref,必须先于分镜) ----------
if (STEPS.has('chars')) {
  const rows = db.prepare(`SELECT name, persistent_url FROM project_assets WHERE project_id=? AND type='character' ORDER BY name`).all(projectId);
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.name)) continue; seen.add(r.name);
    if (onDisk(r.persistent_url)) { log('角色', r.name, 'skip'); continue; }
    if (DRY) { console.log(`  · 角色 ${r.name}`); continue; }
    const t = Date.now();
    const res = await fetch(`${BASE}/api/projects/${projectId}/regenerate-asset-image`, {
      method: 'POST', headers: H, body: JSON.stringify({ type: 'character', name: r.name }),
    });
    const j = await res.json().catch(() => ({}));
    log('角色', r.name, res.ok && j.imageUrl ? { ok: true } : { ok: false, error: j.error || `HTTP ${res.status}` }, Date.now() - t);
  }
}

// ---------- 2. 场景图 ----------
if (STEPS.has('scenes')) {
  const rows = db.prepare(`SELECT name, persistent_url FROM project_assets WHERE project_id=? AND type='scene' ORDER BY name`).all(projectId);
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.name)) continue; seen.add(r.name);
    if (onDisk(r.persistent_url)) { log('场景', r.name, 'skip'); continue; }
    if (DRY) { console.log(`  · 场景 ${r.name}`); continue; }
    const t = Date.now();
    const res = await fetch(`${BASE}/api/projects/${projectId}/regenerate-asset-image`, {
      method: 'POST', headers: H, body: JSON.stringify({ type: 'scene', name: r.name }),
    });
    const j = await res.json().catch(() => ({}));
    log('场景', r.name, res.ok && j.imageUrl ? { ok: true } : { ok: false, error: j.error || `HTTP ${res.status}` }, Date.now() - t);
  }
}

// ---------- 3. 分镜图(视频的首帧,必须先于视频) ----------
if (STEPS.has('boards')) {
  for (const s of shots) {
    const row = db.prepare(`SELECT persistent_url FROM project_assets WHERE project_id=? AND type='storyboard' AND shot_number=? ORDER BY updated_at DESC LIMIT 1`).get(projectId, s.shotNumber);
    if (row && onDisk(row.persistent_url)) { log('分镜', `#${s.shotNumber}`, 'skip'); continue; }
    if (DRY) { console.log(`  · 分镜 #${s.shotNumber}`); continue; }
    const t = Date.now();
    const r = await sse(`${BASE}/api/projects/${projectId}/regenerate-storyboard`,
      { shotNumber: s.shotNumber, customPrompt: s.visualPrompt || s.sceneDescription || '' },
      (ev, d) => (ev.type === 'complete' ? d?.imageUrl : null));
    log('分镜', `#${s.shotNumber}`, r, Date.now() - t);
  }
}

// ---------- 4. 视频 ----------
if (STEPS.has('videos')) {
  for (const s of shots) {
    const row = db.prepare(`SELECT persistent_url, data FROM project_assets WHERE project_id=? AND type='video' AND shot_number=? ORDER BY updated_at DESC LIMIT 1`).get(projectId, s.shotNumber);
    // 占位片不算数 —— 盘上有文件也要重做,否则「续跑」会把它永久当成片。
    if (row && onDisk(row.persistent_url) && !isAnimaticRow(row)) { log('视频', `#${s.shotNumber}`, 'skip'); continue; }
    if (row && isAnimaticRow(row)) console.log(`  ↻ 视频 #${s.shotNumber} —— 上次是占位片,重做`);
    if (DRY) { console.log(`  · 视频 #${s.shotNumber} (${s.duration || 10}s)`); continue; }
    const t = Date.now();
    let animatic = false;
    const r = await sse(`${BASE}/api/projects/${projectId}/regenerate-shot`,
      { shotNumber: s.shotNumber, duration: s.duration || 10, description: s.sceneDescription || '', videoProvider: PROVIDER, cameraMovement: s.cameraMovement || '' },
      (ev, d) => {
        if (ev.type === 'complete' && d?.isAnimatic === true) animatic = true;
        return (ev.type === 'complete' || ev.type === 'done') ? (d?.videoUrl || d?.url) : null;
      });
    if (r.ok && animatic) {
      // 额度耗尽的信号。继续跑只会产出更多占位片,白费时间 —— 停下来等明天刷新。
      stat.animatic++;
      console.log(`  ⚠️ 视频 #${s.shotNumber} —— 引擎全部不可用,产出的是 Ken Burns 占位片,不是真视频`);
      console.log(`\n  ⛔ 判定当日额度已耗尽,停止本项目剩余镜头(明天刷新后重跑同一条命令即可续上)`);
      break;
    }
    log('视频', `#${s.shotNumber}`, r, Date.now() - t);
  }
}

console.log(`\n  合计 生成 ${stat.done} · 跳过 ${stat.skip} · 失败 ${stat.fail}${stat.animatic ? ` · ⚠️ 占位片 ${stat.animatic}` : ''} · 耗时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟\n`);
// 退出码有语义:3 = 当日视频额度已耗尽(调用方应停止整轮,而不是换个项目再撞一次墙)。
if (stat.animatic > 0) {
  console.log('  ⛔ 当日视频额度已耗尽 —— 明天刷新后重跑同一条命令即可续上\n');
  process.exit(3);
}
process.exit(stat.fail > 0 ? 1 : 0);
