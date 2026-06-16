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
  updated_at TEXT NOT NULL, script_data TEXT, director_notes TEXT, pipeline_state TEXT, mode TEXT DEFAULT 'episodic', execution_mode TEXT DEFAULT 'dialogue', style_id TEXT, global_asset_ids TEXT DEFAULT '[]', output_config TEXT, primary_character_ref TEXT, locked_characters TEXT NOT NULL DEFAULT '[]', share_token TEXT, share_created_at TEXT
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
CREATE TABLE IF NOT EXISTS template_share_tokens (
  token TEXT PRIMARY KEY,                       
  asset_id TEXT NOT NULL,                       
  owner_user_id TEXT NOT NULL,                  
  view_count INTEGER NOT NULL DEFAULT 0,        
  clone_count INTEGER NOT NULL DEFAULT 0,       
  created_at TEXT NOT NULL,
  expires_at TEXT                               
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
, invite_code_used TEXT, subscription_tier TEXT NOT NULL DEFAULT 'free', subscription_status TEXT, stripe_customer_id TEXT, email_notify_pref TEXT DEFAULT 'mentions', budget_cap_cny REAL, budget_hard_cap_cny REAL);
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
-- v9.6.7 (阶段十六 T2 模板市场): 可复用成片模板 (画风+多参元素+节奏+一键起片预填)
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
CREATE INDEX IF NOT EXISTS idx_film_templates_market ON film_templates(visibility, quality);
CREATE INDEX IF NOT EXISTS idx_film_templates_owner ON film_templates(owner_id);
-- v9.7.16 (T2 评分/收藏)
CREATE TABLE IF NOT EXISTS template_ratings (
  template_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_active ON api_quota_alerts(provider, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_api_quota_alerts_recent ON api_quota_alerts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_provider_created ON api_usage_events(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_success ON api_usage_events(success, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_user_id);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_created ON cost_log(created_at);
CREATE INDEX IF NOT EXISTS idx_cost_log_project ON cost_log(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_log_user ON cost_log(user_id);
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
CREATE INDEX IF NOT EXISTS idx_pipeline_reruns_project ON pipeline_reruns(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_created ON plugin_chain_events(created_at);
CREATE INDEX IF NOT EXISTS idx_plugin_events_kind ON plugin_chain_events(kind, outcome);
CREATE INDEX IF NOT EXISTS idx_preview_history_user_created ON preview_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_created ON project_quality_scores(created_at);
CREATE INDEX IF NOT EXISTS idx_project_quality_scores_project ON project_quality_scores(project_id);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_owner ON project_share_tokens(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_project_share_tokens_project ON project_share_tokens(project_id);
CREATE INDEX IF NOT EXISTS idx_review_status_status ON project_review_status(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_shot_audits_project ON shot_vision_audits(project_id, shot_number);
CREATE INDEX IF NOT EXISTS idx_team_invites_owner ON team_invites(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_asset ON template_share_tokens(asset_id);
CREATE INDEX IF NOT EXISTS idx_template_share_tokens_owner ON template_share_tokens(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_track_edits_project ON project_track_edits(project_id, track_type);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON agent_workflows(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_yjs_docs_updated ON yjs_docs(updated_at);

-- v12.2.5 (阶段二十一 B): 锁脸角色归一表(projects.locked_characters JSON 的索引镜像)
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

-- v12.3.1 (阶段二十二): 发布记录
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
CREATE INDEX IF NOT EXISTS idx_publish_records_project ON publish_records(project_id, created_at);

-- v12.3.3 (阶段二十二): 定时发布
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
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_due ON scheduled_publishes(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_publishes_project ON scheduled_publishes(project_id, created_at);
