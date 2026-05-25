/**
 * lib/continuity (v7.3) — 连贯性 + 种子锁 (对标 CineFlow Continuity Pro「连贯性控制台」)
 *
 * 纯逻辑 + 预设。把"镜头链的连贯性"做成结构化、可枚举、可编译成生成指令的设置:
 *   - 种子锁 (主/辅种子 + 锁定): 锁定时全链路复用主种子 → 跨镜最大一致性
 *   - 链接模式: 硬切 / 匹配切 / 参考上一帧
 *   - 连贯性强度 (0-1) + 服装锁 + 光照锁 + FaceID 强度
 *   - compileContinuityDirectives(): 编译成生成提示词片段 + 参数 (seed / faceWeight / strength)
 *   - computeContinuityTags(): 算出分镜行上的"连贯性逻辑"彩色 chips
 *
 * 放大本品已有护城河 (FaceID / Cameo): 这里把它和环境/种子/链接模式统一成一个可视控制台。
 */

export type LinkMode = 'hard-cut' | 'match-cut' | 'last-frame';
export type FaceIdStrength = 'off' | 'low' | 'medium' | 'high';

export interface LinkModePreset {
  id: LinkMode;
  label: string;   // 中文
  en: string;
  desc: string;
  prompt: string;  // 英文生成片段
}

export const LINK_MODES: LinkModePreset[] = [
  { id: 'hard-cut',  label: '硬切',       en: 'Hard Cut',            desc: '镜头间独立, 不强制衔接',     prompt: 'independent framing, hard cut from previous shot' },
  { id: 'match-cut', label: '匹配切',     en: 'Match Cut',           desc: '构图/动作匹配上一镜',       prompt: 'match cut — keep composition and motion direction consistent with the previous shot' },
  { id: 'last-frame', label: '参考上一帧', en: 'Last Frame Reference', desc: '以上一镜末帧为起点, 无缝延续', prompt: 'continue seamlessly from the last frame of the previous shot, same lighting and subject position' },
];

export const FACEID_STRENGTHS: { id: FaceIdStrength; label: string; weight: number }[] = [
  { id: 'off',    label: '关闭', weight: 0 },
  { id: 'low',    label: '低',   weight: 0.3 },
  { id: 'medium', label: '中',   weight: 0.6 },
  { id: 'high',   label: '高',   weight: 0.9 },
];

export const SEED_MAX = 1_000_000_000;

export interface ContinuitySettings {
  mainSeed: number;
  auxSeed: number;
  seedLocked: boolean;
  linkMode: LinkMode;
  /** 0-1, 越高跨镜一致性约束越强 */
  continuityStrength: number;
  clothingLock: boolean;
  lightingLock: boolean;
  faceIdStrength: FaceIdStrength;
}

export function generateSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}

export function defaultContinuitySettings(): ContinuitySettings {
  return {
    mainSeed: generateSeed(),
    auxSeed: generateSeed(),
    seedLocked: true,
    linkMode: 'match-cut',
    continuityStrength: 0.6,
    clothingLock: true,
    lightingLock: true,
    faceIdStrength: 'high',
  };
}

function clamp01(n: any, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}
function safeSeed(n: any): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return generateSeed();
  return Math.floor(v) % SEED_MAX;
}
function pickEnum<T extends string>(vals: readonly T[], v: any, fallback: T): T {
  return vals.includes(v) ? (v as T) : fallback;
}

export function normalizeContinuitySettings(raw: any): ContinuitySettings {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = { linkMode: 'match-cut' as LinkMode, faceIdStrength: 'high' as FaceIdStrength };
  return {
    mainSeed: safeSeed(r.mainSeed),
    auxSeed: safeSeed(r.auxSeed),
    seedLocked: r.seedLocked === undefined ? true : !!r.seedLocked,
    linkMode: pickEnum(LINK_MODES.map((m) => m.id), r.linkMode, d.linkMode),
    continuityStrength: clamp01(r.continuityStrength, 0.6),
    clothingLock: r.clothingLock === undefined ? true : !!r.clothingLock,
    lightingLock: r.lightingLock === undefined ? true : !!r.lightingLock,
    faceIdStrength: pickEnum(FACEID_STRENGTHS.map((f) => f.id), r.faceIdStrength, d.faceIdStrength),
  };
}

