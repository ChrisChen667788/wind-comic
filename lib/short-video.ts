/**
 * lib/short-video (v7.6) — 15s 短视频极速分镜 (对标 CineSpark 15s)
 *
 * 纯逻辑 + 预设, 不打网络。给一个创意 → 三幕(HOOK/BODY/CLIMAX)结构化分镜计划:
 *   - 三幕时长布局 (默认 20/60/20, 随节奏模板变)
 *   - 15s 运镜词库 (开场钩子 / 叙事推进 / 结尾爆发)
 *   - 每镜编译成 SSS+ AI 视频生成 prompt
 *   - 节奏分布 (环形图数据)
 *   - LLM 消息构造 + 输出解析 (由 /api/short-video/plan 调 callLLMWithFallback)
 *
 * 设计取舍: 默认每幕一镜 = 3 镜, 与 CineSpark 形态一致; 时间轴由 duration + 节奏模板算出,
 * LLM 只负责"画面内容 + AI prompt 文案", 结构/时长/运镜由确定性逻辑掌控 (稳定、可单测)。
 */

export type ActPhase = 'hook' | 'body' | 'climax';
export type ShotSize = 'ELS' | 'WS' | 'LS' | 'MS' | 'CU';
export type CameraSpeed = 'slow' | 'normal' | 'fast';
export type AspectRatio = '9:16' | '16:9' | '1:1' | '2.39:1';
export type UpscaleFactor = 1 | 2 | 4;

export const SHORT_DURATIONS = [15, 30, 60] as const;
export type ShortDuration = (typeof SHORT_DURATIONS)[number];

export const ACT_LABEL_ZH: Record<ActPhase, string> = {
  hook: '钩子',
  body: '核心叙事',
  climax: '高潮爆发',
};

export const SHOT_SIZE_LABEL_ZH: Record<ShotSize, string> = {
  ELS: '超远景',
  WS: '远景',
  LS: '全景',
  MS: '中景',
  CU: '特写',
};

// ─────────────────────────────────────────────────────────────
// 节奏模板 — 决定三幕配比 + 默认运动强度/运镜速度
// ─────────────────────────────────────────────────────────────
export interface RhythmTemplate {
  id: string;
  label: string;   // 悬疑反转
  en: string;
  desc: string;    // 前慢后快
  /** hook / body / climax 配比, 内部会归一化 */
  ratios: [number, number, number];
  motionIntensity: number; // 0-100 默认
  cameraSpeed: CameraSpeed;
}

export const RHYTHM_TEMPLATES: RhythmTemplate[] = [
  { id: 'suspense',    label: '悬疑反转', en: 'Suspense Twist',      desc: '前慢后快', ratios: [0.2, 0.6, 0.2],  motionIntensity: 45, cameraSpeed: 'slow' },
  { id: 'blockbuster', label: '视觉大片', en: 'Visual Blockbuster',  desc: '快切高频', ratios: [0.2, 0.55, 0.25], motionIntensity: 75, cameraSpeed: 'fast' },
  { id: 'emotion',     label: '情绪氛围', en: 'Emotional Mood',      desc: '长镜慢推', ratios: [0.25, 0.6, 0.15], motionIntensity: 30, cameraSpeed: 'slow' },
];

export function getRhythmTemplate(id: string | undefined | null): RhythmTemplate {
  return RHYTHM_TEMPLATES.find((t) => t.id === id) || RHYTHM_TEMPLATES[0];
}

// ─────────────────────────────────────────────────────────────
// 15s 运镜词库 — 按幕分组 (开场钩子 / 叙事推进 / 结尾爆发)
// ─────────────────────────────────────────────────────────────
export interface CameraMove {
  id: string;
  label: string;   // Dynamic Reveal
  labelZh: string; // 动态揭示
  phase: ActPhase;
  motion: number;  // 0-100 默认运动值
  cameraType: string; // Flyover / Zoom In / Quick Zoom ...
  prompt: string;  // 英文运镜 prompt 片段
}

