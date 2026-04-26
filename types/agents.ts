// Agent 角色枚举
export enum AgentRole {
  DIRECTOR = 'director',              // AI 导演（连线到每个环节，总控）
  WRITER = 'writer',                  // AI 编剧
  CHARACTER_DESIGNER = 'character_designer', // AI 角色设计师
  SCENE_DESIGNER = 'scene_designer',         // AI 场景设计师
  STORYBOARD = 'storyboard',          // AI 分镜师
  VIDEO_PRODUCER = 'video_producer',  // AI 视频制作
  EDITOR = 'editor',                  // AI 剪辑师
  PRODUCER = 'producer'               // AI 制片人（最终审核、成片确认）
}

// Agent 状态
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'completed' | 'error';

// Agent 接口
export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  avatar: string;
  status: AgentStatus;
  progress: number;
  currentTask?: string;
  output?: any;
  error?: string;
}

// Agent 任务
export interface AgentTask {
  agentRole: AgentRole;
  input: any;
  dependencies: AgentRole[];
  priority: number;
}

// 角色
export interface Character {
  name: string;
  description: string;
  appearance: string;
  imageUrl?: string;
  /** McKee 11 维视觉结构（导演输出，传入 getCharacterVisualPrompt 时会被展平到英文 prompt） */
  visual?: {
    age?: string;
    headShape?: string;
    bodyType?: string;
    skinTone?: string;
    face?: string;
    hair?: string;
    outfit?: string;
    props?: string;
    bodyLanguage?: string;
    colorScheme?: string;
    silhouette?: string;
  };
  /** 角色内在悖论（McKee） */
  paradox?: string;
  /** 说话风格 */
  speechStyle?: string;
  /** 角色定位 */
  role?: string;
}

// 场景
export interface Scene {
  id: string;
  description: string;
  location: string;
  imageUrl?: string;
  /** McKee 五感 + 建筑/天气/时间 结构（导演输出） */
  visual?: {
    lighting?: string;
    atmosphere?: string;
    architecture?: string;
    weather?: string;
    timeOfDay?: string;
    soundscape?: string;
    smell?: string;
    colorPalette?: string;
  };
}

// 剧本
export interface ScriptShot {
  shotNumber: number;
  sceneDescription: string;
  action: string;
  emotion: string;
  characters: string[];
  dialogue?: string;
  // McKee 写作扩展字段(Writer v2.1+)
  act?: number;
  storyBeat?: string;
  visualPrompt?: string;
  subtext?: string;
  emotionTemperature?: number;
  beat?: string;
  cameraWork?: string;
  soundDesign?: string;
  duration?: number;
  // v2.8 摄影语言字段(Writer v2.8+)
  shotSize?: string;
  lens?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lightingIntent?: string;
  composition?: string;
  editPattern?: string;
  whyThisChoice?: string;
  diegeticSound?: string;
  scoreMood?: string;
  rhythmicSync?: string;
}

export interface Script {
  title: string;
  synopsis: string;
  shots: ScriptShot[];
  scenes?: { sceneId: string; dialogue: string; action: string }[];
}

// 分镜
export interface Storyboard {
  shotNumber?: number;
  imageUrl: string;
  prompt: string;
  shots?: { id: string; description: string; imageUrl?: string; duration: number }[];
  planData?: {
    cameraAngle?: string;
    composition?: string;
    lighting?: string;
    colorTone?: string;
    characterAction?: string;
    transitionNote?: string;
  };
  /**
   * v2.12 Sprint A.1: Cameo Vision Auto-Retry 留下的可见痕迹。
   * UI (A.4 仪表盘) 直接消费这两个字段, 在分镜卡上绘红/黄/绿徽章。
   * 字段缺失代表"未评分", 不算坏 — 旧数据兼容。
   */
  cameoScore?: number;          // 0-100, vision 比对生成图与参考图的一致性分数
  cameoRetried?: boolean;       // 是否触发了重生 (一次重生上限)
  cameoAttempts?: number;       // 实际跑了几次生成 (1 = 首次成功, 2 = 重生过 1 次)
  cameoFinalCw?: number;        // 重生时实际使用的 cw, 调试用
  cameoReason?: string;         // 一句话说明 vision 给低分的理由 (来自 LLM)
}

// 视频片段
export interface VideoClip {
  id?: string;
  shotId?: string;
  shotNumber?: number;
  videoUrl: string;
  coverImageUrl?: string;   // 关键帧封面图 URL
  duration?: number;
  status?: 'pending' | 'generating' | 'completed' | 'error';
}

// 导演计划输出
export interface DirectorPlan {
  genre: string;
  style: string;
  characters: Character[];
  scenes: Scene[];
  storyStructure: {
    acts: number;
    totalShots: number;
  };
}

// ========== 新增：工作台相关类型 ==========

// 对话消息
export interface ChatMessage {
  id: string;
  projectId: string;
  agentRole: AgentRole;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;           // Agent 思考过程
  metadata?: {
    action?: string;           // 'regenerate_shot' | 'update_script' | 'review' 等
    assetId?: string;
    shotNumber?: number;
    [key: string]: any;
  };
  createdAt: string;
}

// 项目资产
export type AssetType = 'character' | 'scene' | 'storyboard' | 'video' | 'script' | 'music' | 'final_video' | 'timeline';

