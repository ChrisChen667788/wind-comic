import OpenAI from 'openai';
import { API_CONFIG } from '@/lib/config';
import {
  Agent, AgentRole, DirectorPlan, Script, Storyboard, VideoClip, Character
} from '@/types/agents';
import { MinimaxService } from './minimax.service';
import { VeoService, hasVeo } from './veo.service';
import { MidjourneyService, hasMidjourney } from './midjourney.service';
import { KlingService, hasKling } from './kling.service';
import { FalFluxService, hasFalFlux } from './fal-flux.service';
import { ComfyUIService, hasComfyUI } from './comfyui.service';
import { XVerseService, hasXVerse, isXVersePrimary } from './xverse.service';
import {
  getDirectorSystemPrompt, getMcKeeWriterPrompt,
  getCharacterVisualPrompt, getSceneVisualPrompt, getStoryboardVisualPrompt,
  getStoryboardSketchPrompt, getMusicPromptForEmotion,
  getStoryboardPlannerPrompt, getUnifiedStoryboardRenderPrompt,
  getConsistencyEnforcementPrompt,
  validateDirectorOutput, validateWriterOutput,
} from '@/lib/mckee-skill';
import {
  isFullScriptInput, parseScript,
  getDirectorScriptContext, getWriterScriptContext,
  type ParsedScript,
} from '@/lib/script-parser';
import { optimizeMidjourneyPrompt } from '@/lib/prompt-filter';
import {
  enhanceCharacterPromptSeedance, enhanceScenePromptSeedance,
  buildProgressiveRefs, styleAnchorBlock,
} from '@/lib/seedance-enhance';
import {
  buildScreenwriterEnhanceUserBlock,
  inferVoiceFingerprintsFromCharacters,
  buildDefaultSceneBudgets,
} from '@/lib/screenwriter-enhance';
import {
  buildCharacterBible,
  renderCharacterBibleBlock,
  runContinuityAudit,
  buildAssetLedger,
  validateRuntimeBudget,
  validateRhythm,
  buildProducerEvaluationContext,
  type CharacterBibleEntry,
} from '@/lib/producer-enhance';
import { validateDirectorShotSpecs } from '@/lib/director-enhance';
import {
  buildMultiReferenceBundle,
  flattenBundleToUrls,
  applyCinemaToVisualPrompt,
  buildMusicVisualAnchor,
} from '@/lib/writer-enhance';
import { StoryTemplate } from '@/lib/story-templates';
import { createError, normalizeError, PipelineError } from '@/lib/pipeline-error';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { extractLastFrame, extractMiddleFrame } from '@/lib/last-frame-extractor';
import { deriveProsody } from '@/lib/tts-prosody';
import { getLatestQualityScore, buildWriterFeedbackHint } from '@/lib/quality-scores';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 把 base64 data URI 持久化到本地 tmp 文件，返回 /api/serve-file?path=... 的 URL。
 * 这样 SSE / Zustand 传输的只是一个短 URL 而不是几 MB 的 base64 字符串。
 */
function persistBase64ToFile(dataUri: string, label: string): string {
  try {
    const match = dataUri.match(/^data:image\/(\w+);base64,([\s\S]+)$/);
    if (!match) return dataUri; // 不是 base64 data URI，原样返回

    const ext = match[1] === 'svg+xml' ? 'svg' : (match[1] || 'png');
    const buf = Buffer.from(match[2], 'base64');
    const tmpDir = path.join(os.tmpdir(), 'qf-images');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, buf);
    console.log(`[ImagePersist] Saved ${(buf.length / 1024).toFixed(0)}KB → ${filePath}`);
    return `/api/serve-file?path=${encodeURIComponent(filePath)}`;
  } catch (e) {
    console.error('[ImagePersist] Failed to save base64:', e);
    return dataUri; // 失败则回退到原始 data URI
  }
}

/**
 * 判断 URL 是否为有效的可播放/可下载的视频地址
 * 支持 http(s) URL 和 /api/serve-file 本地代理 URL
 */
function isValidVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('http')) return true;
  if (url.startsWith('/api/serve-file')) return true;
  return false;
}

function mockSvg(w: number, h: number, c1: string, c2: string, label: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-family="system-ui" font-size="${Math.min(w, h) * 0.07}">${label}</text></svg>`)}`;
}

const hasLLM = !!API_CONFIG.openai.apiKey && !API_CONFIG.openai.apiKey.startsWith('your_');
const hasMinimax = !!API_CONFIG.minimax.apiKey && !API_CONFIG.minimax.apiKey.startsWith('your_');

// 进度回调类型
type ProgressCallback = (type: string, data: any) => void;

// ═══════════════════════════════════════════
// P2: 智能引擎路由 — 根据镜头类型自动选择最优引擎
// ═══════════════════════════════════════════
type VideoEngine = 'veo' | 'minimax' | 'kling';

interface EngineRouteResult {
  primary: VideoEngine;
  fallbacks: VideoEngine[];
  reason: string;
}

function routeVideoEngine(
  shotDescription: string,
  emotion: string,
  preferredEngine: string,
  availableEngines: VideoEngine[]
): EngineRouteResult {
  // 如果用户强制选择了引擎，优先使用
  if (preferredEngine && availableEngines.includes(preferredEngine as VideoEngine)) {
    const fallbacks = availableEngines.filter(e => e !== preferredEngine);
    return { primary: preferredEngine as VideoEngine, fallbacks, reason: '用户指定' };
  }

  const desc = (shotDescription + ' ' + emotion).toLowerCase();

  // 动作戏 → 可灵（运动理解强）
  if (desc.match(/打斗|追逐|爆炸|战斗|奔跑|跳跃|武|剑|拳|飞|combat|fight|action|chase|run/)) {
    const primary: VideoEngine = availableEngines.includes('kling') ? 'kling' : availableEngines[0];
    return { primary, fallbacks: availableEngines.filter(e => e !== primary), reason: '动作场景→可灵' };
  }

  // 风景/静态场景 → Veo（画质顶级）
  if (desc.match(/远景|全景|风景|山水|日落|星空|海洋|landscape|scenery|panorama|sunset|ocean/)) {
    const primary: VideoEngine = availableEngines.includes('veo') ? 'veo' : availableEngines[0];
    return { primary, fallbacks: availableEngines.filter(e => e !== primary), reason: '风景场景→Veo' };
  }

  // 人物对话/情感 → 海螺（角色一致性最强）
  if (desc.match(/对话|交谈|哭泣|拥抱|亲吻|表白|道别|dialogue|talk|cry|hug|emotion/)) {
    const primary: VideoEngine = availableEngines.includes('minimax') ? 'minimax' : availableEngines[0];
    return { primary, fallbacks: availableEngines.filter(e => e !== primary), reason: '情感对话→海螺' };
  }

  // 默认：按引擎可用性选择
  return {
    primary: availableEngines[0],
    fallbacks: availableEngines.slice(1),
    reason: '默认路由'
  };
}

