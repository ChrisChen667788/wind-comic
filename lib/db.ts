import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const dataDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'qfmj.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// 当多个 worker(vitest 并行 / Next.js dev 多进程) 同时写同一个 sqlite 文件时,
// 默认会立即抛 "database is locked". 设置 busy_timeout 让写者最多阻塞等待 5s,
// 避免假性失败.
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar_url TEXT,
  locale TEXT DEFAULT 'zh',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cover_urls TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  metrics TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  status TEXT NOT NULL,
  result_urls TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  media_urls TEXT DEFAULT '[]',
  shot_number INTEGER,
  version INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS character_library (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  visual_tags TEXT NOT NULL DEFAULT '[]',
  image_urls TEXT NOT NULL DEFAULT '[]',
  style_keywords TEXT NOT NULL DEFAULT '',
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_tracking (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  credits_used INTEGER DEFAULT 1,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  tier_id TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============ v2.0 新增表 ============

-- 全局资产记忆库（跨项目复用角色/场景/风格/道具）
CREATE TABLE IF NOT EXISTS global_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                           -- 'character' | 'scene' | 'style' | 'prop'
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',              -- JSON array
  thumbnail TEXT NOT NULL DEFAULT '',
  visual_anchors TEXT NOT NULL DEFAULT '[]',    -- JSON array 3-5 个关键视觉特征
  embedding TEXT,                                -- JSON array 768 维向量 (v2.1 启用)
  metadata TEXT NOT NULL DEFAULT '{}',          -- JSON object 类型特定数据
  referenced_by_projects TEXT NOT NULL DEFAULT '[]', -- JSON array 项目 id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_global_assets_user_type ON global_assets(user_id, type);
CREATE INDEX IF NOT EXISTS idx_global_assets_user_name ON global_assets(user_id, name);

-- Beta 邀请码
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,                        -- BETAX3K9P 等
  source TEXT,                                  -- 渠道追踪
  status TEXT NOT NULL DEFAULT 'unused',        -- 'unused' | 'used' | 'expired' | 'revoked'
  used_by_user_id TEXT,
  used_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL,                     -- 管理员 user id
  created_at TEXT NOT NULL,
  FOREIGN KEY (used_by_user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status ON invite_codes(status);
CREATE INDEX IF NOT EXISTS idx_invite_codes_source ON invite_codes(source);

-- Waitlist 申请
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'approved' | 'rejected'
  approved_at TEXT,
  invite_code TEXT,                             -- 审批后绑定的码
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);

-- 成本日志（追踪每次引擎调用成本）
CREATE TABLE IF NOT EXISTS cost_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  engine TEXT NOT NULL,                         -- 'seedance2' | 'kling3' | ...
  resolution TEXT NOT NULL,                     -- '360p' | '480p' | '720p'
  duration_sec REAL NOT NULL DEFAULT 0,
  cost_cny REAL NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_cost_log_user ON cost_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_project ON cost_log(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_created ON cost_log(created_at);
`);

// Safe ALTER TABLE — add columns if missing
const addColumnIfMissing = (table: string, column: string, type: string) => {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch { /* ignore */ }
};

addColumnIfMissing('projects', 'script_data', 'TEXT');
addColumnIfMissing('projects', 'director_notes', 'TEXT');
addColumnIfMissing('projects', 'pipeline_state', 'TEXT');
addColumnIfMissing('project_assets', 'confirmed', 'INTEGER DEFAULT 0');

// v2.0 新增 projects 字段
addColumnIfMissing('projects', 'mode', "TEXT DEFAULT 'episodic'");           // CreationMode
addColumnIfMissing('projects', 'execution_mode', "TEXT DEFAULT 'dialogue'"); // ExecutionMode
addColumnIfMissing('projects', 'style_id', 'TEXT');                           // 风格预设 id
addColumnIfMissing('projects', 'global_asset_ids', "TEXT DEFAULT '[]'");      // JSON array
addColumnIfMissing('projects', 'output_config', 'TEXT');                      // JSON object

// v2.0 给 users 表加 invite_code_used 字段，用于审计哪个码引入了用户
addColumnIfMissing('users', 'invite_code_used', 'TEXT');

// v2.9 (2026-04-21): 资产持久化 —— 外链/tmp URL 会过期,persistent_url 指向
// 本机 .storage/assets/<sha256>.<ext> 的持久化副本,是兜底路径。
// serve-file 路由优先读 persistent_url,失败时才回退到原始 media_urls。
addColumnIfMissing('project_assets', 'persistent_url', 'TEXT');

// v2.9: 项目级 Cameo 主角脸参考图(P0) —— 锁全片 IP
// primary_character_ref 是用户上传的一张脸照,Director 生成主角时优先用这张,
// 视频每个 shot 的 subject_reference 第一条都锁这张,彻底解决跨镜跳脸。
addColumnIfMissing('projects', 'primary_character_ref', 'TEXT');

// v2.12 (2026-04-26): 多角色锁脸 (Phase 1) —— 创作工坊前置 1-3 个主要角色
// JSON shape: Array<{ name: string, role: string, cw: number, imageUrl: string }>
// 沿用 primary_character_ref 兜底:Phase 1 把 lockedCharacters[0] 同步进 primary_character_ref,
// 保证现有单角色编排链路无感知;Phase 2 再做 per-shot 角色路由。
addColumnIfMissing('projects', 'locked_characters', "TEXT NOT NULL DEFAULT '[]'");

// v2.12 Sprint C.2 (2026-04-26): Stripe 4 档订阅
// subscription_tier: 'free' | 'creator' | 'pro' | 'enterprise', 默认 free
// subscription_status: 'active' | 'past_due' | 'canceled' | 'incomplete' | null, null = 没订阅
// stripe_customer_id: 用户的 Stripe Customer 对象 ID, 第一次 checkout 时 webhook 写入
// 三列都 nullable, 沿用现有 users 表, 旧用户读出来等同 free / 无 stripe 关联
addColumnIfMissing('users', 'subscription_tier', "TEXT NOT NULL DEFAULT 'free'");
addColumnIfMissing('users', 'subscription_status', 'TEXT');
addColumnIfMissing('users', 'stripe_customer_id', 'TEXT');

// v2.11 #4 (2026-04-21): Writer-Editor 闭环 —— 成片后让 Editor 用 vision LLM
// 对最终视频打 3 维分(连贯度/光影/脸相似),存进 project_quality_scores。
// 下一次 Writer 生成台词时会读最近一次评分,对"分<70 的维度"注入针对性 cue
// (例如 face 偏低就强化面部特征描写,lighting 偏低就注明光源)。
// 保留历史让用户能看到"迭代了几次,每次哪项提升了"。
db.exec(`
CREATE TABLE IF NOT EXISTS project_quality_scores (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  /** 综合分 0-100 */
  overall_score INTEGER NOT NULL,
  /** 连贯度: 镜头 → 镜头的转场是否顺畅 */
  continuity_score INTEGER NOT NULL,
  /** 光影:整片色温/明暗是否统一,有没有跳光 */
  lighting_score INTEGER NOT NULL,
  /** 脸相似:跨镜主角脸是否还是同一个人 */
  face_score INTEGER NOT NULL,
  /** LLM 的总结叙述,给 Writer 下一轮看 */
  narrative TEXT,
  /** 采样帧 URL 数组 (JSON),留作二次分析/用户可查 */
  sample_frames TEXT,
  /** 逐维度建议(JSON {continuity:[], lighting:[], face:[]}) */
  suggestions TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_project ON project_quality_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_created ON project_quality_scores(created_at);
`);

export const now = () => new Date().toISOString();

// Placeholder SVG generator for server-side seed data
function seedSvg(w: number, h: number, c1: string, c2: string, label: string): string {
  const id = label.replace(/\s/g, '');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g${id})"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="system-ui" font-size="${Math.min(w, h) * 0.08}">${label}</text></svg>`)}`;
}

const AVATAR = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#2d1b69"/><circle cx="40" cy="30" r="14" fill="rgba(255,255,255,0.3)"/><ellipse cx="40" cy="68" rx="22" ry="18" fill="rgba(255,255,255,0.2)"/></svg>`)}`;

export function seed() {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (userCount.count > 0) return;

    const run = db.transaction(() => {
      const c = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
      if (c.count > 0) return;

      const passwordHash = bcrypt.hashSync('Qfmanju123', 10);
      const demoUserId = nanoid();

      db.prepare(`INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        demoUserId, 'demo@qfmanju.ai', passwordHash, '青枫漫剧 Demo', 'admin', AVATAR, 'zh', now()
      );

      const projectStmt = db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const demoProjects = [
        { title: '灵眸·短篇漫剧', description: '以中国山水为灵感的 60 秒动画试验。', covers: [seedSvg(300, 180, '#4c1d95', '#ec4899', '灵眸'), seedSvg(300, 180, '#6b21a8', '#f472b6', '灵眸2')], status: 'active' },
        { title: '都市镜像', description: '赛博霓虹风格的角色片段合集。', covers: [seedSvg(300, 180, '#0e7490', '#f472b6', '都市镜像')], status: 'draft' },
        { title: '风起青枫', description: '多镜头分镜与氛围光影测试。', covers: [seedSvg(300, 180, '#1e3a5f', '#4de0c2', '风起青枫'), seedSvg(300, 180, '#0f172a', '#ef319f', '风起2')], status: 'completed' },
      ];
      for (const p of demoProjects) {
        projectStmt.run(nanoid(), demoUserId, p.title, p.description, JSON.stringify(p.covers), p.status, now(), now());
      }

      const caseStmt = db.prepare(`INSERT INTO cases (id, title, category, cover_url, author_name, author_avatar, metrics, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const demoCases = [
        { title: '月华藏境', category: '东方幻想', cover: seedSvg(400, 300, '#312e81', '#f9a8d4', '月华藏境'), author: '青枫漫剧 Studio' },
        { title: '霓虹回响', category: '赛博都市', cover: seedSvg(400, 300, '#0c4a6e', '#ef319f', '霓虹回响'), author: 'QingFeng Lab' },
        { title: '星潮旅人', category: '科幻冒险', cover: seedSvg(400, 300, '#1e1b4b', '#4de0c2', '星潮旅人'), author: '青枫漫剧 Studio' },
        { title: '云岚日记', category: '治愈日常', cover: seedSvg(400, 300, '#064e3b', '#a78bfa', '云岚日记'), author: 'QingFeng Lab' },
      ];
      for (const c of demoCases) {
        caseStmt.run(nanoid(), c.title, c.category, c.cover, c.author, AVATAR, JSON.stringify({ likes: Math.floor(Math.random() * 1000) + 200, views: Math.floor(Math.random() * 5000) + 800 }), now());
      }

      db.prepare(`INSERT INTO generations (id, user_id, project_id, prompt, style, status, result_urls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        nanoid(), demoUserId, null, '晨雾森林中的少女，柔焦，轻电影感', 'Poetic Mist', 'completed',
        JSON.stringify([seedSvg(600, 400, '#1a1035', '#6b21a8', '晨雾森林')]), now()
      );
    });

    run();
  } catch (e) {
    console.log('Seed skipped (already seeded or concurrent)');
  }
}

seed();

export { db };