export interface ProjectAsset {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  data: Record<string, any>;   // 角色小传/场景描述/分镜描述等
  mediaUrls: string[];         // 图片/视频URL数组
  shotNumber?: number;         // 分镜/视频关联的镜头号
  version: number;
  confirmed?: boolean;         // 用户是否已确认该资产
  createdAt: string;
  updatedAt: string;
}

// 管线节点状态
export type PipelineNodeStatus = 'pending' | 'running' | 'completed' | 'error' | 'reviewing';

export interface PipelineNodeData {
  [key: string]: unknown;
  id: string;
  agentRole: AgentRole;
  label: string;
  status: PipelineNodeStatus;
  progress: number;
  assets: ProjectAsset[];
}

// 导演审核
export interface ReviewItem {
  shotNumber?: number;
  targetRole: AgentRole;       // 需要返工的环节
  issue: string;
  suggestion: string;
  severity: 'minor' | 'major' | 'critical';
}

export interface DirectorReview {
  id: string;
  projectId: string;
  overallScore: number;        // 1-10
  summary: string;
  items: ReviewItem[];
  status: 'pending' | 'accepted' | 'completed';
  createdAt: string;
}

// 完整项目（扩展）
export interface Project {
  id: string;
  userId: string;
  title: string;
  description?: string;
  coverUrls?: string[];
  status: string;
  scriptData?: Script;
  directorNotes?: DirectorReview;
  pipelineState?: PipelineNodeData[];
  // v2.0 新增字段
  mode?: CreationMode;                 // 创作模式
  executionMode?: ExecutionMode;       // 执行模式（托管/对话）
  styleId?: string;                    // 选中的风格预设 id
  globalAssetIds?: string[];           // 复用的全局资产 id 数组
  outputConfig?: ProjectOutputConfig;  // 输出配置（分辨率等）
  createdAt: string;
  updatedAt: string;
}

// ========== v2.0 新增：创作模式与输出配置 ==========

// 创作模式枚举
export type CreationMode =
  | 'episodic'         // 剧情短片
  | 'mv'               // 音乐 MV
  | 'quick'            // 快剪
  | 'comic-to-video'   // 漫转视频
  | 'ip-derivative';   // IP 衍生设计

// 执行模式（全局生效，工作台可切换）
export type ExecutionMode = 'managed' | 'dialogue';

// 分辨率档位（本期上限 720P）
export type ResolutionTier = '360p' | '480p' | '720p';

// 画面比例
export type AspectRatio = '16:9' | '9:16' | '1:1';

// 项目输出配置
export interface ProjectOutputConfig {
  resolution: ResolutionTier;
  aspectRatio: AspectRatio;
  targetDuration?: number;   // 目标总时长（秒）
}

// ========== v2.0 新增：全局资产记忆库 ==========

export type GlobalAssetType = 'character' | 'scene' | 'style' | 'prop';

export interface GlobalAsset {
  id: string;
  userId: string;
  type: GlobalAssetType;
  name: string;
  description: string;
  tags: string[];
  thumbnail: string;              // 缩略图 URL
  visualAnchors: string[];        // 3-5 个关键视觉特征（用于一致性 prompt 注入）
  embedding?: number[];            // 768 维特征向量（v2.1 接入真实 embedding）
  metadata: Record<string, any>;   // 类型特定数据（角色年龄/场景位置/风格 prompt 等）
  referencedByProjects: string[];  // 被哪些项目引用
  createdAt: string;
  updatedAt: string;
}

// ========== v2.0 新增：风格预设 ==========

export type StyleCategory = 'realistic' | 'anime' | 'artistic' | 'retro' | 'experimental';

// 引擎标识（与 services/*.service.ts 对齐）
export type VideoEngineId =
  | 'seedance2'
  | 'kling3'
  | 'viduq3'
  | 'veo31lite'
  | 'minimax'
  | 'vidu'
  | 'kling';

export interface StylePreset {
  id: string;
  name: string;                  // 中文名
  nameEn: string;                // 英文名
  category: StyleCategory;
  thumbnail: string;             // 缩略图相对路径 /styles/<id>.jpg
  promptFragment: string;        // 注入到生成 prompt 尾部的风格描述
  negativePrompt?: string;       // 可选负面描述
  recommendedEngine?: VideoEngineId;
  popularity: number;            // 0-100，用于默认排序
}

// ========== v2.0 新增：Beta 邀请码 ==========

export type InviteCodeStatus = 'unused' | 'used' | 'expired' | 'revoked';

export interface InviteCode {
  code: string;                  // 主键，如 BETAX3K9P
  source?: string;               // 渠道追踪："twitter" / "weixin" / "internal"
  status: InviteCodeStatus;
  usedByUserId?: string;
  usedAt?: string;
  expiresAt?: string;
  createdBy: string;             // 管理员 user id
  createdAt: string;
}

export type WaitlistStatus = 'pending' | 'approved' | 'rejected';

export interface WaitlistEntry {
  id: string;
  email: string;
  purpose: string;               // 申请用途说明
  source?: string;
  status: WaitlistStatus;
  approvedAt?: string;
  inviteCode?: string;           // 审批后绑定的邀请码
  createdAt: string;
}

// ========== v2.0 新增：成本日志 ==========

export interface CostLogEntry {
  id: string;
  userId: string;
  projectId?: string;
  engine: VideoEngineId;
  resolution: ResolutionTier;
  durationSec: number;
  costCNY: number;
  metadata?: Record<string, any>;
  createdAt: string;
}
