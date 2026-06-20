import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const dataDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const isTestEnv = !!process.env.VITEST || process.env.NODE_ENV === 'test';
// 测试隔离: 每个测试文件用一个"全新、独占"的随机库文件 —— 永不碰生产 qfmj.db,
// 也永不与别的连接/进程共用同一个测试库文件.
// (此前测试直接写 data/qfmj.db, 灌进上百个 @test.local 用户, 触发过 "项目全空"
//  这类非确定性 LIMIT 1 怪象; 测试库独立后彻底隔离.)
//
// 为什么不能共用单个 qfmj.test.db 再每次 unlink+重建:
//   vitest isolate:true 会"按每个测试文件"重新求值本模块, 每个文件因此新开一个
//   better-sqlite3 连接. 若所有文件共用同一路径并在每次求值时 unlink 旧文件再建,
//   就会与上一个文件"尚未释放的连接"(WAL 的 -wal/-shm 句柄) 以及 e2e 的 ws-server
//   子进程竞争同一文件, 偶发抛 "disk I/O error" / "database is locked"(全量跑概率性
//   挂, 隔离单跑必过 —— 经典共享文件竞争). 试过"重建前关上一个连接 / 每次清理其它
//   文件 / 进程内只清一次"等基于 globalThis、process.env 标记的方案, 但这些标记在
//   vitest 的文件隔离下并不可靠保留, 仍会偶发. 改成"一个文件一个独占库"后, 当前库
//   从不被别的连接/进程触碰 → 确定性干净起点.
//
//   旧库文件不在这里清理(避免删到仍被占用的文件); 由 tests/global-setup.ts 在整批
//   测试开始前、于主进程一次性清掉 data/qfmj.test.* 残留. e2e 的 ws-server 子进程通过
//   QFMJ_DB_PATH 复用本进程这一文件 (见 scripts/ws-server.mjs).
const dbFile = isTestEnv ? `qfmj.test.${process.pid}.${nanoid(10)}.db` : 'qfmj.db';
const dbPath = path.join(dataDir, dbFile);

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
  video_url TEXT,
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

