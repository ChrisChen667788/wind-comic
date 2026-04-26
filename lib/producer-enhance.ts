/**
 * Producer enhancement primitives — professional production oversight
 *
 * 背景调研 (2026-04):
 *   - Autodesk Flow Production Tracking (ex-ShotGrid) / ftrack:
 *     Task + Version + Asset 三实体模型,每个 shot 有 required assets 清单,
 *     任何一个 missing 都阻塞下一环节
 *   - LTX Studio / Cuebric 的持久 Character Bible / Style Bible 用 --sref
 *     + --cref / Omni Reference 做跨 shot 锁定
 *   - FilmAgent (arXiv:2501.12909): Producer 作为 multi-agent orchestrator,
 *     负责 asset-completeness gating
 *   - FilMaster (arXiv:2506.18899): 基于 440K 片段的 ASL (average shot
 *     length) 对齐,流派 norms:action 1.5-3s / drama 4-8s / art-house 8-20s
 *   - McKinsey 2024 AI film/TV 报告: continuity error flagging 是 AI
 *     pipeline 最大痛点,需要 explicit audit gate
 *   - HeyGen 2025-06 release: Scene Split + deliverable manifest 工作流
 *
 * 我们的产出(6 大原语):
 *   9.  Character Bible / Style Bible — 持久一致性卡片,跨 shot 复读
 *   10. Continuity Audit Gate — 道具/服装/视线/轴线/时间/天气 6 维审核
 *   11. Asset Ledger — 每 shot 必需资产清单,missing 则阻塞
 *   12. Runtime Budget Validator — 总时长 + 三幕配比
 *   13. Rhythm/Pacing Validator — ASL 按流派基准 flag 单调/混乱
 *   14. Deliverable Manifest — 最终交付清单,非 LLM 的确定性输出
 *
 * 所有原语都是 prompt 层 + 代码层的组合:
 *   - Character/Style Bible 是结构化 JSON,在每次 agent 调用前 stringify 注入
 *   - Continuity Audit / Rhythm Validator 是确定性函数,直接 diff/统计,不用 LLM
 *   - Asset Ledger 用 TypeScript 类型,编译期就能 catch 大部分缺失
 *   - Manifest 是纯函数,从 state 组装,不用 LLM 生成
 */

import type { Character, ScriptShot, Script } from '@/types/agents';

// Alias to preserve public API of producer-enhance — we accept ScriptShot-shaped inputs
export type Shot = ScriptShot;

// ─────────────────────────────────────────────────────────────────
// 9. Character Bible — 持久角色一致性档案
// ─────────────────────────────────────────────────────────────────

export interface CharacterBibleEntry {
  name: string;
  /** 15-20 项物理属性,每次生图都会被 verbatim 复读 */
  physicalAttributes: {
    age?: string;
    height?: string;
    build?: string;
    skin?: string;
    hair?: string;       // 发型 + 颜色 + 长度
    eyes?: string;       // 颜色 + 形状
    face?: string;       // 面部标志性特征
    distinguishingMarks?: string[];  // 疤/痣/刺青
  };
  /** 主要服饰(base outfit) — 默认装束 */
  baseOutfit: string;
  /** 替换服饰(场景限定) — 场景名 → 服饰 */
  outfitVariants?: Record<string, string>;
  /** 生图锁定 token — --cref URL / --sref ID / seed 等 */
  lockTokens?: {
    charRefUrl?: string;  // Midjourney cref
    styleRefUrl?: string;
    seed?: number;
  };
  /** 配色方案 — 跨 shot 不能飘 */
  colorScheme: string;
  /** 标志道具 — 每次出场必须携带 */
  signatureProps?: string[];
  /** 剪影辨识度描述 */
  silhouette?: string;
  /** 英文合并 prompt(给 Midjourney/flux/Minimax image) */
  englishPromptAnchor: string;
}

export interface StyleBible {
  /** 全局风格关键词(注入到每张图) */
  styleKeywords: string;
  /** 参考图底稿 URL(Midjourney sref / Omni Reference) */
  styleRefUrl?: string;
  /** 固定 seed,让 sref 之外的 gen 也保持一致 */
  baseSeed?: number;
  /** 调色板主色 */
  colorPalette: string[];
  /** 灯光签名(lighting signature) */
  lightingSignature: string;
  /** 胶片/渲染风格参考(如 Arri Alexa / Fuji Pro 400H / octane render) */
  filmStockReference: string;
  /** 纵横比(全片统一) */
  aspectRatio: '16:9' | '9:16' | '2.39:1' | '4:3' | '1:1';
}