export const CAMERA_MOVE_VOCAB: CameraMove[] = [
  // 1. 开场钩子
  { id: 'dynamic-reveal', label: 'Dynamic Reveal', labelZh: '动态揭示', phase: 'hook', motion: 55, cameraType: 'Reveal',   prompt: 'dynamic reveal shot, subject emerges into frame' },
  { id: 'whip-pan',       label: 'Whip Pan',       labelZh: '甩鞭转场', phase: 'hook', motion: 80, cameraType: 'Whip Pan', prompt: 'rapid whip pan transition, motion blur' },
  { id: 'drone-flyover',  label: 'Drone Flyover',  labelZh: '无人机飞越', phase: 'hook', motion: 50, cameraType: 'Flyover', prompt: 'drone flyover shot, tilt down to street level' },
  // 2. 叙事推进
  { id: 'smooth-dolly-in', label: 'Smooth Dolly In', labelZh: '平滑推进', phase: 'body', motion: 20, cameraType: 'Zoom In',  prompt: 'smooth slow dolly in toward the subject, rack focus to eyes' },
  { id: 'parallax-shot',   label: 'Parallax Shot',   labelZh: '视差镜头', phase: 'body', motion: 35, cameraType: 'Parallax', prompt: 'parallax shot, foreground and background separation, depth' },
  { id: 'tracking-shot',   label: 'Tracking Shot',   labelZh: '跟拍',     phase: 'body', motion: 40, cameraType: 'Tracking', prompt: 'tracking shot following the subject, steady motion' },
  // 3. 结尾爆发
  { id: 'zoom-burst',   label: 'Zoom Burst',   labelZh: '爆炸变焦', phase: 'climax', motion: 90, cameraType: 'Quick Zoom', prompt: 'explosive zoom burst, dramatic quick zoom, high tension' },
  { id: 'freeze-frame', label: 'Freeze Frame', labelZh: '定格瞬间', phase: 'climax', motion: 10, cameraType: 'Freeze',     prompt: 'freeze frame moment, time stops, sharp details' },
  { id: 'fade-to-black', label: 'Fade to Black', labelZh: '黑屏留白', phase: 'climax', motion: 15, cameraType: 'Fade',     prompt: 'slow fade to black, dramatic ending' },
];

export function cameraMovesByPhase(phase: ActPhase): CameraMove[] {
  return CAMERA_MOVE_VOCAB.filter((m) => m.phase === phase);
}

export function getCameraMove(id: string | undefined | null): CameraMove | undefined {
  return CAMERA_MOVE_VOCAB.find((m) => m.id === id);
}

// ─────────────────────────────────────────────────────────────
// 三幕时长布局
// ─────────────────────────────────────────────────────────────
export interface ActLayout {
  phase: ActPhase;
  labelZh: string;
  startS: number;
  endS: number;
  pct: number; // 0-100 (四舍五入, 仅供展示)
}