-- v2.17 P0.1: API 用量追踪 — 每次 API 调用结果 (成功 / 失败 / 错误码), 给监控用
-- 不写每次调用全部 metadata (避免写放大), 只在失败时 + 错误码 != 0 时记
CREATE TABLE IF NOT EXISTS api_usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                       -- 'minimax' | 'midjourney' | 'openai' | 'veo' | 'kling' | 'vidu' | 'fal' | 'comfyui'
  model TEXT NOT NULL DEFAULT '',               -- 'I2V-01' | 'image-01' | 'gpt-4o' | 'kling-v1' | ...
  method TEXT NOT NULL DEFAULT '',              -- 'generateImage' | 'generateVideo' | 'chat.completions' | ...
  success INTEGER NOT NULL,                     -- 0 / 1
  status_code INTEGER,                          -- HTTP 或 业务码 (如 Minimax 1008)
  error_message TEXT,                           -- 失败时的精简错误消息 (≤200 字符)
  duration_ms INTEGER NOT NULL DEFAULT 0,       -- 端到端耗时
  project_id TEXT,                              -- 关联项目 (如有)
  user_id TEXT,                                 -- 关联用户 (如有)
  est_cost_cny REAL DEFAULT 0,                  -- 估算成本 (CNY), 仅供参考
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created ON api_usage_events(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_success ON api_usage_events(success, created_at);

-- v2.17 P0.1: 配额耗尽告警 — 同一 provider 1 小时内多次"配额耗尽"或"上游饱和" → 升级为告警
-- 用户 / 管理员能从 /api/admin/api-usage 看活跃告警, ack 后清掉
CREATE TABLE IF NOT EXISTS api_quota_alerts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                       -- 同 api_usage_events.provider
  model TEXT DEFAULT '',
  alert_type TEXT NOT NULL,                     -- 'exhausted' | 'saturated' | 'rate_limited' | 'auth_failed'
  error_message TEXT,                           -- 最近一次的错误消息 (≤200 字符)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  acknowledged_at TEXT                          -- 用户标 ack 后填
);
CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_active ON api_quota_alerts(provider, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_recent ON api_quota_alerts(last_seen_at);

-- v9.6.7 (阶段十六 T2 模板市场): 把出片好的项目沉淀成可复用模板 (画风+多参元素+节奏+一键起片预填)
CREATE TABLE IF NOT EXISTS film_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT,                                -- 创建者 (可空: demo)
  title TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',               -- 画风 (LOOK 预设 id/en)
  genre TEXT,
  pacing_tone TEXT,                             -- 节奏基调
  shot_count INTEGER NOT NULL DEFAULT 0,
  quality INTEGER NOT NULL DEFAULT 60,          -- 模板质量分 0-100 (源项目质量沉淀)
  elements TEXT NOT NULL DEFAULT '[]',          -- JSON: TemplateElementSummary[]
  tags TEXT NOT NULL DEFAULT '[]',              -- JSON: string[]
  payload TEXT,                                 -- JSON: 一键起片预填 (style/references/genre/pacing/lockedCharacters)
  source_project_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',    -- 'public' | 'private'
  use_count INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,        -- v9.7.16 评分聚合(均分 = sum/count)
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_templates_market ON film_templates(visibility, quality);
CREATE INDEX IF NOT EXISTS idx_film_templates_owner ON film_templates(owner_id);

-- v9.7.16 (T2 评分/收藏): 每用户对模板的评分(去重) + 收藏
CREATE TABLE IF NOT EXISTS template_ratings (
  template_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,                       -- 1-5
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, user_id)
);
CREATE TABLE IF NOT EXISTS template_favorites (
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_template_favorites_user ON template_favorites(user_id);

-- v10.4.1: 流水线任务表 — create-stream 改投递后,长任务脱离 HTTP 生命周期。
-- project_id 故意不设 FK:项目行由任务自己在执行期创建(enqueue 时尚不存在)。
-- progress_log 存 SSE 事件回放(JSON 数组,worker 截断保最近若干条)。
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'create',
  project_id TEXT NOT NULL,
  user_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',          -- queued | running | done | failed
  step TEXT NOT NULL DEFAULT '',                 -- 最近进入的阶段标记(director/writer/video/...)
  payload TEXT NOT NULL DEFAULT '{}',
  progress_log TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  heartbeat_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_state ON pipeline_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_project ON pipeline_jobs(project_id);

-- v10.5.3: 轻量 UI 埋点(首跑引导完成率等)。user_id 可空(匿名也记),不设 FK。
CREATE TABLE IF NOT EXISTS ui_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  user_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ui_events_event ON ui_events(event, created_at);

-- v11.0.3: 任务进度事件 append-only 表 —— 取代 pipeline_jobs.progress_log 的
-- 读改写(非原子,多副本/PG 下有 lost update;部署文档限位 #2)。INSERT 天然原子。
-- 排序 (at, ord):job 同一时刻只被一个 worker 认领,进程内 ord 单调递增即可全序。
CREATE TABLE IF NOT EXISTS pipeline_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pje_job ON pipeline_job_events(job_id, at, ord);

-- v10.6.3: 模型雷达 — 扫描后采用的模型覆盖(env_key 如 OPENAI_CREATIVE_MODEL)
CREATE TABLE IF NOT EXISTS model_overrides (
  env_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  prev_value TEXT,
  updated_at TEXT NOT NULL
);
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
addColumnIfMissing('projects', 'aspect', "TEXT DEFAULT '16:9'");              // v10.6.0 项目级画幅(竖屏优先;旧项目默认横屏=零回归)
addColumnIfMissing('projects', 'global_asset_ids', "TEXT DEFAULT '[]'");      // JSON array
addColumnIfMissing('projects', 'output_config', 'TEXT');                      // JSON object
addColumnIfMissing('projects', 'series_id', 'TEXT');                          // 阶段二十六 多集:系列 id(同系列各集共享角色/画风);null=单集
addColumnIfMissing('projects', 'episode_number', 'INTEGER');                  // 集号(1 起);null=单集

// v2.0 给 users 表加 invite_code_used 字段，用于审计哪个码引入了用户
addColumnIfMissing('users', 'invite_code_used', 'TEXT');

// v9.3.4 (2026-06-02): 用户月预算护栏 —— budget_cap_cny 软上限(预算目标) + budget_hard_cap_cny 硬上限(绝对线);
// null = 不设防。生成端点经 lib/budget-enforce.assertBudget 读这两列 + 当月 cost_log 花费裁决, 到硬上限拦截。
addColumnIfMissing('users', 'budget_cap_cny', 'REAL');
addColumnIfMissing('users', 'budget_hard_cap_cny', 'REAL');

// v9.5.3 (2026-06-03): 灵感库案例加示意播放视频 video_url。
// 示意片段引用自公开影视作品(《英雄联盟:双城之战 / Arcane》, Netflix·Riot·Fortiche),
// 仅供个人学习与画风参考、非商业用途,版权归原作者所有 (见 public/cases/NOTICE.md)。
addColumnIfMissing('cases', 'video_url', 'TEXT');
// v9.7.16: 模板评分聚合(旧 film_templates 补列)
addColumnIfMissing('film_templates', 'rating_sum', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('film_templates', 'rating_count', 'INTEGER NOT NULL DEFAULT 0');
// 已 seed 过的库也补上示意视频 (幂等: 仅在 video_url 为空时写);标题匹配 demo 案例。
try {
  const setCaseVideo = db.prepare(`UPDATE cases SET video_url = ? WHERE title = ? AND (video_url IS NULL OR video_url = '')`);
  setCaseVideo.run('/cases/clip-a.mp4', '霓虹回响');
  setCaseVideo.run('/cases/clip-b.mp4', '星潮旅人');
  setCaseVideo.run('/cases/clip-c.mp4', '月华藏境');
  setCaseVideo.run('/cases/clip-d.mp4', '云岚日记'); // v10.0 第 4 段(用户 6月7日 片段)
} catch { /* 表为空或并发, 忽略 */ }

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

// v9.0.2b (2026-05-31): 轻量项目共享链接 — 之前由 /api/projects/[id]/share 的
// ensureShareSchema() 运行时 ALTER 热加; 现纳入规范 schema (canonical), 让 SQLite (新/旧库)
// 与 PG export 都带上这两列, share 写路径才能走 project-repo 双驱动 (见 v9.0.2b)。
addColumnIfMissing('projects', 'share_token', 'TEXT');
addColumnIfMissing('projects', 'share_created_at', 'TEXT');

// v2.12 Sprint C.2 (2026-04-26): Stripe 4 档订阅
// subscription_tier: 'free' | 'creator' | 'pro' | 'enterprise', 默认 free
// subscription_status: 'active' | 'past_due' | 'canceled' | 'incomplete' | null, null = 没订阅
// stripe_customer_id: 用户的 Stripe Customer 对象 ID, 第一次 checkout 时 webhook 写入
// 三列都 nullable, 沿用现有 users 表, 旧用户读出来等同 free / 无 stripe 关联
addColumnIfMissing('users', 'subscription_tier', "TEXT NOT NULL DEFAULT 'free'");
addColumnIfMissing('users', 'subscription_status', 'TEXT');
addColumnIfMissing('users', 'stripe_customer_id', 'TEXT');

// v4.0.1: Cameo 复用闭环 — 从别人的 IP token 导入到自己 character_library 的角色,
// 记来源 token (出处/版税归属), 同一用户同一 token 只导一次 (dedup).
addColumnIfMissing('character_library', 'source_token_id', 'TEXT');

// v6.0.1: 角色资产中心 — 角色档案 (CharacterProfile JSON: 小传 + 绑定音色 +
// 多视角设定图 prompt/图 URL). 由 lib/character-studio 生成, /api/characters/[id]/studio 落库.
addColumnIfMissing('character_library', 'profile', 'TEXT');

// v12.2.7 (阶段二十一 B): IP 反向同步 —— 来源 token 被撤销/更新时,把导入它的 character_library
// 行标 stale(=1),并给行主人发通知(见 cameo-ip-repo.fanOutTokenInvalidation)。
addColumnIfMissing('character_library', 'stale', 'INTEGER NOT NULL DEFAULT 0');

// v6.5: 团队工作区 — 主账号 (owner_user_id) 的积分额度分配. allocations 为成员额度 JSON 数组.
db.exec(`CREATE TABLE IF NOT EXISTS team_allocations (
  owner_user_id TEXT PRIMARY KEY,
  pool_credits INTEGER NOT NULL DEFAULT 0,
  allocations TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);`);

// v6.4.1: 导演台单环节重跑 — 资产显式失效标记. 上游环节重跑后, 下游环节资产被 POST
// /api/projects/[id]/rerun 置 stale=1; 重生该环节时新资产 stale=0. 兼容老数据 (默认 0).
addColumnIfMissing('project_assets', 'stale', 'INTEGER NOT NULL DEFAULT 0');

// v6.4.1: 重跑审计 — 每次单环节重跑记一条 (谁/哪个项目/哪个环节/失效了哪些下游/是否真派发到
// 活跃 orchestrator). 留痕方便排查 "为什么这集突然要重生".
db.exec(`CREATE TABLE IF NOT EXISTS pipeline_reruns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  invalidates TEXT NOT NULL DEFAULT '[]',     -- JSON StageId[]
  affected_asset_ids TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  dispatched INTEGER NOT NULL DEFAULT 0,      -- 是否真派发到活跃 orchestrator
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_reruns_project ON pipeline_reruns(project_id, created_at);`);

// v6.5.1: 真·多用户成员邀请. 主账号 (owner_user_id) 生成带 token 的邀请, 被邀请的已有账号
// 用户接受后以真实 user id 进 team_allocations 成员表. token 即邀请链接的凭证.
db.exec(`CREATE TABLE IF NOT EXISTS team_invites (
  token TEXT PRIMARY KEY,                      -- nanoid, 邀请链接凭证
  owner_user_id TEXT NOT NULL,
  email TEXT NOT NULL,                         -- 期望接受者邮箱 (规范化小写)
  role TEXT NOT NULL DEFAULT 'member',         -- member | admin (不可邀 owner)
  allocated INTEGER NOT NULL DEFAULT 0,        -- 接受后初始额度
  status TEXT NOT NULL DEFAULT 'pending',      -- pending | accepted | revoked
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT,                            -- 接受者真实 user id
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_team_invites_owner ON team_invites(owner_user_id, created_at);`);

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

// v2.18 P2 (2026-05-10): 试拍记录 — 既给"今天用了几次"做 rate-limit, 又给"试拍历史"
// UI 显示用. 不建立 user FK (使匿名/demo 用户也可记 + 未来 user 删除不级联)。
db.exec(`
CREATE TABLE IF NOT EXISTS preview_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idea TEXT NOT NULL,                           -- 截到 ≤500 字
  style TEXT NOT NULL DEFAULT '',
  aspect TEXT NOT NULL DEFAULT '16:9',
  image_url TEXT,
  video_url TEXT,
  prompt TEXT,                                  -- 实际喂 MJ 的 prompt, ≤400 字
  elapsed_ms INTEGER DEFAULT 0,
  warnings TEXT DEFAULT '[]',                   -- JSON array
  created_at TEXT NOT NULL                      -- ISO timestamp, 也是 day 维度索引基础
);
CREATE INDEX IF NOT EXISTS idx_preview_history_user_created ON preview_history(user_id, created_at);
`);

// v2.18 P2 (2026-05-10): 模板分享 token. global_assets type='template' 的可分享外链。
// 同一 asset 可重复生成 token (用最新的); 删 token (回收) 直接 DELETE row。
db.exec(`
CREATE TABLE IF NOT EXISTS template_share_tokens (
  token TEXT PRIMARY KEY,                       -- nanoid, URL-safe
  asset_id TEXT NOT NULL,                       -- → global_assets.id (type='template')
  owner_user_id TEXT NOT NULL,                  -- 谁创建的, 用来鉴权回收
  view_count INTEGER NOT NULL DEFAULT 0,        -- 公开页被查看次数
  clone_count INTEGER NOT NULL DEFAULT 0,       -- 被克隆次数
  created_at TEXT NOT NULL,
  expires_at TEXT                               -- 可空 = 永不过期
);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_asset ON template_share_tokens(asset_id);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_owner ON template_share_tokens(owner_user_id);
`);

// v3.0 P0.1 (2026-05-16): 协作 — 评论 + @人 + 通知.
//
// 设计要点:
//   - 评论 target: project / shot / scene / character / storyboard 都可 (target_type + target_id)
//     project_id 始终冗余存一份, 方便 "拉某项目下所有 comments" 不跨表 join.
//   - mentions JSON 存 [{userId, name}] 数组 — 解析时机: 服务端在 createComment 触发 (单源真理).
//   - parent_id 支持简单 1 层 reply, 不做无限嵌套 (UI 体验更糟).
//   - 通知是独立表, FK 不强制 — comment / project 删除后通知仍能显示 (体感更好).
//   - 跨项目读取 (用户的"@我"收件箱) 走 notifications.recipient_user_id 索引, 不查 comments.
db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,                      -- 冗余, 方便按项目筛
  target_type TEXT NOT NULL,                     -- 'project'|'shot'|'scene'|'character'|'storyboard'
  target_id TEXT NOT NULL,                       -- target_type='project' 时 = project_id; 否则 = 镜头号等
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,                     -- snapshot, 用户改名后老评论仍显示当时的名
  author_avatar_url TEXT,                        -- 同上
  content TEXT NOT NULL,                         -- ≤ 2000 字, 原文(含 @user 文本占位)
  mentions TEXT DEFAULT '[]',                    -- JSON [{userId, name}]
  parent_id TEXT,                                -- 1 层 reply; null = top-level
  created_at TEXT NOT NULL,
  updated_at TEXT,                               -- null = 没编辑过
  deleted_at TEXT                                -- 软删 — 让 thread 保留 "[已删除]" 占位避免 reply 孤儿
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_user_id);
`);

// v3.x P0.3 E.1 — 评论附件 (拖拽上传的图片 URL). 加列而不是新表 — 1:1 关系简单.
// 兼容老数据: 没列时不报错, 后续 INSERT 都带值 (默认 '[]').
try {
  db.exec(`ALTER TABLE comments ADD COLUMN attachments TEXT DEFAULT '[]'`);
} catch { /* already exists */ }

// v3.x P0.3 E.2 — 用户邮件提醒偏好 ('all'|'mentions'|'none'). 默认 mentions.
try {
  db.exec(`ALTER TABLE users ADD COLUMN email_notify_pref TEXT DEFAULT 'mentions'`);
} catch { /* already exists */ }

// v3.x P0.3 E.3 — 项目级版本审批状态机.
db.exec(`
CREATE TABLE IF NOT EXISTS project_review_status (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',          -- 'draft' | 'in_review' | 'approved' | 'changes_requested'
  submitted_by_user_id TEXT,
  submitted_at TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,                              -- 审批人留言 (approve/request changes 时填)
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_status_status ON project_review_status(status, updated_at);
`);

// v3.1 F.1 — Cinema timeline 多轨道用户编辑覆盖层.
//   - 默认所有 BGM/字幕 segments 从 script 派生 (按 shots[].dialogue + 时长累计)
//   - 用户在 timeline 上拖拽改时间 / 静音单段 / 切某段后, 把 override 写到这里
//   - 渲染时: 取 script 派生默认值 + 该表 override 覆盖
//   - track_type: 'bgm' | 'subtitle'
//   - segment_key: 段内唯一 (字幕用 shotNumber, BGM 用 act number 或 segment idx)
//   - 字段: muted/start_offset_sec/duration_override/custom_text (字幕改写)
db.exec(`
CREATE TABLE IF NOT EXISTS project_track_edits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  track_type TEXT NOT NULL,                       -- 'bgm' | 'subtitle'
  segment_key TEXT NOT NULL,                      -- shot-N 或 bgm-act-N 等稳定 key
  muted INTEGER NOT NULL DEFAULT 0,
  start_offset_sec REAL,                          -- 相对默认 startSec 的偏移 (秒, 可负)
  duration_override_sec REAL,                     -- 覆盖默认时长 (>0 才生效)
  custom_text TEXT,                               -- subtitle 改写后的文本 (BGM 不用)
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, track_type, segment_key)
);
CREATE INDEX IF NOT EXISTS idx_track_edits_project ON project_track_edits(project_id, track_type);
`);

// v3.x — 项目协作: 分享链接 + 协作者表 (复用 template_share_tokens 模式).
//   project_share_tokens: 创建分享链接, 含 role 控权限 ('viewer'|'commenter'|'editor')
//   project_collaborators: 用户点链接接受后写入 — 后续直接进项目页可见
db.exec(`
CREATE TABLE IF NOT EXISTS project_share_tokens (
  token TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  view_count INTEGER NOT NULL DEFAULT 0,
  accept_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_project ON project_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_owner ON project_share_tokens(owner_user_id);

CREATE TABLE IF NOT EXISTS project_collaborators (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  invited_by_user_id TEXT,
  invited_via_token TEXT,
  joined_at TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user ON project_collaborators(user_id);
`);

// v12.2.5 (阶段二十一 B): 锁脸角色归一表 —— projects.locked_characters JSON blob 的索引镜像,
// 让「哪些项目用过角色 X」从全表 JSON 扫变 idx_plc_character_name 索引查(双写,JSON 仍为读源)。
db.exec(`
CREATE TABLE IF NOT EXISTS project_locked_characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  cw INTEGER NOT NULL DEFAULT 100,
  role TEXT NOT NULL DEFAULT 'lead',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, character_name)
);
CREATE INDEX IF NOT EXISTS idx_plc_project ON project_locked_characters(project_id);
CREATE INDEX IF NOT EXISTS idx_plc_character_name ON project_locked_characters(character_name);
`);

// v12.3.1 (阶段二十二): 发布记录 —— 一次「发布」动作落一行(packaged/published/scheduled),
// 记平台 + 分享链接 + 真发布时间。dashboard 读它显示发布状态。
db.exec(`
CREATE TABLE IF NOT EXISTS publish_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'packaged',       -- packaged | published | scheduled | failed
  share_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  external_url TEXT,                             -- 真发布后的平台链接(v12.3.3)
  published_at TEXT,                             -- 真发布成功才写
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publish_records_project ON publish_records(project_id, created_at);
`);

// v12.3.3 (阶段二十二): 定时发布 —— 到点由 worker tick 认领并经适配器发布。
// status: pending(待发)| running(认领中)| done(已处理:真传成功或降级出包)| failed | canceled。
db.exec(`
CREATE TABLE IF NOT EXISTS scheduled_publishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,                     -- ISO,到点触发
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | running | done | failed | canceled
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  publish_record_id TEXT,                         -- 触发后产生的 publish_records.id
  created_by TEXT,                                -- 发起用户 id
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_due ON scheduled_publishes(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_project ON scheduled_publishes(project_id, created_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  type TEXT NOT NULL,                            -- 'mention'|'reply'|'project_invite' (v3.x)
  source_user_id TEXT NOT NULL,
  source_user_name TEXT NOT NULL,                -- snapshot
  project_id TEXT,                               -- 可空 — system 通知
  comment_id TEXT,                               -- 触发本通知的评论, 可空
  preview TEXT,                                  -- ≤ 200 字, 评论原文截断
  read_at TEXT,                                  -- null = 未读
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_user_id, read_at, created_at);
`);

// v3.0 P0.2 (2026-05-17): Yjs 文档持久化.
// 每个 project 对应一个 Y.Doc, 状态以 BLOB 存. WS server 启动时 load + 在 update
// 时 debounced 写回. update_count 给 GC 用 (每 N 次 update 做一次 full snapshot).
db.exec(`
CREATE TABLE IF NOT EXISTS yjs_docs (
  doc_name TEXT PRIMARY KEY,                     -- 例: 'project-<projectId>'
  state BLOB NOT NULL,                           -- Y.encodeStateAsUpdate(ydoc) 二进制
  update_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_yjs_docs_updated ON yjs_docs(updated_at);

-- v3.2 P4.1: plugin-chain 灰度遥测. 每次 plugin chain 调用 (primary 命中/回退,
-- shadow 采样一致/不一致) 落一行, 让 admin 面板能看真实 success-rate diff,
-- 决定 shadow → primary 切换时机. kind = image/video/tts, outcome 见 lib/plugin-chain-telemetry.ts.
CREATE TABLE IF NOT EXISTS plugin_chain_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                            -- 'image' | 'video' | 'tts'
  mode TEXT NOT NULL,                            -- 'primary' | 'shadow'
  outcome TEXT NOT NULL,                         -- 'primary_hit' | 'primary_fallback' | 'shadow_agree' | 'shadow_disagree'
  provider TEXT,                                 -- 命中的 provider id (有则记)
  latency_ms INTEGER,                            -- plugin chain 耗时
  error TEXT,                                    -- 失败原因 (截断 200)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_chain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_kind ON plugin_chain_events(kind, outcome);

-- v3.4: 端到端 Vision Audit — 每镜成片关键帧对剧本的符合度评分.
-- 一个 project × shot_number 一行 (重审 UPSERT 覆盖). 详见 lib/vision-audit.ts.
CREATE TABLE IF NOT EXISTS shot_vision_audits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_number INTEGER NOT NULL,
  score INTEGER NOT NULL,                        -- 0-100 综合
  verdict TEXT NOT NULL,                         -- 'pass' | 'warn' | 'fail'
  scene_match INTEGER,
  action_match INTEGER,
  mood_match INTEGER,
  composition INTEGER,
  issues TEXT,                                   -- JSON string array
  reasoning TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shot_audits_project ON shot_vision_audits(project_id, shot_number);

-- v4.0: Cameo IP 经济 — 把 character_library 里的角色 token 化, 经授权可被其他用户复用.
-- 一个角色可发一个 IP token (UPSERT). 详见 lib/cameo-ip.ts.
CREATE TABLE IF NOT EXISTS character_ip_tokens (
  id TEXT PRIMARY KEY,                           -- token id (公开可分享)
  character_id TEXT NOT NULL,                    -- FK character_library.id
  owner_id TEXT NOT NULL,                        -- FK users.id
  name TEXT NOT NULL,                            -- 角色名快照
  cover_url TEXT,                                -- 封面图快照
  visibility TEXT NOT NULL DEFAULT 'private',    -- 'public' | 'unlisted' | 'private'
  license TEXT NOT NULL DEFAULT 'view',          -- 'view' | 'remix' | 'commercial'
  terms TEXT DEFAULT '',                         -- 授权条款自由文本
  royalty_cny REAL DEFAULT 0,                    -- 建议单次复用版税 (元), 0 = 免费
  status TEXT NOT NULL DEFAULT 'active',         -- 'active' | 'revoked'
  use_count INTEGER NOT NULL DEFAULT 0,          -- 累计被复用次数
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_tokens_owner ON character_ip_tokens(owner_id);
CREATE INDEX IF NOT EXISTS idx_ip_tokens_visibility ON character_ip_tokens(visibility, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_tokens_character ON character_ip_tokens(character_id);

-- 授权记录: 非 public-remix 的 token, 复用前要 grantee 申请 + owner 批准.
CREATE TABLE IF NOT EXISTS character_ip_grants (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,                        -- FK character_ip_tokens.id
  grantee_id TEXT NOT NULL,                      -- FK users.id (申请复用的人)
  status TEXT NOT NULL DEFAULT 'pending',        -- 'pending' | 'approved' | 'revoked'
  use_count INTEGER NOT NULL DEFAULT 0,          -- 该授权下复用次数
  message TEXT DEFAULT '',                       -- 申请留言
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ip_grants_token ON character_ip_grants(token_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_grants_token_grantee ON character_ip_grants(token_id, grantee_id);

-- v4.1: Agent 编排工作流 — 用户自定义的 agent DAG (拖拽 IDE 地基). 详见 lib/agent-workflow.ts.
CREATE TABLE IF NOT EXISTS agent_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,                      -- WorkflowGraph JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON agent_workflows(user_id, updated_at);
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
      // demo 账号凭据是公开演示用的(登录页明示)。默认给普通 member 角色,避免公网部署时
      // 把 admin 接口(/api/admin/*、waitlist 管理、完整用量统计)暴露给任何人。
      // 本地若需 admin 调试:启动时设 DEMO_ADMIN=1。
      const demoRole = process.env.DEMO_ADMIN === '1' ? 'admin' : 'member';

      db.prepare(`INSERT INTO users (id, email, password_hash, name, role, avatar_url, locale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        demoUserId, 'demo@qfmanju.ai', passwordHash, '青枫漫剧 Demo', demoRole, AVATAR, 'zh', now()
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

      const caseStmt = db.prepare(`INSERT INTO cases (id, title, category, cover_url, author_name, author_avatar, video_url, metrics, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      // video 为示意播放片段(引用自公开影视《双城之战》, 仅供学习/画风参考, 非商用; 见 public/cases/NOTICE.md)
      const demoCases: { title: string; category: string; cover: string; author: string; video?: string }[] = [
        { title: '月华藏境', category: '东方幻想', cover: seedSvg(400, 300, '#312e81', '#f9a8d4', '月华藏境'), author: '青枫漫剧 Studio', video: '/cases/clip-c.mp4' },
        { title: '霓虹回响', category: '赛博都市', cover: seedSvg(400, 300, '#0c4a6e', '#ef319f', '霓虹回响'), author: 'QingFeng Lab', video: '/cases/clip-a.mp4' },
        { title: '星潮旅人', category: '科幻冒险', cover: seedSvg(400, 300, '#1e1b4b', '#4de0c2', '星潮旅人'), author: '青枫漫剧 Studio', video: '/cases/clip-b.mp4' },
        { title: '云岚日记', category: '治愈日常', cover: seedSvg(400, 300, '#064e3b', '#a78bfa', '云岚日记'), author: 'QingFeng Lab', video: '/cases/clip-d.mp4' },
      ];
      for (const c of demoCases) {
        caseStmt.run(nanoid(), c.title, c.category, c.cover, c.author, AVATAR, c.video || null, JSON.stringify({ likes: Math.floor(Math.random() * 1000) + 200, views: Math.floor(Math.random() * 5000) + 800 }), now());
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

// dbPath 导出供 e2e 测试把"本进程实际使用的库文件"路径透传给 ws-server 子进程
// (QFMJ_DB_PATH), 让子进程与测试进程读写同一个库. 生产环境即 data/qfmj.db.
export { db, dbPath };