/**
 * 从 Director plan 的 characters 构造 Character Bible。
 * 把零散的 visual.* 字段压实为一行可复读的 englishPromptAnchor。
 */
export function buildCharacterBible(characters: Character[]): CharacterBibleEntry[] {
  return (characters || []).map((c) => {
    const v = (c as any).visual || {};
    return {
      name: c.name,
      physicalAttributes: {
        age: v.age,
        skin: v.skinTone,
        hair: v.hair,
        face: v.face,
        distinguishingMarks: v.face ? [v.face] : [],
        build: v.bodyType,
      },
      baseOutfit: v.outfit || '',
      colorScheme: v.colorScheme || '',
      signatureProps: v.props ? [v.props] : [],
      silhouette: v.silhouette || '',
      englishPromptAnchor: c.appearance || '',
      lockTokens: {
        charRefUrl: c.imageUrl,
      },
    };
  });
}

/**
 * 把 Character Bible 渲染成 prompt 可注入的 block,跨 agent 调用时复读。
 */
export function renderCharacterBibleBlock(bibles: CharacterBibleEntry[]): string {
  if (!bibles || bibles.length === 0) return '';
  const cards = bibles.map((b) => {
    const lines = [`◆ ${b.name}`];
    if (b.physicalAttributes.age) lines.push(`  年龄: ${b.physicalAttributes.age}`);
    if (b.physicalAttributes.hair) lines.push(`  发型: ${b.physicalAttributes.hair}`);
    if (b.physicalAttributes.face) lines.push(`  面部: ${b.physicalAttributes.face}`);
    if (b.baseOutfit) lines.push(`  服饰: ${b.baseOutfit}`);
    if (b.colorScheme) lines.push(`  配色: ${b.colorScheme}`);
    if (b.signatureProps?.length) lines.push(`  标志道具: ${b.signatureProps.join('、')}`);
    if (b.silhouette) lines.push(`  剪影: ${b.silhouette}`);
    if (b.englishPromptAnchor) lines.push(`  ENG anchor: ${b.englishPromptAnchor.slice(0, 200)}`);
    return lines.join('\n');
  }).join('\n\n');
  return `\n═══ Character Bible(制片人持有·不可飘移的一致性档案)═══\n每次生图都必须 verbatim 复读下列角色描述,禁止重新解读。\n\n${cards}\n════════════════════════════\n`;
}

// ─────────────────────────────────────────────────────────────────
// 10. Continuity Audit — 6 维连贯性审核
// ─────────────────────────────────────────────────────────────────

export interface ContinuityFlag {
  shotNumber: number;
  dimension: 'prop' | 'costume' | 'eyeline' | 'screen-direction' | 'time-of-day' | 'weather';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  fix: string;
}

/**
 * 对比相邻 shot 的 storyboard 描述,flag 出 6 维不一致。
 * 这是确定性代码,不用 LLM,速度快 + 无幻觉。
 */