// ═══════════════════════════════════════════
// P2: 指数退避重试策略
// ═══════════════════════════════════════════
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 5000,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 5s, 10s, 20s
        onRetry?.(attempt + 1, lastError);
        console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay / 1000}s: ${lastError.message}`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════
// P1: 角色视觉锚点系统 — 提取角色3个标志性视觉特征
// ═══════════════════════════════════════════
interface CharacterVisualAnchor {
  name: string;
  visualTags: string[];    // 3 key visual tags e.g. ["silver hair", "red cape", "scar on left cheek"]
  primaryImageUrl: string; // First generated image as reference
  appearance: string;      // Full appearance description
}

function extractVisualAnchors(characters: any[]): CharacterVisualAnchor[] {
  return characters.map(c => {
    const name = c.character || c.name || '';
    const appearance = c.appearance || c.description || '';
    const imageUrl = c.imageUrl || '';

    // Extract visual keywords from appearance description (支持中英文)
    const visualTags: string[] = [];

    // Hair (English + Chinese)
    const hairMatchEn = appearance.match(/([\w]+\s*(?:hair|ponytail|braid|bun))/i);
    const hairMatchCn = appearance.match(/([\u4e00-\u9fa5]*(?:发|头发|长发|短发|马尾|辫|银发|黑发|白发|红发|金发)[\u4e00-\u9fa5]*)/);
    if (hairMatchEn) visualTags.push(hairMatchEn[1]);
    else if (hairMatchCn) visualTags.push(hairMatchCn[1]);

    // Clothing (English + Chinese)
    const clothMatchEn = appearance.match(/([\w]+\s*(?:robe|dress|armor|coat|cape|suit|cloak|vest|jacket))/i);
    const clothMatchCn = appearance.match(/([\u4e00-\u9fa5]*(?:衣|袍|甲|裙|衫|长袍|铠甲|战袍|汉服|旗袍|西装)[\u4e00-\u9fa5]*)/);
    if (clothMatchEn) visualTags.push(clothMatchEn[1]);
    else if (clothMatchCn) visualTags.push(clothMatchCn[1]);

    // Distinctive feature (English + Chinese)
    const featureMatchEn = appearance.match(/(scar|tattoo|eyepatch|glasses|mark|earring|necklace|ring|crown)/i);
    const featureMatchCn = appearance.match(/(伤疤|纹身|眼罩|眼镜|胎记|耳环|项链|戒指|冠|面纱|面具|独眼)/);
    if (featureMatchEn) visualTags.push(featureMatchEn[1]);
    else if (featureMatchCn) visualTags.push(featureMatchCn[1]);

    // Pad to at least 3 tags from appearance words (split both by English and Chinese delimiters)
    const words = appearance.split(/[\s,，、;；.。]+/).filter((w: string) => w.length > 1 && w.length < 20);
    while (visualTags.length < 3 && words.length > 0) {
      const w = words.shift()!;
      if (!visualTags.includes(w)) visualTags.push(w);
    }

    return { name, visualTags: visualTags.slice(0, 3), primaryImageUrl: imageUrl, appearance };
  });
}

function buildCharacterAnchorPrompt(anchors: CharacterVisualAnchor[], shotCharacterNames: string[]): string {
  const relevantAnchors = anchors.filter(a => shotCharacterNames.includes(a.name));
  if (relevantAnchors.length === 0) return '';
  return relevantAnchors.map(a =>
    `[CHARACTER: ${a.name} — key features: ${a.visualTags.join(', ')}. ${a.appearance}]`
  ).join(' ');
}

export class HybridOrchestrator {
  private agents: Map<AgentRole, Agent>;
  private openai: OpenAI | null;
  private minimaxService: MinimaxService | null;
  private veoService: VeoService | null;
  private mjService: MidjourneyService | null;
  private klingService: KlingService | null;
  private falFluxService: FalFluxService | null;
  private comfyuiService: ComfyUIService | null;
  private xverseService: XVerseService | null;
  public onProgress?: ProgressCallback;

  // Pipeline intervention gate support
  private gateResolvers: Map<string, (data: any) => void> = new Map();

  // 存储创作过程中的风格关键词
  private styleKeywords: string = '';
  private genre: string = '';
  private characterImageUrls: string[] = []; // 角色图URL，用于 --cref/--sref 一致性

  // P1: 角色一致性增强
  private characterAnchors: CharacterVisualAnchor[] = [];
  private primaryCharacterRef: string = ''; // 第一个角色图URL，作为全局--cref基准
  // v2.9 P0 Cameo: 用户上传的主角脸参考图(锁死全片 IP,优先级高于 Character Designer 自动生成)
  // 一旦 lock=true,后续 Character Designer 不能覆盖它 —— 这是 Cameo 功能的核心语义
  private primaryCharacterRefLocked: boolean = false;
  // v2.12 Phase 2: 多角色锁脸 — 1-3 个角色,每个有自己的 name + role + cw + imageUrl。
  // pickConsistencyRefs 会按 shot.characters 匹配进来,命中即用该角色的 imageUrl 当 cref、
  // 用其 cw 当 --cw。比 primaryCharacterRef 优先级高(per-shot 路由 > 全局兜底)。
  private lockedCharacters: import('@/lib/consistency-policy').LockedCharacter[] = [];

  // v2.9 P1 Keyframes: 每个已生成 shot 的末帧持久化 URL(key = shotNumber)
  // 下一个 shot 会把 shotLastFrames.get(shotNumber - 1) 塞到 referenceImages
  // 让 video 模型把上一条 clip 的收尾姿态/光影当作本条的起点 —— 跨 shot 连续性
  private shotLastFrames: Map<number, string> = new Map();

  // v2.11 #3 智能插帧:全局风格锚点(中间帧)
  // 选一个"成熟"shot 的 middle frame 作为全片基调参考,挂在每个 shot 的 ref 里。
  // 防止 shotLastFrames 链式传递 N 次后出现的"第 10 shot 跟第 1 shot 像两部片"漂移。
  // 刷新策略:shot 1 完成就首次设置,之后每 3 shots 用最新中间帧覆盖一次(drift correction)
  private globalAnchorFrame: string = '';

  // v2.11 #4 Writer-Editor 闭环:projectId 注入后,Writer 可以查询本项目上一轮评分,
  // 对"分<70 的维度"注入针对性 cue。Editor 成片后也会把评分写回这个 projectId。
  private projectId: string = '';

  // Story template for guided generation
  private template: StoryTemplate | null = null;

  // P4: 渐进式一致性链 — 存储已渲染的分镜图URL，作为后续镜头的额外参考
  private renderedStoryboardUrls: string[] = [];

  // Parsed script data (when user provides a full script)
  private parsedScript: ParsedScript | null = null;

  // Character appearance map for consistency enforcement
  private characterAppearanceMap: Record<string, string> = {};

  // v2.7: Character Bible — 制片人持有的跨 shot 一致性档案
  private characterBible: CharacterBibleEntry[] = [];

  setTemplate(template: StoryTemplate) {
    this.template = template;
    console.log(`[Hybrid] Story template set: ${template.name} (${template.id})`);
  }

  /** 测试用：注入 XVerse 服务（生产请勿使用） */
  __setXVerseService(service: XVerseService | null): void {
    this.xverseService = service;
  }

  /** 读取某个 agent 的当前状态（测试 / 调试用） */
  getAgentState(role: AgentRole): Agent | undefined {
    return this.agents.get(role);
  }

  /**
   * v2.9 P0 Cameo: 项目级主角脸锁(从 projects.primary_character_ref 读入)。
   *
   * 必须在 runCharacterDesigner 之前调用,否则会被 Character Designer 的自动
   * 首帧覆盖。设置之后,整个 pipeline 的每个 shot 都会把这张图塞到
   * subject_reference[0],配合 Character Bible 把角色 ID 死死锁住。
   */
  setPrimaryCharacterRef(url: string) {
    if (!url) return;
    this.primaryCharacterRef = url;
    this.primaryCharacterRefLocked = true;
    console.log(`[Cameo] Primary character face locked from user: ${url.slice(0, 60)}...`);
  }

  /**
   * v2.12 Phase 2: 注入用户在创作工坊预先锁定的 1-3 个角色。
   * 必须在 runCharacterDesigner 之前调用 — pickConsistencyRefs 会优先按
   * shot.characters 匹配名字,命中就用该角色自己的 imageUrl + cw,不再统一用
   * primaryCharacterRef(那是单角色 Phase 1 的兜底)。
   *
   * Phase 2 行为:per-shot 路由,每个镜头根据出场角色名匹配独立 cref。
   * Phase 3 (待):Cameo retry 也按命中角色独立评分,而非统一用 primary。
   */
  setLockedCharacters(arr: Array<{ name: string; role: string; cw: number; imageUrl: string }>) {
    if (!Array.isArray(arr)) return;
    const allowed: Array<'lead' | 'antagonist' | 'supporting' | 'cameo'> = ['lead', 'antagonist', 'supporting', 'cameo'];
    this.lockedCharacters = arr
      .filter(c => c && typeof c.name === 'string' && c.name.trim() && typeof c.imageUrl === 'string' && c.imageUrl)
      .slice(0, 3)
      .map(c => ({
        name: c.name.trim().slice(0, 40),
        role: (allowed as string[]).includes(c.role) ? (c.role as 'lead' | 'antagonist' | 'supporting' | 'cameo') : 'lead',
        cw: Number.isFinite(c.cw) ? Math.max(25, Math.min(125, Math.round(c.cw))) : 100,
        imageUrl: c.imageUrl,
      }));
    if (this.lockedCharacters.length > 0) {
      console.log(`[Cameo] ${this.lockedCharacters.length} locked character(s) registered: ${this.lockedCharacters.map(c => `${c.name}(${c.role}/cw=${c.cw})`).join(', ')}`);
    }
  }

  /**
   * v2.11 #4: 注入 projectId,让 Writer 能查上次评分 + Editor 能把本次评分写回表。
   * 必须在 runWriter 之前调用,否则 Writer 拿不到历史评分(等同于第一次跑)。
   */
  setProjectId(id: string) {
    if (!id) return;
    this.projectId = id;
  }

  getProjectId(): string {
    return this.projectId;
  }

  // ── 用户选定画风 → 覆盖自动检测 ──
  private userSelectedStyle: string = '';
  setUserStyle(style: string) {
    this.userSelectedStyle = style;
    // 将画风 ID 映射为 prompt 关键词（用于所有图片/视频生成）
    const styleMap: Record<string, { keywords: string; genre: string }> = {
      'Poetic Mist':  { keywords: 'ethereal Chinese watercolor ink wash painting, misty soft diffused light, delicate brush strokes, muted pastels', genre: '诗意水墨' },
      'Neo Noir':     { keywords: 'film noir cinematic, high contrast chiaroscuro lighting, dark moody shadows, rain-soaked atmosphere, dramatic silhouettes', genre: '黑色悬疑' },
      'Ink Wash':     { keywords: 'traditional Chinese sumi-e ink painting, minimal brushwork, flowing ink gradients, rice paper texture, Song Dynasty style', genre: '水墨丹青' },
      'Dreamwave':    { keywords: 'surreal dreamscape, vaporwave iridescent gradients, pastel neon purple and pink, dreamy soft focus, otherworldly', genre: '梦境幻想' },
      'Cyber Neon':   { keywords: 'cyberpunk neon-lit cityscape, holographic glowing circuitry, electric blue and magenta, futuristic sci-fi, blade runner style', genre: '赛博科幻' },
      'Anime 3D':     { keywords: 'high-quality 3D donghua Chinese animation, dramatic volumetric lighting, CG animation, ornate detailed characters', genre: '3D国创' },
      'Cinematic':    { keywords: 'photorealistic cinematic wide shot, Roger Deakins cinematography, anamorphic lens, film grain 35mm, epic scale', genre: '电影写实' },
      'Ghibli':       { keywords: 'Studio Ghibli hand-painted watercolor animation, warm golden light, whimsical pastoral, Hayao Miyazaki style, gentle and cozy', genre: '吉卜力' },
    };
    const matched = styleMap[style];
    if (matched) {
      this.styleKeywords = matched.keywords;
      this.genre = matched.genre;
      console.log(`[Hybrid] User style applied: ${style} → keywords="${this.styleKeywords.slice(0, 60)}..."`);
    } else {
      console.log(`[Hybrid] Unknown style "${style}", will use auto-detect`);
    }
  }

  constructor() {
    this.agents = new Map();
    this.openai = hasLLM ? new OpenAI({ apiKey: API_CONFIG.openai.apiKey, baseURL: API_CONFIG.openai.baseURL, timeout: 180_000, maxRetries: 1 }) : null;
    this.minimaxService = hasMinimax ? new MinimaxService() : null;
    this.veoService = hasVeo() ? new VeoService() : null;
    this.mjService = hasMidjourney() ? new MidjourneyService() : null;
    this.klingService = hasKling() ? new KlingService() : null;
    this.falFluxService = hasFalFlux() ? new FalFluxService() : null;
    this.comfyuiService = hasComfyUI() ? new ComfyUIService() : null;
    this.xverseService = hasXVerse() ? new XVerseService() : null;
    this.initializeAgents();
    const minimaxCaps: string[] = [];
    if (this.minimaxService?.isImageAvailable()) minimaxCaps.push('IMG');
    if (this.minimaxService?.isVideoAvailable()) minimaxCaps.push('VID');
    if (this.minimaxService) minimaxCaps.push('TTS');
    const minimaxLabel = this.minimaxService
      ? (minimaxCaps.length > 0 ? minimaxCaps.join('+') : 'TTS-ONLY')
      : 'OFF';
    console.log(`[Hybrid] LLM: ${this.openai ? 'Claude' : 'OFF'}, MJ: ${this.mjService ? 'ON' : 'OFF'}, Minimax: ${minimaxLabel}, Veo: ${this.veoService ? 'ON' : 'OFF'}, Kling: ${this.klingService ? 'ON' : 'OFF'}, FalFlux: ${this.falFluxService ? 'ON' : 'OFF'}, ComfyUI: ${this.comfyuiService ? 'ON' : 'OFF'}, XVerse: ${this.xverseService ? (isXVersePrimary() ? 'PRIMARY' : 'FALLBACK') : 'OFF'}`);
  }

  private initializeAgents() {
    const a = (role: AgentRole, id: string, name: string, avatar: string): [AgentRole, Agent] =>
      [role, { id, role, name, avatar, status: 'idle' as const, progress: 0 }];
    this.agents = new Map([
      a(AgentRole.DIRECTOR, 'director-001', '张导', '/avatars/beaver-crown.jpg'),
      a(AgentRole.WRITER, 'writer-001', '李编剧', '/avatars/beaver-happy.jpg'),
      a(AgentRole.CHARACTER_DESIGNER, 'character-001', '王设计师', '/avatars/frog-3d.jpg'),
      a(AgentRole.SCENE_DESIGNER, 'scene-001', '陈场景师', '/avatars/beaver-sleepy.jpg'),
      a(AgentRole.STORYBOARD, 'storyboard-001', '赵分镜师', '/avatars/frog-cartoon.jpg'),
      a(AgentRole.VIDEO_PRODUCER, 'video-001', '孙制作', '/avatars/frog-3d.jpg'),
      a(AgentRole.EDITOR, 'editor-001', '周剪辑', '/avatars/beaver-crown.jpg'),
      a(AgentRole.PRODUCER, 'producer-001', '钱制片', '/avatars/frog-cartoon.jpg'),
    ]);
  }

  getAllAgents(): Agent[] { return Array.from(this.agents.values()); }

  private update(role: AgentRole, u: Partial<Agent>) {
    const a = this.agents.get(role);
    if (a) Object.assign(a, u);
  }

  private emit(type: string, data: any) {
    this.onProgress?.(type, data);
  }

  // Called by the API route when user approves/edits at a gate
  resolveGate(gateId: string, data: any) {
    const resolver = this.gateResolvers.get(gateId);
    if (resolver) {
      resolver(data);
      this.gateResolvers.delete(gateId);
    }
  }

  // Wait for user at an intervention gate
  async waitForGate(gateId: string, gateData: any): Promise<any> {
    this.emit('gate', { gateId, ...gateData });
    return new Promise((resolve) => {
      this.gateResolvers.set(gateId, resolve);
      // Auto-continue after 5 minutes timeout
      setTimeout(() => {
        if (this.gateResolvers.has(gateId)) {
          this.gateResolvers.delete(gateId);
          resolve({ action: 'continue' });
        }
      }, 5 * 60 * 1000);
    });
  }

  // ── Claude LLM 调用（带超时和心跳）──
  // 关键修复: 使用子进程运行 LLM 调用，绕过 Next.js Turbopack 运行时的 fetch 阻塞问题
  private async callLLM(systemPrompt: string, userMessage: string, json = true, useCreativeModel = false): Promise<string> {
    if (!API_CONFIG.openai.apiKey) return '';

    const model = useCreativeModel ? API_CONFIG.openai.creativeModel : API_CONFIG.openai.model;
    const callId = `llm-${Date.now()}`;
    console.log(`[LLM:${callId}] 开始调用 | model=${model} | system=${systemPrompt.length}chars, user=${userMessage.length}chars, json=${json}`);

    // 心跳：每 8 秒发一次进度
    const heartbeat = setInterval(() => {
      this.emit('heartbeat', { message: 'LLM 正在思考...' });
      console.log(`[LLM:${callId}] ⏳ 等待中...`);
    }, 8000);

    const LLM_TIMEOUT = 150_000;

    try {
      const finalSystem = json
        ? systemPrompt + '\n\n重要：直接输出纯 JSON，不要用 ```json 等 markdown 代码块包裹。'
        : systemPrompt;

      let finalUser = userMessage;
      if (finalUser.length > 30000) {
        console.warn(`[LLM:${callId}] user message 过长(${finalUser.length}), 截断`);
        finalUser = finalUser.slice(0, 30000) + '\n\n[... 已截断 ...]';
      }

      const startTime = Date.now();

      // ═══ 通过子进程运行 fetch（绕过 Next.js Turbopack 对长请求的阻塞）═══
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      const cwd = process.cwd();
      const scriptPath = [cwd, 'scripts', 'llm-call.mjs'].join(path.sep);
      const input = JSON.stringify({
        baseURL: API_CONFIG.openai.baseURL,
        apiKey: API_CONFIG.openai.apiKey,
        model,
        system: finalSystem,
        user: finalUser,
        maxTokens: 4096,
        timeout: LLM_TIMEOUT,
      });

      const result = await new Promise<string>((resolve, reject) => {
        const child = execFile('node', [scriptPath], {
          timeout: LLM_TIMEOUT + 10_000, // 子进程超时比内部超时多 10s
          maxBuffer: 10 * 1024 * 1024,    // 10MB
          env: { ...process.env },
        }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(err.killed ? 'timeout' : (err.message || String(err))));
            return;
          }
          resolve(stdout);
        });
        // 通过 stdin 传入请求数据
        child.stdin?.write(input);
        child.stdin?.end();
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      let parsed: any;
      try {
        parsed = JSON.parse(result);
      } catch {
        console.error(`[LLM:${callId}] ❌ 子进程输出解析失败 | ${elapsed}s | ${result.slice(0, 200)}`);
        return '';
      }

      if (!parsed.ok) {
        const errMsg = parsed.error || 'unknown error';
        console.error(`[LLM:${callId}] ❌ ${errMsg} | ${elapsed}s`);
        if (errMsg.includes('insufficient_quota') || errMsg.includes('quota')) {
          this.emit('status', { message: '⚠️ LLM API 余额不足，请充值后重试' });
          this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: '❌ API 余额不足，无法继续创作。' });
        } else if (errMsg === 'timeout') {
          this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `LLM 响应超时，跳过此步骤...` });
        } else {
          this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `LLM 出错: ${errMsg.slice(0, 80)}` });
        }
        return '';
      }

      let content = parsed.content || '';
      console.log(`[LLM:${callId}] ✅ 完成 | ${elapsed}s | 响应=${content.length}chars`);

      // 清理 markdown 代码块包裹
      if (json && content) {
        content = content.trim();
        content = content.replace(/^```(?:json)?\s*\n?/, '');
        content = content.replace(/\n?\s*```\s*$/, '');
        content = content.trim();
      }

      return content;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      if (errMsg.includes('timeout')) {
        console.error(`[LLM:${callId}] ❌ 请求超时 (${LLM_TIMEOUT / 1000}s)`);
        this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `LLM 响应超时，跳过此步骤...` });
      } else {
        console.error(`[LLM:${callId}] ❌ 调用失败:`, errMsg);
        this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `LLM 出错: ${errMsg.slice(0, 80)}` });
      }
      return '';
    } finally {
      clearInterval(heartbeat);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 图片生成 — 智能路由（2026-04 Minimax 官方优先版）
  //
  // 引擎可用性（实测验证）：
  //   ✅ Minimax 官方 image-01          — 直接返回 URL，速度快，优先使用
  //   ✅ vectorengine MJ (mj_imagine)   — 画质最佳
  //   ✅ vectorengine flux.1-kontext-pro — 稳定，支持参考图
  //   ✅ qingyuntop（新 key）           — 备选 fallback
  //
  // 路由策略（MJ 画质最佳，Minimax 做 fallback）：
  //   无参考图 → MJ → Minimax image-01 → flux.1-kontext-pro
  //   有参考图 → MJ(--cref) → Minimax image-01 → flux.1-kontext-pro
  // ═══════════════════════════════════════════════════════════════════
  private async generateImage(prompt: string, opts?: {
    aspectRatio?: string; label?: string;
    cref?: string; sref?: string; cw?: number;
    referenceImages?: string[];
  }): Promise<string> {
    const hasRefImages = !!(opts?.cref || opts?.sref || opts?.referenceImages?.length);
    const label = opts?.label || 'image';
    const veKey = API_CONFIG.openai.apiKey;
    const veBase = 'https://api.vectorengine.ai';
    const qytKey = API_CONFIG.qingyuntop.apiKey;
    const qytBase = API_CONFIG.qingyuntop.baseURL;

    // vectorengine / qingyuntop 通用 OpenAI 兼容图片生成
    const apiImage = async (model: string, apiBase: string, apiKey: string, size?: string): Promise<string> => {
      const sizeMap: Record<string, Record<string, string>> = {
        'flux.1-kontext-pro': { '16:9': '1024x1024', '9:16': '1024x1024', '1:1': '1024x1024' },
      };
      const finalSize = size || sizeMap[model]?.[opts?.aspectRatio || '16:9'] || '1024x1024';
      const gateway = apiBase.includes('vectorengine') ? 'vectorengine' : 'qingyuntop';
      console.log(`[ImageRouter] → ${gateway} ${model} (${finalSize}) for: ${label}`);

      const res = await fetch(`${apiBase}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, size: finalSize }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw createError('ENGINE_FAILED', `${model} 图像生成失败 (${res.status})`, {
          stage: 'storyboard',
          retryable: true,
          details: { status: res.status, body: errBody.slice(0, 120), model, label },
        });
      }

      const json = await res.json();
      if (json.data?.[0]?.b64_json) {
        console.log(`[ImageRouter] ✅ ${model} (base64) for: ${label}`);
        const dataUri = `data:image/png;base64,${json.data[0].b64_json}`;
        return persistBase64ToFile(dataUri, `${model}-${label}`);
      }
      if (json.data?.[0]?.url) {
        console.log(`[ImageRouter] ✅ ${model} succeeded for: ${label}`);
        return json.data[0].url;
      }
      throw createError('INVALID_RESPONSE', `${model} 未返回图像 URL`, {
        stage: 'storyboard', retryable: true, details: { model, label },
      });
    };

    // flux.1-kontext-pro（参考图一致性最佳）
    const kontextImage = async (base: string, key: string): Promise<string> => {
      const gateway = base.includes('vectorengine') ? 'vectorengine' : 'qingyuntop';
      console.log(`[ImageRouter] → ${gateway} flux.1-kontext-pro for: ${label}`);
      const refUrls: string[] = [...(opts?.referenceImages || [])];
      if (opts?.cref && !refUrls.includes(opts.cref)) refUrls.push(opts.cref);
      if (opts?.sref && !refUrls.includes(opts.sref)) refUrls.push(opts.sref);
      const validRefs = refUrls.filter(u => u.startsWith('http')).slice(0, 4);
      const refHint = validRefs.length > 0 ? ` [Reference images: ${validRefs.join(' , ')}]` : '';

      const res = await fetch(`${base}/v1/images/generations`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'flux.1-kontext-pro', prompt: prompt + refHint, n: 1, size: '1024x1024' }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw createError('ENGINE_FAILED', `flux.1-kontext-pro 失败 (${res.status})`, {
          stage: 'storyboard', retryable: true,
          details: { status: res.status, body: errBody.slice(0, 120), label },
        });
      }

      const json = await res.json();
      if (json.data?.[0]?.b64_json) {
        console.log(`[ImageRouter] ✅ flux.1-kontext-pro (base64) for: ${label}`);
        return persistBase64ToFile(`data:image/png;base64,${json.data[0].b64_json}`, `kontext-${label}`);
      }
      if (json.data?.[0]?.url) {
        console.log(`[ImageRouter] ✅ flux.1-kontext-pro succeeded for: ${label}`);
        return json.data[0].url;
      }
      throw createError('INVALID_RESPONSE', 'flux.1-kontext-pro 未返回图像 URL', {
        stage: 'storyboard', retryable: true, details: { label },
      });
    };

    // ═══ 统一路由：MJ 优先（画质最佳）→ Minimax image-01 → flux.1-kontext-pro ═══
    // 实测结论：之前版本效果好就是因为 MJ 出图质量高，Minimax image-01 速度快但风格偏弱，
    // flux.1-kontext-pro 作为最终兜底（100% 可用但质量一般）
    console.log(`[ImageRouter] ${hasRefImages ? 'Reference' : 'Standard'} routing for: ${label}`);

    // 1️⃣ Midjourney（vectorengine，画质最佳，有参考图时用 --cref/--sref）
    if (this.mjService) {
      try {
        if (hasRefImages) {
          console.log(`[ImageRouter] → Midjourney (--cref/--sref) for: ${label}`);
          this.mjService.onProgress = (progress, status) => { this.emit('mjProgress', { progress, status, label }); };
          return await this.mjService.generateImage(prompt, {
            aspectRatio: opts?.aspectRatio, cref: opts?.cref, sref: opts?.sref, cw: opts?.cw ?? 100,
          });
        } else {
          console.log(`[ImageRouter] → Midjourney for: ${label}`);
          this.mjService.onProgress = (progress, status) => { this.emit('mjProgress', { progress, status, label }); };
          return await this.mjService.generateImage(prompt, { aspectRatio: opts?.aspectRatio });
        }
      } catch (e) { console.warn(`[ImageRouter] MJ failed for ${label}:`, e); }
    }

    // 2️⃣ Minimax image-01 官方 API（MJ 失败时的主 fallback）
    if (this.minimaxService?.isImageAvailable()) {
      try {
        console.log(`[ImageRouter] → Minimax image-01 for: ${label}`);
        return await this.minimaxService.generateImage(prompt, { aspectRatio: opts?.aspectRatio || '16:9' });
      } catch (e) { console.warn(`[ImageRouter] Minimax image-01 failed for ${label}:`, e instanceof Error ? e.message : e); }
    }

    // 3️⃣ vectorengine flux.1-kontext-pro（终极兜底，100% 可用）
    if (veKey) {
      try { return hasRefImages ? await kontextImage(veBase, veKey) : await apiImage('flux.1-kontext-pro', veBase, veKey); }
      catch (e) { console.warn(`[ImageRouter] flux-kontext failed for ${label}:`, e instanceof Error ? e.message : e); }
    }

    // 4️⃣ qingyuntop flux.1-kontext-pro（二级备选）
    if (qytKey) {
      try { return hasRefImages ? await kontextImage(qytBase, qytKey) : await apiImage('flux.1-kontext-pro', qytBase, qytKey); }
      catch (e) { console.warn(`[ImageRouter] qyt flux-kontext failed for ${label}:`, e instanceof Error ? e.message : e); }
    }

    // 5️⃣ fal.ai / ComfyUI（本地）
    if (this.falFluxService) {
      try {
        const refImages: string[] = [...(opts?.referenceImages || [])];
        if (opts?.cref) refImages.push(opts.cref);
        if (opts?.sref) refImages.push(opts.sref);
        return await this.falFluxService.generateImage(prompt, {
          referenceImages: refImages.slice(0, 4),
          aspectRatio: (opts?.aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4') || '16:9',
        });
      } catch (e) { console.warn(`[ImageRouter] FalFlux failed for ${label}:`, e); }
    }
    if (this.comfyuiService && hasRefImages) {
      try {
        return await this.comfyuiService.generateWithIPAdapter(prompt, {
          characterRefImage: opts?.cref, sceneRefImage: opts?.sref,
          consistencyMode: opts?.cref ? 'full_character' : 'style_transfer',
          width: 1344, height: 768,
        });
      } catch (e) { console.warn(`[ImageRouter] ComfyUI failed for ${label}:`, e); }
    }

    // 最后备用：Mock SVG
    console.warn(`[ImageRouter] All engines failed, using mock for: ${label}`);
    await sleep(800);
    return mockSvg(1024, 576, '#1e1b4b', '#7c3aed', label);
  }

  // ══════════════════════════════════════
  // 导演（Claude LLM）
  // ══════════════════════════════════════
  async runDirector(idea: string): Promise<DirectorPlan> {
    this.update(AgentRole.DIRECTOR, { status: 'thinking', currentTask: '分析创意，制定拍摄计划', progress: 10 });

    // ── P3: 检测是否为完整剧本输入 ──
    const isScript = isFullScriptInput(idea);
    if (isScript) {
      this.parsedScript = parseScript(idea);
      console.log(`[Director] 检测到完整剧本输入！${this.parsedScript.stats.sceneCount}个场景, ${this.parsedScript.stats.characterCount}个角色, ${this.parsedScript.stats.dialogueCount}句台词`);
      this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `检测到完整剧本！${this.parsedScript.stats.sceneCount}个场景、${this.parsedScript.stats.characterCount}个角色，正在深度解析...📖` });
    } else {
      this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: '让我看看这个创意...🤔' });
    }

    let plan: DirectorPlan;

    if (this.openai) {
      this.update(AgentRole.DIRECTOR, { progress: 30 });

      // 根据是否为完整剧本，构建不同的用户提示
      let userPrompt: string;
      if (this.parsedScript) {
        const scriptContext = getDirectorScriptContext(this.parsedScript);
        const directorTemplateHint = this.template
          ? `\n\n【故事模板】类型：${this.template.name}（${this.template.category}）；风格推荐：${this.template.styleRecommendation}；镜头数量建议：${this.template.shotCount.min}~${this.template.shotCount.max}个`
          : '';
        userPrompt = `${scriptContext}${directorTemplateHint}`;
      } else {
        const directorTemplateHint = this.template
          ? `\n\n【故事模板】类型：${this.template.name}（${this.template.category}）；风格推荐：${this.template.styleRecommendation}；镜头数量建议：${this.template.shotCount.min}~${this.template.shotCount.max}个`
          : '';
        userPrompt = `用户创意：${idea}${directorTemplateHint}`;
      }

      // 注入用户选定画风到 Director 提示中
      if (this.userSelectedStyle) {
        userPrompt += `\n\n【重要：用户指定画风】用户已选定画风为"${this.userSelectedStyle}"（${this.genre}），你的所有视觉描述、角色设计、场景设计必须严格遵循此画风。styleKeywords 必须包含: ${this.styleKeywords}`;
      }

      // 构建导演 system prompt（传入适配模式参数）
      const directorSystemPrompt = getDirectorSystemPrompt(this.parsedScript ? {
        isScriptAdaptation: true,
        parsedCharacterCount: this.parsedScript.stats.characterCount,
        parsedSceneCount: this.parsedScript.stats.sceneCount,
      } : undefined);

      const raw = await this.callLLM(directorSystemPrompt, userPrompt, true, true);
      this.update(AgentRole.DIRECTOR, { progress: 70 });

      try {
        const parsed = JSON.parse(raw);
        plan = parsed as DirectorPlan;
        // 仅当用户未选定画风时，才使用 LLM 返回的风格
        if (!this.userSelectedStyle) {
          this.styleKeywords = parsed.styleKeywords || '';
          this.genre = parsed.genre || '';
        }

        // ── P3: 输出质量验证 + 自动修正 ──
        const validation = validateDirectorOutput(parsed);
        if (!validation.passed) {
          console.log(`[Director] 输出验证未通过 (${validation.issues.length}个问题)，请求修正...`);
          this.update(AgentRole.DIRECTOR, { currentTask: '检查质量标准，补充不足内容', progress: 80 });
          this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `自检发现${validation.issues.length}处不达标，正在修正...🔧` });

          try {
            const fixRaw = await this.callLLM(
              directorSystemPrompt,
              `你之前的输出存在以下问题：\n${validation.fixInstructions}\n\n原始输出：\n${raw}\n\n请修正以上所有问题，输出完整的修正后JSON。`
            );
            const fixedPlan = JSON.parse(fixRaw);
            plan = fixedPlan as DirectorPlan;
            if (!this.userSelectedStyle) {
              this.styleKeywords = fixedPlan.styleKeywords || this.styleKeywords;
              this.genre = fixedPlan.genre || this.genre;
            }
            console.log('[Director] 修正完成');
          } catch {
            console.warn('[Director] 修正失败，使用原始输出');
          }
        }

        // 存储角色外观映射，供一致性系统使用
        if (plan.characters) {
          for (const char of plan.characters) {
            if (char.appearance) {
              this.characterAppearanceMap[char.name] = char.appearance;
            }
          }
        }
      } catch {
        console.error('[Director] JSON parse failed, using fallback');
        plan = this.fallbackDirectorPlan(idea);
      }
    } else {
      await sleep(1500);
      plan = this.fallbackDirectorPlan(idea);
    }

    // ═══ v2.7: 构建 Character Bible — 跨 shot 一致性档案 ═══
    // 把 Director plan 的 characters 压缩为 CharacterBibleEntry[]，
    // 每次下游 agent 生图/审核时可 renderCharacterBibleBlock 注入 prompt，
    // 保证角色英文 anchor / 配色 / 标志道具 跨 shot 不漂移。
    if (plan.characters?.length) {
      this.characterBible = buildCharacterBible(plan.characters);
      console.log(`[Director] Character Bible 生成: ${this.characterBible.length} 条`);
    }

    // ═══ v2.7: ShotBench 8 维规格校验(soft warn,不阻塞) ═══
    // 只有当 Director 输出了 shots 数组时才校验(有些 plan 只有 characters+scenes 没有 shots)
    try {
      const specValidation = validateDirectorShotSpecs(plan);
      if (!specValidation.passed && specValidation.issues.length > 0) {
        console.log(`[Director] ShotSpec 校验提示 (${specValidation.issues.length}项):`);
        specValidation.issues.slice(0, 3).forEach((i) => console.log(`  · ${i}`));
      }
    } catch {
      // 静默失败 — plan 结构可能还没到 shots 阶段
    }

    this.update(AgentRole.DIRECTOR, { status: 'completed', progress: 100, output: plan });
    this.emit('agentTalk', { role: AgentRole.DIRECTOR, text: `计划定了！${plan.genre}风格，${plan.characters.length}个角色，开拍！🎬` });
    return plan;
  }

  private fallbackDirectorPlan(idea: string): DirectorPlan {
    const isAncient = /古|秦|唐|宋|明|清|朝|宫|侠|武|仙|修/.test(idea);
    const isCyber = /赛博|科幻|未来|机器|AI|太空/.test(idea);
    // 仅当用户未选定画风时，才自动检测
    if (!this.userSelectedStyle) {
      this.genre = isAncient ? '古装历史' : isCyber ? '赛博科幻' : '现代剧情';
      this.styleKeywords = isAncient ? 'cinematic 3D Chinese animation style' : isCyber ? 'cyberpunk neon style' : 'cinematic realistic style';
    }

    // 如果有解析过的剧本数据，使用剧本中的角色和场景（而非写死2个角色+2个场景）
    if (this.parsedScript) {
      // 从类型推断中获取年代背景
      const detectedGenre = this.parsedScript.genreHints[0] || this.genre || '';
      const isAncientScript = /古|侠|武|仙|修|朝|宫|唐|宋|明|清|秦/.test(detectedGenre + this.parsedScript.rawText.slice(0, 500));
      const isCyberScript = /赛博|科幻|未来|机器|AI|太空/.test(detectedGenre + this.parsedScript.rawText.slice(0, 500));
      const eraPrefix = isAncientScript ? '古装人物，身着传统汉服/古装服饰，' :
                         isCyberScript ? '未来科幻人物，赛博朋克服饰，' : '';
      const eraAppearance = isAncientScript
        ? 'ancient Chinese character, traditional hanfu clothing, historical hairstyle, NO modern clothing NO hoodie NO sneakers NO cap, '
        : isCyberScript
        ? 'cyberpunk futuristic character, high-tech sci-fi outfit, '
        : '';

      const characters = this.parsedScript.characters.map(c => ({
        name: c.name,
        description: `${eraPrefix}${c.descriptionHints.join('；') || `${c.name}，台词${c.dialogueCount}句`}`,
        appearance: `${eraAppearance}${c.descriptionHints.join('; ') || c.name}`,
      }));
      const scenes = this.parsedScript.scenes.slice(0, 15).map((s, i) => {
        // 构建场景描述：以「地点（时间）」为标题 + 核心氛围
        const timeLabel = s.timeOfDay ? `（${s.timeOfDay}）` : '';
        const emotionLabel = s.emotionalArc ? `，氛围：${s.emotionalArc}` : '';
        // 从动作中提取环境描写（过滤掉角色对白/动作，只保留场景氛围描写）
        const envActions = s.actions
          .filter(a => a.length > 6 && !a.match(/^[\u4e00-\u9fa5]{1,4}[：:]/))
          .slice(0, 2);
        const envDesc = envActions.length > 0 ? `。${envActions.join('；')}` : '';
        return {
          id: s.id || `s${i + 1}`,
          description: `${s.location}${timeLabel}${emotionLabel}${envDesc}`,
          location: s.location || `场景${i + 1}`,
        };
      });
      const totalShots = Math.max(4, Math.min(scenes.length, 20));
      console.log(`[Director] Fallback using parsed script: ${characters.length} characters, ${scenes.length} scenes, ${totalShots} shots`);
      return {
        genre: this.parsedScript.genreHints[0] || this.genre,
        style: isAncient ? '3D国创画风' : isCyber ? '赛博霓虹' : '电影写实',
        characters: characters.length > 0 ? characters : [
          { name: '主角', description: `${idea.slice(0, 20)}中的核心人物`, appearance: '' },
        ],
        scenes: scenes.length > 0 ? scenes : [
          { id: 's1', description: '开场远景', location: '主场景' },
        ],
        storyStructure: { acts: 3, totalShots },
      };
    }

    return {
      genre: this.genre,
      style: isAncient ? '3D国创画风' : isCyber ? '赛博霓虹' : '电影写实',
      characters: [
        { name: '主角', description: `${idea.slice(0, 20)}中的核心人物`, appearance: '' },
        { name: '伙伴', description: '主角的忠实伙伴', appearance: '' },
      ],
      scenes: [
        { id: 's1', description: '开场远景', location: '主场景' },
        { id: 's2', description: '冲突场所', location: '关键场所' },
      ],
      storyStructure: { acts: 3, totalShots: 4 },
    };
  }

  // ══════════════════════════════════════
  // 编剧（Claude LLM + 麦基方法论）
  // ══════════════════════════════════════
  async runWriter(plan: DirectorPlan): Promise<Script> {
    this.update(AgentRole.WRITER, { status: 'working', currentTask: '运用麦基方法论创作剧本', progress: 10 });

    if (this.parsedScript) {
      this.emit('agentTalk', { role: AgentRole.WRITER, text: '基于原始剧本进行改编，保留核心情节和对白精华...✍️' });
    } else {
      this.emit('agentTalk', { role: AgentRole.WRITER, text: '三幕结构、人物弧光...让我好好构思 ✍️' });
    }

    let script: Script;

    // ─────────────────────────────────────────
    // XVERSE-Ent 路径（开源 MoE 编剧模型）
    // 仅当 XVERSE_ENABLED=true 时作为编剧主用 LLM
    // 否则保留 OpenAI/Claude 主链路，XVerse 仅作 fallback
    // ─────────────────────────────────────────
    if (this.xverseService && isXVersePrimary()) {
      this.update(AgentRole.WRITER, { progress: 20, currentTask: 'XVERSE-Ent A5.7B 思考剧本结构' });
      this.emit('agentTalk', { role: AgentRole.WRITER, text: '调用开源 XVERSE-Ent A5.7B（融合麦基方法论）...🧠' });

      const directorTotalShotsX = plan.storyStructure?.totalShots || 0;

      // ── 编剧增强块：Voice Fingerprints + Budget Plan(story-bible 按需注入) ──
      // 来源: lib/screenwriter-enhance.ts — Sudowrite Story Bible + LongWriter AgentWrite
      // 只做 userContext 末尾追加,不改原有 prompt,对 XVerse/OpenAI 都是纯文本注入
      const enhanceBlockX = buildScreenwriterEnhanceUserBlock({
        voices: inferVoiceFingerprintsFromCharacters(plan.characters || []),
        budgets: plan.scenes?.length
          ? buildDefaultSceneBudgets(plan.scenes, directorTotalShotsX || plan.scenes.length * 3)
          : undefined,
      });

      // v2.11 #4: 如果本项目有上一轮 Editor 评分,把"低分维度强化提示"注入 Writer
      const prevScoreX = this.projectId ? getLatestQualityScore(this.projectId) : null;
      const feedbackHintX = buildWriterFeedbackHint(prevScoreX);
      if (feedbackHintX) {
        console.log(`[Writer] reinforcing weak dimensions from last run score (overall=${prevScoreX?.overall})`);
        this.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `读到上一版评分(综合${prevScoreX?.overall}),针对性强化弱维度 📈`,
        });
      }

      const xUserContext = (this.parsedScript
        ? `${getWriterScriptContext(this.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style, characterAppearances: plan.characters.map(c => ({ name: c.name, appearance: c.appearance })) })}`
        : `导演计划：${JSON.stringify(plan)}`) + feedbackHintX + enhanceBlockX;

      const xResult = await this.xverseService.writeScript({
        plan,
        userContext: xUserContext,
        isAdaptation: !!this.parsedScript,
        characterNames: plan.characters?.map(c => c.name),
        characterAppearances: Object.keys(this.characterAppearanceMap).length > 0 ? this.characterAppearanceMap : undefined,
        sceneCount: this.parsedScript?.stats.sceneCount,
        directorTotalShots: directorTotalShotsX,
        onHeartbeat: (msg) => {
          this.emit('heartbeat', { message: msg });
          this.update(AgentRole.WRITER, { currentTask: msg });
        },
      });

      if (xResult.ok && xResult.script) {
        script = xResult.script;
        this.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
        const ms = xResult.elapsedMs.toFixed(0);
        const p1 = xResult.passes.pass1Ms.toFixed(0);
        const p2 = xResult.passes.pass2Ms.toFixed(0);
        const fix = xResult.passes.fixMs ? `, fix=${xResult.passes.fixMs.toFixed(0)}ms` : '';
        console.log(`[Writer] XVerse done in ${ms}ms (pass1=${p1}ms, pass2=${p2}ms${fix})`);
        this.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title || '未命名'}」由 XVERSE-Ent 完成 ✨ (${(xResult.elapsedMs / 1000).toFixed(1)}s)` });
        return script;
      }

      console.warn(`[Writer] XVerse failed (${xResult.error}), 降级到 Claude/OpenAI 主链路`);
      this.emit('agentTalk', { role: AgentRole.WRITER, text: `XVerse 调用失败 (${xResult.error?.slice(0, 60)})，降级到云端 LLM...` });
    }

    if (this.openai) {
      this.update(AgentRole.WRITER, { progress: 30 });
      // 构建编剧 system prompt（传入适配模式参数 + 角色外观）
      const directorTotalShots = plan.storyStructure?.totalShots || 0;
      const writerPromptOptions = this.parsedScript ? {
        isScriptAdaptation: true,
        characterNames: plan.characters.map(c => c.name),
        characterAppearances: Object.keys(this.characterAppearanceMap).length > 0
          ? this.characterAppearanceMap
          : undefined,
        sceneCount: this.parsedScript.stats.sceneCount,
        // 基于剧本内容量动态计算镜头数范围
        // 每1000字≈2个镜头，每3句对白≈1个镜头，每个场景≈2-3个镜头
        minShots: Math.max(4, Math.min(
          Math.max(
            this.parsedScript.stats.sceneCount * 2,           // 每场景至少2个镜头
            Math.ceil(this.parsedScript.stats.dialogueCount / 3), // 每3句对白1个镜头
            Math.ceil(this.parsedScript.stats.totalChars / 1000) * 2, // 每1000字2个镜头
          ),
          8  // minShots 上限
        )),
        maxShots: Math.max(8, Math.min(
          Math.max(
            this.parsedScript.stats.sceneCount * 4,
            Math.ceil(this.parsedScript.stats.dialogueCount / 2),
            Math.ceil(this.parsedScript.stats.totalChars / 500) * 2,
          ),
          30 // maxShots 上限
        )),
        directorTotalShots,
      } : {
        directorTotalShots,
      };
      const prompt = getMcKeeWriterPrompt(plan.genre, plan.style, writerPromptOptions);

      // ── P3: 根据是否有原始剧本，构建不同上下文 ──
      let userContext: string;
      if (this.parsedScript) {
        // 剧本改编模式：原始剧本文本是唯一权威，Director plan 仅提供视觉风格参考
        const scriptContext = getWriterScriptContext(this.parsedScript);

        // 极简化 Director plan — 只保留视觉风格信息，删除一切可能干扰剧情忠实度的内容
        const visualStyleRef = {
          genre: plan.genre,
          style: plan.style,
          styleKeywords: (plan as any).styleKeywords,
          // 只提供角色外貌（用于 visualPrompt），不提供 Director 重新解读的角色性格/背景
          characterAppearances: plan.characters.map(c => ({
            name: c.name,
            appearance: c.appearance,
          })),
        };

        const templateContext = this.template
          ? `\n\n【故事模板指引（仅影响视觉风格，不影响剧情）】\n色彩建议：${this.template.colorPalette}`
          : '';

        // 原始剧本文本占据绝大部分上下文，视觉风格仅作为附录
        userContext = `${scriptContext}\n\n═══ 附录：视觉风格参考（仅用于 visualPrompt 的风格关键词和角色外貌，不要参考这里的任何剧情信息）═══\n${JSON.stringify(visualStyleRef)}${templateContext}`;
      } else {
        const templateContext = this.template
          ? `\n\n【故事模板指引】\n结构提示：${this.template.structureHint}\n情感曲线：${this.template.emotionCurve}\n关键元素：${this.template.keyElements.join('、')}\n色彩建议：${this.template.colorPalette}`
          : '';
        userContext = `导演计划：${JSON.stringify(plan)}${templateContext}`;
      }

      // ── 编剧增强块: Voice Fingerprints + Budget Plan ──
      // 来源: lib/screenwriter-enhance.ts — Sudowrite Story Bible + LongWriter AgentWrite + Dramaturge
      // 纯文本追加,不改原 prompt,对 writer 质量的提升来自:
      //   1. 每角色的声音卡(口头禅/禁词/语域) → 消除"所有人说话一样"
      //   2. 按场景分配镜头/情感预算 → 减少 Act 3 "末尾崩塌"
      const enhanceBlock = buildScreenwriterEnhanceUserBlock({
        voices: inferVoiceFingerprintsFromCharacters(plan.characters || []),
        budgets: plan.scenes?.length
          ? buildDefaultSceneBudgets(plan.scenes, directorTotalShots || plan.scenes.length * 3)
          : undefined,
      });
      if (enhanceBlock) userContext += enhanceBlock;

      // v2.11 #4: Writer-Editor 闭环 —— 把上一版的评分反馈注入本轮 prompt
      // 分<70 的维度会被拼进 userContext,引导模型针对性补弱点。
      const prevScore = this.projectId ? getLatestQualityScore(this.projectId) : null;
      const feedbackHint = buildWriterFeedbackHint(prevScore);
      if (feedbackHint) {
        console.log(`[Writer] reinforcing weak dimensions from last run score (overall=${prevScore?.overall})`);
        this.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `读到上一版评分(综合${prevScore?.overall}),针对性强化弱维度 📈`,
        });
        userContext += feedbackHint;
      }

      // ═══ Two-Pass Generation（业界最佳实践）═══
      // Pass 1: 自然语言规划 — 让 LLM 先用自由文本规划镜头分配
      // Pass 2: JSON 格式化 — 基于规划生成结构化输出
      // 这避免了"推理 + 格式化同时进行"导致的质量下降

      const minShotsRequired = writerPromptOptions.minShots || (directorTotalShots > 0 ? Math.max(4, directorTotalShots - 2) : 4);
      const maxShotsAllowed = writerPromptOptions.maxShots || (directorTotalShots > 0 ? Math.max(directorTotalShots + 2, 8) : 12);

      this.emit('agentTalk', { role: AgentRole.WRITER, text: '第一步：规划镜头分配方案...📋' });

      const planningPrompt = `你是一位精通分镜的编剧,精通罗伯特·麦基故事学与短视频叙事。请先分析以下内容,按麦基方法论规划镜头拆分方案。

## 麦基核心法则(Pass 1 阶段就必须遵循)

1. **黄金开场** — 第 1 个镜头必须是钩子(悬念/闪回/极端反差/情感冲击之一),绝不能从"主角起床/走路/看风景"开始
2. **三幕结构** — 把 ${minShotsRequired}-${maxShotsAllowed} 个镜头按 Act 1 / Act 2 / Act 3 明确切分,大致 25%/50%/25%
3. **激励事件** — 在 Act 1 末尾(约 25% 处)必须有一个不可逆的激励事件,把主角卷入冲突
4. **中点反转** — 在 Act 2 中段必须有一个反转/代价揭示
5. **高潮选择** — 倒数第 2 个镜头必须给主角一个不可逆的选择,显露真正的人物本质
6. **情感曲线起伏** — 温度值(-10 到 +10)必须波动,不能单调上升/下降。理想: 中→低→高→谷底→巅峰→余韵
7. **期望鸿沟** — 每一个镜头角色的预期结果 ≠ 实际结果,这是推进故事的引擎
8. **价值转换** — 每个镜头开头和结尾的情感价值必须不同,"平静→平静"的镜头是废镜头

## 场景拆分规则
- 一个场景通常应拆分为 2-5 个镜头(每段重要对话/动作/情绪转折 = 1 个镜头)
- 你必须规划 ${minShotsRequired} 到 ${maxShotsAllowed} 个镜头
- **绝对禁止只规划 1-2 个镜头! 至少 ${minShotsRequired} 个**

## 输出格式(纯文本,不要 JSON)

先写总数和三幕切分: "共规划 N 个镜头,Act1=第1-X镜头(建立+激励事件),Act2=第X-Y镜头(对抗+中点反转),Act3=第Y-N镜头(高潮选择+余韵)"

然后逐一列出,每个镜头必须包含以下字段:
镜头1: [Act1] [场景名] - [核心内容] - beat:[叙事节拍] - 情感温度:N - 角色:[名字] - 台词:"[原文台词]" - 价值转换:从X到Y
镜头2: [Act1] ...
...

关键节点必须明确标注:
- 第 1 个镜头标注 [钩子策略: mystery/flashforward/contrast/action]
- 激励事件镜头标注 [激励事件]
- 中点反转镜头标注 [中点反转]
- 高潮镜头标注 [高潮选择]
- 结尾镜头标注 [余韵]`;

      console.log(`[Writer] Pass 1 开始: userContext=${userContext.length}chars, minShots=${minShotsRequired}, maxShots=${maxShotsAllowed}`);
      const shotPlan = await this.callLLM(planningPrompt, userContext, false, true);
      this.update(AgentRole.WRITER, { progress: 40 });

      if (!shotPlan) {
        console.error('[Writer] Pass 1 返回空结果！LLM 可能超时或出错');
        this.emit('agentTalk', { role: AgentRole.WRITER, text: '镜头规划超时，尝试直接生成剧本...⚡' });
      }

      // 从规划文本中提取镜头数
      const planShotCount = (shotPlan.match(/镜头\d+/g) || []).length;
      console.log(`[Writer] Pass 1 规划完成: ${planShotCount} 个镜头, 响应长度=${shotPlan.length}`);

      // Pass 2: 基于规划生成完整 JSON
      this.emit('agentTalk', { role: AgentRole.WRITER, text: `第二步：将 ${planShotCount || minShotsRequired} 个镜头转为完整剧本...📝` });
      this.update(AgentRole.WRITER, { currentTask: `将${planShotCount || minShotsRequired}个镜头规划转为完整剧本`, progress: 50 });

      // 如果 Pass 1 为空（超时等），直接用原始素材进入 Pass 2
      // 注意：pass2Context 不能太长，否则输出 token 被压缩导致空结果
      // 限制 userContext 在 pass2 中的长度，优先保留 shotPlan
      const trimmedUserCtx = userContext.length > 8000 ? userContext.slice(0, 8000) + '\n[...已截断...]' : userContext;
      const pass2Context = shotPlan
        ? `══ 镜头规划（严格按照此规划生成 JSON）══\n${shotPlan}\n\n══ 素材 ══\n${trimmedUserCtx}\n\n══ 指令 ══\nshots 数组必须有 ${planShotCount || minShotsRequired} 个镜头。`
        : `${trimmedUserCtx}\n\nshots 数组必须有 ${minShotsRequired}-${maxShotsAllowed} 个镜头。`;

      console.log(`[Writer] Pass 2 开始: pass2Context=${pass2Context.length}chars`);
      const raw = await this.callLLM(prompt, pass2Context, true, true);
      this.update(AgentRole.WRITER, { progress: 70 });

      if (!raw) {
        console.error('[Writer] Pass 2 返回空结果！');
        // 优先尝试 XVerse 作为开源 fallback
        if (this.xverseService) {
          this.emit('agentTalk', { role: AgentRole.WRITER, text: 'Claude 返回空结果，切换 XVERSE-Ent 兜底...🔄' });
          const xUserContext = this.parsedScript
            ? `${getWriterScriptContext(this.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style, characterAppearances: plan.characters.map(c => ({ name: c.name, appearance: c.appearance })) })}`
            : `导演计划：${JSON.stringify(plan)}`;
          const xRes = await this.xverseService.writeScript({
            plan,
            userContext: xUserContext,
            isAdaptation: !!this.parsedScript,
            characterNames: plan.characters?.map(c => c.name),
            characterAppearances: Object.keys(this.characterAppearanceMap).length > 0 ? this.characterAppearanceMap : undefined,
            sceneCount: this.parsedScript?.stats.sceneCount,
            directorTotalShots,
            onHeartbeat: (msg) => this.emit('heartbeat', { message: msg }),
          });
          if (xRes.ok && xRes.script) {
            script = xRes.script;
            this.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
            this.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title || '未命名'}」由 XVERSE-Ent 兜底完成 ✨` });
            return script;
          }
        }
        this.emit('agentTalk', { role: AgentRole.WRITER, text: 'LLM 返回空结果，使用智能降级方案...' });
        script = this.fallbackScript(plan);
        this.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
        this.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title}」写好了（降级模式）🔧` });
        return script;
      }
      console.log(`[Writer] Pass 2 完成: raw=${raw.length}chars`);

      try {
        script = JSON.parse(raw) as Script;

        // ── 镜头数量验证 + 自动重试 ──
        if (script.shots && script.shots.length < minShotsRequired) {
          console.log(`[Writer] 镜头数不足: ${script.shots.length}/${minShotsRequired}，请求补充...`);
          this.update(AgentRole.WRITER, { currentTask: `镜头数不足(${script.shots.length}个)，补充到${minShotsRequired}个`, progress: 75 });
          this.emit('agentTalk', { role: AgentRole.WRITER, text: `检测到只有${script.shots.length}个镜头，正在补充到至少${minShotsRequired}个...🔄` });

          try {
            const retryRaw = await this.callLLM(
              prompt,
              `🚨 严重问题：你只生成了 ${script.shots.length} 个镜头，但要求是 ${minShotsRequired}-${maxShotsAllowed} 个！

请参考以下镜头规划重新生成完整 JSON，shots 数组必须有 ${minShotsRequired} 个以上：

${shotPlan}

你之前的不完整输出（仅供参考结构，镜头数量严重不足）：
${raw.slice(0, 2000)}

请输出完整的修正后 JSON，shots 数组至少 ${minShotsRequired} 个镜头。`
            );
            const retryScript = JSON.parse(retryRaw) as Script;
            if (retryScript.shots && retryScript.shots.length > script.shots.length) {
              script = retryScript;
              console.log(`[Writer] 补充后镜头数: ${script.shots.length}`);
            }
          } catch {
            console.warn('[Writer] 镜头数补充失败，使用原始输出');
          }
        }

        // ── P3: 输出质量验证 + 自动修正 ──
        const validation = validateWriterOutput(script);
        if (!validation.passed) {
          console.log(`[Writer] 输出验证未通过 (${validation.issues.length}个问题)，请求修正...`);
          this.update(AgentRole.WRITER, { currentTask: '检查字数标准，补充不足内容', progress: 80 });
          this.emit('agentTalk', { role: AgentRole.WRITER, text: `自检发现${validation.issues.length}处不达标（字数/细节不足），正在补充...📝` });

          try {
            const fixRaw = await this.callLLM(
              prompt,
              `你之前的输出存在以下问题：\n${validation.fixInstructions}\n\n原始输出：\n${raw}\n\n请修正以上所有问题，输出完整的修正后JSON。shots数组必须保持${script.shots?.length || minShotsRequired}个镜头，不可减少。`
            );
            const fixedScript = JSON.parse(fixRaw) as Script;
            if (fixedScript.shots && fixedScript.shots.length >= (script.shots?.length || 0)) {
              script = fixedScript;
              console.log('[Writer] 修正完成');
            }
          } catch {
            console.warn('[Writer] 修正失败，使用原始输出');
          }
        }

        // ── P3 增强: 剧本改编模式下的忠实度校验 ──
        if (this.parsedScript && script.shots?.length > 0) {
          const fidelityIssues: string[] = [];
          const originalChars = this.parsedScript.characters.map(c => c.name);
          const scriptChars = new Set(script.shots.flatMap(s => s.characters || []));

          // 检查是否遗漏了原剧本中的重要角色
          const missedChars = originalChars.filter(c => !scriptChars.has(c) && (this.parsedScript!.characters.find(pc => pc.name === c)?.dialogueCount || 0) >= 2);
          if (missedChars.length > 0) {
            fidelityIssues.push(`遗漏了原剧本中的重要角色: ${missedChars.join('、')}。这些角色在原剧本中有多句台词，必须在某个镜头中出场。`);
          }

          // 检查是否有虚构的角色（不在原剧本中）
          const fabricatedChars = [...scriptChars].filter(c => !originalChars.includes(c) && c !== '旁白' && c !== '群众');
          if (fabricatedChars.length > 0) {
            fidelityIssues.push(`出现了原剧本中不存在的角色: ${fabricatedChars.join('、')}。禁止编造新角色，请使用原剧本中的角色。`);
          }

          // 检查对白是否与原剧本有关联（至少30%的台词应包含原剧本中的关键词）
          const originalDialogues = this.parsedScript.scenes.flatMap(s => s.dialogues.map(d => d.line));
          const originalKeywords = originalDialogues.join('').split(/[，。！？、；：""''（）\s]+/).filter(w => w.length >= 2);
          if (originalKeywords.length > 0) {
            const scriptDialogues = script.shots.map(s => s.dialogue || '').filter(Boolean);
            const matchCount = scriptDialogues.filter(d => originalKeywords.some(kw => d.includes(kw))).length;
            const matchRate = scriptDialogues.length > 0 ? matchCount / scriptDialogues.length : 0;
            if (matchRate < 0.3 && scriptDialogues.length > 2) {
              fidelityIssues.push(`对白忠实度过低(${Math.round(matchRate * 100)}%)。你的大部分台词看起来是自创的，而非引用自原剧本。请重新检查原剧本中的对白，直接引用或精炼原文。`);
            }
          }

          if (fidelityIssues.length > 0) {
            console.log(`[Writer] 剧本忠实度校验: ${fidelityIssues.length}个问题`);
            this.update(AgentRole.WRITER, { currentTask: '检查剧本忠实度，修正偏离原作的内容', progress: 85 });
            this.emit('agentTalk', { role: AgentRole.WRITER, text: `剧本忠实度校验发现${fidelityIssues.length}处偏离原作，正在修正...🔍` });

            try {
              const fidelityFixRaw = await this.callLLM(
                prompt,
                `你之前的改编存在以下忠实度问题：\n${fidelityIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n原始输出：\n${JSON.stringify(script)}\n\n请严格按照原始剧本修正以上问题，输出完整的修正后JSON。记住：你的任务是忠实转化原剧本，不是创作新故事。`
              );
              const fixedScript = JSON.parse(fidelityFixRaw) as Script;
              script = fixedScript;
              console.log('[Writer] 忠实度修正完成');
              this.emit('agentTalk', { role: AgentRole.WRITER, text: '忠实度修正完成，现在与原剧本高度一致 ✅' });
            } catch {
              console.warn('[Writer] 忠实度修正失败，使用原始输出');
            }
          } else {
            console.log('[Writer] 剧本忠实度校验通过 ✅');
          }
        }
      } catch {
        console.error('[Writer] JSON parse failed, using fallback');
        script = this.fallbackScript(plan);
      }
    } else if (this.xverseService) {
      // OpenAI 缺席 → XVerse 兜底
      this.emit('agentTalk', { role: AgentRole.WRITER, text: '云端 LLM 未配置，启用开源 XVERSE-Ent...🚀' });
      const xUserContext = this.parsedScript
        ? `${getWriterScriptContext(this.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style })}`
        : `导演计划：${JSON.stringify(plan)}`;
      const xRes = await this.xverseService.writeScript({
        plan,
        userContext: xUserContext,
        isAdaptation: !!this.parsedScript,
        characterNames: plan.characters?.map(c => c.name),
        directorTotalShots: plan.storyStructure?.totalShots || 0,
        sceneCount: this.parsedScript?.stats.sceneCount,
        onHeartbeat: (msg) => this.emit('heartbeat', { message: msg }),
      });
      script = (xRes.ok && xRes.script) ? xRes.script : this.fallbackScript(plan);
    } else {
      await sleep(2000);
      script = this.fallbackScript(plan);
    }

    this.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
    this.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title}」写好了！这次的反转绝对够劲 🔥` });
    return script;
  }

  private fallbackScript(plan: DirectorPlan): Script {
    // 如果有解析过的剧本，基于原始剧本生成 fallback
    // 将每个场景按对话数量拆分为多个镜头，确保至少4个镜头
    if (this.parsedScript && this.parsedScript.scenes.length > 0) {
      const scenes = this.parsedScript.scenes.slice(0, Math.min(this.parsedScript.scenes.length, 20));
      const shots: any[] = [];
      let shotNum = 1;

      for (const scene of scenes) {
        // 每个场景至少1个镜头，每3句对白额外增加1个镜头
        const dialogueGroups = [];
        const dialogues = scene.dialogues;
        const groupSize = 3;
        for (let j = 0; j < Math.max(1, dialogues.length); j += groupSize) {
          dialogueGroups.push(dialogues.slice(j, j + groupSize));
        }

        for (let g = 0; g < dialogueGroups.length; g++) {
          const group = dialogueGroups[g];
          const actionIdx = Math.min(g, scene.actions.length - 1);
          shots.push({
            shotNumber: shotNum++,
            sceneDescription: `${scene.location}（${scene.timeOfDay}）。${scene.actions[actionIdx >= 0 ? actionIdx : 0] || '场景画面'}`,
            characters: group.length > 0
              ? [...new Set(group.map(d => d.character))]
              : (scene.characters.length > 0 ? scene.characters : [plan.characters[0]?.name || '主角']),
            dialogue: group[0]?.line?.slice(0, 25) || '',
            action: scene.actions[actionIdx >= 0 ? actionIdx : 0] || '角色动作',
            emotion: scene.emotionalArc || '平静',
          });
        }
      }

      // 确保至少4个镜头
      while (shots.length < 4 && shots.length > 0) {
        const last = shots[shots.length - 1];
        shots.push({
          ...last,
          shotNumber: shots.length + 1,
          sceneDescription: `${last.sceneDescription}（延续）`,
        });
      }

      return {
        title: `${plan.genre}短片`,
        synopsis: this.parsedScript.plotSummary || `一部基于用户剧本改编的${plan.genre}风格短片。`,
        shots,
      };
    }
    const totalShots = Math.max(4, plan.storyStructure.totalShots);
    return {
      title: `${plan.genre}短片`,
      synopsis: `一部${plan.genre}风格的AI漫剧短片。`,
      shots: Array.from({ length: totalShots }, (_, i) => ({
        shotNumber: i + 1,
        sceneDescription: `${plan.style}风格，镜头${i + 1}`,
        characters: [plan.characters[0]?.name || '主角'],
        dialogue: '', action: '动作', emotion: '情绪',
      })),
    };
  }

  // ══════════════════════════════════════
  // 角色设计师（Midjourney 三视图）
  // ══════════════════════════════════════
  async runCharacterDesigner(characters: Character[]): Promise<any[]> {
    this.update(AgentRole.CHARACTER_DESIGNER, { status: 'working', currentTask: `设计 ${characters.length} 个角色三视图`, progress: 0 });
    this.emit('agentTalk', { role: AgentRole.CHARACTER_DESIGNER, text: '开始画角色三视图，正面侧面背面一个不少~ 🎨' });

    // ═══ v2.11 #3: 角色多维特征抽取 ═══
    // 用户痛点: fallbackDirectorPlan 走通用前缀 ("古装人物，身着传统汉服/古装服饰，") 后,
    // 所有角色描述完全一样 → MJ 出图也完全一样, 一致性/辨识度无救。
    // 这里在画图前, 先用 LLM 从原剧本里逆向推理每个角色的 6-8 维特征(性别/年龄/体型/肤色/外观/服饰/性格),
    // 把结果塞进 character.visual, 让 getCharacterVisualPrompt 走结构化分支拼出有差异的 prompt。
    if (this.parsedScript?.rawText && characters.length > 0) {
      try {
        const { extractCharacterTraits, traitsToVisual, traitsToDescription } = await import('@/lib/character-traits');
        this.emit('agentTalk', {
          role: AgentRole.CHARACTER_DESIGNER,
          text: `先做一遍角色档案: 性别/年龄/体型/肤色/服饰/性格逐项抽取... 📋`,
        });
        const traits = await extractCharacterTraits(
          this.parsedScript.rawText,
          characters.map((c) => c.name),
          { timeoutMs: 90_000 },
        );
        if (traits && traits.length > 0) {
          let enriched = 0;
          for (const c of characters) {
            const t = traits.find((x) => x.name === c.name);
            if (!t || !t.confident) continue;
            // 已经有结构化 visual (导演路径) 就跳过, 不覆盖更精的源
            if (!(c as any).visual || Object.keys((c as any).visual || {}).length === 0) {
              (c as any).visual = traitsToVisual(t);
            }
            // description / appearance 也用更具体的覆盖回来 (UI 列表展示也跟着差异化)
            const richDesc = traitsToDescription(t);
            if (richDesc.length > (c.description || '').length) {
              c.description = richDesc;
            }
            if (!c.appearance || c.appearance.length < 30) {
              const v = (c as any).visual || {};
              c.appearance = [v.bodyType, v.skinTone, v.hair, v.outfit, v.props]
                .filter((x: any) => typeof x === 'string' && x).join(', ');
            }
            enriched++;
          }
          if (enriched > 0) {
            this.emit('agentTalk', {
              role: AgentRole.CHARACTER_DESIGNER,
              text: `档案完成: ${enriched}/${characters.length} 个角色拿到了结构化特征 ✓`,
            });
          } else {
            this.emit('agentTalk', {
              role: AgentRole.CHARACTER_DESIGNER,
              text: `角色档案 LLM 没拿到足量线索, 走原描述兜底 (这是正常的 — 剧本若没明确写人物长相, 强求会跑偏)`,
            });
          }
        }
      } catch (e) {
        // 档案抽取失败不阻塞主流程, 走原 description 兜底
        console.warn('[CharDesigner] traits extraction failed, falling back:', e);
      }
    }

    const results = [];
    const totalSteps = characters.length;
    // ★ Seedance 风格: 累积已生成的角色图,供后续角色做风格基准
    const generatedCharRefs: string[] = [];

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      // 总体进度计算
      const overallProgress = Math.round((i / totalSteps) * 100);
      this.update(AgentRole.CHARACTER_DESIGNER, {
        currentTask: `设计角色：${char.name}（三视图）`,
        progress: overallProgress
      });

      const basePrompt = getCharacterVisualPrompt(char.name, char.description, char.appearance || '', this.styleKeywords, {
        genre: this.genre,
        visual: (char as any).visual,  // 展平 McKee 11 维结构到英文 prompt
      });

      // ★ Seedance 2.0 借鉴: 多机位 turnaround + 显式一致性锚点 + 风格锚点复读
      const enhancedPrompt = enhanceCharacterPromptSeedance(basePrompt, char.name)
        + '. ' + styleAnchorBlock(this.styleKeywords);

      // ★ Seedance 风格: 渐进参考链 — 前一个角色图作为风格基准,保证所有角色画风一致
      // 第 1 个角色无参考; 第 2 个起,用前一个角色图作 --sref (风格基准)
      const priorCharRef = generatedCharRefs[generatedCharRefs.length - 1];
      const progressiveRefs = buildProgressiveRefs({
        primaryCharRef: priorCharRef,
        maxRefs: 2,
      });

      // 单角色限时 3 分钟，超时则降级为 mock
      const CHAR_TIMEOUT = 180_000;
      const imageUrl = await Promise.race([
        this.generateImage(enhancedPrompt, {
          label: `${char.name} 三视图`,
          // 第一个角色无参考; 第二个角色起把前序角色图当 --sref 风格基准
          sref: progressiveRefs[0],
          referenceImages: progressiveRefs,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Char timeout: ${char.name}`)), CHAR_TIMEOUT)
        ),
      ]).catch(err => {
        console.warn(`[CharDesigner] ${char.name} 超时/失败: ${err.message}, 降级 mock`);
        return mockSvg(768, 768, '#4c1d95', '#7c3aed', char.name);
      });

      // 一个角色只输出一张三视图
      results.push({ character: char.name, prompt: enhancedPrompt, imageUrl });

      // ★ Seedance 累积: 把刚生成的真实 http 图推入引用链,第 N+1 个角色会引用它做风格基准
      if (imageUrl && imageUrl.startsWith('http')) {
        generatedCharRefs.push(imageUrl);
      }

      // 更新总体进度
      const completedProgress = Math.round(((i + 1) / totalSteps) * 100);
      this.update(AgentRole.CHARACTER_DESIGNER, { progress: completedProgress });
    }

    this.update(AgentRole.CHARACTER_DESIGNER, { status: 'completed', progress: 100, output: results });
    // 存储角色图URL，供后续 --cref/--sref 使用
    this.characterImageUrls = results.map(r => r.imageUrl).filter(u => u && !u.startsWith('data:'));

    // P1: 构建角色视觉锚点系统
    this.characterAnchors = extractVisualAnchors(results);
    // v2.9 P0 Cameo: 用户上传的主角脸参考图优先级最高 —— 绝不能被 Character Designer 盖掉
    if (!this.primaryCharacterRefLocked) {
      this.primaryCharacterRef = this.characterImageUrls[0] || '';
    }
    if (this.primaryCharacterRef) {
      const src = this.primaryCharacterRefLocked ? 'user cameo' : 'auto from Character Designer';
      console.log(`[P1-CharConsistency] Primary character ref locked (${src}): ${this.primaryCharacterRef.slice(0, 60)}...`);
      console.log(`[P1-CharConsistency] ${this.characterAnchors.length} character anchors built: ${this.characterAnchors.map(a => `${a.name}[${a.visualTags.join(',')}]`).join('; ')}`);
    }

    this.emit('agentTalk', { role: AgentRole.CHARACTER_DESIGNER, text: `三视图画完了，${results.length}个角色帅到我自己都心动~ ✨\n角色锚点已锁定，后续镜头将严格保持一致性 🔒` });
    return results;
  }

  // ══════════════════════════════════════
  // 场景设计师（Midjourney，--sref 保持画风一致）
  // ══════════════════════════════════════
  async runSceneDesigner(scenes: { id: string; description: string; location: string; visual?: any }[]): Promise<any[]> {
    // ═══ 限制场景数量（防止 15 个场景串行生成导致超长等待）═══
    const MAX_SCENES = 8;
    const trimmedScenes = scenes.length > MAX_SCENES
      ? this.deduplicateScenes(scenes).slice(0, MAX_SCENES)
      : scenes;

    if (trimmedScenes.length < scenes.length) {
      console.log(`[SceneDesigner] 裁剪场景 ${scenes.length} → ${trimmedScenes.length}（去重 + 限制 ${MAX_SCENES}）`);
    }

    this.update(AgentRole.SCENE_DESIGNER, { status: 'working', currentTask: `设计 ${trimmedScenes.length} 个场景`, progress: 0 });
    this.emit('agentTalk', { role: AgentRole.SCENE_DESIGNER, text: `场景概念图开画（${trimmedScenes.length}个），画风和角色保持一致 🏔️` });

    // P1: 使用主角色参考图作为风格基准（--sref），确保画风一致
    const srefUrl = this.primaryCharacterRef || this.characterImageUrls[0] || undefined;

    // ═══ 并发生成场景图（2路并发，大幅加速）═══
    // ★ Seedance 风格进化: 串行链 (1路) 允许"风格传递链" — 场景 N 引用场景 N-1
    //   但并发 2 路才能保证速度, 所以策略: 第 1 批 2 场景并发(无场景间 ref),
    //   后续批次可以拿到前批的产出做参考。暂保留 2 并发,通过 worker 内累积 refs。
    const CONCURRENCY = 2;
    const SCENE_TIMEOUT = 180_000; // 单个场景 3 分钟超时
    const results: { sceneId: string; name: string; description: string; imageUrl: string }[] = [];
    let completed = 0;
    // ★ 已完成场景图池 - 后续场景从池中取最近的一张做风格传递
    const completedSceneRefs: string[] = [];

    const generateSingleScene = async (scene: typeof trimmedScenes[0]): Promise<typeof results[0]> => {
      const basePrompt = getSceneVisualPrompt(scene.description, scene.location, this.styleKeywords, (scene as any).visual);

      // ★ Seedance 2.0 借鉴: 多机位预演 + 风格锚点复读
      const enhancedPrompt = enhanceScenePromptSeedance(basePrompt)
        + '. ' + styleAnchorBlock(this.styleKeywords);

      // ★ Seedance 渐进参考链:
      //   styleRef (用户上传) > 主角色图 > 最近场景图 > 次角色图
      //   flux.1-kontext-pro 最多吃 4 张, MJ 只吃 2 张 (--cref + --sref)
      const prevSceneRef = completedSceneRefs[completedSceneRefs.length - 1];
      const progressiveRefs = buildProgressiveRefs({
        primaryCharRef: srefUrl,
        prevSceneRef,
        secondaryCharRef: this.characterImageUrls[1],
        maxRefs: 4,
      });

      // 单场景限时：如果超时则返回 mock
      const imageUrl = await Promise.race([
        this.generateImage(enhancedPrompt, {
          aspectRatio: '16:9', label: scene.location,
          sref: srefUrl, // 主 --sref 通道保持角色风格
          referenceImages: progressiveRefs, // 额外参考图供 flux.1-kontext-pro 使用
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Scene timeout: ${scene.location}`)), SCENE_TIMEOUT)
        ),
      ]).catch(err => {
        console.warn(`[SceneDesigner] ${scene.location} failed: ${err.message}, using mock`);
        return mockSvg(1024, 576, '#1e1b4b', '#7c3aed', scene.location);
      });

      // ★ 把成功产出加入风格传递池 (仅 http URL, 去除 mock SVG)
      if (imageUrl && imageUrl.startsWith('http')) {
        completedSceneRefs.push(imageUrl);
      }

      completed++;
      this.update(AgentRole.SCENE_DESIGNER, {
        currentTask: `已完成 ${completed}/${trimmedScenes.length} 个场景`,
        progress: Math.round((completed / trimmedScenes.length) * 100),
      });

      return { sceneId: scene.id, name: scene.location, description: scene.description, imageUrl };
    };

    // Worker-based 并发调度器
    const orderedResults: (typeof results[0] | null)[] = new Array(trimmedScenes.length).fill(null);
    const indexedQueue = trimmedScenes.map((scene, idx) => ({ scene, idx }));
    const workers: Promise<void>[] = [];

    for (let w = 0; w < Math.min(CONCURRENCY, indexedQueue.length); w++) {
      workers.push((async () => {
        while (indexedQueue.length > 0) {
          const item = indexedQueue.shift();
          if (!item) break;
          const result = await generateSingleScene(item.scene);
          orderedResults[item.idx] = result;
        }
      })());
    }

    await Promise.all(workers);

    const finalResults = orderedResults.filter((r): r is typeof results[0] => r !== null);

    this.update(AgentRole.SCENE_DESIGNER, { status: 'completed', progress: 100, output: finalResults });
    this.emit('agentTalk', { role: AgentRole.SCENE_DESIGNER, text: `${finalResults.length}个场景画好了，氛围感拉满！🌄` });
    return finalResults;
  }

  /** 去重：合并相同/相似 location 的场景 */
  private deduplicateScenes(scenes: { id: string; description: string; location: string; visual?: any }[]): typeof scenes {
    const seen = new Map<string, typeof scenes[0]>();
    for (const scene of scenes) {
      // 提取核心场景名（去掉时间/氛围后缀）
      const coreLocation = scene.location.replace(/[（(].*?[）)]/, '').trim();
      if (!seen.has(coreLocation)) {
        seen.set(coreLocation, scene);
      }
    }
    return Array.from(seen.values());
  }

  // ══════════════════════════════════════
  // 分镜师 第1阶段：纯文本分镜规划（不生成图片）
  // ══════════════════════════════════════
  async runStoryboardArtist(script: Script, characters: any[], scenes?: any[]): Promise<Storyboard[]> {
    const shots = script.shots || [];
    this.update(AgentRole.STORYBOARD, { status: 'working', currentTask: `规划 ${shots.length} 个分镜描述`, progress: 0 });
    this.emit('agentTalk', { role: AgentRole.STORYBOARD, text: `先规划每个分镜的详细视觉描述，稍后统一渲染确保一致性~ 📝` });

    let storyboardPlans: any[] = [];

    if (API_CONFIG.openai.apiKey) {
      this.update(AgentRole.STORYBOARD, { progress: 20 });

      // 构建角色外观描述（让分镜师了解角色长什么样）
      const charDescBlock = characters.map(c => {
        const name = c.character || c.name;
        const appearance = this.characterAppearanceMap[name] || c.description || '';
        const anchors = this.characterAnchors.find(a => a.name === name);
        const tags = anchors ? ` [视觉锚点: ${anchors.visualTags.join(', ')}]` : '';
        return `  - ${name}: ${appearance}${tags}`;
      }).join('\n');

      // 构建场景视觉描述
      const sceneDescBlock = (scenes || []).map(s =>
        `  - ${s.name || s.location}: ${s.description || ''}`
      ).join('\n');

      const context = `剧本标题：${script.title}
剧本简介：${script.synopsis}
风格关键词：${this.styleKeywords}
类型：${this.genre}

【角色外观详情】（分镜中必须体现角色的辨识性特征）
${charDescBlock}

【场景视觉详情】
${sceneDescBlock}

【镜头列表】（共${shots.length}个镜头）
${shots.map((s, i) => {
  const shotNum = s.shotNumber || i + 1;
  const charNames = s.characters?.join('、') || '';
  return `镜头${shotNum}: ${s.sceneDescription}${s.dialogue ? ` [台词: "${s.dialogue}"]` : ''} [情绪: ${s.emotion || ''}] [动作: ${s.action || ''}]${charNames ? ` [角色: ${charNames}]` : ''}`;
}).join('\n')}`;

      const raw = await this.callLLM(getStoryboardPlannerPrompt(), context);
      this.update(AgentRole.STORYBOARD, { progress: 70 });

      try {
        const parsed = JSON.parse(raw);
        // 兼容 LLM 可能输出 cameraWork 或 cameraAngle 两种字段名
        storyboardPlans = (Array.isArray(parsed) ? parsed : [parsed]).map((p: any) => ({
          ...p,
          cameraAngle: p.cameraAngle || p.cameraWork || '',
        }));
      } catch {
        console.error('[Storyboard] JSON parse failed, using fallback plans');
        storyboardPlans = [];
      }
    }

    // Fallback: 如果 LLM 没有返回或解析失败，使用专业分镜规则引擎生成描述
    if (storyboardPlans.length === 0) {
      storyboardPlans = shots.map((shot, i) => {
        const totalShots = shots.length;
        const position = i / Math.max(1, totalShots - 1); // 0→1 归一化位置

        // 专业景别递进：开场远景 → 中景叙事 → 紧张段近景 → 高潮特写 → 余韵远景
        let cameraAngle: string;
        let lighting: string;
        let composition: string;
        let shotDuration: number;

        if (i === 0) {
          // 开场：大远景或全景，建立世界观
          cameraAngle = 'Extreme Wide Shot, slight crane down, establishing shot';
          lighting = 'Natural ambient light, atmospheric haze, volumetric';
          composition = 'Wide composition, subject small in frame, negative space emphasizing scale';
          shotDuration = 10;
        } else if (i === totalShots - 1) {
          // 结尾：远景拉远，余韵留白
          cameraAngle = 'Wide Shot, slow dolly out / crane up, farewell framing';
          lighting = 'Golden hour backlighting, warm rim light, silhouette tendency';
          composition = 'Subject receding into distance, leading lines, vast negative space';
          shotDuration = 12;
        } else if (position > 0.6 && position < 0.85) {
          // 高潮段落：近景→特写，最高张力
          cameraAngle = 'Close-Up, low angle, slow push in to Extreme Close-Up';
          lighting = 'Low-key dramatic lighting, Rembrandt, strong contrast';
          composition = 'Face fills 2/3 frame, tight crop, shallow depth of field';
          shotDuration = 4;
        } else if (position > 0.35 && position <= 0.6) {
          // 紧张升级：中近景，景别收紧
          cameraAngle = 'Medium Close-Up, eye level, slight handheld movement';
          lighting = 'Split warm/cold lighting, tension building';
          composition = 'Rule of thirds, character slightly off-center, foreground element';
          shotDuration = 6;
        } else {
          // 正常叙事：中景
          cameraAngle = 'Medium Shot, eye level, steady tracking';
          lighting = 'Natural light with subtle fill';
          composition = 'Standard rule of thirds, balanced framing';
          shotDuration = 7;
        }

        const emotion = shot.emotion || '平静';
        // 根据情绪调整光影
        if (emotion.match(/紧张|恐惧|危机|恐怖/)) {
          lighting = 'Low-key lighting, under lighting, deep shadows, cold blue tones';
        } else if (emotion.match(/温暖|希望|幸福|释然/)) {
          lighting = 'Golden hour, warm high-key lighting, soft diffusion';
        } else if (emotion.match(/悲伤|孤独|绝望/)) {
          lighting = 'Desaturated, overcast diffuse light, cold grey tones, silhouette';
        }

        return {
          shotNumber: shot.shotNumber || i + 1,
          visualDescription: `${shot.sceneDescription}。${shot.action || ''}。角色表情传达${emotion}。`,
          cameraAngle,
          composition,
          lighting,
          colorTone: '根据情绪自动调色',
          characterAction: shot.action || '站立',
          shotDuration,
          tensionLevel: Math.round(position <= 0.3 ? 3 + position * 10 : position <= 0.7 ? 5 + position * 5 : 10 - (position - 0.7) * 20),
          transitionNote: i === 0 ? '开场淡入' : i === totalShots - 1 ? '淡出黑场' : '匹配切',
        };
      });
    }

    // 输出纯文本分镜（imageUrl 暂时留空，后续渲染阶段填充）
    const storyboards: Storyboard[] = storyboardPlans.map((plan: any) => ({
      shotNumber: plan.shotNumber,
      imageUrl: '', // 暂无图片，等待统一渲染
      prompt: plan.visualDescription,
      // 附加规划数据供渲染阶段使用
      planData: {
        cameraAngle: plan.cameraAngle || plan.cameraWork || '',
        composition: plan.composition,
        lighting: plan.lighting,
        colorTone: plan.colorTone,
        characterAction: plan.characterAction,
        shotDuration: plan.shotDuration,
        tensionLevel: plan.tensionLevel,
        transitionNote: plan.transitionNote,
      },
    }));

    this.update(AgentRole.STORYBOARD, { status: 'completed', progress: 100, output: storyboards });
    // 计算张力曲线摘要
    const tensionValues = storyboards.map((sb: any) => sb.planData?.tensionLevel || 5);
    const maxTension = Math.max(...tensionValues);
    const avgTension = Math.round(tensionValues.reduce((a: number, b: number) => a + b, 0) / tensionValues.length);

    this.emit('agentTalk', {
      role: AgentRole.STORYBOARD,
      text: `${storyboards.length}个分镜描述规划完成！张力曲线: 平均${avgTension}/10, 峰值${maxTension}/10 🎬\n景别递进+镜头语言已注入, 接下来统一渲染确保一致性 📐`
    });

    // 通过 SSE 发送分镜描述供前端展示
    for (const sb of storyboards) {
      this.emit('storyboardPlan', {
        shotNumber: sb.shotNumber,
        description: sb.prompt,
        planData: (sb as any).planData,
      });
    }

    return storyboards;
  }

  // ══════════════════════════════════════
  // 分镜渲染 第2阶段：统一渲染分镜图（角色/场景/画风一致性）
  // ══════════════════════════════════════
  async runStoryboardRenderer(
    storyboards: Storyboard[],
    script: Script,
    characters: any[],
    scenes?: any[]
  ): Promise<Storyboard[]> {
    this.update(AgentRole.STORYBOARD, { status: 'working', currentTask: `统一渲染 ${storyboards.length} 个分镜图`, progress: 0 });
    this.emit('agentTalk', { role: AgentRole.STORYBOARD, text: `开始统一渲染分镜图，严格保持角色和画风一致性！🎨` });

    // 构建角色名→图片URL映射
    const charUrlMap = new Map<string, string>();
    for (const c of characters) {
      if (c.imageUrl && !c.imageUrl.startsWith('data:')) {
        charUrlMap.set(c.character, c.imageUrl);
      }
    }

    // 构建场景名→图片URL映射
    const sceneUrlMap = new Map<string, string>();
    if (scenes) {
      for (const s of scenes) {
        if (s.imageUrl && !s.imageUrl.startsWith('data:')) {
          sceneUrlMap.set(s.name, s.imageUrl);
        }
      }
    }

    // v2.11 #5: 场景锚点注册表 — 把每个场景概念图按 location/name + description 双 key 登记进去,
    // 后续每个 shot 通过 location 字段精确查锚点 (而不是脆弱的 sceneDesc.includes 模糊匹配),
    // 同 location 多个 shot 一定拿同一张 sref 复用, 风格不漂移。
    const { SceneAnchorRegistry, pickConsistencyRefs } = await import('@/lib/consistency-policy');
    const sceneAnchors = new SceneAnchorRegistry();
    if (scenes) {
      for (const s of scenes) {
        if (!s.imageUrl || s.imageUrl.startsWith('data:')) continue;
        sceneAnchors.register(s.name || s.location || '', { url: s.imageUrl, description: s.description });
        // 同一图也按 location 再登一次, 方便不同写法都能查到
        if (s.location && s.location !== s.name) {
          sceneAnchors.register(s.location, { url: s.imageUrl, description: s.description });
        }
      }
    }

    // ═══ 并发渲染分镜图（2路并发 + 每张3分钟超时）═══
    const CONCURRENCY = 2;
    const SB_TIMEOUT = 180_000; // 3 分钟
    const orderedResults: (Storyboard | null)[] = new Array(storyboards.length).fill(null);
    let completedCount = 0;

    const renderSingleShot = async (sb: Storyboard, i: number): Promise<Storyboard> => {
      const shot = script.shots?.find(s => s.shotNumber === sb.shotNumber) || script.shots?.[i];
      const planData = (sb as any).planData || {};

      this.update(AgentRole.STORYBOARD, {
        currentTask: `渲染第 ${sb.shotNumber} 镜（角色一致性 + 画风一致性）`,
        progress: Math.round((completedCount / storyboards.length) * 100),
      });

      // v2.11 #5: 用集中的一致性策略选取 cref/sref/cw —— 锁脸 → cw 125 / 主角 100 / 配角 80
      const shotCharacters = shot?.characters || [];
      const sceneDesc = shot?.sceneDescription || sb.prompt;
      const isProtagonistShot = shotCharacters.length > 0 && (
        shotCharacters[0] === characters[0]?.character ||
        shotCharacters[0] === characters[0]?.name
      );
      const refsPick = pickConsistencyRefs({
        primaryCharacterRef: this.primaryCharacterRef,
        primaryCharacterRefLocked: this.primaryCharacterRefLocked,
        charUrlMap,
        sceneAnchors,
        shotCharacterNames: shotCharacters,
        shotLocation: (shot as any)?.location,
        shotSceneDescription: sceneDesc,
        fallbackSceneRef: scenes && scenes[0]?.imageUrl && !scenes[0].imageUrl.startsWith('data:') ? scenes[0].imageUrl : undefined,
        isProtagonistShot,
        // v2.12 Phase 2: per-shot 角色路由 — pickConsistencyRefs 会按 shot.characters
        // 匹配 lockedCharacters[].name,命中就用该角色独立的 imageUrl 与 cw
        lockedCharacters: this.lockedCharacters,
      });
      const crefUrl = refsPick.cref;
      const srefUrl = refsPick.sref;
      const matched = refsPick.reason.matchedLockedName ? ` matched=${refsPick.reason.matchedLockedName}` : '';
      console.log(`[Renderer] Shot ${sb.shotNumber} consistency policy: cref=${refsPick.reason.crefSource}${matched} sref=${refsPick.reason.srefSource} cw=${refsPick.cw}(${refsPick.reason.cwTier})${refsPick.extraCrefs?.length ? ` +${refsPick.extraCrefs.length} extra cref(s)` : ''}`);

      // 使用统一渲染提示词
      let renderPrompt = getUnifiedStoryboardRenderPrompt(
        sb.prompt,
        planData.cameraAngle || 'Medium Shot, eye level',
        planData.lighting || 'Natural ambient lighting',
        planData.colorTone || 'neutral tones',
        this.styleKeywords,
        shotCharacters,
        Object.keys(this.characterAppearanceMap).length > 0 ? this.characterAppearanceMap : undefined,
        planData.colorPalette || undefined
      );

      if (planData.composition) {
        renderPrompt = `${renderPrompt}, composition: ${planData.composition}`;
      }
      if (planData.characterAction) {
        renderPrompt = `${renderPrompt}, character action: ${planData.characterAction}`;
      }

      // P1: 注入角色视觉锚点
      const anchorPrompt = buildCharacterAnchorPrompt(this.characterAnchors, shotCharacters);
      if (anchorPrompt) {
        renderPrompt = `${renderPrompt}. ${anchorPrompt}`;
      }

      // P1: 主角色参考图回退已在 pickConsistencyRefs 里完成 (crefSource=first-character),
      // 不再在这里重复; 见 lib/consistency-policy.ts 的优先级实现。

      if (crefUrl) {
        renderPrompt = `${renderPrompt}, consistent character design, same character as reference, identical facial features and outfit`;
      }
      if (srefUrl) {
        renderPrompt = `${renderPrompt}, consistent scene style, same environment as reference`;
      }

      renderPrompt = optimizeMidjourneyPrompt(renderPrompt);

      // P4: 渐进式一致性链（并发安全 — 读取当前已完成的分镜图）
      const progressiveRefs: string[] = [];
      if (crefUrl) progressiveRefs.push(crefUrl);
      // v2.12 Phase 2: 同一镜头里其他匹配上的 lockedCharacters 的脸图也塞 referenceImages,
      // 让 MJ/Minimax 同时看到 A 和 B 的脸,避免多角色同框时把 B 也画成 A
      if (refsPick.extraCrefs?.length) {
        for (const u of refsPick.extraCrefs) if (u && !progressiveRefs.includes(u)) progressiveRefs.push(u);
      }
      if (srefUrl) progressiveRefs.push(srefUrl);
      const recentRendered = this.renderedStoryboardUrls.slice(-2);
      for (const url of recentRendered) {
        if (!progressiveRefs.includes(url)) {
          progressiveRefs.push(url);
        }
      }

      console.log(`[P4-Chain] Shot ${sb.shotNumber}: ${progressiveRefs.length} reference images (cref=${!!crefUrl}, sref=${!!srefUrl}, chain=${recentRendered.length})`);

      // 单张分镜限时 3 分钟; cw 由 policy 决定 (锁脸 125, 主角 100, 配角 80)
      const imageUrl = await Promise.race([
        this.generateImage(renderPrompt, {
          aspectRatio: '16:9',
          label: `Shot ${sb.shotNumber}`,
          cref: crefUrl,
          cw: refsPick.cw,
          sref: srefUrl,
          referenceImages: progressiveRefs.length > 0 ? progressiveRefs : undefined,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error(`Storyboard timeout: Shot ${sb.shotNumber}`)), SB_TIMEOUT)
        ),
      ]).catch(err => {
        console.warn(`[Renderer] Shot ${sb.shotNumber} failed: ${err.message}, using mock`);
        return mockSvg(1344, 768, '#1e1b4b', '#7c3aed', `Shot ${sb.shotNumber}`);
      });

      // ── v2.12 Sprint A.1 · Cameo Vision Auto-Retry (< 75 触发重生) ───────
      // 真实 mj/dalle 生成的 http 图才走 retry; mock svg / data: URI 跳过 (省 vision token)
      let finalImageUrl = imageUrl;
      let cameoOutcome: Awaited<ReturnType<typeof import('@/services/cameo-retry').evaluateAndRetry>> | null = null;
      const isRealRender = imageUrl && !imageUrl.startsWith('data:') && !imageUrl.startsWith('<svg');
      if (isRealRender && crefUrl) {
        try {
          const { evaluateAndRetry } = await import('@/services/cameo-retry');
          // 取同角色最近 2 张已成功的分镜图作为额外 sref —— 强化一致性链
          const sameCharRecent = this.renderedStoryboardUrls.slice(-2).filter((u) => u !== imageUrl);
          cameoOutcome = await evaluateAndRetry({
            shotImageUrl: imageUrl,
            referenceImageUrl: crefUrl,
            characterName: shotCharacters[0],
            originalCw: refsPick.cw,
            sameCharacterRecentShots: sameCharRecent,
            shotNumber: sb.shotNumber,
            regenerate: async (boostedCw, extraRefs) => {
              const reinforcedPrompt = `${renderPrompt}, IDENTICAL face structure to reference, same character identity, ${shotCharacters[0] || 'same protagonist'}`;
              const reinforcedRefs = [...progressiveRefs, ...extraRefs].filter(
                (u, idx, arr) => u && arr.indexOf(u) === idx
              );
              return await this.generateImage(reinforcedPrompt, {
                aspectRatio: '16:9',
                label: `Shot ${sb.shotNumber} (cameo-retry cw${boostedCw})`,
                cref: crefUrl,
                cw: boostedCw,
                sref: srefUrl,
                referenceImages: reinforcedRefs.length > 0 ? reinforcedRefs : undefined,
              });
            },
          });
          finalImageUrl = cameoOutcome.finalImageUrl;
          if (cameoOutcome.retried) {
            this.emit('agentTalk', {
              role: AgentRole.STORYBOARD,
              text: cameoOutcome.finalScore != null
                ? `🎯 第 ${sb.shotNumber} 镜一致性自动重生: ${cameoOutcome.firstScore} → ${cameoOutcome.finalScore} (cw ${refsPick.cw}→${cameoOutcome.finalCw})`
                : `🎯 第 ${sb.shotNumber} 镜一致性自动重生 (cw ${refsPick.cw}→${cameoOutcome.finalCw})`,
            });
          }
        } catch (e) {
          // retry 模块自身崩了 (vision 网络问题等), 不影响主流程, 用原图
          console.warn(`[Renderer] cameo-retry shot ${sb.shotNumber} threw, fallback to original:`, e instanceof Error ? e.message : e);
        }
      }

      // P4: 将成功渲染的图片加入一致性链
      if (finalImageUrl && !finalImageUrl.startsWith('data:')) {
        this.renderedStoryboardUrls.push(finalImageUrl);
      }

      completedCount++;
      this.update(AgentRole.STORYBOARD, { progress: Math.round((completedCount / storyboards.length) * 100) });

      // 把 cameo retry 痕迹挂到 storyboard 上 — A.4 仪表盘 (分镜 tab) 直接消费这些字段
      const out: Storyboard = { shotNumber: sb.shotNumber, imageUrl: finalImageUrl, prompt: renderPrompt };
      if (cameoOutcome) {
        if (cameoOutcome.finalScore != null) out.cameoScore = cameoOutcome.finalScore;
        if (cameoOutcome.retried) {
          out.cameoRetried = true;
          out.cameoFinalCw = cameoOutcome.finalCw;
        }
        out.cameoAttempts = cameoOutcome.attempts;
        if (cameoOutcome.reasoning) out.cameoReason = cameoOutcome.reasoning;
      }
      return out;
    };

    // Worker-based 并发调度器
    const indexedQueue = storyboards.map((sb, idx) => ({ sb, idx }));
    const workers: Promise<void>[] = [];

    for (let w = 0; w < Math.min(CONCURRENCY, indexedQueue.length); w++) {
      workers.push((async () => {
        while (indexedQueue.length > 0) {
          const item = indexedQueue.shift();
          if (!item) break;
          orderedResults[item.idx] = await renderSingleShot(item.sb, item.idx);
        }
      })());
    }

    await Promise.all(workers);

    const rendered = orderedResults.filter((r): r is Storyboard => r !== null);

    this.update(AgentRole.STORYBOARD, { status: 'completed', progress: 100, output: rendered });
    this.emit('agentTalk', {
      role: AgentRole.STORYBOARD,
      text: `分镜图统一渲染完成！${rendered.length} 个分镜图，角色/画风一致性保障 + 渐进参考链 ✅`
    });
    return rendered;
  }

  // ══════════════════════════════════════
  // 视频制作（增强一致性：角色图+场景图+分镜脚本→Veo）
  // ══════════════════════════════════════
  async runVideoProducer(
    storyboards: Storyboard[],
    videoProvider: string,
    characters?: any[],
    scenes?: any[],
    script?: Script
  ): Promise<VideoClip[]> {
    // ★ 2026-04 priority flip: Veo primary, Minimax fallback (Veo vectorengine more stable)
    const providerLabel = this.veoService ? 'Veo 3.1' : (this.minimaxService ? 'Minimax' : 'Kling');
    this.update(AgentRole.VIDEO_PRODUCER, { status: 'working', currentTask: `制作 ${storyboards.length} 个视频`, progress: 0 });

    // v2.11 #1: 向前端报告总 shot 数,让 ConsistencyPanel 算 X/N 时分母准确
    this.emit('runMeta', { totalShots: storyboards.length });

    // ═══════════════════════════════════════════════════════════════
    // 业界最佳实践："首帧锚定 + 角色参考" 双保险模式
    //
    //   角色参考图(subject_reference) → 锁定面部/服装/体型（S2V-01）
    //   场景参考图(first_frame_image)  → 锁定构图/背景/氛围
    //
    // 路由优先级：
    //   有角色图 + 有场景图 → S2V-01(双锚) > video-01(首帧) > Veo > Kling
    //   仅有场景图         → video-01(首帧) > Veo(首帧) > Kling(首帧)
    //   无参考图           → video-01(纯文) > Veo(纯文) > Kling(纯文)
    // ═══════════════════════════════════════════════════════════════

    // 构建角色名→图片URL映射（仅保留真实URL，排除 mock SVG data URI）
    const charUrlMap = new Map<string, string>();
    if (characters) {
      for (const c of characters) {
        const name = c.character || c.name;
        if (c.imageUrl && !c.imageUrl.startsWith('data:') && (c.imageUrl.startsWith('http') || c.imageUrl.startsWith('/api/serve-file')) && name) {
          charUrlMap.set(name, c.imageUrl);
        }
      }
    }
    // 主角色参考图（用于 S2V-01 subject_reference 和无法匹配角色时的 fallback）
    const primaryCharRef = this.primaryCharacterRef || Array.from(charUrlMap.values())[0] || '';

    // 构建场景名→图片URL映射
    const sceneUrlMap = new Map<string, string>();
    if (scenes) {
      for (const s of scenes) {
        if (s.imageUrl && !s.imageUrl.startsWith('data:') && (s.imageUrl.startsWith('http') || s.imageUrl.startsWith('/api/serve-file'))) {
          sceneUrlMap.set(s.name || s.location, s.imageUrl);
        }
      }
    }

    this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text:
      `${storyboards.length}个镜头开始生成视频 🎥\n` +
      `• 角色参考图: ${charUrlMap.size > 0 ? `${charUrlMap.size}个角色锁定` : '无（纯文生成）'}\n` +
      `• 场景首帧: ${sceneUrlMap.size > 0 ? `${sceneUrlMap.size}个场景锚定` : '无'}\n` +
      `• 引擎优先级: ${this.veoService ? 'Veo 3.1(主)' : ''}${this.veoService && this.minimaxService ? ' → ' : ''}${this.minimaxService ? 'Minimax S2V-01(兜底)' : ''}${this.klingService ? ' → 可灵' : ''}`
    });

    // ═══ 并发视频生成（限制同时 2 路，避免 API 限流）═══
    const CONCURRENCY = 2;
    const generateSingleVideo = async (board: Storyboard, i: number): Promise<VideoClip> => {
      const shot = script?.shots?.find(s => s.shotNumber === board.shotNumber) || script?.shots?.[i];
      const planData = (board as any).planData || {};

      this.update(AgentRole.VIDEO_PRODUCER, {
        currentTask: `制作第 ${board.shotNumber} 镜视频（${providerLabel}）`,
        progress: Math.round((i / storyboards.length) * 100),
      });

      // ── 精确匹配：该镜头涉及哪个角色 → 找到对应角色参考图 ──
      let characterRefUrl = '';
      const shotCharacters = shot?.characters || [];
      for (const charName of shotCharacters) {
        const url = charUrlMap.get(charName);
        if (url) { characterRefUrl = url; break; }
      }
      // 降级到主角色参考图
      if (!characterRefUrl) characterRefUrl = primaryCharRef;

      // ── 精确匹配：该镜头对应哪个场景 → 找到对应场景参考图 ──
      let sceneRefUrl = '';
      const sceneDesc = shot?.sceneDescription || board.prompt;
      for (const [sceneName, url] of sceneUrlMap.entries()) {
        if (sceneDesc.includes(sceneName) || sceneName.includes(sceneDesc.slice(0, 10))) {
          sceneRefUrl = url; break;
        }
      }
      if (!sceneRefUrl && scenes?.length) {
        // 降级到第一个有效场景图
        sceneRefUrl = Array.from(sceneUrlMap.values())[0] || '';
      }

      // ═══ v2.8 (Seedance 2.0 同款): 多参考图统一打包 ═══
      // 把"分镜渲染图 + 出场角色三视图 + 场景概念图 + 风格锚点图"
      // 打成一个统一的 reference bundle,视频/配乐全流程共用,保证:
      //   - 每个 shot 的角色/场景/风格都来自同一套参考图
      //   - Veo 3.1 ingredient-to-video 收到多图触发高一致性路径
      //   - Minimax S2V-01 的 subject_reference[] 可锁多个主体
      const prevStoryboard = i > 0 ? storyboards[i - 1] : undefined;
      const prevStoryboardUrl = prevStoryboard?.imageUrl && prevStoryboard.imageUrl.startsWith('http')
        ? prevStoryboard.imageUrl : undefined;
      const ownStoryboardImg = board.imageUrl && !board.imageUrl.startsWith('data:')
        && (board.imageUrl.startsWith('http') || board.imageUrl.startsWith('/api/serve-file'))
        ? board.imageUrl : undefined;
      // 风格锚点图: 用第一个分镜作为全片风格参考(Seedance 的 sref 模式)
      const styleAnchorUrl = storyboards[0]?.imageUrl && storyboards[0].imageUrl.startsWith('http')
        && storyboards[0].shotNumber !== board.shotNumber
        ? storyboards[0].imageUrl
        : undefined;
      // v2.9 P1 Keyframes: 如果前一 shot 已经生成完并抽了末帧,作为衔接参考(提升跨 shot 连续性)
      const curShotNum = board.shotNumber ?? (i + 1);
      const prevShotLastFrame = this.shotLastFrames.get(curShotNum - 1);
      const mrBundle = buildMultiReferenceBundle({
        storyboardImageUrl: ownStoryboardImg,
        shotCharacterNames: shotCharacters,
        characterImageMap: charUrlMap,
        sceneImageUrl: sceneRefUrl || undefined,
        styleReferenceUrl: styleAnchorUrl,
        previousStoryboardUrl: prevStoryboardUrl,
        // v2.9 P0 Cameo: 项目锁定的主角脸,优先级最高
        cameoReferenceUrl: this.primaryCharacterRefLocked ? this.primaryCharacterRef : undefined,
        // v2.9 P1 Keyframes: 上一 shot 末帧
        previousShotLastFrameUrl: prevShotLastFrame,
        // v2.11 #3 智能插帧:全局风格锚点(中间帧),抗链式漂移
        // 不塞到本 shot 的 anchor 上(避免 shot 1 生成前就引用自己)
        globalAnchorFrameUrl: (this.globalAnchorFrame && curShotNum > 1) ? this.globalAnchorFrame : undefined,
        maxSubjects: 2,
        maxExtraRefs: 3,
      });
      console.log(`[MultiRef] Shot ${board.shotNumber}: ${mrBundle.composition || 'empty'}${prevShotLastFrame ? ' + prev_last_frame' : ''}`);

      // v2.10 C: 一致性状态事件 —— 告诉前端本 shot 的 Cameo/Keyframe 接上没
      // 前端拿这两个事件 aggregate 出徽章:"12/15 shots 已锁脸 · 11/15 已衔接"
      const cameoApplied = mrBundle.characterNames.includes('__cameo_primary__');
      const keyframeChained = Boolean(prevShotLastFrame);
      // v2.11 #3: 本 shot 有没有拿到全局风格锚点
      const globalAnchorApplied = curShotNum > 1 && Boolean(this.globalAnchorFrame);
      if (cameoApplied) {
        this.emit('consistencyStatus', {
          shotNumber: curShotNum,
          type: 'cameoApplied',
          cameoUrl: this.primaryCharacterRef,
        });
      }
      if (keyframeChained) {
        this.emit('consistencyStatus', {
          shotNumber: curShotNum,
          type: 'keyframeChained',
          fromShot: curShotNum - 1,
          frameUrl: prevShotLastFrame,
        });
      }
      if (globalAnchorApplied) {
        this.emit('consistencyStatus', {
          shotNumber: curShotNum,
          type: 'globalAnchorApplied',
          anchorUrl: this.globalAnchorFrame,
        });
      }

      // ═══ 增强版 Prompt 构建：严格对齐剧本 + 角色外貌 + 场景 ═══

      // 1. 构建详细的角色外貌描述
      const charDescriptions: string[] = [];
      for (const charName of shotCharacters) {
        const charData = characters?.find((c: any) => (c.character || c.name) === charName);
        if (charData) {
          const appearance = this.characterAppearanceMap[charName] || charData.appearance || charData.description || '';
          charDescriptions.push(`${charName}: ${appearance}`);
        } else {
          charDescriptions.push(charName);
        }
      }
      if (charDescriptions.length === 0 && characters?.length) {
        const c = characters[0];
        const appearance = this.characterAppearanceMap[c.character || c.name] || c.appearance || c.description || '';
        charDescriptions.push(`${c.character || c.name}: ${appearance}`);
      }

      // 2. 从剧本中提取该镜头的具体指令
      const scriptAction = shot?.action || '';
      const scriptEmotion = shot?.emotion || '';
      const scriptDialogue = shot?.dialogue || '';
      const sceneDescription = shot?.sceneDescription || board.prompt;

      // 3. 构建结构化 prompt（按重要性排序）
      let enhancedPrompt = '';

      // v2.8: 如果 Writer 输出了 cinema 字段,先用 Veo 3 prose prefix 锁镜头语言
      // 让每个 shot 的 prompt 第一句就是 "slow push in on 85mm, MCU, low-angle:"
      // 视频模型对首句 camera token 注意力最高,平镜头→有质感的转变就靠这个
      const cinemaPrefix = shot ? applyCinemaToVisualPrompt(shot) : '';
      if (cinemaPrefix && cinemaPrefix !== (shot?.visualPrompt || '')) {
        // applyCinemaToVisualPrompt 返回的是带 prefix 的完整 visualPrompt
        enhancedPrompt = cinemaPrefix;
      } else if (shot?.visualPrompt) {
        enhancedPrompt = shot.visualPrompt;
      } else {
        enhancedPrompt = sceneDescription;
      }

      if (charDescriptions.length > 0) {
        enhancedPrompt += `. Character: ${charDescriptions.join('; ')}`;
      }
      if (scriptAction) {
        enhancedPrompt += `. Action: ${scriptAction}`;
      }
      if (scriptDialogue) {
        enhancedPrompt += `. Speaking: "${scriptDialogue.slice(0, 60)}"`;
      }
      if (scriptEmotion) {
        enhancedPrompt += `. Mood: ${scriptEmotion}`;
      }

      // 镜头语言(旧路径,planData 有值时作为兜底补充)
      if (planData.cameraAngle && !/angle/i.test(enhancedPrompt.slice(0, 80))) {
        enhancedPrompt += `, ${planData.cameraAngle} shot`;
      }
      if (planData.lighting) enhancedPrompt += `, ${planData.lighting} lighting`;

      // v2.8: Writer 层的声音设计直接透传给视频模型(Veo 3/Sora 2 能响应 audio cues)
      if (shot?.diegeticSound) enhancedPrompt += `. Diegetic audio: ${shot.diegeticSound}`;

      // 风格一致性
      if (this.styleKeywords) enhancedPrompt += `, ${this.styleKeywords}`;
      enhancedPrompt += ', cinematic quality';

      // P1: 注入角色视觉锚点
      const anchorPrompt = buildCharacterAnchorPrompt(this.characterAnchors, shotCharacters);
      if (anchorPrompt) enhancedPrompt += `. ${anchorPrompt}`;

      // ── 首帧选择策略：分镜渲染图 > 场景图 ──
      const storyboardImage = board.imageUrl && !board.imageUrl.startsWith('data:') && (board.imageUrl.startsWith('http') || board.imageUrl.startsWith('/api/serve-file')) ? board.imageUrl : '';
      const firstFrameUrl = mrBundle.firstFrameUrl || storyboardImage || sceneRefUrl;

      // 截断 prompt（视频 API 通常限制 1500 字符以内）
      if (enhancedPrompt.length > 1500) {
        enhancedPrompt = enhancedPrompt.slice(0, 1500);
      }

      // 远程视频 API 只能使用公网可达的 http(s) URL 作为参考图
      const hasCharRef = characterRefUrl && characterRefUrl.startsWith('http');
      const hasFirstFrame = firstFrameUrl && firstFrameUrl.startsWith('http');
      console.log(`[Video] Shot ${board.shotNumber}: charRef=${hasCharRef ? 'YES' : 'NO'}, firstFrame=${storyboardImage ? 'STORYBOARD' : hasFirstFrame ? 'SCENE' : 'NONE'}, promptLen=${enhancedPrompt.length}`);

      let videoUrl: string = '';

      // ═══════════════════════════════════════════════════════
      // 引擎路由策略（2026-04 实测调优）：
      //
      // ★ Veo 3.1 优先（vectorengine 通道最稳定，I2V/T2V 质量最佳）
      // ★ Minimax S2V-01 兜底（角色一致性强，但 qingyuntop pool 易饱和）
      // ★ Kling 终极兜底
      //
      // 用户反馈"镜头生成总是失败"——Minimax 主路径在 pool 饱和时大量 503,
      // 翻转为 Veo 优先可显著提高 success rate（实测 vectorengine 池容量更大）。
      // ═══════════════════════════════════════════════════════
      const availableEngines: VideoEngine[] = [];
      // ★ Veo 官方优先（vectorengine.ai 通道，实测稳定性最佳）
      if (this.veoService) availableEngines.push('veo');
      if (this.minimaxService?.isVideoAvailable()) availableEngines.push('minimax');
      if (this.klingService) availableEngines.push('kling');

      if (availableEngines.length > 0) {
        const route = routeVideoEngine(
          enhancedPrompt, shot?.emotion || '', videoProvider, availableEngines
        );
        console.log(`[P2-Route] Shot ${board.shotNumber}: ${route.primary} (${route.reason}), fallbacks: [${route.fallbacks.join(',')}]`);

        // ★ 2026-04 翻转：Veo 首选 → Minimax 兜底 → Kling
        // 用户显式请求 minimax 时仍然尊重路由,否则强制 Veo 打头
        let engineOrder: VideoEngine[];
        if (videoProvider === 'minimax' && this.minimaxService?.isVideoAvailable()) {
          engineOrder = ['minimax', 'veo', 'kling'].filter(e => availableEngines.includes(e as VideoEngine)) as VideoEngine[];
        } else if (this.veoService) {
          engineOrder = ['veo', 'minimax', 'kling'].filter(e => availableEngines.includes(e as VideoEngine)) as VideoEngine[];
        } else {
          engineOrder = [route.primary, ...route.fallbacks];
        }
        engineOrder = [...new Set(engineOrder)]; // 去重

        let generated = false;

        for (const engine of engineOrder) {
          if (generated) break;
          const engineLabel = engine === 'veo' ? 'Veo 3.1' : engine === 'kling' ? '可灵 AI' : (hasCharRef ? 'Minimax(I2V+角色)' : hasFirstFrame ? 'Minimax I2V-01' : 'Minimax Hailuo-2.3');
          this.emit('agentTalk', {
            role: AgentRole.VIDEO_PRODUCER,
            text: `镜头 ${board.shotNumber}/${storyboards.length} → ${engineLabel}${hasCharRef && engine === 'minimax' ? '（角色锁定）' : ''}${hasFirstFrame ? '（首帧锚定）' : ''}`
          });

          try {
            if (engine === 'minimax' && this.minimaxService) {
              // ★ v2.8 (Seedance 2.0 同款): 多主体 + 场景/风格辅助参考图
              //   - subjectReferences: 该 shot 出场的每个角色一个条目(多主体锁)
              //   - firstFrameImage: 分镜渲染图(锁构图)
              //   - referenceImages: 场景图 + 风格锚点图(辅助上下文)
              const subjectRefs = mrBundle.subjectImages.map((url, idx) => ({
                type: 'character' as const,
                imageUrl: url,
                name: mrBundle.characterNames[idx],
              }));
              videoUrl = await this.minimaxService.generateVideo(firstFrameUrl, enhancedPrompt, {
                subjectReferenceUrl: hasCharRef ? characterRefUrl : undefined,
                subjectReferences: subjectRefs.length > 0 ? subjectRefs : undefined,
                referenceImages: mrBundle.referenceImages.length > 0 ? mrBundle.referenceImages : undefined,
              });
            } else if (engine === 'veo' && this.veoService) {
              // ★ v2.8: Veo 3.1 multi-reference — 把整个 bundle 拍平给 ingredient-to-video
              const veoRefs = flattenBundleToUrls(mrBundle, 4)
                .filter((u) => u !== firstFrameUrl); // 首帧不重复算
              videoUrl = await this.veoService.generateVideo(
                firstFrameUrl, enhancedPrompt,
                {
                  duration: 8,
                  referenceImages: veoRefs.length > 0 ? veoRefs : undefined,
                  onProgress: (progress, status) => {
                    this.emit('videoProgress', { shotNumber: board.shotNumber, progress, status });
                  }
                }
              );
            } else if (engine === 'kling' && this.klingService) {
              videoUrl = await this.klingService.generateVideo(
                firstFrameUrl, enhancedPrompt,
                {
                  duration: 5,
                  onProgress: (progress, status) => {
                    this.emit('videoProgress', { shotNumber: board.shotNumber, progress, status });
                  }
                }
              );
            } else {
              throw createError('ENGINE_UNAVAILABLE', `${engine} 引擎未配置`, {
                stage: 'video', retryable: false, details: { engine, shotNumber: board.shotNumber },
              });
            }

            if (videoUrl && isValidVideoUrl(videoUrl)) {
              console.log(`[P2-Route] Shot ${board.shotNumber} generated via ${engine}${hasCharRef && engine === 'minimax' ? '(S2V-01)' : ''}`);
              generated = true;
            } else {
              throw createError('INVALID_RESPONSE', `${engine} 返回的视频 URL 无效`, {
                stage: 'video', retryable: true, details: { engine, shotNumber: board.shotNumber, returned: videoUrl },
              });
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error(`[P2-Route] Shot ${board.shotNumber} ${engine} failed:`, errMsg.slice(0, 200));
            // ── 把真实错误文本 surface 到用户,不要只说"失败" ──
            // 关键信号: 上游池饱和 / 余额不足 / 配额耗尽 / 超时 — 这些用户需要看到,才知道不是 bug 而是上游问题
            let userHint = '';
            if (/pre_consume_token_quota_failed|上游.*饱和|分组.*饱和/i.test(errMsg)) {
              userHint = '上游视频池饱和(非 bug,稍后重试)';
            } else if (/余额不足|insufficient.*balance|quota.*exceeded/i.test(errMsg)) {
              userHint = '余额不足';
            } else if (/timeout|ETIMEDOUT|AbortError/i.test(errMsg)) {
              userHint = '超时';
            } else if (/rate.?limit|429/i.test(errMsg)) {
              userHint = '限流';
            } else {
              // 未识别错误: 把原始文本前 80 字直接贴出来
              userHint = errMsg.replace(/\s+/g, ' ').slice(0, 80);
            }
            this.emit('agentTalk', {
              role: AgentRole.VIDEO_PRODUCER,
              text: `⚠️ ${engineLabel} 失败 (${userHint})，尝试下一个引擎...`,
            });
          }
        }

        if (!generated) {
          console.warn(`[P2-Degradation] Shot ${board.shotNumber}: all engines failed`);
          this.emit('agentTalk', {
            role: AgentRole.VIDEO_PRODUCER,
            text: `⚠️ 镜头 ${board.shotNumber} 所有引擎均失败，将在后续重试`
          });
          // 发出结构化错误事件 - 前端可据此渲染"重试此镜头"按钮
          this.emit('pipelineError', {
            code: 'ALL_ENGINES_FAILED',
            userMsg: `镜头 ${board.shotNumber} 所有视频引擎均失败`,
            retryable: true,
            stage: 'video',
            details: { shotNumber: board.shotNumber },
          });
          videoUrl = '';
        }
      } else {
        await sleep(1000);
        videoUrl = '';
      }

      const clip = { shotNumber: board.shotNumber, videoUrl, duration: 8, status: 'completed' as const };

      // v2.9 P1 Keyframes: 异步抽末帧存进 shotLastFrames,下一 shot 开始时会读它作参考图
      // fire-and-forget —— 抽帧耗时 ~0.5s,不阻塞主推理流,失败也不影响本 shot 结果
      if (videoUrl && (videoUrl.startsWith('http') || videoUrl.startsWith('/api/serve-file'))) {
        const shotNo = board.shotNumber ?? (i + 1);
        void extractLastFrame(videoUrl)
          .then((frameUrl) => {
            if (frameUrl) {
              this.shotLastFrames.set(shotNo, frameUrl);
              console.log(`[P1-Keyframes] Shot ${shotNo} last frame cached → ${frameUrl.slice(0, 60)}...`);
            }
          })
          .catch((e) => {
            console.warn(`[P1-Keyframes] Shot ${shotNo} extract failed:`, e instanceof Error ? e.message : e);
          });

        // v2.11 #3 智能插帧:每 3 shots 刷新一次全局风格锚点(中间帧)
        // shot 1/4/7/... 触发,shot 1 设首次基准,后面覆盖做 drift correction
        const shouldRefreshAnchor = (shotNo === 1) || (shotNo % 3 === 1);
        if (shouldRefreshAnchor) {
          void extractMiddleFrame(videoUrl)
            .then((frameUrl) => {
              if (frameUrl) {
                const isFirst = !this.globalAnchorFrame;
                this.globalAnchorFrame = frameUrl;
                console.log(`[v2.11-GlobalAnchor] ${isFirst ? 'initialized' : 'refreshed'} from shot ${shotNo}: ${frameUrl.slice(0, 60)}...`);
                this.emit('consistencyStatus', {
                  shotNumber: shotNo,
                  type: 'globalAnchorSet',
                  anchorUrl: frameUrl,
                });
              }
            })
            .catch((e) => {
              console.warn(`[v2.11-GlobalAnchor] Shot ${shotNo} middle frame failed:`, e instanceof Error ? e.message : e);
            });
        }
      }

      // 逐条推送：每生成一个视频就立即通知前端
      this.emit('videoClip', clip);
      if (videoUrl) {
        this.emit('agentTalk', {
          role: AgentRole.VIDEO_PRODUCER,
          text: `✅ 镜头 ${board.shotNumber}/${storyboards.length} 生成完成`
        });
      }
      return clip;
    };

    // ═══ 并发调度器：最多同时 CONCURRENCY 路 ═══
    const videos: VideoClip[] = new Array(storyboards.length);
    let completedCount = 0;
    const queue = storyboards.map((board, i) => ({ board, i }));
    const workers: Promise<void>[] = [];

    for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) {
      workers.push((async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (!task) break;
          const { board, i } = task;
          try {
            videos[i] = await generateSingleVideo(board, i);
          } catch (e) {
            console.error(`[Video] Shot ${board.shotNumber} generation error:`, e);
            videos[i] = { shotNumber: board.shotNumber, videoUrl: '', duration: 8, status: 'completed' as const };
          }
          completedCount++;
          this.update(AgentRole.VIDEO_PRODUCER, { progress: Math.round((completedCount / storyboards.length) * 100) });
        }
      })());
    }
    await Promise.all(workers);

    // ═══ 失败镜头二次重试（2026-04-20 重构：三级策略，显著降低 Ken Burns 兜底率）═══
    //
    // 重试通常是以下原因之一:
    //   (a) 上游 pool 饱和 (429/503/pre_consume_token_quota_failed) — 等 20s 再试同引擎
    //   (b) first_frame_image 被 reject (NSFW/尺寸/格式) — 剥离首帧做纯 T2V
    //   (c) prompt 敏感词/过长 — 用净化后的超简提示词
    //
    // 策略:
    //   Pass-A: 等 20s,用 shot 自己的 storyboard 图做 I2V(Veo 优先) — 扛住瞬时饱和
    //   Pass-B: 剥离首帧,纯 T2V 简化 prompt,duration=5(更容易过审) — 扛住图片/时长问题
    //   Pass-C: 还不行才交给后面的 Ken Burns animatic 兜底
    const failedVideos = videos.filter(v => !isValidVideoUrl(v.videoUrl));
    if (failedVideos.length > 0) {
      this.emit('agentTalk', {
        role: AgentRole.VIDEO_PRODUCER,
        text: `🔄 ${failedVideos.length} 个镜头生成失败，启动三级重试策略...`
      });

      // 重试也并发（最多 2 路）
      const retryQueue = [...failedVideos];
      const retryWorkers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(CONCURRENCY, retryQueue.length); w++) {
        retryWorkers.push((async () => {
          while (retryQueue.length > 0) {
            const failedVideo = retryQueue.shift();
            if (!failedVideo) break;
            const shot = script?.shots?.find(s => s.shotNumber === failedVideo.shotNumber);
            const board = storyboards.find(b => b.shotNumber === failedVideo.shotNumber);

            // ★ 修正: 使用该 shot 自己的 storyboard 图, 而不是"第一个场景图"
            const ownStoryboardImage = board?.imageUrl && !board.imageUrl.startsWith('data:') && board.imageUrl.startsWith('http')
              ? board.imageUrl : '';
            const retryFirstFrame = ownStoryboardImage || Array.from(sceneUrlMap.values())[0] || '';

            // 简化但保留情绪 & 风格的 prompt
            const simplePrompt = (shot?.sceneDescription || 'cinematic scene').slice(0, 400)
              + (shot?.emotion ? `, ${shot.emotion} mood` : '')
              + (this.styleKeywords ? `, ${this.styleKeywords}` : '')
              + ', cinematic quality, smooth animation';

            // 等 20s 让上游池恢复 (典型 pool saturation 15-30s 自愈)
            await sleep(20_000);

            let rescued = false;

            // ───── Pass-A: Veo 优先 I2V (用 shot 自己的首帧) ─────
            const passAEngines: Array<{ name: string; gen: () => Promise<string> }> = [];
            if (this.veoService) passAEngines.push({
              name: 'Veo',
              gen: () => this.veoService!.generateVideo(retryFirstFrame, simplePrompt, { duration: 5 }),
            });
            if (this.minimaxService?.isVideoAvailable()) passAEngines.push({
              name: 'Minimax',
              gen: () => this.minimaxService!.generateVideo(retryFirstFrame, simplePrompt, {}),
            });
            if (this.klingService) passAEngines.push({
              name: 'Kling',
              gen: () => this.klingService!.generateVideo(retryFirstFrame, simplePrompt, { duration: 5 }),
            });

            for (const engine of passAEngines) {
              try {
                const retryUrl = await engine.gen();
                if (retryUrl && isValidVideoUrl(retryUrl)) {
                  failedVideo.videoUrl = retryUrl;
                  this.emit('videoClip', failedVideo);
                  this.emit('agentTalk', {
                    role: AgentRole.VIDEO_PRODUCER,
                    text: `✅ 镜头 ${failedVideo.shotNumber} 通过 ${engine.name} Pass-A 重试成功`,
                  });
                  rescued = true;
                  break;
                }
              } catch (e) {
                console.error(`[Video-Retry-A] Shot ${failedVideo.shotNumber} ${engine.name}:`, e instanceof Error ? e.message.slice(0, 80) : '');
              }
            }

            if (rescued) continue;

            // ───── Pass-B: 剥离首帧,纯 T2V,5s 短时长 (扛住图片/长度问题) ─────
            this.emit('agentTalk', {
              role: AgentRole.VIDEO_PRODUCER,
              text: `🔁 镜头 ${failedVideo.shotNumber} Pass-A 全败，尝试纯文本生视频（无首帧）...`,
            });

            // T2V 时用更紧凑的 prompt,只保留核心场景 + 动作 + 风格
            const t2vPrompt = [
              shot?.sceneDescription?.slice(0, 200),
              shot?.action?.slice(0, 100),
              shot?.emotion,
              this.styleKeywords,
              'cinematic, smooth motion',
            ].filter(Boolean).join(', ');

            const passBEngines: Array<{ name: string; gen: () => Promise<string> }> = [];
            if (this.veoService) passBEngines.push({
              name: 'Veo-T2V',
              gen: () => this.veoService!.generateVideoFromText(t2vPrompt, { duration: 5 }),
            });
            if (this.minimaxService?.isVideoAvailable()) passBEngines.push({
              name: 'Minimax-T2V',
              gen: () => this.minimaxService!.generateVideo('', t2vPrompt, {}), // 空首帧 → Hailuo-2.3 纯文生
            });
            // v2.12: Hailuo-2.3-Fast 是 Minimax 的低质快速版,日额度独立于标准 Hailuo-2.3。
            // 排在 Kling 之前 —— Fast 通常仍比 Kling 跑得动且与 Hailuo-2.3 共账户管理,
            // 标准 Hailuo 用满后用同一家的 Fast 比换 Kling 更可控(成本/响应/失败率)。
            // 仍排在 Ken Burns 静帧之前,保证只在所有真视频引擎都失败时才掉到 animatic。
            if (this.minimaxService?.isVideoAvailable()) passBEngines.push({
              name: 'Minimax-Hailuo-Fast',
              gen: () => this.minimaxService!.generateVideoFast(t2vPrompt, { duration: 5 }),
            });
            if (this.klingService) passBEngines.push({
              name: 'Kling-T2V',
              gen: () => this.klingService!.generateVideo('', t2vPrompt, { duration: 5 }),
            });

            for (const engine of passBEngines) {
              try {
                const retryUrl = await engine.gen();
                if (retryUrl && isValidVideoUrl(retryUrl)) {
                  failedVideo.videoUrl = retryUrl;
                  this.emit('videoClip', failedVideo);
                  this.emit('agentTalk', {
                    role: AgentRole.VIDEO_PRODUCER,
                    text: `✅ 镜头 ${failedVideo.shotNumber} 通过 ${engine.name} Pass-B 救回`,
                  });
                  rescued = true;
                  break;
                }
              } catch (e) {
                console.error(`[Video-Retry-B] Shot ${failedVideo.shotNumber} ${engine.name}:`, e instanceof Error ? e.message.slice(0, 80) : '');
              }
            }

            // Pass-C 由后面的 Ken Burns animatic 兜底处理
          }
        })());
      }
      await Promise.all(retryWorkers);
    }

    // ═══ 终极降级：animatic 滞帧式成片 ═══
    // 当上游所有视频引擎都饱和/不可用时（典型场景：qingyuntop video pool 全部 saturated），
    // 把对应分镜图做成 Ken Burns 缓推/缓拉的 mp4，让用户至少能拿到一段可看的 animatic 成片，
    // 而不是看到 7/7 镜头全失败。这个降级**只在重试也失败之后**才会触发。
    const stillFailing = videos.filter(v => !isValidVideoUrl(v.videoUrl));
    if (stillFailing.length > 0) {
      this.emit('agentTalk', {
        role: AgentRole.VIDEO_PRODUCER,
        text: `⚠️ 上游视频池在饱和中（${stillFailing.length}/${videos.length} 镜头），已自动降级为 animatic 滞帧式成片：使用分镜图 + Ken Burns 缓慢推拉，保证产出可看 🎞️`
      });

      try {
        const { stillFrameToVideo } = await import('./video-composer');
        for (let i = 0; i < stillFailing.length; i++) {
          const fv = stillFailing[i];
          // 找到对应的分镜图
          const board = storyboards.find(b => b.shotNumber === fv.shotNumber);
          const stillImage = board?.imageUrl;
          if (!stillImage) {
            console.warn(`[Animatic] Shot ${fv.shotNumber} has no storyboard image, skipping`);
            continue;
          }
          try {
            // 推拉方向轮换:让连续静帧不至于都是同一种运动
            const dir: 'in' | 'out' | 'pan' = (['in', 'out', 'pan'] as const)[i % 3];
            const localMp4 = await stillFrameToVideo(stillImage, fv.duration || 8, undefined, dir);
            fv.videoUrl = `/api/serve-file?path=${encodeURIComponent(localMp4)}`;
            (fv as any).isAnimatic = true;
            this.emit('videoClip', fv);
            this.emit('agentTalk', {
              role: AgentRole.VIDEO_PRODUCER,
              text: `🎞️ 镜头 ${fv.shotNumber} 已降级为 animatic（${dir === 'in' ? '缓推' : dir === 'out' ? '缓拉' : '横移'}）`
            });
          } catch (e) {
            console.error(`[Animatic] Shot ${fv.shotNumber} fallback failed:`, e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.error('[Animatic] stillFrameToVideo import failed:', e);
      }
    }

    // ═══ 关键帧封面图提取（可选，不阻塞管线）═══
    const validClips = videos.filter(v => isValidVideoUrl(v.videoUrl));
    if (validClips.length > 0) {
      this.update(AgentRole.VIDEO_PRODUCER, { currentTask: '提取关键帧封面图...', progress: 95 });
      this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text: `正在为 ${validClips.length} 段视频提取封面图 📸` });
      try {
        const { extractKeyFrames } = await import('./video-composer');
        const keyFrames = await extractKeyFrames(
          validClips.map(v => ({ shotNumber: v.shotNumber || 0, videoUrl: v.videoUrl })),
          (current, total) => {
            this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text: `提取关键帧 ${current}/${total}...` });
          }
        );

        for (const kf of keyFrames) {
          const video = videos.find(v => v.shotNumber === kf.shotNumber);
          if (video) {
            video.coverImageUrl = `/api/serve-file?path=${encodeURIComponent(kf.coverImagePath)}`;
          }
        }

        if (keyFrames.length > 0) {
          this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text: `已提取 ${keyFrames.length} 张关键帧封面图 ✅` });
          this.emit('coverImages', keyFrames.map(kf => ({
            shotNumber: kf.shotNumber,
            coverImageUrl: `/api/serve-file?path=${encodeURIComponent(kf.coverImagePath)}`,
          })));
        }
      } catch (e) {
        console.error('[VideoProducer] Key frame extraction failed (non-fatal):', e);
        this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text: '⚠️ 关键帧提取跳过，不影响视频' });
      }
    } else {
      console.log('[VideoProducer] No valid video URLs for key frame extraction, skipping');
    }

    this.update(AgentRole.VIDEO_PRODUCER, { status: 'completed', progress: 100, output: videos });
    this.emit('agentTalk', { role: AgentRole.VIDEO_PRODUCER, text: `视频全部生成完毕（${providerLabel}），关键帧封面图已提取！🎬` });
    return videos;
  }

  // ══════════════════════════════════════
  // 剪辑师（专业节奏策略）
  // ══════════════════════════════════════
  async runEditor(videos: VideoClip[], script: Script): Promise<any> {
    this.update(AgentRole.EDITOR, { status: 'working', currentTask: '分析镜头节奏，构建剪辑时间线', progress: 5 });
    this.emit('agentTalk', { role: AgentRole.EDITOR, text: '开始剪辑！先分析高光时刻，再智能编排节奏 ✂️🔥' });

    await sleep(500);
    const totalShots = videos.length;

    // ═══ 第1步：构建时间线 + 高光元数据 ═══
    this.update(AgentRole.EDITOR, { progress: 10, currentTask: '构建高光分析时间线...' });
    const timeline = videos.map((v, i) => {
      // 通过 shotNumber 精确匹配脚本镜头（而非数组下标，避免镜头错位）
      const shot = script.shots?.find(s => s.shotNumber === v.shotNumber) || script.shots?.[i];
      const act = (shot as any)?.act || (i < totalShots * 0.25 ? 1 : i < totalShots * 0.75 ? 2 : 3);
      const emotion = shot?.emotion || '';
      const baseDuration = v.duration || (shot as any)?.duration || 8;
      const emotionTemperature = (shot as any)?.emotionTemperature ?? 0;

      // 基础转场策略（会被高光检测引擎覆盖）
      let transition = 'cross-dissolve';
      let effect = '';

      if (i === 0) {
        transition = 'fade-in';
        effect = 'slow-zoom-in';
      } else if (i === totalShots - 1) {
        transition = 'fade-out';
        effect = 'slow-zoom-out';
      } else if (act === 2 && emotion.match(/紧张|愤怒|恐惧|危机/)) {
        transition = 'cut';
        effect = 'shake';
      } else if (act === 3 || emotion.match(/高潮|爆发|决战/)) {
        transition = 'flash-cut';
        effect = 'flash-white';
      } else if (emotion.match(/悲伤|感动|温暖|浪漫/)) {
        transition = 'cross-dissolve';
        effect = 'soft-focus';
      } else if (emotion.match(/神秘|诡异/)) {
        transition = 'dip-to-black';
        effect = 'vignette';
      } else {
        transition = i % 2 === 0 ? 'cross-dissolve' : 'cut';
      }

      // 从 storyboard planData 获取张力等级
      const tensionLevel = (shot as any)?.tensionLevel ?? (
        i === 0 ? 3 : i === totalShots - 1 ? 4 : act === 3 ? 9 : 5
      );

      return {
        shotNumber: v.shotNumber,
        videoUrl: v.videoUrl,
        duration: baseDuration,
        baseDuration,
        transition,
        effect,
        emotion,
        act,
        dialogue: shot?.dialogue || '',
        // 高光检测元数据
        emotionTemperature,
        tensionLevel,
      };
    });

    // ═══ 第2步：高光时刻检测 ═══
    this.update(AgentRole.EDITOR, { progress: 20, currentTask: '智能检测高光时刻...' });
    const { detectHighlights } = await import('./video-composer');
    const highlightAnalysis = detectHighlights(timeline.map(t => ({
      shotNumber: t.shotNumber || 0,
      videoUrl: t.videoUrl,
      duration: t.duration,
      transition: t.transition,
      emotionTemperature: t.emotionTemperature,
      tensionLevel: t.tensionLevel,
    })));

    const highlightShots = highlightAnalysis.filter(h => h.isHighlight);
    if (highlightShots.length > 0) {
      const highlightInfo = highlightShots.map(h => `镜头${h.shotNumber}(${h.reason}, 评分${h.score})`).join('、');
      console.log(`[Editor] Highlights: ${highlightInfo}`);
      this.emit('agentTalk', {
        role: AgentRole.EDITOR,
        text: `🔥 高光时刻检测完成！发现 ${highlightShots.length} 个高光镜头：${highlightInfo}\n高光镜头将使用慢动作强调 + 最佳转场`
      });
    } else {
      this.emit('agentTalk', { role: AgentRole.EDITOR, text: '高光分析完成，叙事节奏均匀，将优化整体流畅度 📊' });
    }

    // ═══ 第2.5步：LLM 生成专业剪辑方案 ═══
    if (API_CONFIG.openai.apiKey) {
      this.update(AgentRole.EDITOR, { progress: 25, currentTask: 'AI 分析最佳剪辑策略...' });
      this.emit('agentTalk', { role: AgentRole.EDITOR, text: '用 AI 分析最佳剪辑策略：节奏、变速、转场...🎬' });

      try {
        const editContext = timeline.map((t, i) => {
          const ha = highlightAnalysis.find(h => h.shotNumber === t.shotNumber);
          return `#${t.shotNumber}: ${t.emotion || '平静'}, act${t.act}, tension=${t.tensionLevel}, highlight=${ha?.isHighlight || false}, 台词="${(t.dialogue || '').slice(0, 20)}"`;
        }).join('\n');

        const editPlanRaw = await this.callLLM(
          `你是金马奖剪辑师 + Netflix / A24 短片剪辑师, 同时熟悉抖音/小红书前 3 秒挂留观众的算法逻辑。
按下面的法则给每个镜头出剪辑参数, 思考时把每镜放到"前一镜→当前→后一镜"的三联中考虑节奏。

## 行业级剪辑法则 (按优先级)

### 节奏 (Pacing)
1. **前 3 秒 Hook**: 第 1 镜 fade-in 0.5s + speed=1.0, 第 2 镜直接 cut, 制造"立刻有事发生"。绝不要开场就用 1.5s 的慢转场。
2. **三段呼吸**: 主体段用 "快-快-慢" 的 3 镜节奏组(模拟心跳), 不要连续 4 镜以上同节奏。
3. **高光慢放 (Speed Ramping)**: 情感高潮镜头 speed=0.6-0.75, 时长 ≥ 3s, 放大情感。
4. **紧张推进**: tension≥0.7 的镜头 speed=1.05-1.2, 时长 1-2s, 营造压迫感。
5. **结尾余韵**: 最后一镜 fade-out 1.2s + speed=0.85, 给观众回味。

### 转场 (Transitions) — 一定要根据情绪动机选, 不是随机选
- **cut** 硬切: 情绪剧变 / 时空跳切 / 信息密度高时
- **match-cut** 匹配剪辑: 前后镜头有相同形状/动作时 (例: 杯子→月亮), 仪式感最高
- **smash-cut** 蒙太奇硬切: 突然安静→爆发, 最强冲击 (例: 平静日常→暴雨)
- **j-cut** 音先入: 下一镜的声音/对白先出来, 画面后切, 制造预期 (温情段必备)
- **l-cut** 音延续: 当前镜头的声音延续到下一镜, 拉长情绪 (告别 / 内心独白)
- **whip-pan** 快摇: 1.05-1.15 倍速, 配合相机轨迹, 用于场景跳切 + 时间流逝
- **cross-dissolve** 交叠: 温情/悲伤/回忆段, 柔化 0.6-1.0s
- **fade-in / fade-out**: 仅用于片头片尾, 中间不要用
- **flash-cut** 闪白: 仅最高潮瞬间, 全片用 1-2 次
- **dip-to-black** 黑场转: 章节分隔 / 时间大跳 (10 秒以上的省略)
- **iris-in / iris-out** 圈入圈出: 喜剧 / 怀旧风格
- **invisible-cut** 隐形剪辑: 同动作连续, 不留痕迹 (镜头 2 直接用前一镜的动作末)

### 字幕/台词节奏 (与 transition 配合)
- 对白镜尽量用 j-cut 提前 0.3-0.5s 入声, 让观众"听到"再"看到"
- 心理独白镜用 l-cut 把上一镜的声音延续过来

## 输出 JSON 数组 (每个镜头一个对象)
[{
  "shotNumber":1,
  "speed":0.9,
  "transition":"fade-in",
  "transitionDuration":1.0,
  "reason":"开场建立氛围 + 让观众进入"
}, ...]

speed: 0.6-1.3
transition 必须从上面列表里选: cut / match-cut / smash-cut / j-cut / l-cut / whip-pan / cross-dissolve / fade-in / fade-out / flash-cut / dip-to-black / iris-in / iris-out / invisible-cut
transitionDuration: 0.0-1.5 (cut 类用 0, fade 类用 0.5-1.2)`,
          `镜头列表：\n${editContext}`
        );

        try {
          const editPlan = JSON.parse(editPlanRaw);
          if (Array.isArray(editPlan)) {
            for (const plan of editPlan) {
              const t = timeline.find(x => x.shotNumber === plan.shotNumber);
              if (t && plan.transition) {
                t.transition = plan.transition;
                if (plan.speed && plan.speed >= 0.5 && plan.speed <= 1.5) {
                  t.duration = Math.round(t.baseDuration / plan.speed);
                  (t as any).speedMultiplier = plan.speed;
                }
              }
            }
            console.log(`[Editor] LLM edit plan applied: ${editPlan.length} shots`);
            this.emit('agentTalk', {
              role: AgentRole.EDITOR,
              text: `✨ AI 剪辑方案生成完成！已为每个镜头定制节奏和转场策略`
            });
          }
        } catch { console.warn('[Editor] LLM edit plan parse failed, using default'); }
      } catch (e) {
        console.warn('[Editor] LLM edit plan generation failed:', e);
      }
    }

    const totalDuration = timeline.reduce((sum, t) => sum + t.duration, 0);

    // ═══ 第3步：AI 配音生成（MiniMax TTS）═══
    const voiceoverClips: Array<{ shotNumber: number; audioUrl: string }> = [];
    // v2.11 #B1: 收集音频相关的降级信号, 最后带入 final payload 让前端明示"哪些镜头降级了"
    const audioWarnings: string[] = [];
    if (this.minimaxService) {
      const dialogueShots = timeline.filter(t => t.dialogue && t.dialogue.trim().length > 0);
      if (dialogueShots.length > 0) {
        this.update(AgentRole.EDITOR, { progress: 30, currentTask: `生成 ${dialogueShots.length} 段 AI 配音...` });
        this.emit('agentTalk', { role: AgentRole.EDITOR, text: `正在为 ${dialogueShots.length} 个有台词的镜头生成 AI 配音（MiniMax TTS）🎙️` });

        for (let i = 0; i < dialogueShots.length; i++) {
          const t = dialogueShots[i];
          try {
            // ── 语言统一：过滤纯英文对白 → 仅为中文/含中文对白生成配音 ──
            const hasChinese = /[\u4e00-\u9fa5]/.test(t.dialogue);
            if (!hasChinese) {
              console.log(`[Editor] TTS skip (non-Chinese): "${t.dialogue.slice(0, 30)}"`);
              continue;
            }
            // 替换对白中的英文片段为中文发音提示（避免 TTS 中英文混杂）
            const cleanedDialogue = t.dialogue
              .replace(/[a-zA-Z]+/g, (match: string) => match.length <= 3 ? match : '')  // 保留短缩写如 AI、OK
              .replace(/\s{2,}/g, ' ')
              .trim();
            if (!cleanedDialogue) continue;

            // v2.9 Bug 3: 从 emotion + emotionTemperature 推导 speed/pitch/vol
            // 之前所有配音都是 1.0/0/0.85 的死板默认,声画脱节;现在画面走情绪,配音也跟着走
            const prosody = deriveProsody({
              emotion: t.emotion,
              emotionTemperature: t.emotionTemperature,
            });
            console.log(`[Editor] TTS prosody shot ${t.shotNumber}: emotion="${t.emotion}" temp=${t.emotionTemperature ?? 0} → speed=${prosody.speed} pitch=${prosody.pitch} vol=${prosody.vol}`);
            const audioUrl = await this.minimaxService.generateSpeech(cleanedDialogue, {
              emotion: t.emotion,
              gender: t.emotion.match(/温柔|哭|委屈|姐|妹|母/) ? 'female' : 'male',
              speed: prosody.speed,
              pitch: prosody.pitch,
              vol: prosody.vol,
            });
            voiceoverClips.push({ shotNumber: t.shotNumber || 0, audioUrl });
            this.emit('agentTalk', {
              role: AgentRole.EDITOR,
              text: `🎙️ 配音 ${i + 1}/${dialogueShots.length}: "${t.dialogue.slice(0, 15)}..." ✓`
            });
          } catch (e) {
            // v2.11 #B1: TTS 失败不再 skip, 生成等长静音兜底, 保证时间轴对齐 + 下游 adelay 不错位
            const errMsg = e instanceof Error ? e.message : String(e);
            console.error(`[Editor] TTS failed for shot ${t.shotNumber}:`, errMsg);
            try {
              const { createSilenceMp3, estimateSpeechDuration } = await import('@/lib/audio-silence');
              const dur = estimateSpeechDuration(t.dialogue);
              const silenceFile = await createSilenceMp3(dur);
              // 包装成 serve-file url, 让下游 ffmpeg 能读到
              const silenceUrl = `/api/serve-file?path=${encodeURIComponent(silenceFile)}`;
              voiceoverClips.push({ shotNumber: t.shotNumber || 0, audioUrl: silenceUrl });
              const warn = `🔇 第 ${t.shotNumber} 镜 TTS 失败, 用 ${dur.toFixed(1)}s 静音兜底 (原因: ${errMsg.slice(0, 60)})`;
              audioWarnings.push(warn);
              this.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
            } catch (se) {
              const warn = `⚠️ 第 ${t.shotNumber} 镜 TTS 和静音兜底都失败, 成片会少一段配音`;
              audioWarnings.push(warn);
              console.error('[Editor] silence fallback also failed:', se);
              this.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
            }
          }
          this.update(AgentRole.EDITOR, { progress: 30 + Math.round((i / dialogueShots.length) * 15) });
        }

        if (voiceoverClips.length > 0) {
          const successfulTts = voiceoverClips.length - audioWarnings.filter(w => w.startsWith('🔇') || w.startsWith('⚠️')).length;
          this.emit('agentTalk', {
            role: AgentRole.EDITOR,
            text: audioWarnings.length > 0
              ? `🎙️ AI 配音部分完成: ${successfulTts}/${voiceoverClips.length} 真实音, ${audioWarnings.length} 降级`
              : `🎙️ AI 配音完成！${voiceoverClips.length} 段语音已就绪`,
          });
        }
      }
    }

    // ═══ 第4步：配乐生成（Minimax音乐API）═══
    let musicUrl = '';
    if (this.minimaxService) {
      try {
        this.update(AgentRole.EDITOR, { progress: 50, currentTask: '生成背景配乐...' });
        this.emit('agentTalk', { role: AgentRole.EDITOR, text: '正在生成背景配乐，为画面注入灵魂 🎵' });

        // 根据高光分析和剧情情绪生成配乐
        const emotions = script.shots?.map(s => s.emotion).filter(Boolean) || [];
        const dominantEmotion = emotions[0] || '平静';
        const genre = this.genre || '现代剧情';
        const highlightNote = highlightShots.length > 0
          ? `，在第${highlightShots.map(h => h.shotNumber).join('、')}镜头处需要情感高潮`
          : '';
        let musicPrompt = `${genre}风格配乐，情绪基调：${dominantEmotion}${highlightNote}，时长约${totalDuration}秒，适合短片叙事`;

        // ═══ v2.8: 视觉锚点增强 — 把画面的光影/温度曲线/调色板翻译给音乐模型 ═══
        // 解决"画面和配乐脱节"的痛点:Minimax 音乐不收图,但画面情感信号可以
        // 用英文描述传递给它,让低沉画面配低弦/明亮画面配扬琴,声画同步
        try {
          const visualAnchor = buildMusicVisualAnchor({
            shots: (script.shots || []) as any,
            genre,
          });
          if (visualAnchor) {
            musicPrompt += `. Visual cues: ${visualAnchor}`;
            console.log(`[Editor] Music visual anchor: ${visualAnchor.slice(0, 150)}...`);
          }
        } catch (e) {
          console.warn('[Editor] Music visual anchor failed:', e instanceof Error ? e.message : e);
        }

        musicUrl = await this.minimaxService.generateMusic(musicPrompt, {
          duration: Math.min(totalDuration, 60),
          style: genre,
        });

        console.log(`[Editor] Music generated: ${musicUrl.slice(0, 80)}...`);
        this.emit('agentTalk', { role: AgentRole.EDITOR, text: '🎵 配乐生成完成！' });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('[Editor] Music generation failed:', errMsg);
        const warn = `🎵 BGM 生成失败, 成片为无配乐版本 (原因: ${errMsg.slice(0, 80)})`;
        audioWarnings.push(warn);
        this.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
      }
    }

    // ═══ 第5步：FFmpeg 智能合成（高光变速 + 转场 + 配乐 + 配音）═══
    let finalVideoUrl = '';
    const validVideoClips = timeline.filter(t => isValidVideoUrl(t.videoUrl));

    if (validVideoClips.length >= 1) {
      try {
        this.update(AgentRole.EDITOR, { progress: 65, currentTask: 'FFmpeg 智能合成（高光变速 + 转场 + 配乐 + 配音）...' });
        this.emit('agentTalk', {
          role: AgentRole.EDITOR,
          text: `正在用 FFmpeg 合成最终成片 🎞️\n` +
            `• 高光镜头慢动作强调\n` +
            `• 智能转场匹配\n` +
            `${musicUrl ? '• 背景配乐叠加\n' : ''}` +
            `${voiceoverClips.length > 0 ? `• ${voiceoverClips.length} 段 AI 配音混入\n` : ''}`
        });

        const { composeVideo } = await import('./video-composer');
        const composerClips = validVideoClips.map(t => {
          const analysis = highlightAnalysis.find(h => h.shotNumber === t.shotNumber);
          return {
            shotNumber: t.shotNumber || 0,
            videoUrl: t.videoUrl,
            duration: t.duration,
            transition: t.transition,
            effect: t.effect,
            emotionTemperature: t.emotionTemperature,
            tensionLevel: t.tensionLevel,
            isHighlight: analysis?.isHighlight || false,
            speedMultiplier: (t as any).speedMultiplier || analysis?.editStrategy.speedMultiplier || 1.0,
            dialogue: t.dialogue,
          };
        });

        const result = await composeVideo({
          clips: composerClips,
          musicUrl: musicUrl || undefined,
          voiceoverClips: voiceoverClips.length > 0 ? voiceoverClips : undefined,
          transitionDuration: 0.5,
          musicVolume: voiceoverClips.length > 0 ? 0.2 : 0.3, // 有配音时降低配乐音量
          voiceoverVolume: 0.9,
          onProgress: (pct, stage) => {
            const mappedPct = 65 + Math.round(pct * 0.30);
            this.update(AgentRole.EDITOR, { progress: mappedPct, currentTask: stage });
          },
        });

        finalVideoUrl = `/api/serve-file?path=${encodeURIComponent(result.outputPath)}`;
        console.log(`[Editor] Final video: ${result.clipCount} clips, ${result.totalDuration}s, music=${result.hasMusic}, voiceover=${result.hasVoiceover}, highlights=${result.highlights.length}`);
        this.emit('agentTalk', {
          role: AgentRole.EDITOR,
          text: `🎬 FFmpeg 合成完成！${result.clipCount}个片段` +
            `${result.highlights.length > 0 ? `，${result.highlights.length}个高光慢动作` : ''}` +
            `${result.hasMusic ? '，已配乐' : ''}` +
            `${result.hasVoiceover ? '，已配音' : ''} ✅`
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Editor] FFmpeg compose failed (${validVideoClips.length} clips):`, errMsg);
        this.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ FFmpeg 合成失败: ${errMsg.slice(0, 100)}` });

        // ═══ 降级方案：如果多片段合成失败，尝试逐个片段单独处理后 concat ═══
        if (validVideoClips.length > 1) {
          this.emit('agentTalk', { role: AgentRole.EDITOR, text: `🔄 尝试简化合成模式（无转场直接拼接）...` });
          try {
            const { composeVideo: composeVideoRetry } = await import('./video-composer');
            // 简化：去掉配音和转场，只做基本拼接
            const simpleClips = validVideoClips.map(t => ({
              shotNumber: t.shotNumber || 0,
              videoUrl: t.videoUrl,
              duration: t.duration,
              transition: 'cut' as string,
              speedMultiplier: 1.0,
              isHighlight: false,
            }));
            const simpleResult = await composeVideoRetry({
              clips: simpleClips,
              musicUrl: musicUrl || undefined,
              transitionDuration: 0.1, // 极短转场
              musicVolume: 0.3,
            });
            finalVideoUrl = `/api/serve-file?path=${encodeURIComponent(simpleResult.outputPath)}`;
            console.log(`[Editor] Simplified compose succeeded: ${simpleResult.clipCount} clips`);
            this.emit('agentTalk', { role: AgentRole.EDITOR, text: `✅ 简化合成成功！${simpleResult.clipCount}个片段` });
          } catch (e2) {
            console.error('[Editor] Simplified compose also failed:', e2);
            // 最终降级到首段视频
            finalVideoUrl = validVideoClips[0]?.videoUrl || timeline[0]?.videoUrl || '';
            this.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 合成仍失败，使用首段视频作为临时成片` });
          }
        } else {
          finalVideoUrl = validVideoClips[0]?.videoUrl || timeline[0]?.videoUrl || '';
        }
      }
    } else {
      console.warn(`[Editor] No valid video clips for composition! timeline=${timeline.length}, validClips=${validVideoClips.length}`);
      this.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 没有有效的视频片段可合成` });
      finalVideoUrl = timeline[0]?.videoUrl || '';
    }

    this.update(AgentRole.EDITOR, { progress: 98, currentTask: '最终收尾...' });
    await sleep(300);

    this.update(AgentRole.EDITOR, { status: 'completed', progress: 100 });
    const highlightSummary = highlightShots.length > 0
      ? `\n🔥 高光镜头: ${highlightShots.map(h => `#${h.shotNumber}`).join(' ')}`
      : '';
    const voiceSummary = voiceoverClips.length > 0
      ? `\n🎙️ AI配音: ${voiceoverClips.length}段`
      : '';
    this.emit('agentTalk', {
      role: AgentRole.EDITOR,
      text: `剪辑完成！总时长${totalDuration}秒${musicUrl ? '，已配乐' : ''}${highlightSummary}${voiceSummary}\n开场慢入→发展推进→高潮慢动作→结尾留白 🎞️`
    });

    return {
      timeline,
      totalDuration,
      videoCount: timeline.length,
      finalVideoUrl,
      musicUrl,
      voiceoverClips,
      highlightAnalysis: highlightAnalysis.filter(h => h.isHighlight),
      // v2.11 #B1: 把本次跑出来的音频降级信息透给前端, 便于 UI 明示成片缺 BGM / 配音降级
      audioWarnings,
      hasBgm: Boolean(musicUrl),
    };
  }

  // ══════════════════════════════════════
  // 导演审核（Claude LLM 100分制）
  // ══════════════════════════════════════
  async runDirectorReview(script: Script, videos: VideoClip[], editResult?: any, storyboards?: Storyboard[]): Promise<any> {
    // 制片人负责最终审核（替代原来的导演审核角色）
    this.update(AgentRole.PRODUCER, { status: 'thinking', currentTask: '100分制全面审核', progress: 10 });
    this.emit('agentTalk', { role: AgentRole.PRODUCER, text: '让我仔细看看成片效果...🧐' });

    let review: any;

    // ═══ v2.7: 制片人专业评审上下文 — 确定性计算(无 LLM 幻觉)═══
    // 1) Character Bible 渲染为 prompt 块
    // 2) Continuity Audit — 6 维连贯性审核(时间/天气/服装等)
    // 3) Asset Ledger — 资产台账(character/scene/storyboard/video/dialogue/music)
    // 4) Rhythm Validator — 按流派 ASL 基准验证节奏
    // 5) Runtime Budget — 三幕时长配比验证
    const shotsWithDuration = (script.shots || []).map((s: any) => ({
      shotNumber: s.shotNumber,
      act: s.act,
      duration_s: s.duration ?? s.duration_s ?? 3,
    }));
    const totalDurationSec = editResult?.totalDuration
      ?? shotsWithDuration.reduce((a: number, s: any) => a + (s.duration_s || 3), 0);

    const continuityFlags = runContinuityAudit(
      (script.shots || []) as any,
      this.characterBible,
    );
    const assetLedger = buildAssetLedger(
      script,
      (storyboards || [])
        .filter((b): b is Storyboard & { shotNumber: number } => typeof b.shotNumber === 'number')
        .map((b) => ({ shotNumber: b.shotNumber, imageUrl: b.imageUrl, approved: true })),
      videos
        .filter((v): v is VideoClip & { shotNumber: number } => typeof v.shotNumber === 'number')
        .map((v) => ({ shotNumber: v.shotNumber, videoUrl: v.videoUrl })),
      this.characterAppearanceMap,
    );
    const rhythmReport = validateRhythm(shotsWithDuration, this.genre || 'drama');
    const runtimeReport = validateRuntimeBudget(shotsWithDuration, totalDurationSec);
    const producerContext = buildProducerEvaluationContext({
      characterBible: this.characterBible,
      continuityFlags,
      assetLedger,
      rhythmReport,
      runtimeReport,
    });
    const characterBibleBlock = renderCharacterBibleBlock(this.characterBible);

    if (this.openai) {
      this.update(AgentRole.PRODUCER, { progress: 40 });
      const { getDirectorReviewPrompt } = await import('@/lib/mckee-skill');
      const context = `
剧本标题：${script.title}
剧本简介：${script.synopsis}
镜头数量：${script.shots?.length || 0}
视频数量：${videos.length}
成功生成的视频：${videos.filter(v => v.videoUrl && !v.videoUrl.startsWith('data:')).length}
失败的视频：${videos.filter(v => !v.videoUrl || v.videoUrl.startsWith('data:')).length}
总时长：${editResult?.totalDuration || '未知'}秒
镜头详情：${JSON.stringify(script.shots?.map(s => ({ shot: s.shotNumber, emotion: s.emotion, action: s.action })))}
${characterBibleBlock}${producerContext}
`;
      const raw = await this.callLLM(getDirectorReviewPrompt(), context);
      this.update(AgentRole.PRODUCER, { progress: 80 });
      try {
        review = JSON.parse(raw);
        review.id = `review-${Date.now()}`;
        review.status = review.passed ? 'passed' : 'pending';
        review.createdAt = new Date().toISOString();
      } catch {
        review = this.fallbackReview(videos);
      }
    } else {
      await sleep(2000);
      review = this.fallbackReview(videos);
    }

    // ═══ v2.7: 把确定性计算报告附到 review 对象上,供下游使用 ═══
    // 即使 LLM 忽略了 producerContext,这些硬指标也不会丢失
    review.producerReports = {
      continuityFlags,
      assetLedger,
      rhythmReport,
      runtimeReport,
      characterBibleSize: this.characterBible.length,
    };
    // Continuity critical flags 作为 items 追加进去,触发 executeReviewFeedback 闭环
    if (continuityFlags.length > 0) {
      const criticalFlags = continuityFlags.filter((f) => f.severity === 'critical' || f.severity === 'major');
      if (criticalFlags.length > 0) {
        review.items = review.items || [];
        criticalFlags.forEach((f) => {
          review.items.push({
            shotNumber: f.shotNumber,
            targetRole: 'storyboard',
            stage: 'storyboard',
            issue: `[连贯性 ${f.dimension}] ${f.description}`,
            suggestion: f.fix,
            severity: f.severity,
            dimension: 'continuity',
          });
        });
      }
    }

    this.update(AgentRole.PRODUCER, { status: 'completed', progress: 100, output: review });

    const emoji = review.overallScore >= 80 ? '👍' : review.overallScore >= 70 ? '🤔' : '😤';
    const extras: string[] = [];
    if (continuityFlags.length) extras.push(`🔗 连贯性 ${continuityFlags.length} 项`);
    if (rhythmReport.verdict !== 'on-target') extras.push(`⏱ 节奏 ${rhythmReport.verdict}`);
    if (runtimeReport.warnings.length) extras.push(`⏳ 时长偏离`);
    const extraStr = extras.length ? `\n  ${extras.join(' · ')}` : '';
    this.emit('agentTalk', { role: AgentRole.PRODUCER, text: `审核完成！${review.overallScore}/100分 ${emoji}\n${review.summary}${extraStr}` });

    return review;
  }

  private fallbackReview(videos: VideoClip[]): any {
    const failed = videos.filter(v => !v.videoUrl || v.videoUrl.startsWith('data:'));
    const total = videos.length || 1;
    const failRate = failed.length / total;
    // 更严格的评分：任何失败镜头都大幅扣分（1个=-10，2个=-22，3个=-36）
    const score = Math.max(40, Math.round(90 - failed.length * (10 + failed.length * 2)));
    // 只要有失败镜头就不通过（强制进入重试循环）
    const passed = failed.length === 0 && score >= 70;
    return {
      id: `review-${Date.now()}`,
      overallScore: score,
      summary: failed.length === 0
        ? '整体质量良好，视频全部成功生成。'
        : `有${failed.length}/${total}个视频未成功生成（失败率${Math.round(failRate * 100)}%），必须重新制作。`,
      dimensions: {
        narrative: { score: 16, comment: '叙事结构完整' },
        characterDepth: { score: 14, comment: '角色刻画基本到位' },
        sensoryDensity: { score: 10, comment: '感官细节待丰富' },
        visualQuality: { score: failed.length === 0 ? 12 : Math.max(3, 12 - failed.length * 3), comment: failed.length > 0 ? `${failed.length}个镜头生成失败` : '视觉质量达标' },
        pacing: { score: 12, comment: '节奏尚可' },
        audioVisual: { score: 8, comment: '音画配合待优化' },
      },
      items: failed.map(v => ({
        shotNumber: v.shotNumber, targetRole: AgentRole.VIDEO_PRODUCER,
        stage: 'video',
        issue: `镜头${v.shotNumber}视频未成功生成，画面为空白`,
        suggestion: '使用简化提示词 + 备用引擎重新生成',
        severity: 'critical' as const, dimension: 'visualQuality',
      })),
      passed,
      status: passed ? 'passed' : 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  // ══════════════════════════════════════
  // 导演闭环：自动执行改进
  // ══════════════════════════════════════
  async executeReviewFeedback(review: any, script: Script, storyboards: Storyboard[], videos: VideoClip[]): Promise<{ storyboards: Storyboard[]; videos: VideoClip[] }> {
    const updated = { storyboards: [...storyboards], videos: [...videos] };

    // 只处理 critical 和 major 级别的问题
    const actionableItems = (review.items || []).filter(
      (item: any) => item.severity === 'critical' || item.severity === 'major'
    );

    if (actionableItems.length === 0) return updated;

    this.emit('agentTalk', {
      role: AgentRole.PRODUCER,
      text: `🔍 发现 ${actionableItems.length} 个需要修复的问题，正在按环节归因并重新生成...`
    });

    // 按环节分组处理
    const videoItems = actionableItems.filter((item: any) =>
      item.stage === 'video' || item.targetRole === AgentRole.VIDEO_PRODUCER || item.targetRole === 'video_producer'
    );
    const storyboardItems = actionableItems.filter((item: any) =>
      item.stage === 'storyboard' || item.targetRole === AgentRole.STORYBOARD || item.targetRole === 'storyboard'
    );

    // 1. 修复分镜问题
    for (const item of storyboardItems) {
      if (!item.shotNumber) continue;
      this.update(AgentRole.STORYBOARD, { status: 'working', currentTask: `优化第 ${item.shotNumber} 镜分镜`, progress: 0 });
      this.emit('agentTalk', {
        role: AgentRole.STORYBOARD,
        text: `🔧 镜头 ${item.shotNumber} 分镜问题：${(item.issue || '').slice(0, 40)}，正在重新生成...`
      });
      const shot = script.shots?.find(s => s.shotNumber === item.shotNumber);
      if (shot) {
        try {
          const prompt = getStoryboardVisualPrompt(`${shot.sceneDescription}, ${item.suggestion}`, this.styleKeywords);
          const imageUrl = await this.generateImage(prompt, { aspectRatio: '16:9', label: `Shot ${item.shotNumber} v2` });
          const idx = updated.storyboards.findIndex(s => s.shotNumber === item.shotNumber);
          if (idx >= 0) updated.storyboards[idx] = { ...updated.storyboards[idx], imageUrl, prompt };
        } catch (e) {
          console.error(`[Review] Re-gen storyboard ${item.shotNumber} failed:`, e);
        }
      }
      this.update(AgentRole.STORYBOARD, { status: 'completed', progress: 100 });
    }

    // 2. 修复视频问题（含因分镜更新而级联重生成的视频）
    const videoShotsToRegen = new Set<number>();
    for (const item of videoItems) {
      if (item.shotNumber) videoShotsToRegen.add(item.shotNumber);
    }
    // 分镜更新的镜头也需要重新生成视频
    for (const item of storyboardItems) {
      if (item.shotNumber) videoShotsToRegen.add(item.shotNumber);
    }

    for (const shotNumber of videoShotsToRegen) {
      this.update(AgentRole.VIDEO_PRODUCER, { status: 'working', currentTask: `重新生成第 ${shotNumber} 镜视频`, progress: 0 });
      const board = updated.storyboards.find(s => s.shotNumber === shotNumber);
      if (!board) continue;

      const issueItem = videoItems.find((item: any) => item.shotNumber === shotNumber);
      if (issueItem) {
        this.emit('agentTalk', {
          role: AgentRole.VIDEO_PRODUCER,
          text: `🔧 镜头 ${shotNumber} 视频问题：${(issueItem.issue || '').slice(0, 40)}，重新生成...`
        });
      }

      try {
        let videoUrl: string = '';
        if (this.veoService) {
          videoUrl = await this.veoService.generateVideo(board.imageUrl, board.prompt, { duration: 8 });
        } else if (this.minimaxService) {
          // 使用角色参考图提升一致性
          videoUrl = await this.minimaxService.generateVideo(board.imageUrl, board.prompt, {
            subjectReferenceUrl: this.primaryCharacterRef || undefined,
          });
        } else {
          videoUrl = board.imageUrl;
        }
        const idx = updated.videos.findIndex(v => v.shotNumber === shotNumber);
        if (idx >= 0) updated.videos[idx] = { ...updated.videos[idx], videoUrl, status: 'completed' };
      } catch (e) {
        console.error(`[Review] Re-gen video ${shotNumber} failed:`, e);
      }
      this.update(AgentRole.VIDEO_PRODUCER, { status: 'completed', progress: 100 });
    }

    const regenCount = videoShotsToRegen.size + storyboardItems.filter((i: any) => !videoShotsToRegen.has(i.shotNumber)).length;
    this.emit('agentTalk', {
      role: AgentRole.PRODUCER,
      text: `✅ 已修复 ${regenCount} 个问题镜头，准备二次审核`
    });

    return updated;
  }

  // 单个分镜重生成（优先 Veo 3.1）
  async regenerateShot(shotNumber: number, storyboard: Storyboard, options?: { duration?: number; videoProvider?: string }): Promise<VideoClip> {
    this.update(AgentRole.VIDEO_PRODUCER, { status: 'working', currentTask: `重新生成第 ${shotNumber} 镜`, progress: 0 });
    let videoUrl: string;
    const provider = options?.videoProvider || 'veo';
    const useVeo = (provider === 'veo' || provider === 'veo3.1') && this.veoService;

    if (useVeo) {
      try {
        videoUrl = await this.veoService!.generateVideo(storyboard.imageUrl, storyboard.prompt, { duration: options?.duration || 8 });
      } catch (e) {
        console.error(`[Regenerate] Veo failed for shot ${shotNumber}:`, e);
        // Fallback to Minimax
        if (this.minimaxService) {
          try { videoUrl = await this.minimaxService.generateVideo(storyboard.imageUrl, storyboard.prompt, { subjectReferenceUrl: this.primaryCharacterRef || undefined }); }
          catch { videoUrl = storyboard.imageUrl; }
        } else {
          videoUrl = storyboard.imageUrl;
        }
      }
    } else if (this.minimaxService) {
      try { videoUrl = await this.minimaxService.generateVideo(storyboard.imageUrl, storyboard.prompt, { subjectReferenceUrl: this.primaryCharacterRef || undefined }); }
      catch { videoUrl = storyboard.imageUrl; }
    } else {
      await sleep(2000);
      videoUrl = mockSvg(640, 360, '#6b21a8', '#ec4899', `Shot ${shotNumber} v2`);
    }
    this.update(AgentRole.VIDEO_PRODUCER, { status: 'completed', progress: 100 });
    return { shotNumber, videoUrl, duration: options?.duration || 8, status: 'completed' };
  }

  /**
   * Sprint A.4 · 单镜 Cameo 重生 (公开入口, 给 /api/projects/[id]/cameo-retry-storyboard 用)
   *
   * 跟内部 storyboard renderer 走的同一条 generateImage + cameo-retry 链路, 但简化了输入:
   * 调用方只需要给定原 prompt + 原图 + cref, 不需要重建整个 character/scene 上下文。
   *
   * 行为:
   *   1. 用 cref + 加强提示词 + cw 125 重画一次
   *   2. 跑 cameo vision 评分
   *   3. 如果新分数 ≥ 旧分数 → 返回新图; 否则回滚原图
   *   4. 失败时返回原图 (永远不让用户看到更糟的)
   */
  async cameoRetrySingleShot(input: {
    shotNumber: number;
    originalImageUrl: string;
    originalPrompt: string;
    crefUrl: string;
    sameCharacterRecentShots?: string[];
    characterName?: string;
    originalCw?: number;
  }): Promise<{
    shotNumber: number;
    finalImageUrl: string;
    cameoScore: number | null;
    firstScore: number | null;
    cameoRetried: boolean;
    finalCw: number;
    reasoning: string;
  }> {
    const { evaluateAndRetry } = await import('@/services/cameo-retry');
    const cw = input.originalCw ?? 100;

    const out = await evaluateAndRetry({
      shotImageUrl: input.originalImageUrl,
      referenceImageUrl: input.crefUrl,
      characterName: input.characterName,
      originalCw: cw,
      sameCharacterRecentShots: input.sameCharacterRecentShots,
      shotNumber: input.shotNumber,
      regenerate: async (boostedCw, extraRefs) => {
        const reinforcedPrompt = `${input.originalPrompt}, IDENTICAL face structure to reference, same character identity${input.characterName ? `, ${input.characterName}` : ''}`;
        return await this.generateImage(reinforcedPrompt, {
          aspectRatio: '16:9',
          label: `Shot ${input.shotNumber} (batch-cameo-retry cw${boostedCw})`,
          cref: input.crefUrl,
          cw: boostedCw,
          referenceImages: extraRefs.length > 0 ? extraRefs : undefined,
        });
      },
    });

    return {
      shotNumber: input.shotNumber,
      finalImageUrl: out.finalImageUrl,
      cameoScore: out.finalScore,
      firstScore: out.firstScore,
      cameoRetried: out.retried,
      finalCw: out.finalCw,
      reasoning: out.reasoning,
    };
  }

  // ══════════════════════════════════════
  // 完整创作流程
  // ══════════════════════════════════════
  async startProduction(idea: string, videoProvider: string) {
    const plan = await this.runDirector(idea);
    const script = await this.runWriter(plan);
    const characters = await this.runCharacterDesigner(plan.characters);
    const scenes = await this.runSceneDesigner(plan.scenes);
    // 分镜师：第1阶段 — 纯文字分镜规划
    const storyboardPlans = await this.runStoryboardArtist(script, characters, scenes);
    // 分镜渲染：第2阶段 — 统一渲染分镜图（角色/场景/画风一致性 + 渐进参考链）
    const storyboards = await this.runStoryboardRenderer(storyboardPlans, script, characters, scenes);
    // 视频制作：角色图+场景图+分镜脚本→Veo，增强一致性
    const videos = await this.runVideoProducer(storyboards, videoProvider, characters, scenes, script);
    const editResult = await this.runEditor(videos, script);
    const review = await this.runDirectorReview(script, videos, editResult, storyboards);

    // 闭环：如果不通过，自动改进一轮
    let finalStoryboards = storyboards;
    let finalVideos = videos;
    if (!review.passed) {
      const improved = await this.executeReviewFeedback(review, script, storyboards, videos);
      finalStoryboards = improved.storyboards;
      finalVideos = improved.videos;
    }

    return { plan, script, characters, scenes, storyboards: finalStoryboards, videos: finalVideos, editResult, review };
  }
}