function normalizeRatios(r: [number, number, number]): [number, number, number] {
  const sum = r[0] + r[1] + r[2];
  if (!(sum > 0)) return [0.2, 0.6, 0.2];
  return [r[0] / sum, r[1] / sum, r[2] / sum];
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 给定总时长 + 配比 → 三幕时间轴 (HOOK→BODY→CLIMAX 连续无缝, 末幕收到 duration) */
export function computeActLayout(
  durationS: number,
  ratios: [number, number, number] = [0.2, 0.6, 0.2],
): ActLayout[] {
  const dur = durationS > 0 ? durationS : 15;
  const [h, b, c] = normalizeRatios(ratios);
  const hookEnd = round1(dur * h);
  const bodyEnd = round1(dur * (h + b));
  return [
    { phase: 'hook',   labelZh: ACT_LABEL_ZH.hook,   startS: 0,       endS: hookEnd, pct: Math.round(h * 100) },
    { phase: 'body',   labelZh: ACT_LABEL_ZH.body,   startS: hookEnd, endS: bodyEnd, pct: Math.round(b * 100) },
    { phase: 'climax', labelZh: ACT_LABEL_ZH.climax, startS: bodyEnd, endS: dur,     pct: Math.round(c * 100) },
  ];
}

// ─────────────────────────────────────────────────────────────
// 短视频参数 + 计划
// ─────────────────────────────────────────────────────────────
export interface ShortVideoParams {
  motionIntensity: number; // 0-100
  cameraSpeed: CameraSpeed;
  interpolation: boolean;
  upscale: UpscaleFactor;
  resolution: string;      // '4K' | '8K'
  aspectRatio: AspectRatio;
  fps: number;
}

export function defaultParams(rhythm?: RhythmTemplate): ShortVideoParams {
  return {
    motionIntensity: rhythm?.motionIntensity ?? 60,
    cameraSpeed: rhythm?.cameraSpeed ?? 'normal',
    interpolation: true,
    upscale: 4,
    resolution: '8K',
    aspectRatio: '9:16',
    fps: 24,
  };
}

export interface ShortVideoShot {
  index: number;            // 1-based
  phase: ActPhase;
  timeStartS: number;
  timeEndS: number;
  shotSize: ShotSize;
  cameraMoveId: string;
  cameraMoveLabel: string;  // 中文展示
  cameraType: string;       // Camera: Flyover
  motion: number;           // 0-100
  frameContent: string;     // 画面内容 (中文)
  aiPrompt: string;         // SSS+ english prompt
}

export interface ShortVideoPlan {
  idea: string;
  style: string;
  durationS: number;
  rhythmTemplateId: string;
  title: string;
  acts: ActLayout[];
  shots: ShortVideoShot[];
  params: ShortVideoParams;
}

/** 节奏分布 (环形图数据) */
export function rhythmDistribution(plan: ShortVideoPlan): { phase: ActPhase; labelZh: string; pct: number }[] {
  return plan.acts.map((a) => ({ phase: a.phase, labelZh: a.labelZh, pct: a.pct }));
}

// 每幕默认景别 (远→中→特, 经典短视频"先建立再聚焦"节奏)
const DEFAULT_SHOT_SIZE: Record<ActPhase, ShotSize> = { hook: 'WS', body: 'MS', climax: 'CU' };

/** 把结构化镜头编译成 SSS+ 风格 AI 视频生成 prompt */
export function compileShotToVideoPrompt(opts: {
  frameContent: string;
  shotSize: ShotSize;
  cameraMove?: CameraMove;
  style: string;
  cameraSpeed: CameraSpeed;
}): string {
  const sizeWord: Record<ShotSize, string> = {
    ELS: 'extreme wide shot', WS: 'wide shot', LS: 'full shot', MS: 'medium shot', CU: 'close up',
  };
  const speedWord: Record<CameraSpeed, string> = { slow: 'slow camera move', normal: 'steady camera move', fast: 'fast camera move' };
  const parts = [
    opts.style?.trim(),
    opts.frameContent?.trim(),
    sizeWord[opts.shotSize],
    opts.cameraMove?.prompt,
    speedWord[opts.cameraSpeed],
    'cinematic lighting, highly detailed, 8k',
  ].filter((s): s is string => !!s && s.length > 0);
  return parts.join(', ');
}

// ─────────────────────────────────────────────────────────────
// LLM 消息构造 + 输出解析
// ─────────────────────────────────────────────────────────────
/** 让 LLM 只产 3 段"画面内容", 结构/时长/运镜由我们掌控 */
export function buildShortVideoMessages(opts: {
  idea: string;
  style: string;
  durationS: number;
  rhythm: RhythmTemplate;
}): { system: string; user: string } {
  const system =
    `你是顶级短视频导演, 擅长 ${opts.durationS}s 竖屏爆款的三幕节奏 (钩子→核心→高潮)。\n` +
    `给定创意, 输出严格 JSON: { "title": string, "shots": [\n` +
    `  { "phase": "hook", "frameContent": string, "aiPrompt": string },\n` +
    `  { "phase": "body", "frameContent": string, "aiPrompt": string },\n` +
    `  { "phase": "climax", "frameContent": string, "aiPrompt": string }\n] }\n` +
    `要求: 恰好 3 个 shot, phase 依次 hook/body/climax;frameContent 用中文一句话描述该幕画面;\n` +
    `aiPrompt 用英文、电影级、可直接喂给 AI 视频模型 (含主体/环境/光线/质感, 不要含运镜词, 运镜由系统注入)。\n` +
    `节奏风格: ${opts.rhythm.label} (${opts.rhythm.desc})。只输出 JSON, 不要 markdown 包裹。`;
  const user =
    `创意:${opts.idea}\n画风:${opts.style || 'cinematic'}\n时长:${opts.durationS}s\n按三幕输出 3 个 shot 的 JSON。`;
  return { system, user };
}

/**
 * 把 LLM JSON 解析为完整 ShortVideoPlan。
 * 结构/时长/运镜/景别由确定性逻辑补全; LLM 缺字段时降级为占位, 不抛错 (保证总能出计划)。
 */
export function parseShortVideoPlan(
  raw: any,
  opts: { idea: string; style: string; durationS: number; rhythmId: string; params?: ShortVideoParams },
): ShortVideoPlan {
  const rhythm = getRhythmTemplate(opts.rhythmId);
  const acts = computeActLayout(opts.durationS, rhythm.ratios);
  const params = opts.params || defaultParams(rhythm);
  const style = (opts.style || '').trim() || 'cinematic';

  const llmShots: any[] = Array.isArray(raw?.shots) ? raw.shots : [];
  const byPhase = (p: ActPhase) => llmShots.find((s) => s?.phase === p);

  const phases: ActPhase[] = ['hook', 'body', 'climax'];
  const shots: ShortVideoShot[] = phases.map((phase, i): ShortVideoShot => {
    const act = acts[i];
    const llm = byPhase(phase) || llmShots[i] || {};
    const move = cameraMovesByPhase(phase)[0]; // 该幕默认运镜 (hook→飞越族第一项 等)
    const shotSize = DEFAULT_SHOT_SIZE[phase];
    const frameContent = typeof llm.frameContent === 'string' && llm.frameContent.trim()
      ? llm.frameContent.trim().slice(0, 200)
      : `第 ${i + 1} 幕画面`;
    const aiPromptCore = typeof llm.aiPrompt === 'string' && llm.aiPrompt.trim() ? llm.aiPrompt.trim() : frameContent;
    return {
      index: i + 1,
      phase,
      timeStartS: act.startS,
      timeEndS: act.endS,
      shotSize,
      cameraMoveId: move.id,
      cameraMoveLabel: move.labelZh,
      cameraType: move.cameraType,
      motion: move.motion,
      frameContent,
      aiPrompt: compileShotToVideoPrompt({
        frameContent: aiPromptCore,
        shotSize,
        cameraMove: move,
        style,
        cameraSpeed: params.cameraSpeed,
      }),
    };
  });

  return {
    idea: opts.idea,
    style,
    durationS: opts.durationS,
    rhythmTemplateId: rhythm.id,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : opts.idea.slice(0, 40),
    acts,
    shots,
    params,
  };
}