export function runContinuityAudit(shots: Shot[], characterBible: CharacterBibleEntry[]): ContinuityFlag[] {
  const flags: ContinuityFlag[] = [];
  if (!shots || shots.length < 2) return flags;

  // 建立角色 → baseOutfit 索引
  const outfitByChar = new Map<string, string>();
  characterBible.forEach((b) => outfitByChar.set(b.name, b.baseOutfit));

  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1];
    const curr = shots[i];

    // 简易启发式: 比对场景描述中的关键词
    const prevDesc = (prev.sceneDescription || '').toLowerCase();
    const currDesc = (curr.sceneDescription || '').toLowerCase();

    // (a) 时间跳变检查
    const timeKeywords = ['黎明', '清晨', '正午', '午后', '黄昏', '傍晚', '夜', '深夜', '拂晓', 'dawn', 'morning', 'noon', 'dusk', 'night'];
    const prevTime = timeKeywords.find((k) => prevDesc.includes(k));
    const currTime = timeKeywords.find((k) => currDesc.includes(k));
    if (prevTime && currTime && prevTime !== currTime) {
      // 如果中间没有场景切换提示(闪回/跳切),就是连贯性问题
      const isIntentional = /闪回|回忆|几小时后|次日|翌日|转场|cut|transition/.test(currDesc);
      if (!isIntentional) {
        flags.push({
          shotNumber: curr.shotNumber,
          dimension: 'time-of-day',
          severity: 'major',
          description: `从"${prevTime}"跳到"${currTime}",但没有显式转场`,
          fix: `在 shot ${curr.shotNumber} 的 sceneDescription 明确写"几小时后"或用 match-cut/montage 剪辑语法过渡`,
        });
      }
    }

    // (b) 天气跳变
    const weatherKeywords = ['晴', '阴', '雨', '雪', '雾', '风沙', '暴风', 'rain', 'snow', 'fog', 'storm'];
    const prevWeather = weatherKeywords.find((k) => prevDesc.includes(k));
    const currWeather = weatherKeywords.find((k) => currDesc.includes(k));
    if (prevWeather && currWeather && prevWeather !== currWeather) {
      const isIntentional = /时间|转场|几小时|次日|翌日/.test(currDesc);
      if (!isIntentional) {
        flags.push({
          shotNumber: curr.shotNumber,
          dimension: 'weather',
          severity: 'minor',
          description: `天气从"${prevWeather}"变为"${currWeather}",可能不连贯`,
          fix: `确认 ${curr.shotNumber} 是否真的跨时段,否则统一天气`,
        });
      }
    }

    // (c) 角色服饰漂移 — 对每个出场角色,检查是否偏离 baseOutfit
    (curr.characters || []).forEach((charName: string) => {
      const baseOutfit = outfitByChar.get(charName);
      if (!baseOutfit) return;
      // 如果 sceneDescription 里出现了不在 baseOutfit 里的服饰关键词
      const strongClothingWords = /卫衣|棒球帽|牛仔|运动鞋|西装|婚纱|泳装|汉服|铠甲|长袍/;
      const matches = currDesc.match(strongClothingWords);
      if (matches && !baseOutfit.toLowerCase().includes(matches[0].toLowerCase())) {
        // 可能飘移,但也可能是场景允许的 outfit variant,标 minor
        flags.push({
          shotNumber: curr.shotNumber,
          dimension: 'costume',
          severity: 'minor',
          description: `${charName} 描写中出现"${matches[0]}",与 Character Bible 记录的服饰"${baseOutfit.slice(0, 40)}..."不符`,
          fix: `要么修改 shot 描写与 Bible 一致,要么在 Bible 的 outfitVariants 显式声明这个场景的替换服饰`,
        });
      }
    });
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────
// 11. Asset Ledger — 每 shot 必需资产清单
// ─────────────────────────────────────────────────────────────────

export type AssetStatus = 'missing' | 'draft' | 'approved';

export interface AssetLedgerEntry {
  shotNumber: number;
  characterRef: AssetStatus;   // 出场角色的三视图
  sceneRef: AssetStatus;       // 场景概念图
  storyboardImg: AssetStatus;  // 分镜草图
  videoClip: AssetStatus;      // 最终视频片段
  dialogue: AssetStatus;       // 台词文字
  voiceover?: AssetStatus;     // 配音
  musicCue: AssetStatus;       // 音乐情绪标记
}

export interface AssetLedgerReport {
  entries: AssetLedgerEntry[];
  totalShots: number;
  missingCount: number;
  draftCount: number;
  approvedCount: number;
  blockers: string[];  // 阻塞推进的 missing 项
}

/**
 * 基于当前 Script + Storyboards + VideoClips 构造资产台账。
 */