export function faceIdWeight(s: ContinuitySettings): number {
  return FACEID_STRENGTHS.find((f) => f.id === s.faceIdStrength)?.weight ?? 0;
}

/**
 * 某一镜实际使用的种子:
 *   - 锁定 → 全链路复用主种子 (跨镜最大一致性)
 *   - 未锁 → 主种子 + 镜号 * 质数步进 (每镜不同但可复现)
 */
export function seedForShot(s: ContinuitySettings, shotIndex: number): number {
  const n = normalizeContinuitySettings(s);
  if (n.seedLocked) return n.mainSeed;
  return (n.mainSeed + Math.max(0, shotIndex) * 7919) % SEED_MAX;
}

export interface ContinuityDirectives {
  prompt: string;      // 英文片段, 拼到画面 prompt 后
  seed: number;        // 该镜种子
  faceWeight: number;  // 0-1
  strength: number;    // 0-1
}

/** 编译成生成指令 (prompt 片段 + 参数), 给某一镜 */
export function compileContinuityDirectives(
  s: ContinuitySettings,
  opts: { shotIndex?: number; isFirstShot?: boolean } = {},
): ContinuityDirectives {
  const n = normalizeContinuitySettings(s);
  const idx = opts.shotIndex ?? 0;
  const isFirst = opts.isFirstShot ?? idx === 0;
  const bits: string[] = [];
  if (faceIdWeight(n) > 0) bits.push(`consistent character identity (FaceID strength ${n.faceIdStrength})`);
  if (n.clothingLock) bits.push('consistent wardrobe and costume');
  if (n.lightingLock) bits.push('consistent lighting and color grading');
  // 首镜没有"上一镜"可衔接, 跳过 link-mode 衔接语
  if (!isFirst) {
    const lm = LINK_MODES.find((m) => m.id === n.linkMode);
    if (lm && lm.id !== 'hard-cut') bits.push(lm.prompt);
  }
  if (n.continuityStrength >= 0.8) bits.push('strict cross-shot consistency');
  else if (n.continuityStrength <= 0.3) bits.push('loose continuity, allow variation');
  return {
    prompt: bits.join(', '),
    seed: seedForShot(n, idx),
    faceWeight: faceIdWeight(n),
    strength: n.continuityStrength,
  };
}

export interface ContinuityTag { id: string; label: string; }

/** 分镜行上的"连贯性逻辑"chips (受 settings + 镜头上下文影响) */
export function computeContinuityTags(
  s: ContinuitySettings,
  ctx: { hasCharacter?: boolean; hasEnvironment?: boolean; isFirstShot?: boolean } = {},
): ContinuityTag[] {
  const n = normalizeContinuitySettings(s);
  const tags: ContinuityTag[] = [];
  if (ctx.hasCharacter && faceIdWeight(n) > 0) tags.push({ id: 'character', label: '角色锁定' });
  if (n.clothingLock) tags.push({ id: 'clothing', label: '服装连续' });
  if (ctx.hasEnvironment) tags.push({ id: 'environment', label: '环境锁定' });
  if (n.lightingLock) tags.push({ id: 'lighting', label: '光照连续' });
  if (!ctx.isFirstShot && n.linkMode !== 'hard-cut') {
    tags.push({ id: 'time', label: n.linkMode === 'last-frame' ? '帧级连续' : '动作连续' });
  }
  if (n.seedLocked) tags.push({ id: 'seed', label: '种子锁定' });
  return tags;
}

export function describeContinuity(s: ContinuitySettings): string {
  const n = normalizeContinuitySettings(s);
  const lm = LINK_MODES.find((m) => m.id === n.linkMode);
  const bits = [
    lm?.label,
    `强度 ${n.continuityStrength.toFixed(1)}`,
    n.seedLocked ? `种子锁 #${n.mainSeed}` : '种子不锁',
    `FaceID ${FACEID_STRENGTHS.find((f) => f.id === n.faceIdStrength)?.label}`,
  ].filter(Boolean);
  return bits.join(' · ');
}
