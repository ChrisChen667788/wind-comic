import OpenAI from 'openai';
import { buildDirectorShotSpecHint } from '@/lib/shot-spec-bridge';
import { resolveVerifiedServeFilePath } from '@/lib/serve-file-sign';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { API_CONFIG } from '@/lib/config';
import { withVerticalHints } from '@/lib/vertical-composition';
// v2.18.1: 复用 polish 那套 4 级 JSON fallback (LLM 对中文长文本经常返回非法 JSON)
import { robustJsonParse } from '@/lib/polish-json';
import {
  Agent, AgentRole, DirectorPlan, Script, Storyboard, VideoClip, Character,
  // v12.225 神类拆分第一刀:agent 契约面类型(消公开方法签名上的 any)
  EditResult, DirectorReview, CharacterDesignerResult, SceneDesignerResult, GateData, GateResult,
} from '@/types/agents';
import { MinimaxService } from '../minimax.service';
import { VeoService, hasVeo } from '../veo.service';
import { MidjourneyService, hasMidjourney } from '../midjourney.service';
import { KlingService, hasKling } from '../kling.service';
import { FalFluxService, hasFalFlux } from '../fal-flux.service';
import { ComfyUIService, hasComfyUI, hasComfyUIControlNet } from '../comfyui.service';
import { XVerseService, hasXVerse, isXVersePrimary } from '../xverse.service';
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
import { buildStyleBiblePrompt, prependStyleAnchor } from '@/lib/style-bible';
import type { ImageEngine } from '@/lib/image-router';
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
  getEffectiveVisualPrompt,
  buildMusicVisualAnchor,
} from '@/lib/writer-enhance';
// v12.12.0(Phase 2):@元素注册表 + 跨引擎多参适配 + 同场景续接守卫
import { buildElementsRegistry, mountForShot, scenesLikelySame, subjectReferencesFromMount, type ElementsRegistry, type ShotMount } from '@/lib/elements-registry';
import { normalizeVideoAspect } from '@/lib/video-aspect'; // v12.14.0 横竖屏:把项目比例传给视频引擎
import { StoryTemplate } from '@/lib/story-templates';
import { createError, normalizeError, PipelineError } from '@/lib/pipeline-error';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { extractLastFrame, extractMiddleFrame } from '@/lib/last-frame-extractor';
import { deriveProsody } from '@/lib/tts-prosody';
import { getLatestQualityScore, buildWriterFeedbackHint } from '@/lib/quality-scores';
import { buildPacingFeedbackHint, getLatestPacingReport } from '@/lib/pacing-feedback'; // v12.284
// v12.4.0(阶段二十三):主管线视频/图像成本落库 —— 此前从不记,cost-attribution 视频/图像类目永远 0。
import { recordCostLog, estimateVideoCostCny, estimateImageCostCny, videoRateForProvider } from '@/lib/repos/cost-log-repo';
// v12.6.1(#2):目标语种检测 —— 锁台词/旁白/TTS/口型语种,visualPrompt 仍英文。
import { detectLanguage, ttsLangCode, lipsyncLangCode, buildLanguageDirective, SUPPORTED_LANGUAGES, type TargetLanguage } from '@/lib/language-detect';
// v12.7.0:editor TTS 走注册表(vectorengine-tts 50 > minimax-tts 100),vectorengine 进主路径。
import { dispatchTTSGenerate, ttsEngineConfigured } from '@/lib/tts-providers/registry';
// v12.29.0(P1):原生音画一体 —— NATIVE_AV=1 时,真由原生音频引擎出片的有台词镜跳 TTS,用成片自带音轨。
import { nativeAudioEnabled, isNativeAudioProvider, nativeAudioShotNumbers, partitionDialogueShots } from '@/lib/native-av';
// v12.32.0:可调生成并发(场景/分镜/视频),默认 2 零回归;视频高并发会弱化关键帧链(见 gen-concurrency 注释)。
import { resolveConcurrency } from '@/lib/gen-concurrency';
// v12.8.0:provider 软熔断 —— 视频引擎池饱和/auth/配额失败 → 冷却跳过,跨镜不重复踩坑。
import { isProviderHealthy, markProviderDownIfFatal } from '@/lib/provider-health-cache';
// v12.8.1:视频引擎兜底链控制流(含软熔断)抽出来可单测。
import { runVideoEngineChain } from '@/lib/video-engine-chain';