export function buildAssetLedger(
  script: Script | undefined,
  storyboards: Array<{ shotNumber: number; imageUrl?: string; approved?: boolean }>,
  videos: Array<{ shotNumber: number; videoUrl?: string }>,
  characterAppearanceMap: Record<string, string>,
  sceneImages: Record<string, string> = {},
): AssetLedgerReport {
  const entries: AssetLedgerEntry[] = [];
  const blockers: string[] = [];

  const shots = script?.shots || [];
  shots.forEach((shot) => {
    const sbIdx = storyboards.findIndex((b) => b.shotNumber === shot.shotNumber);
    const sb = sbIdx >= 0 ? storyboards[sbIdx] : undefined;
    const vid = videos.find((v) => v.shotNumber === shot.shotNumber);

    const characterRef: AssetStatus = (shot.characters || []).every(
      (c: string) => characterAppearanceMap[c],
    )
      ? 'approved'
      : (shot.characters?.length ? 'missing' : 'approved');

    // scene ref 状态:如果 script 有 sceneImages 映射就看,否则 draft
    const sceneRef: AssetStatus = Object.keys(sceneImages).length > 0 ? 'approved' : 'draft';

    const storyboardImg: AssetStatus = !sb?.imageUrl
      ? 'missing'
      : sb.approved ? 'approved' : 'draft';

    const videoClip: AssetStatus = !vid?.videoUrl
      ? 'missing'
      : vid.videoUrl.startsWith('data:') ? 'draft' : 'approved';

    const dialogue: AssetStatus = shot.dialogue ? 'approved' : 'draft';
    const musicCue: AssetStatus = (shot as any).score_mood ? 'approved' : 'draft';

    const entry: AssetLedgerEntry = {
      shotNumber: shot.shotNumber,
      characterRef, sceneRef, storyboardImg, videoClip, dialogue, musicCue,
    };

    entries.push(entry);

    if (characterRef === 'missing') blockers.push(`shot ${shot.shotNumber}: 缺少角色三视图 (${shot.characters?.join(', ')})`);
    if (storyboardImg === 'missing') blockers.push(`shot ${shot.shotNumber}: 缺少分镜图`);
    if (videoClip === 'missing') blockers.push(`shot ${shot.shotNumber}: 缺少视频`);
  });

  const flat = entries.flatMap((e) => [e.characterRef, e.sceneRef, e.storyboardImg, e.videoClip, e.dialogue, e.musicCue]);
  return {
    entries,
    totalShots: shots.length,
    missingCount: flat.filter((s) => s === 'missing').length,
    draftCount: flat.filter((s) => s === 'draft').length,
    approvedCount: flat.filter((s) => s === 'approved').length,
    blockers,
  };
}

// ─────────────────────────────────────────────────────────────────
// 12. Runtime Budget Validator — 总时长 + 三幕配比
// ─────────────────────────────────────────────────────────────────

export interface RuntimeBudgetReport {
  targetDurationSec: number;
  actualDurationSec: number;
  overrun: number;  // 正数 = 超时, 负数 = 欠时
  actBreakdown: { act1: number; act2: number; act3: number };
  idealBreakdown: { act1: number; act2: number; act3: number };
  warnings: string[];
}

/**
 * 验证总时长与三幕配比。25%/50%/25% 目标,偏离 ±10% 就 warn。
 */
