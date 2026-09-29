-- v4.2 auto-generated Postgres schema (translated from SQLite)
-- 注意: 时间戳列用 TEXT (ISO 字符串), 与现有代码一致. 真要 timestamptz 需配套改读写.
-- v6.6 applyReady: 已去 FK 约束 (SQLite 未开 FK 强制) + 行注释, 可直接顺序执行.

CREATE TABLE IF NOT EXISTS agent_workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,                      
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_quota_alerts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                       
  model TEXT DEFAULT '',
  alert_type TEXT NOT NULL,                     
  error_message TEXT,                           
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  acknowledged_at TEXT                          
);
CREATE TABLE IF NOT EXISTS api_usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                       
  model TEXT NOT NULL DEFAULT '',               
  method TEXT NOT NULL DEFAULT '',              
  success INTEGER NOT NULL,                     
  status_code INTEGER,                          
  error_message TEXT,                           
  duration_ms INTEGER NOT NULL DEFAULT 0,       
  project_id TEXT,                              
  user_id TEXT,                                 
  est_cost_cny REAL DEFAULT 0,                  
  created_at TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS character_ip_grants (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,                        
  grantee_id TEXT NOT NULL,                      
  status TEXT NOT NULL DEFAULT 'pending',        
  use_count INTEGER NOT NULL DEFAULT 0,          
  message TEXT DEFAULT '',                       
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS character_ip_tokens (
  id TEXT PRIMARY KEY,                           
  character_id TEXT NOT NULL,                    
  owner_id TEXT NOT NULL,                        
  name TEXT NOT NULL,                            
  cover_url TEXT,                                
  visibility TEXT NOT NULL DEFAULT 'private',    
  license TEXT NOT NULL DEFAULT 'view',          
  terms TEXT DEFAULT '',                         
  royalty_cny REAL DEFAULT 0,                    
  status TEXT NOT NULL DEFAULT 'active',         
  use_count INTEGER NOT NULL DEFAULT 0,          
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  updated_at TEXT NOT NULL, source_token_id TEXT, profile TEXT, stale INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,                      
  target_type TEXT NOT NULL,                     
  target_id TEXT NOT NULL,                       
  author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL,                     
  author_avatar_url TEXT,                        
  content TEXT NOT NULL,                         
  mentions TEXT DEFAULT '[]',                    
  parent_id TEXT,                                
  created_at TEXT NOT NULL,
  updated_at TEXT,                               
  deleted_at TEXT                                
, attachments TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  purpose TEXT NOT NULL,
  owner_declaration TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  engine TEXT NOT NULL,                         
  resolution TEXT NOT NULL,                     
  duration_sec REAL NOT NULL DEFAULT 0,
  cost_cny REAL NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS film_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT,                                
  title TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',               
  genre TEXT,
  pacing_tone TEXT,                             
  shot_count INTEGER NOT NULL DEFAULT 0,
  quality INTEGER NOT NULL DEFAULT 60,          
  elements TEXT NOT NULL DEFAULT '[]',          
  tags TEXT NOT NULL DEFAULT '[]',              
  payload TEXT,                                 
  source_project_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',    
  use_count INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0,        
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  prompt TEXT NOT NULL,
  style TEXT NOT NULL,
  status TEXT NOT NULL,
  result_urls TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                           
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',              
  thumbnail TEXT NOT NULL DEFAULT '',
  visual_anchors TEXT NOT NULL DEFAULT '[]',    
  embedding TEXT,                                
  metadata TEXT NOT NULL DEFAULT '{}',          
  referenced_by_projects TEXT NOT NULL DEFAULT '[]', 
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,                        
  source TEXT,                                  
  status TEXT NOT NULL DEFAULT 'unused',        
  used_by_user_id TEXT,
  used_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL,                     
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_overrides (
  env_key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  prev_value TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  type TEXT NOT NULL,                            
  source_user_id TEXT NOT NULL,
  source_user_name TEXT NOT NULL,                
  project_id TEXT,                               
  comment_id TEXT,                               
  preview TEXT,                                  
  read_at TEXT,                                  
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'create',
  project_id TEXT NOT NULL,
  user_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',          
  step TEXT NOT NULL DEFAULT '',                 
  payload TEXT NOT NULL DEFAULT '{}',
  progress_log TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  heartbeat_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_reruns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  invalidates TEXT NOT NULL DEFAULT '[]',     
  affected_asset_ids TEXT NOT NULL DEFAULT '[]', 
  dispatched INTEGER NOT NULL DEFAULT 0,      
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_chain_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                            
  mode TEXT NOT NULL,                            
  outcome TEXT NOT NULL,                         
  provider TEXT,                                 
  latency_ms INTEGER,                            
  error TEXT,                                    
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idea TEXT NOT NULL,                           
  style TEXT NOT NULL DEFAULT '',
  aspect TEXT NOT NULL DEFAULT '16:9',
  image_url TEXT,
  video_url TEXT,
  prompt TEXT,                                  
  elapsed_ms INTEGER DEFAULT 0,
  warnings TEXT DEFAULT '[]',                   
  created_at TEXT NOT NULL                      
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
  updated_at TEXT NOT NULL, confirmed INTEGER DEFAULT 0, persistent_url TEXT, stale INTEGER NOT NULL DEFAULT 0
);
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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_review_status (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',          
  submitted_by_user_id TEXT,
  submitted_at TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,                              
  updated_at TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS project_track_edits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  track_type TEXT NOT NULL,                       
  segment_key TEXT NOT NULL,                      
  muted INTEGER NOT NULL DEFAULT 0,
  start_offset_sec REAL,                          
  duration_override_sec REAL,                     
  custom_text TEXT,                               
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, track_type, segment_key)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  cover_urls TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, script_data TEXT, director_notes TEXT, pipeline_state TEXT, mode TEXT DEFAULT 'episodic', execution_mode TEXT DEFAULT 'dialogue', style_id TEXT, aspect TEXT DEFAULT '16:9', global_asset_ids TEXT DEFAULT '[]', output_config TEXT, series_id TEXT, episode_number INTEGER, canvas_layout TEXT, primary_character_ref TEXT, locked_characters TEXT NOT NULL DEFAULT '[]', share_token TEXT, share_created_at TEXT
);
CREATE TABLE IF NOT EXISTS publish_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'packaged',       
  share_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  external_url TEXT,                             
  published_at TEXT,                             
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resource_locks (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_publishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,                     
  status TEXT NOT NULL DEFAULT 'pending',         
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  publish_record_id TEXT,                         
  created_by TEXT,                                
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS series_anchors (
  series_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shot_vision_audits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  shot_number INTEGER NOT NULL,
  score INTEGER NOT NULL,                        
  verdict TEXT NOT NULL,                         
  scene_match INTEGER,
  action_match INTEGER,
  mood_match INTEGER,
  composition INTEGER,
  issues TEXT,                                   
  reasoning TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  tier_id TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  started_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_allocations (
  owner_user_id TEXT PRIMARY KEY,
  pool_credits INTEGER NOT NULL DEFAULT 0,
  allocations TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_invites (
  token TEXT PRIMARY KEY,                      
  owner_user_id TEXT NOT NULL,
  email TEXT NOT NULL,                         
  role TEXT NOT NULL DEFAULT 'member',         
  allocated INTEGER NOT NULL DEFAULT 0,        
  status TEXT NOT NULL DEFAULT 'pending',      
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT,                            
  accepted_at TEXT
);
CREATE TABLE IF NOT EXISTS template_favorites (
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);
CREATE TABLE IF NOT EXISTS template_ratings (
  template_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,                       
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, user_id)
);
CREATE TABLE IF NOT EXISTS template_share_tokens (
  token TEXT PRIMARY KEY,                       
  asset_id TEXT NOT NULL,                       
  owner_user_id TEXT NOT NULL,                  
  view_count INTEGER NOT NULL DEFAULT 0,        
  clone_count INTEGER NOT NULL DEFAULT 0,       
  created_at TEXT NOT NULL,
  expires_at TEXT                               
);
CREATE TABLE IF NOT EXISTS ui_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  user_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_tracking (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  credits_used INTEGER DEFAULT 1,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar_url TEXT,
  locale TEXT DEFAULT 'zh',
  created_at TEXT NOT NULL
, invite_code_used TEXT, budget_cap_cny REAL, budget_hard_cap_cny REAL, subscription_tier TEXT NOT NULL DEFAULT 'free', subscription_status TEXT, stripe_customer_id TEXT, email_notify_pref TEXT DEFAULT 'mentions');
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       
  approved_at TEXT,
  invite_code TEXT,                             
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS yjs_docs (
  doc_name TEXT PRIMARY KEY,                     
  state BYTEA NOT NULL,                           
  update_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- v12.457 auto-generated: 把 SQLite 上后加的列补到已存在的 PG 表上
-- CREATE TABLE IF NOT EXISTS 对已存在的表是 no-op —— 升级部署拿不到新列,全靠这一段。

ALTER TABLE "agent_workflows" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "agent_workflows" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "agent_workflows" ADD COLUMN IF NOT EXISTS "graph_json" TEXT;
ALTER TABLE "agent_workflows" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "agent_workflows" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "model" TEXT DEFAULT '';
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "alert_type" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "first_seen_at" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "last_seen_at" TEXT;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "occurrence_count" INTEGER DEFAULT 1 NOT NULL;
ALTER TABLE "api_quota_alerts" ADD COLUMN IF NOT EXISTS "acknowledged_at" TEXT;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "model" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "method" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "success" INTEGER;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "status_code" INTEGER;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "est_cost_cny" REAL DEFAULT 0;
ALTER TABLE "api_usage_events" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "cover_url" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "author_name" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "author_avatar" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "video_url" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "metrics" TEXT;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "token_id" TEXT;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "grantee_id" TEXT;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "use_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "message" TEXT DEFAULT '';
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "character_ip_grants" ADD COLUMN IF NOT EXISTS "decided_at" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "character_id" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "cover_url" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "visibility" TEXT DEFAULT 'private' NOT NULL;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "license" TEXT DEFAULT 'view' NOT NULL;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "terms" TEXT DEFAULT '';
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "royalty_cny" REAL DEFAULT 0;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'active' NOT NULL;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "use_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "character_ip_tokens" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "appearance" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "visual_tags" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "image_urls" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "style_keywords" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "usage_count" INTEGER DEFAULT 0;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "source_token_id" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "profile" TEXT;
ALTER TABLE "character_library" ADD COLUMN IF NOT EXISTS "stale" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "agent_role" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "thinking" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "metadata" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "target_type" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "target_id" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "author_user_id" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "author_name" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "author_avatar_url" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "mentions" TEXT DEFAULT '[]';
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "parent_id" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "deleted_at" TEXT;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "attachments" TEXT DEFAULT '[]';
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "purpose" TEXT;
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "owner_declaration" TEXT;
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "consent_log" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "engine" TEXT;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "duration_sec" REAL DEFAULT 0 NOT NULL;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "cost_cny" REAL DEFAULT 0 NOT NULL;
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "metadata" TEXT DEFAULT '{}';
ALTER TABLE "cost_log" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "style" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "genre" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "pacing_tone" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "shot_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "quality" INTEGER DEFAULT 60 NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "elements" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "tags" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "payload" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "source_project_id" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "visibility" TEXT DEFAULT 'public' NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "use_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "rating_sum" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "rating_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "film_templates" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "prompt" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "style" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "result_urls" TEXT;
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "description" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "tags" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "thumbnail" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "visual_anchors" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "embedding" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "metadata" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "referenced_by_projects" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "global_assets" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'unused' NOT NULL;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "used_by_user_id" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "used_at" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "model_overrides" ADD COLUMN IF NOT EXISTS "value" TEXT;
ALTER TABLE "model_overrides" ADD COLUMN IF NOT EXISTS "prev_value" TEXT;
ALTER TABLE "model_overrides" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipient_user_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "source_user_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "source_user_name" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "comment_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "preview" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read_at" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "pipeline_job_events" ADD COLUMN IF NOT EXISTS "job_id" TEXT;
ALTER TABLE "pipeline_job_events" ADD COLUMN IF NOT EXISTS "ord" INTEGER;
ALTER TABLE "pipeline_job_events" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "pipeline_job_events" ADD COLUMN IF NOT EXISTS "data" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "pipeline_job_events" ADD COLUMN IF NOT EXISTS "at" TEXT;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "type" TEXT DEFAULT 'create' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "state" TEXT DEFAULT 'queued' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "step" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "payload" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "progress_log" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "attempts" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "last_error" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "pipeline_jobs" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "invalidates" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "affected_asset_ids" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "dispatched" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "pipeline_reruns" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "mode" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "plugin_chain_events" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "idea" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "style" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "aspect" TEXT DEFAULT '16:9' NOT NULL;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "image_url" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "video_url" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "prompt" TEXT;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "elapsed_ms" INTEGER DEFAULT 0;
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "warnings" TEXT DEFAULT '[]';
ALTER TABLE "preview_history" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "data" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "media_urls" TEXT DEFAULT '[]';
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "shot_number" INTEGER;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "confirmed" INTEGER DEFAULT 0;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "persistent_url" TEXT;
ALTER TABLE "project_assets" ADD COLUMN IF NOT EXISTS "stale" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'viewer' NOT NULL;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "invited_by_user_id" TEXT;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "invited_via_token" TEXT;
ALTER TABLE "project_collaborators" ADD COLUMN IF NOT EXISTS "joined_at" TEXT;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "character_name" TEXT;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "image_url" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "cw" INTEGER DEFAULT 100 NOT NULL;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'lead' NOT NULL;
ALTER TABLE "project_locked_characters" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "overall_score" INTEGER;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "continuity_score" INTEGER;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "lighting_score" INTEGER;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "face_score" INTEGER;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "narrative" TEXT;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "sample_frames" TEXT;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "suggestions" TEXT;
ALTER TABLE "project_quality_scores" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'draft' NOT NULL;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "submitted_by_user_id" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "submitted_at" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "reviewed_at" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "review_note" TEXT;
ALTER TABLE "project_review_status" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'viewer' NOT NULL;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "view_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "accept_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "project_share_tokens" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "track_type" TEXT;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "segment_key" TEXT;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "muted" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "start_offset_sec" REAL;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "duration_override_sec" REAL;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "custom_text" TEXT;
ALTER TABLE "project_track_edits" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "cover_urls" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "script_data" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "director_notes" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "pipeline_state" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "mode" TEXT DEFAULT 'episodic';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "execution_mode" TEXT DEFAULT 'dialogue';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "style_id" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "aspect" TEXT DEFAULT '16:9';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "global_asset_ids" TEXT DEFAULT '[]';
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "output_config" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "series_id" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "episode_number" INTEGER;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "canvas_layout" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "primary_character_ref" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "locked_characters" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "share_token" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "share_created_at" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'packaged' NOT NULL;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "share_url" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "title" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "external_url" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "published_at" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "resource_locks" ADD COLUMN IF NOT EXISTS "owner" TEXT;
ALTER TABLE "resource_locks" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "resource_locks" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "scheduled_at" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "attempts" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "publish_record_id" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "scheduled_publishes" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "series_anchors" ADD COLUMN IF NOT EXISTS "data" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "series_anchors" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "shot_number" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "score" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "verdict" TEXT;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "scene_match" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "action_match" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "mood_match" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "composition" INTEGER;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "issues" TEXT;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "reasoning" TEXT;
ALTER TABLE "shot_vision_audits" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "tier_id" TEXT DEFAULT 'free' NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'active' NOT NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "started_at" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "team_allocations" ADD COLUMN IF NOT EXISTS "pool_credits" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "team_allocations" ADD COLUMN IF NOT EXISTS "allocations" TEXT DEFAULT '[]' NOT NULL;
ALTER TABLE "team_allocations" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "role" TEXT DEFAULT 'member' NOT NULL;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "allocated" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "accepted_by" TEXT;
ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "accepted_at" TEXT;
ALTER TABLE "template_favorites" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "template_ratings" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "template_ratings" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "asset_id" TEXT;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "owner_user_id" TEXT;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "view_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "clone_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "template_share_tokens" ADD COLUMN IF NOT EXISTS "expires_at" TEXT;
ALTER TABLE "ui_events" ADD COLUMN IF NOT EXISTS "event" TEXT;
ALTER TABLE "ui_events" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "ui_events" ADD COLUMN IF NOT EXISTS "meta" TEXT DEFAULT '{}' NOT NULL;
ALTER TABLE "ui_events" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "action_type" TEXT;
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "resource_type" TEXT;
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "credits_used" INTEGER DEFAULT 1;
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "metadata" TEXT DEFAULT '{}';
ALTER TABLE "usage_tracking" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" TEXT DEFAULT 'zh';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code_used" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget_cap_cny" REAL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "budget_hard_cap_cny" REAL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_tier" TEXT DEFAULT 'free' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_notify_pref" TEXT DEFAULT 'mentions';
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "purpose" TEXT DEFAULT '' NOT NULL;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'pending' NOT NULL;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "approved_at" TEXT;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "invite_code" TEXT;
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "created_at" TEXT;
ALTER TABLE "yjs_docs" ADD COLUMN IF NOT EXISTS "state" BYTEA;
ALTER TABLE "yjs_docs" ADD COLUMN IF NOT EXISTS "update_count" INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE "yjs_docs" ADD COLUMN IF NOT EXISTS "updated_at" TEXT;
ALTER TABLE "yjs_docs" ADD COLUMN IF NOT EXISTS "created_at" TEXT;

CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_active ON api_quota_alerts(provider, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_recent ON api_quota_alerts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created ON api_usage_events(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_success ON api_usage_events(success, created_at);
CREATE INDEX IF NOT EXISTS idx_character_library_user ON character_library(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_user_id);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_action ON consent_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_consent_log_user ON consent_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_log_created ON cost_log(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_log_project ON cost_log(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_user ON cost_log(user_id);
CREATE INDEX IF NOT EXISTS idx_film_templates_market ON film_templates(visibility, quality);
CREATE INDEX IF NOT EXISTS idx_film_templates_owner ON film_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_generations_project ON generations(project_id);
CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id);
CREATE INDEX IF NOT EXISTS idx_global_assets_user_name ON global_assets(user_id, name);
CREATE INDEX IF NOT EXISTS idx_global_assets_user_type ON global_assets(user_id, type);
CREATE INDEX IF NOT EXISTS idx_invite_codes_source ON invite_codes(source);
CREATE INDEX IF NOT EXISTS idx_invite_codes_status ON invite_codes(status);
CREATE INDEX IF NOT EXISTS idx_ip_grants_token ON character_ip_grants(token_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_grants_token_grantee ON character_ip_grants(token_id, grantee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_tokens_character ON character_ip_tokens(character_id);
CREATE INDEX IF NOT EXISTS idx_ip_tokens_owner ON character_ip_tokens(owner_id);
CREATE INDEX IF NOT EXISTS idx_ip_tokens_visibility ON character_ip_tokens(visibility, status);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_project ON pipeline_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_state ON pipeline_jobs(state, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_reruns_project ON pipeline_reruns(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pje_job ON pipeline_job_events(job_id, at, ord);
CREATE INDEX IF NOT EXISTS idx_plc_character_name ON project_locked_characters(character_name);
CREATE INDEX IF NOT EXISTS idx_plc_project ON project_locked_characters(project_id);
CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_chain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_kind ON plugin_chain_events(kind, outcome);
CREATE INDEX IF NOT EXISTS idx_preview_history_user_created ON preview_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_assets_project_shot ON project_assets(project_id, shot_number);
CREATE INDEX IF NOT EXISTS idx_project_assets_project_type ON project_assets(project_id, type);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_created ON project_quality_scores(created_at);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_project ON project_quality_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_owner ON project_share_tokens(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_project ON project_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_created ON projects(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_publish_records_project ON publish_records(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_resource_locks_expires ON resource_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_review_status_status ON project_review_status(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_due ON scheduled_publishes(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_project ON scheduled_publishes(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shot_audits_project ON shot_vision_audits(project_id, shot_number);
CREATE INDEX IF NOT EXISTS idx_team_invites_owner ON team_invites(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_template_favorites_user ON template_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_asset ON template_share_tokens(asset_id);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_owner ON template_share_tokens(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_track_edits_project ON project_track_edits(project_id, track_type);
CREATE INDEX IF NOT EXISTS idx_ui_events_event ON ui_events(event, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON agent_workflows(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_yjs_docs_updated ON yjs_docs(updated_at);