/**
 * v12.261:runWriter 从 hybrid-orchestrator(5517 行神类)抽出的独立模块。
 * 行为逐字节保持 —— orchestrator 以 `this as unknown as WriterAgentCtx` 传入,读写仍落在同一实例上。
 * WriterAgentCtx 只声明本函数用到的成员(私有成员的「类型视图」,不放宽类的封装)。
 */
/** 抽出时 orchestrator 的模块级 sleep 未导出,这里本地补一个等价实现(与原逐字节等价)。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WriterAgentCtx {
  parsedScript: ParsedScript | null;
  originalIdea: string;
  projectId: string;
  template: StoryTemplate | null;
  characterAppearanceMap: Record<string, string>;
  qualityLedger: Array<{ shot: number; kind: string; detail: string }>;
  openai: OpenAI | null;
  xverseService: XVerseService | null;
  emit(type: string, data: any): void;
  update(role: AgentRole, u: Partial<Agent>): void;
  callLLM(systemPrompt: string, userMessage: string, json?: boolean, useCreativeModel?: boolean, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
  fallbackScript(plan: DirectorPlan): Script;
  targetLanguage(): TargetLanguage;
}
export async function runWriter(ctx: WriterAgentCtx, plan: DirectorPlan): Promise<Script> {
    ctx.update(AgentRole.WRITER, { status: 'working', currentTask: '运用麦基方法论创作剧本', progress: 10 });

    if (ctx.parsedScript) {
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '基于原始剧本进行改编，保留核心情节和对白精华...✍️' });
    } else {
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '三幕结构、人物弧光...让我好好构思 ✍️' });
    }

    let script: Script;

    // ─────────────────────────────────────────
    // XVERSE-Ent 路径（开源 MoE 编剧模型）
    // 仅当 XVERSE_ENABLED=true 时作为编剧主用 LLM
    // 否则保留 OpenAI/Claude 主链路，XVerse 仅作 fallback
    // ─────────────────────────────────────────
    if (ctx.xverseService && isXVersePrimary()) {
      ctx.update(AgentRole.WRITER, { progress: 20, currentTask: 'XVERSE-Ent A5.7B 思考剧本结构' });
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '调用开源 XVERSE-Ent A5.7B（融合麦基方法论）...🧠' });

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
      const prevScoreX = ctx.projectId ? await getLatestQualityScore(ctx.projectId) : null;
      const feedbackHintX = buildWriterFeedbackHint(prevScoreX);
      if (feedbackHintX) {
        console.log(`[Writer] reinforcing weak dimensions from last run score (overall=${prevScoreX?.overall})`);
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `读到上一版评分(综合${prevScoreX?.overall}),针对性强化弱维度 📈`,
        });
      }

      const xUserContext = (ctx.parsedScript
        ? `${getWriterScriptContext(ctx.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style, characterAppearances: plan.characters.map(c => ({ name: c.name, appearance: c.appearance })) })}`
        : `导演计划：${JSON.stringify(plan)}`) + feedbackHintX + enhanceBlockX;

      const xResult = await ctx.xverseService.writeScript({
        plan,
        userContext: xUserContext,
        isAdaptation: !!ctx.parsedScript,
        characterNames: plan.characters?.map(c => c.name),
        characterAppearances: Object.keys(ctx.characterAppearanceMap).length > 0 ? ctx.characterAppearanceMap : undefined,
        sceneCount: ctx.parsedScript?.stats.sceneCount,
        directorTotalShots: directorTotalShotsX,
        language: ctx.targetLanguage(),   // v12.322:与自家 LLM 那条同一口径
        onHeartbeat: (msg) => {
          ctx.emit('heartbeat', { message: msg });
          ctx.update(AgentRole.WRITER, { currentTask: msg });
        },
      });

      if (xResult.ok && xResult.script) {
        script = xResult.script;
        ctx.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
        const ms = xResult.elapsedMs.toFixed(0);
        const p1 = xResult.passes.pass1Ms.toFixed(0);
        const p2 = xResult.passes.pass2Ms.toFixed(0);
        const fix = xResult.passes.fixMs ? `, fix=${xResult.passes.fixMs.toFixed(0)}ms` : '';
        console.log(`[Writer] XVerse done in ${ms}ms (pass1=${p1}ms, pass2=${p2}ms${fix})`);
        ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title || '未命名'}」由 XVERSE-Ent 完成 ✨ (${(xResult.elapsedMs / 1000).toFixed(1)}s)` });
        return script;
      }

      console.warn(`[Writer] XVerse failed (${xResult.error}), 降级到 Claude/OpenAI 主链路`);
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `XVerse 调用失败 (${xResult.error?.slice(0, 60)})，降级到云端 LLM...` });
    }

    if (ctx.openai) {
      ctx.update(AgentRole.WRITER, { progress: 30 });
      // 构建编剧 system prompt（传入适配模式参数 + 角色外观）
      const directorTotalShots = plan.storyStructure?.totalShots || 0;
      const writerPromptOptions = ctx.parsedScript ? {
        isScriptAdaptation: true,
        characterNames: plan.characters.map(c => c.name),
        characterAppearances: Object.keys(ctx.characterAppearanceMap).length > 0
          ? ctx.characterAppearanceMap
          : undefined,
        sceneCount: ctx.parsedScript.stats.sceneCount,
        // 基于剧本内容量动态计算镜头数范围
        // 每1000字≈2个镜头，每3句对白≈1个镜头，每个场景≈2-3个镜头
        minShots: Math.max(4, Math.min(
          Math.max(
            ctx.parsedScript.stats.sceneCount * 2,           // 每场景至少2个镜头
            Math.ceil(ctx.parsedScript.stats.dialogueCount / 3), // 每3句对白1个镜头
            Math.ceil(ctx.parsedScript.stats.totalChars / 1000) * 2, // 每1000字2个镜头
          ),
          8  // minShots 上限
        )),
        maxShots: Math.max(8, Math.min(
          Math.max(
            ctx.parsedScript.stats.sceneCount * 4,
            Math.ceil(ctx.parsedScript.stats.dialogueCount / 2),
            Math.ceil(ctx.parsedScript.stats.totalChars / 500) * 2,
          ),
          30 // maxShots 上限
        )),
        directorTotalShots,
      } : {
        directorTotalShots,
      };
      // v2.20 P0.2: 把原始 idea 透给 Writer prompt builder, 启用 漫剧 mode 检测
      const writerPromptOptionsWithIdea = {
        ...writerPromptOptions,
        idea: ctx.originalIdea || (plan as any).synopsis || '',
        language: ctx.targetLanguage(), // v12.6.1: 锁台词/旁白/场景描述语种
      };
      const prompt = getMcKeeWriterPrompt(plan.genre, plan.style, writerPromptOptionsWithIdea);

      // ── P3: 根据是否有原始剧本，构建不同上下文 ──
      let userContext: string;
      if (ctx.parsedScript) {
        // 剧本改编模式：原始剧本文本是唯一权威，Director plan 仅提供视觉风格参考
        const scriptContext = getWriterScriptContext(ctx.parsedScript);

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

        const templateContext = ctx.template
          ? `\n\n【故事模板指引（仅影响视觉风格，不影响剧情）】\n色彩建议：${ctx.template.colorPalette}`
          : '';

        // 原始剧本文本占据绝大部分上下文，视觉风格仅作为附录
        // v12.324:覆盖计划属**视觉**决策(景别/机位/剪辑语法),不含剧情,
        // 因此放进视觉附录不违反「原剧本是唯一权威」这条改编铁律。
        userContext = `${scriptContext}\n\n═══ 附录：视觉风格参考（仅用于 visualPrompt 的风格关键词和角色外貌，不要参考这里的任何剧情信息）═══\n${JSON.stringify(visualStyleRef)}${templateContext}${buildDirectorShotSpecHint(plan)}`;
      } else {
        const templateContext = ctx.template
          ? `\n\n【故事模板指引】\n结构提示：${ctx.template.structureHint}\n情感曲线：${ctx.template.emotionCurve}\n关键元素：${ctx.template.keyElements.join('、')}\n色彩建议：${ctx.template.colorPalette}`
          : '';
        // v12.324:整份 plan 里本就含 shotSpec,但那是一坨无标签 JSON —— 模型无从
        // 知道该遵守它。补一个有标签、写明优先级的基线块。
        userContext = `导演计划：${JSON.stringify(plan)}${templateContext}${buildDirectorShotSpecHint(plan)}`;
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
      const prevScore = ctx.projectId ? await getLatestQualityScore(ctx.projectId) : null;
      const feedbackHint = buildWriterFeedbackHint(prevScore);
      if (feedbackHint) {
        console.log(`[Writer] reinforcing weak dimensions from last run score (overall=${prevScore?.overall})`);
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `读到上一版评分(综合${prevScore?.overall}),针对性强化弱维度 📈`,
        });
        userContext += feedbackHint;
      }

      // v12.284:节奏审计反馈闭环 —— buildWriterFeedbackHint 只看 face/lighting/continuity
      // 三个**画面**维度,节奏诊断(拖沓段/高开低走/开场弱/时长呆板)此前**从不回流**:
      // 审计能指出「第 3~5 镜拖沓」,下一轮生成却完全不知道 —— 诊断出来了却没进闭环。
      // 依赖 v12.278 起 pacingReport 已随 script 落库(在那之前的老项目自然拿不到,返回空串)。
      try {
        const prevPacing = ctx.projectId ? await getLatestPacingReport(ctx.projectId) : null;
        const pacingHint = buildPacingFeedbackHint({ report: prevPacing, plannedShots: plan?.storyStructure?.totalShots });
        if (pacingHint) {
          const dragN = prevPacing?.v2?.dragSegments?.length ?? 0;
          console.log(`[Writer] 注入上一版节奏诊断(拖沓段 ${dragN} 处,形状 ${prevPacing?.v2?.shape?.shape})`);
          ctx.emit('agentTalk', {
            role: AgentRole.WRITER,
            text: `读到上一版节奏诊断${dragN > 0 ? `(${dragN} 段拖沓)` : ''},本版针对性改进 📉`,
          });
          userContext += pacingHint;
        }
      } catch (e) {
        console.warn('[Writer] 节奏反馈注入失败(非阻塞):', e instanceof Error ? e.message.slice(0, 60) : e);
      }

      // ═══ Two-Pass Generation（业界最佳实践）═══
      // Pass 1: 自然语言规划 — 让 LLM 先用自由文本规划镜头分配
      // Pass 2: JSON 格式化 — 基于规划生成结构化输出
      // 这避免了"推理 + 格式化同时进行"导致的质量下降

      const minShotsRequired = writerPromptOptions.minShots || (directorTotalShots > 0 ? Math.max(4, directorTotalShots - 2) : 4);
      const maxShotsAllowed = writerPromptOptions.maxShots || (directorTotalShots > 0 ? Math.max(directorTotalShots + 2, 8) : 12);

      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '第一步：规划镜头分配方案...📋' });

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
      const shotPlan = await ctx.callLLM(planningPrompt, userContext, false, true);
      ctx.update(AgentRole.WRITER, { progress: 40 });

      if (!shotPlan) {
        console.error('[Writer] Pass 1 返回空结果！LLM 可能超时或出错');
        ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '镜头规划超时，尝试直接生成剧本...⚡' });
      }

      // 从规划文本中提取镜头数
      const planShotCount = (shotPlan.match(/镜头\d+/g) || []).length;
      console.log(`[Writer] Pass 1 规划完成: ${planShotCount} 个镜头, 响应长度=${shotPlan.length}`);

      // Pass 2: 基于规划生成完整 JSON
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `第二步：将 ${planShotCount || minShotsRequired} 个镜头转为完整剧本...📝` });
      ctx.update(AgentRole.WRITER, { currentTask: `将${planShotCount || minShotsRequired}个镜头规划转为完整剧本`, progress: 50 });

      // 如果 Pass 1 为空（超时等），直接用原始素材进入 Pass 2
      // 注意：pass2Context 不能太长，否则输出 token 被压缩导致空结果
      // 限制 userContext 在 pass2 中的长度，优先保留 shotPlan
      const trimmedUserCtx = userContext.length > 8000 ? userContext.slice(0, 8000) + '\n[...已截断...]' : userContext;
      // v12.164:输出预算铁律 —— 网关会 clamp maxTokens(16384 实测 ~8K 截断),长英文修饰字段
      // (visualPrompt/globalLighting/negativePrompt)是 token 大户;明示「完整 JSON > 描述丰富度」。
      const budgetRule = `\n══ 输出预算铁律 ══\n完整闭合的 JSON 比描述丰富度更重要。visualPrompt ≤ 60 英文词;globalLighting/negativePrompt ≤ 12 英文词;禁止在任何字段里写散文式长段。若篇幅紧张,优先精简修饰字段,绝不截断 JSON 结构。`
        // v12.166:目标语种 ≠ 中文时,user 消息末尾再注一次语言铁律 —— system 端铁律会被
        // 大段中文素材带偏(live 实测 language=ja 出稿全中文台词);LLM 对 user 末尾指令遵从度最高。
        + (ctx.targetLanguage() !== 'zh' ? buildLanguageDirective(ctx.targetLanguage()) : '');
      const pass2Context = (shotPlan
        ? `══ 镜头规划（严格按照此规划生成 JSON）══\n${shotPlan}\n\n══ 素材 ══\n${trimmedUserCtx}\n\n══ 指令 ══\nshots 数组必须有 ${planShotCount || minShotsRequired} 个镜头。`
        : `${trimmedUserCtx}\n\nshots 数组必须有 ${minShotsRequired}-${maxShotsAllowed} 个镜头。`) + budgetRule;

      console.log(`[Writer] Pass 2 开始: pass2Context=${pass2Context.length}chars`);
      // v2.18.4: Writer Pass-2 known-heavy;v12.164 提档 24576(env WRITER_MAX_TOKENS 可覆盖)
      const writerMax = parseInt(process.env.WRITER_MAX_TOKENS || '', 10) || 24576;
      const raw = await ctx.callLLM(prompt, pass2Context, true, true, { maxTokens: writerMax });
      ctx.update(AgentRole.WRITER, { progress: 70 });

      if (!raw) {
        console.error('[Writer] Pass 2 返回空结果！');
        // 优先尝试 XVerse 作为开源 fallback
        if (ctx.xverseService) {
          ctx.emit('agentTalk', { role: AgentRole.WRITER, text: 'Claude 返回空结果，切换 XVERSE-Ent 兜底...🔄' });
          const xUserContext = ctx.parsedScript
            ? `${getWriterScriptContext(ctx.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style, characterAppearances: plan.characters.map(c => ({ name: c.name, appearance: c.appearance })) })}`
            : `导演计划：${JSON.stringify(plan)}`;
          const xRes = await ctx.xverseService.writeScript({
            plan,
            userContext: xUserContext,
            isAdaptation: !!ctx.parsedScript,
            characterNames: plan.characters?.map(c => c.name),
            characterAppearances: Object.keys(ctx.characterAppearanceMap).length > 0 ? ctx.characterAppearanceMap : undefined,
            sceneCount: ctx.parsedScript?.stats.sceneCount,
            directorTotalShots,
            language: ctx.targetLanguage(),   // v12.322
            onHeartbeat: (msg) => ctx.emit('heartbeat', { message: msg }),
          });
          if (xRes.ok && xRes.script) {
            script = xRes.script;
            ctx.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
            ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title || '未命名'}」由 XVERSE-Ent 兜底完成 ✨` });
            return script;
          }
        }
        ctx.emit('agentTalk', { role: AgentRole.WRITER, text: 'LLM 返回空结果，使用智能降级方案...' });
        script = ctx.fallbackScript(plan);
        ctx.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
        ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title}」写好了（降级模式）🔧` });
        return script;
      }
      console.log(`[Writer] Pass 2 完成: raw=${raw.length}chars`);

      try {
        // v2.18.1 修复: robustJsonParse 4 级降级 — 此前 raw JSON.parse 经常因
        // LLM 在中文长字段塞裸 \n / 用全角引号 而炸 → 走 fallback 出 "镜头N" 占位.
        const parsedScript = robustJsonParse(raw);
        if (!parsedScript || typeof parsedScript !== 'object') {
          // v2.18.2: dump raw 方便排查
          try {
            const fs = await import('fs');
            const path = await import('path');
            const tmpFile = path.join('/tmp', `llm-fail-writer-${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, raw);
            console.error(`[Writer] raw 输出已 dump 到 ${tmpFile}`);
          } catch { /* swallow */ }
          throw new Error(`Writer: robustJsonParse 也无法解析 (raw=${raw.length} chars, tail="${raw.slice(-100)}")`);
        }
        script = parsedScript as Script;

        // ── 镜头数量验证 + 自动重试 ──
        if (script.shots && script.shots.length < minShotsRequired) {
          console.log(`[Writer] 镜头数不足: ${script.shots.length}/${minShotsRequired}，请求补充...`);
          ctx.update(AgentRole.WRITER, { currentTask: `镜头数不足(${script.shots.length}个)，补充到${minShotsRequired}个`, progress: 75 });
          ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `检测到只有${script.shots.length}个镜头，正在补充到至少${minShotsRequired}个...🔄` });

          try {
            const retryRaw = await ctx.callLLM(
              prompt,
              `🚨 严重问题：你只生成了 ${script.shots.length} 个镜头，但要求是 ${minShotsRequired}-${maxShotsAllowed} 个！

请参考以下镜头规划重新生成完整 JSON，shots 数组必须有 ${minShotsRequired} 个以上：

${shotPlan}

你之前的不完整输出（仅供参考结构，镜头数量严重不足）：
${raw.slice(0, 2000)}

请输出完整的修正后 JSON，shots 数组至少 ${minShotsRequired} 个镜头。`
            );
            const retryParsed = robustJsonParse(retryRaw);
            const retryScript = (retryParsed || {}) as Script;
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
          ctx.update(AgentRole.WRITER, { currentTask: '检查字数标准，补充不足内容', progress: 80 });
          ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `自检发现${validation.issues.length}处不达标（字数/细节不足），正在补充...📝` });

          try {
            const fixRaw = await ctx.callLLM(
              prompt,
              `你之前的输出存在以下问题：\n${validation.fixInstructions}\n\n原始输出：\n${raw}\n\n请修正以上所有问题，输出完整的修正后JSON。shots数组必须保持${script.shots?.length || minShotsRequired}个镜头，不可减少。`
            );
            const fixedParsed = robustJsonParse(fixRaw);
            const fixedScript = (fixedParsed || {}) as Script;
            if (fixedScript.shots && fixedScript.shots.length >= (script.shots?.length || 0)) {
              script = fixedScript;
              console.log('[Writer] 修正完成');
              ctx.qualityLedger.push({ shot: 0, kind: 'writer-fix', detail: `${validation.issues.length}问题已修正` }); // v12.111
            }
          } catch {
            console.warn('[Writer] 修正失败，使用原始输出');
            ctx.qualityLedger.push({ shot: 0, kind: 'writer-fix', detail: `${validation.issues.length}问题修正失败,沿用首稿` }); // v12.111
          }
        }

        // ── P3 增强: 剧本改编模式下的忠实度校验 ──
        if (ctx.parsedScript && script.shots?.length > 0) {
          const fidelityIssues: string[] = [];
          const originalChars = ctx.parsedScript.characters.map(c => c.name);
          const scriptChars = new Set(script.shots.flatMap(s => s.characters || []));

          // 检查是否遗漏了原剧本中的重要角色
          const missedChars = originalChars.filter(c => !scriptChars.has(c) && (ctx.parsedScript!.characters.find(pc => pc.name === c)?.dialogueCount || 0) >= 2);
          if (missedChars.length > 0) {
            fidelityIssues.push(`遗漏了原剧本中的重要角色: ${missedChars.join('、')}。这些角色在原剧本中有多句台词，必须在某个镜头中出场。`);
          }

          // 检查是否有虚构的角色（不在原剧本中）
          const fabricatedChars = [...scriptChars].filter(c => !originalChars.includes(c) && c !== '旁白' && c !== '群众');
          if (fabricatedChars.length > 0) {
            fidelityIssues.push(`出现了原剧本中不存在的角色: ${fabricatedChars.join('、')}。禁止编造新角色，请使用原剧本中的角色。`);
          }

          // 检查对白是否与原剧本有关联（至少30%的台词应包含原剧本中的关键词）
          const originalDialogues = ctx.parsedScript.scenes.flatMap(s => s.dialogues.map(d => d.line));
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
            ctx.update(AgentRole.WRITER, { currentTask: '检查剧本忠实度，修正偏离原作的内容', progress: 85 });
            ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `剧本忠实度校验发现${fidelityIssues.length}处偏离原作，正在修正...🔍` });

            try {
              const fidelityFixRaw = await ctx.callLLM(
                prompt,
                `你之前的改编存在以下忠实度问题：\n${fidelityIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\n\n原始输出：\n${JSON.stringify(script)}\n\n请严格按照原始剧本修正以上问题，输出完整的修正后JSON。记住：你的任务是忠实转化原剧本，不是创作新故事。`
              );
              const fidelityFixed = robustJsonParse(fidelityFixRaw);
              if (fidelityFixed && typeof fidelityFixed === 'object') {
                script = fidelityFixed as Script;
              }
              console.log('[Writer] 忠实度修正完成');
              ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '忠实度修正完成，现在与原剧本高度一致 ✅' });
            } catch {
              console.warn('[Writer] 忠实度修正失败，使用原始输出');
            }
          } else {
            console.log('[Writer] 剧本忠实度校验通过 ✅');
          }
        }
      } catch {
        console.error('[Writer] JSON parse failed, using fallback');
        script = ctx.fallbackScript(plan);
      }
    } else if (ctx.xverseService) {
      // OpenAI 缺席 → XVerse 兜底
      ctx.emit('agentTalk', { role: AgentRole.WRITER, text: '云端 LLM 未配置，启用开源 XVERSE-Ent...🚀' });
      const xUserContext = ctx.parsedScript
        ? `${getWriterScriptContext(ctx.parsedScript)}\n\n══ 视觉风格参考 ══\n${JSON.stringify({ genre: plan.genre, style: plan.style })}`
        : `导演计划：${JSON.stringify(plan)}`;
      const xRes = await ctx.xverseService.writeScript({
        plan,
        userContext: xUserContext,
        isAdaptation: !!ctx.parsedScript,
        characterNames: plan.characters?.map(c => c.name),
        directorTotalShots: plan.storyStructure?.totalShots || 0,
        sceneCount: ctx.parsedScript?.stats.sceneCount,
        language: ctx.targetLanguage(),   // v12.322
        onHeartbeat: (msg) => ctx.emit('heartbeat', { message: msg }),
      });
      script = (xRes.ok && xRes.script) ? xRes.script : ctx.fallbackScript(plan);
    } else {
      await sleep(2000);
      script = ctx.fallbackScript(plan);
    }

    ctx.update(AgentRole.WRITER, { status: 'completed', progress: 100, output: script });
    ctx.emit('agentTalk', { role: AgentRole.WRITER, text: `「${script.title}」写好了！这次的反转绝对够劲 🔥` });

    // v2.21 P1.1: 节奏 audit — 检查冲突分 + 反转密度 + cliffhanger 收尾.
    // 非阻塞 — 即使全片节奏崩, 也让用户看到分镜画面再决定要不要重生.
    try {
      const { auditScript } = await import('@/lib/pacing-audit');
      const { isDramaContext } = await import('@/lib/drama-tropes');
      const dramaMode = isDramaContext(plan.genre, ctx.originalIdea);
      const report = auditScript(script, { dramaMode });
      // v10.6.2: 钩子审计三指标 — 开场 3 秒 / 集尾悬念立即可算;
      // BGM 卡点对齐率等 Editor 阶段真 BGM 落盘后回填。配 LLM key 时复核前两项。
      try {
        const { auditHooks, assistHookAuditWithLLM } = await import('@/lib/hook-audit');
        report.hooks = await assistHookAuditWithLLM(script, auditHooks(script));
      } catch (e) {
        console.warn('[HookAudit] failed (non-blocking):', e instanceof Error ? e.message : e);
      }
      // 挂到 script 上, 供前端 SSE + 项目页"节奏分析" tab 用
      (script as any).pacingReport = report;
      ctx.emit('pacingAudit', report);
      if (!report.passed && report.warnings.length > 0) {
        // 提示用户但不打断 — 第 1 条 warning 给 Writer 频道, 让对话感更自然
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `📊 节奏 audit: ${report.warnings[0]}${report.warnings.length > 1 ? ` (共 ${report.warnings.length} 条建议, 看项目页节奏分析 tab)` : ''}`,
        });
      } else if (report.passed) {
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `📊 节奏 audit ✅ 通过 (平均冲突分 ${report.averageConflictScore.toFixed(1)}/10, ${report.reversalCount} 次反转)`,
        });
      }
    } catch (e) {
      console.warn('[PacingAudit] failed (non-blocking):', e instanceof Error ? e.message : e);
    }

    // v2.23 P0.4: 对话覆盖度 audit — 多角色对话缺反打/特写的场景标出来.
    // 非阻塞, 给 SSE + Writer 频道.
    try {
      const { auditDialogueCoverage } = await import('@/lib/dialogue-coverage');
      const dialogueReport = auditDialogueCoverage(script);
      (script as any).dialogueCoverageReport = dialogueReport;
      ctx.emit('dialogueCoverage', dialogueReport);
      if (dialogueReport.warnings.length > 0) {
        const first = dialogueReport.warnings[0];
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `${first}${dialogueReport.warnings.length > 1 ? ` (共 ${dialogueReport.warnings.length} 条对话覆盖度建议)` : ''}`,
        });
      } else if (dialogueReport.multiCharSceneCount > 0) {
        ctx.emit('agentTalk', {
          role: AgentRole.WRITER,
          text: `🎬 对话覆盖度 ✅ ${dialogueReport.multiCharSceneCount} 个多角色对话场景全部满足正反打 (${dialogueReport.coverageScore}/100)`,
        });
      }
    } catch (e) {
      console.warn('[DialogueCoverage] failed (non-blocking):', e instanceof Error ? e.message : e);
    }

    return script;
  }