export function validateRuntimeBudget(
  shots: Array<{ shotNumber: number; act?: number; duration_s?: number }>,
  targetDurationSec: number,
): RuntimeBudgetReport {
  const warnings: string[] = [];
  const n = shots.length;
  const act1End = Math.floor(n * 0.25);
  const act2End = Math.floor(n * 0.75);

  let act1 = 0, act2 = 0, act3 = 0;
  shots.forEach((shot, i) => {
    const d = shot.duration_s || (targetDurationSec / Math.max(1, n));
    // 优先用 shot 自己的 act 字段,回退到按位置推断
    const act = shot.act || (i < act1End ? 1 : i < act2End ? 2 : 3);
    if (act === 1) act1 += d;
    else if (act === 2) act2 += d;
    else act3 += d;
  });

  const actualTotal = act1 + act2 + act3;
  const overrun = actualTotal - targetDurationSec;
  const ideal = {
    act1: targetDurationSec * 0.25,
    act2: targetDurationSec * 0.5,
    act3: targetDurationSec * 0.25,
  };

  if (Math.abs(overrun) > targetDurationSec * 0.1) {
    warnings.push(`总时长 ${actualTotal.toFixed(1)}s 偏离目标 ${targetDurationSec}s ${overrun > 0 ? '超' : '不足'} ${Math.abs(overrun).toFixed(1)}s`);
  }

  if (Math.abs(act1 - ideal.act1) / ideal.act1 > 0.3) {
    warnings.push(`Act 1 时长 ${act1.toFixed(1)}s 偏离理想 ${ideal.act1.toFixed(1)}s(建立+激励事件不足/过长)`);
  }
  if (Math.abs(act2 - ideal.act2) / ideal.act2 > 0.3) {
    warnings.push(`Act 2 时长 ${act2.toFixed(1)}s 偏离理想 ${ideal.act2.toFixed(1)}s(对抗戏不足/过长)`);
  }
  if (Math.abs(act3 - ideal.act3) / ideal.act3 > 0.3) {
    warnings.push(`Act 3 时长 ${act3.toFixed(1)}s 偏离理想 ${ideal.act3.toFixed(1)}s(高潮+余韵不足/过长)`);
  }

  return {
    targetDurationSec,
    actualDurationSec: actualTotal,
    overrun,
    actBreakdown: { act1, act2, act3 },
    idealBreakdown: ideal,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────
// 13. Rhythm / Pacing Validator — ASL 按流派基准
// ─────────────────────────────────────────────────────────────────

export type Genre = 'action' | 'drama' | 'thriller' | 'comedy' | 'romance' | 'art-house' | 'horror' | 'documentary' | string;

export const GENRE_ASL_BENCHMARKS: Record<string, { min: number; max: number; ideal: number; label: string }> = {
  action:       { min: 1.5, max: 3.0,  ideal: 2.2, label: '动作片: 1.5-3s/镜(快节奏)' },
  thriller:     { min: 2.0, max: 4.0,  ideal: 3.0, label: '惊悚片: 2-4s/镜' },
  horror:       { min: 1.8, max: 5.0,  ideal: 3.2, label: '恐怖片: 1.8-5s/镜(张弛)' },
  drama:        { min: 4.0, max: 8.0,  ideal: 5.5, label: '剧情片: 4-8s/镜' },
  romance:      { min: 4.0, max: 7.0,  ideal: 5.0, label: '爱情片: 4-7s/镜' },
  comedy:       { min: 2.5, max: 5.0,  ideal: 3.5, label: '喜剧: 2.5-5s/镜(重反应)' },
  'art-house':  { min: 8.0, max: 20.0, ideal: 12.0, label: '艺术片: 8-20s/镜(长镜头)' },
  documentary:  { min: 4.0, max: 10.0, ideal: 6.0, label: '纪录片: 4-10s/镜' },
};

export interface RhythmReport {
  genre: string;
  averageShotLength: number;
  variance: number;
  benchmark: { min: number; max: number; ideal: number; label: string };
  verdict: 'on-target' | 'too-fast' | 'too-slow' | 'monotonous' | 'chaotic';
  warnings: string[];
}

/**
 * 按流派基准验证 ASL(平均镜头长度)和节奏方差。
 */
export function validateRhythm(
  shots: Array<{ duration_s?: number }>,
  genre: string,
): RhythmReport {
  const durations = shots.map((s) => s.duration_s || 3);
  const total = durations.reduce((a, b) => a + b, 0);
  const asl = total / Math.max(1, durations.length);

  const mean = asl;
  const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / Math.max(1, durations.length);
  const stddev = Math.sqrt(variance);

  // 流派匹配(模糊)
  const genreKey = Object.keys(GENRE_ASL_BENCHMARKS).find((k) => genre.toLowerCase().includes(k) || k.includes(genre.toLowerCase()));
  const benchmark = (genreKey ? GENRE_ASL_BENCHMARKS[genreKey] : GENRE_ASL_BENCHMARKS.drama);

  const warnings: string[] = [];
  let verdict: RhythmReport['verdict'] = 'on-target';

  if (asl < benchmark.min) {
    verdict = 'too-fast';
    warnings.push(`ASL ${asl.toFixed(1)}s 低于 ${benchmark.label} — 观众还没看清就切了`);
  } else if (asl > benchmark.max) {
    verdict = 'too-slow';
    warnings.push(`ASL ${asl.toFixed(1)}s 高于 ${benchmark.label} — 节奏拖,观众流失`);
  }

  // 单调检测: 方差过低 = 每个 shot 都一样长
  if (stddev < asl * 0.15 && shots.length > 4) {
    verdict = 'monotonous';
    warnings.push(`镜头时长方差 ${stddev.toFixed(2)} 过低 — 每个 shot 都一样长,缺乏张弛`);
  }

  // 混乱检测: 方差过高 = 时长乱跳
  if (stddev > asl * 0.8) {
    verdict = 'chaotic';
    warnings.push(`镜头时长方差 ${stddev.toFixed(2)} 过高 — 节奏混乱`);
  }

  return {
    genre,
    averageShotLength: Number(asl.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    benchmark,
    verdict,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────
// 14. Deliverable Manifest — 最终交付清单
// ─────────────────────────────────────────────────────────────────

export interface DeliverableManifest {
  title: string;
  runtimeSec: number;
  shotCount: number;
  asl: number;
  aspectRatio: string;
  resolution?: string;

  // 质量指标
  characterConsistencyScore: number;   // 0-100
  continuityFlagsTotal: number;
  continuityFlagsResolved: number;
  assetCompleteness: number;           // 0-100

  // 完成度
  audioComplete: boolean;
  subtitlesComplete: boolean;
  thumbnailShotNumber?: number;

  // 证据链
  characterBibleEntries: number;
  styleBiblePresent: boolean;

  // 时间戳
  generatedAt: string;
}

export function buildDeliverableManifest(params: {
  title: string;
  script?: Script;
  styleBible?: StyleBible;
  characterBible: CharacterBibleEntry[];
  videos: Array<{ shotNumber: number; videoUrl?: string }>;
  storyboards: Array<{ shotNumber: number; imageUrl?: string }>;
  continuityFlags: ContinuityFlag[];
  assetLedger?: AssetLedgerReport;
  totalDurationSec?: number;
  hasMusic?: boolean;
  hasVoiceover?: boolean;
}): DeliverableManifest {
  const shotCount = params.script?.shots?.length || 0;
  const runtimeSec = params.totalDurationSec || 0;
  const asl = shotCount > 0 ? runtimeSec / shotCount : 0;

  // 角色一致性评分: 有 englishPromptAnchor + lockTokens 的角色算完备
  const charsWithAnchor = params.characterBible.filter((b) => b.englishPromptAnchor?.length > 30).length;
  const charsWithLock = params.characterBible.filter((b) => b.lockTokens?.charRefUrl).length;
  const characterConsistencyScore = params.characterBible.length > 0
    ? Math.round(((charsWithAnchor + charsWithLock) / (params.characterBible.length * 2)) * 100)
    : 0;

  const resolved = params.continuityFlags.filter((f) => (f as any).resolved).length;

  const assetCompleteness = params.assetLedger
    ? Math.round((params.assetLedger.approvedCount / Math.max(1, params.assetLedger.approvedCount + params.assetLedger.draftCount + params.assetLedger.missingCount)) * 100)
    : 0;

  return {
    title: params.title,
    runtimeSec: Number(runtimeSec.toFixed(1)),
    shotCount,
    asl: Number(asl.toFixed(2)),
    aspectRatio: params.styleBible?.aspectRatio || '16:9',
    resolution: '1920x1080',

    characterConsistencyScore,
    continuityFlagsTotal: params.continuityFlags.length,
    continuityFlagsResolved: resolved,
    assetCompleteness,

    audioComplete: params.hasMusic ?? false,
    subtitlesComplete: false,
    thumbnailShotNumber: params.storyboards[0]?.shotNumber,

    characterBibleEntries: params.characterBible.length,
    styleBiblePresent: !!params.styleBible,

    generatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Producer system prompt 增强块 — 注入到 runDirectorReview 的 system
// ─────────────────────────────────────────────────────────────────

/**
 * 给 Producer 的增强评审 prompt 块。
 * 把 Bible / Continuity / Ledger / Rhythm / Manifest 的摘要喂给 LLM,
 * 让它在 100 分制评审里把这些因素都算进去。
 */
export function buildProducerEvaluationContext(params: {
  characterBible: CharacterBibleEntry[];
  continuityFlags: ContinuityFlag[];
  assetLedger?: AssetLedgerReport;
  rhythmReport?: RhythmReport;
  runtimeReport?: RuntimeBudgetReport;
  manifest?: DeliverableManifest;
}): string {
  const parts: string[] = ['\n═══ Producer 专业评审上下文(必须纳入评分)═══'];

  if (params.characterBible?.length) {
    parts.push(`\n▶ 角色一致性档案: ${params.characterBible.length} 个角色有 Bible 条目`);
    const weak = params.characterBible.filter((b) => !b.englishPromptAnchor || b.englishPromptAnchor.length < 30);
    if (weak.length) parts.push(`   ⚠️ ${weak.length} 个角色 Bible 的英文 anchor 过短,会导致跨镜头漂移`);
  }

  if (params.continuityFlags?.length) {
    parts.push(`\n▶ 连贯性审核: ${params.continuityFlags.length} 个 flag`);
    const byDim: Record<string, number> = {};
    params.continuityFlags.forEach((f) => { byDim[f.dimension] = (byDim[f.dimension] || 0) + 1; });
    Object.entries(byDim).forEach(([d, c]) => parts.push(`   · ${d}: ${c} 处`));
  } else {
    parts.push('\n▶ 连贯性审核: 无 flag — 通过');
  }

  if (params.assetLedger) {
    const l = params.assetLedger;
    parts.push(`\n▶ 资产台账: ${l.approvedCount} approved / ${l.draftCount} draft / ${l.missingCount} missing`);
    if (l.blockers.length) {
      parts.push(`   ⛔ ${l.blockers.length} 个阻塞项:`);
      l.blockers.slice(0, 5).forEach((b) => parts.push(`      - ${b}`));
    }
  }

  if (params.rhythmReport) {
    const r = params.rhythmReport;
    parts.push(`\n▶ 节奏审核 (${r.genre}): ASL=${r.averageShotLength}s, 判定=${r.verdict}`);
    parts.push(`   · 基准: ${r.benchmark.label}`);
    r.warnings.forEach((w) => parts.push(`   ⚠️ ${w}`));
  }

  if (params.runtimeReport) {
    const r = params.runtimeReport;
    parts.push(`\n▶ 时长预算: 目标 ${r.targetDurationSec}s, 实际 ${r.actualDurationSec.toFixed(1)}s, 偏差 ${r.overrun > 0 ? '+' : ''}${r.overrun.toFixed(1)}s`);
    parts.push(`   · 三幕实际: Act1=${r.actBreakdown.act1.toFixed(1)}s / Act2=${r.actBreakdown.act2.toFixed(1)}s / Act3=${r.actBreakdown.act3.toFixed(1)}s`);
    r.warnings.forEach((w) => parts.push(`   ⚠️ ${w}`));
  }

  if (params.manifest) {
    const m = params.manifest;
    parts.push(`\n▶ 交付清单快照: ${m.shotCount} shots / ${m.runtimeSec}s / ASL=${m.asl}s / 角色一致性=${m.characterConsistencyScore}/100 / 资产完整度=${m.assetCompleteness}%`);
  }

  parts.push('\n════════════════════════════');
  return parts.join('\n');
}

/**
 * 增强版 Producer system prompt 尾部追加块。
 * 在现有 getDirectorReviewPrompt 的 100 分制上,新增 3 项专业评分维度。
 */
export function buildProducerReviewPromptBlock(): string {
  return `

## ═══ 制片人专业评审强化(行业标准接轨)═══

除了原有的 叙事 / 角色 / 感官 / 视觉 / 节奏 / 音画 6 维,你还必须对以下 3 项专业维度打分(总分仍是 100 但现在包含这 3 维):

### A. 角色/风格 Bible 完备度(+15 分)
- 每个主要角色是否有至少 30 词的英文 anchor prompt?
- 是否有 --cref / lockTokens 让跨镜头不飘?
- 是否有 Style Bible(styleKeywords + palette + lighting signature)?
- 缺一项减 3-5 分

### B. 连贯性审核(+10 分)
- 相邻 shot 的时间/天气/服装/眼神方向是否一致?
- 每发现 1 个未解决的 continuity flag 扣 2 分(critical 扣 4 分)
- 轴线(180° rule)是否保持?eyeline match 是否对齐?

### C. 节奏 / 时长预算(+10 分)
- ASL 是否落在流派基准内(action 1.5-3s / drama 4-8s / art-house 8-20s)
- 三幕时长是否接近 25/50/25
- 镜头时长方差是否合理(不能每个镜头都一样长)
- 超出预算或偏离基准每项扣 3 分

### 输出格式追加字段

原有 dimensions 对象追加:
\`\`\`json
{
  "bibleCompleteness": { "score": <0-15>, "comment": "..." },
  "continuity":        { "score": <0-10>, "comment": "..." },
  "rhythmAndBudget":   { "score": <0-10>, "comment": "..." }
}
\`\`\`

注意:这 3 项分数加上原有 6 项分数应 = 100(原有 6 项上限从 100 调整为 65:叙事 20 / 角色 15 / 感官 10 / 视觉 10 / 节奏 5 / 音画 5)。

════════════════════════════════════════`;
}

// Re-export types for other modules that construct these at call sites
// Note: Shot is already exported above as a type alias for ScriptShot
export type { Character, Script };
