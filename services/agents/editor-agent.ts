import OpenAI from 'openai';
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

/** 抽出时 orchestrator 的模块级 sleep 未导出,这里本地补一个等价实现。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** orchestrator 的模块级 isValidVideoUrl 未导出,本地补(逐字节等价)。 */
function isValidVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.startsWith('http')) return true;
  if (url.startsWith('/api/serve-file')) return true;
  return false;
}

/**
 * v12.262:runEditor 从 hybrid-orchestrator 抽出的独立模块(神类瘦身下半)。
 * 行为逐字节保持 —— orchestrator 以 `this as unknown as EditorAgentCtx` 传入,读写仍落在同一实例上。
 */
export interface EditorAgentCtx {
  aspect: string;
  genre: string;
  styleKeywords: string;
  editStyleInstruction: string;
  originalIdea: string;
  lockedCharacters: import('@/lib/consistency-policy').LockedCharacter[];
  minimaxService: MinimaxService | null;
  shotImageMap: Map<number, string>;
  qualityLedger: Array<{ shot: number; kind: string; detail: string }>;
  emit(type: string, data: any): void;
  update(role: AgentRole, u: Partial<Agent>): void;
  callLLM(systemPrompt: string, userMessage: string, json?: boolean, useCreativeModel?: boolean, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
  targetLanguage(): TargetLanguage;
  regenerateShot(shotNumber: number, storyboard: Storyboard, options?: { duration?: number; videoProvider?: string; tailFrameUrl?: string }): Promise<VideoClip>;
}
export async function runEditor(ctx: EditorAgentCtx, videos: VideoClip[], script: Script): Promise<EditResult> {
    ctx.update(AgentRole.EDITOR, { status: 'working', currentTask: '分析镜头节奏，构建剪辑时间线', progress: 5 });
    ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '开始剪辑！先分析高光时刻，再智能编排节奏 ✂️🔥' });

    await sleep(500);
    const totalShots = videos.length;

    // v12.13.0(打斗劲爆度):动作模式判定 —— 动作/打斗片要「快切、硬切、不整段慢放」。
    // 由题材 + 一句指令 + 全镜情绪关键词综合判定;命中则剪辑层切快节奏策略。
    const actionMode = /动作|打斗|格斗|武侠|战斗|追逐|枪战|对决|厮杀|action|fight|combat|battle/i.test(
      `${ctx.genre} ${ctx.editStyleInstruction} ${(script?.shots || []).map((s: any) => `${s.emotion || ''} ${s.sceneDescription || ''}`).join(' ')}`
    );
    if (actionMode) console.log('[Editor] v12.13.0 动作模式:快切+硬切+不整段慢放');

    // ═══ 第1步：构建时间线 + 高光元数据 ═══
    ctx.update(AgentRole.EDITOR, { progress: 10, currentTask: '构建高光分析时间线...' });
    const timeline = videos.map((v, i) => {
      // 通过 shotNumber 精确匹配脚本镜头（而非数组下标，避免镜头错位）
      const shot = script.shots?.find(s => s.shotNumber === v.shotNumber) || script.shots?.[i];
      const act = (shot as any)?.act || (i < totalShots * 0.25 ? 1 : i < totalShots * 0.75 ? 2 : 3);
      const emotion = shot?.emotion || '';
      // v12.13.0:设计时长优先(让现有项目「重新成片」也按 shot.duration 裁切,不必整片重生);
      // 旧片段存的 v.duration=8 不再压过设计的 3-5s。
      const baseDuration = (shot as any)?.duration || v.duration || 8;
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

      // v12.13.0:动作片中段一律硬切(淡入/淡黑软化冲击),保留首尾 fade 与高潮 flash-cut
      if (actionMode && i !== 0 && i !== totalShots - 1 && (transition === 'cross-dissolve' || transition === 'dip-to-black')) {
        transition = 'cut';
        if (effect === 'soft-focus' || effect === 'vignette') effect = 'shake';
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
        // v12.203:说话角色名(出场角色首个)→ TTS prosody 性别/年龄纠偏
        speaker: (shot as any)?.characters?.[0] || '',
        // 高光检测元数据
        emotionTemperature,
        tensionLevel,
      };
    });

    // v12.16.0(Phase 3):CONTINUITY 主表 —— 出片前校验跨镜一致性(同场景光照漂移/画幅帧率不统一/风格包缺失)。
    const { buildContinuitySheet, validateContinuity } = await import('@/lib/continuity-sheet');
    const continuitySheet = buildContinuitySheet({
      shots: (script?.shots || []) as any,
      stylePack: ctx.styleKeywords,
      aspectRatio: ctx.aspect,
      fps: 24,
    });
    const continuityCheck = validateContinuity(continuitySheet);
    if (!continuityCheck.passed) {
      console.warn('[Continuity] 主表校验隐患:', continuityCheck.issues.join(' | '));
      ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 连续性主表发现 ${continuityCheck.issues.length} 处隐患:${continuityCheck.issues.slice(0, 2).join(';')}` });
    }
    ctx.emit('continuitySheet', { rows: continuitySheet, check: continuityCheck });

    // ═══ 第2步：高光时刻检测 ═══
    ctx.update(AgentRole.EDITOR, { progress: 20, currentTask: '智能检测高光时刻...' });
    // v12.13.1(打斗劲爆度第二波):动作片找「冲击点」(beat 标 speedRamp 或含冲击动词)→
    // 打击音效 + 选择性 impact 慢镜。非动作片为空,完全不影响。
    const { findImpactCues, impactShotSet } = await import('@/lib/impact-sfx');
    const impactCues = actionMode ? findImpactCues((script?.shots || []) as any) : [];
    const impactShotsArr = [...impactShotSet(impactCues)];
    if (impactCues.length) console.log(`[Editor] v12.13.1 冲击点 ${impactCues.length} 记(镜 ${impactShotsArr.join(',')})`);
    const { detectHighlights } = await import('@/services/video-composer');
    const highlightAnalysis = detectHighlights(timeline.map(t => ({
      shotNumber: t.shotNumber || 0,
      videoUrl: t.videoUrl,
      duration: t.duration,
      transition: t.transition,
      emotionTemperature: t.emotionTemperature,
      tensionLevel: t.tensionLevel,
    })), { actionMode, impactShots: impactShotsArr });

    const highlightShots = highlightAnalysis.filter(h => h.isHighlight);
    if (highlightShots.length > 0) {
      const highlightInfo = highlightShots.map(h => `镜头${h.shotNumber}(${h.reason}, 评分${h.score})`).join('、');
      console.log(`[Editor] Highlights: ${highlightInfo}`);
      ctx.emit('agentTalk', {
        role: AgentRole.EDITOR,
        text: `🔥 高光时刻检测完成！发现 ${highlightShots.length} 个高光镜头：${highlightInfo}\n高光镜头将使用慢动作强调 + 最佳转场`
      });
    } else {
      ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '高光分析完成，叙事节奏均匀，将优化整体流畅度 📊' });
    }

    // ═══ 第2.5步：LLM 生成专业剪辑方案 ═══
    if (API_CONFIG.openai.apiKey) {
      ctx.update(AgentRole.EDITOR, { progress: 25, currentTask: 'AI 分析最佳剪辑策略...' });
      ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '用 AI 分析最佳剪辑策略：节奏、变速、转场...🎬' });

      try {
        const editContext = timeline.map((t, i) => {
          const ha = highlightAnalysis.find(h => h.shotNumber === t.shotNumber);
          return `#${t.shotNumber}: ${t.emotion || '平静'}, act${t.act}, tension=${t.tensionLevel}, highlight=${ha?.isHighlight || false}, 台词="${(t.dialogue || '').slice(0, 20)}"`;
        }).join('\n');

        const editPlanRaw = await ctx.callLLM(
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
          // v2.18.1: edit plan 也可能是顶层数组, 兼容两种形态
          let editPlan: any = robustJsonParse(editPlanRaw);
          if (!editPlan) {
            try {
              const m = editPlanRaw.match(/\[[\s\S]*\]/);
              if (m) editPlan = JSON.parse(m[0]);
            } catch { /* swallow */ }
          }
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
            ctx.emit('agentTalk', {
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
    // v12.29.0(P1):runEditor 级别算「原生音频镜」集合,供 TTS 跳过 + composer 取真音轨共用。
    const nativeShotsSet = new Set(nativeAudioShotNumbers(videos));
    const voiceoverClips: Array<{ shotNumber: number; audioUrl: string }> = [];
    const voiceoverDurations: Record<number, number> = {}; // v12.68 镜号→TTS 真实时长(karaoke 对齐)
    // v2.11 #B1: 收集音频相关的降级信号, 最后带入 final payload 让前端明示"哪些镜头降级了"
    const audioWarnings: string[] = [];
    // v12.7.0: 配音走 TTS 注册表 —— 不再只认 minimax;任一 TTS provider 可用即跑(vectorengine-tts 等也能出声)。
    if (ctx.minimaxService || ttsEngineConfigured()) {
      // v12.29.0(P1):原生音频镜跳 TTS(成片自带音轨,composer 取真音轨);其余仍走 TTS(零回归)。
      const allDialogueShots = timeline.filter(t => t.dialogue && t.dialogue.trim().length > 0);
      // v12.296:**整组一次性定音色**,而不是逐句现挑。
      // 逐句挑(v12.288 的做法)看不到全片阵容,于是与「重配单镜」那条路径(按整组去重挑)
      // 天生对不齐 —— 实测 8/8 角色重配后换嗓、性别都反了。两边现在跑同一个 resolveCastVoices。
      const _voiceCast: Map<string, string> = await (async () => {
        try {
          const { resolveCastVoices } = await import('@/lib/character-studio');
          return resolveCastVoices(allDialogueShots.map((t: any) => String(t?.speaker || '').trim()));
        } catch { return new Map<string, string>(); }
      })();
      if (_voiceCast.size > 0) {
        console.log(`[Editor] 角色音色(整组定,${_voiceCast.size} 人): ${[...(_voiceCast as any)].map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
      const { tts: dialogueShots, native: nativeDialogueShots } = partitionDialogueShots(allDialogueShots, nativeShotsSet);
      if (nativeDialogueShots.length > 0) {
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🎧 ${nativeDialogueShots.length} 个镜头用引擎原生音频(跳过 TTS,音画一体)` });
      }
      if (dialogueShots.length > 0) {
        ctx.update(AgentRole.EDITOR, { progress: 30, currentTask: `生成 ${dialogueShots.length} 段 AI 配音...` });
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `正在为 ${dialogueShots.length} 个有台词的镜头生成 AI 配音 🎙️` });

        for (let i = 0; i < dialogueShots.length; i++) {
          const t = dialogueShots[i];
          try {
            // ── 语言统一：过滤纯英文对白 → 仅为中文/含中文对白生成配音 ──
            // v12.41:\u5148\u5254\u9664\u97f3\u6548/\u914d\u4e50/\u52a8\u4f5c\u62ec\u53f7\u63d0\u793a(\u4e0e\u5b57\u5e55\u540c\u6e90),\u907f\u514d TTS \u5ff5\u51fa\u300c\u91d1\u5c5e\u8f70\u54cd\u300d\u8fd9\u7c7b\u63d0\u793a
            const { stripNonDialogueBrackets } = await import('@/lib/text-control');
            const spokenDialogue = stripNonDialogueBrackets(t.dialogue);
            if (!spokenDialogue) { console.log(`[Editor] TTS skip (\u4ec5\u97f3\u6548/\u821e\u53f0\u63d0\u793a): "${t.dialogue.slice(0, 30)}"`); continue; }
            const hasChinese = /[\u4e00-\u9fa5]/.test(spokenDialogue);
            if (!hasChinese) {
              console.log(`[Editor] TTS skip (non-Chinese): "${t.dialogue.slice(0, 30)}"`);
              continue;
            }
            // 替换对白中的英文片段为中文发音提示（避免 TTS 中英文混杂）
            const cleanedDialogue = spokenDialogue
              .replace(/[a-zA-Z]+/g, (match: string) => match.length <= 3 ? match : '')  // 保留短缩写如 AI、OK
              .replace(/\s{2,}/g, ' ')
              .trim();
            if (!cleanedDialogue) continue;

            // v2.9 Bug 3: 从 emotion + emotionTemperature 推导 speed/pitch/vol
            // 之前所有配音都是 1.0/0/0.85 的死板默认,声画脱节;现在画面走情绪,配音也跟着走
            const prosody = deriveProsody({
              emotion: t.emotion,
              emotionTemperature: t.emotionTemperature,
              character: (t as any).speaker, // v12.203:角色名性别/年龄纠偏(legacy #5 落地)
            });
            // v12.87.0 台词-镜长适配:说不完就在合法区间提速(≤1.3),仍溢出记账告警(不擅自删词)
            {
              const { fitSpeechToShot } = await import('@/lib/tts-prosody');
              const fit = fitSpeechToShot(cleanedDialogue, t.duration || 4, prosody.speed);
              if (fit.speed > prosody.speed) {
                console.log(`[Editor] v12.87 台词适配 shot ${t.shotNumber}: speed ${prosody.speed}→${fit.speed}(估 ${fit.estimatedSec.toFixed(1)}s / 镜 ${t.duration || 4}s)`);
                prosody.speed = fit.speed;
              }
              if (fit.overflow) {
                ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'dialogue-overflow', detail: `${fit.estimatedSec.toFixed(1)}s>${t.duration || 4}s` });
                ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 第 ${t.shotNumber} 镜台词偏长(约 ${fit.estimatedSec.toFixed(1)}s > 镜 ${t.duration || 4}s),已提速仍可能溢出` });
              }
            }
            console.log(`[Editor] TTS prosody shot ${t.shotNumber}: emotion="${t.emotion}" temp=${t.emotionTemperature ?? 0} → speed=${prosody.speed} pitch=${prosody.pitch} vol=${prosody.vol}`);
            // ── v12.288:角色音色按**角色**定,不再按**台词情绪**猜 ────────────────────
            // 病根(本版最要命的一条):原来是 `t.emotion.match(/温柔|哭|委屈|姐|妹|母/) ? 'female' : 'male'`
            //   ① 性别从**这句台词的情绪**推断 —— 于是**同一个角色会在镜与镜之间换嗓**:
            //      这句「温柔」用女声、下句「愤怒」变男声;男主哭一场就变成女声。
            //   ② 全片只有 `female-zh` / `male-zh` **两个写死 id**,且**不在 VOICE_CATALOG 内**;
            //      v12.229 扩到 22 档、v12.274 逐档配韵律、v12.287 打开选路 —— 主出片链路一个都没用上。
            //   ③ `t.speaker`(角色名)其实**就在手边**:上面第 383 行的 prosody 纠偏已经在用它了。
            // 现在:按角色名走 `assignVoiceToCharacter`(v12.287 已让它认性别年龄并散开到全目录),
            // 同一角色全片恒定同音色;无角色名(旁白等)才退回情绪猜测的旧行为。
            const _speaker = String((t as any).speaker || '').trim();
            const _gender = t.emotion.match(/温柔|哭|委屈|姐|妹|母/) ? 'female' : 'male';
            let _voiceId = _gender === 'female' ? 'female-zh' : 'male-zh';
            if (_speaker) {
              // v12.296:直接取上面**整组一次性定好**的音色表。
              // 逐句现挑会看不到全片阵容,与「重配单镜」那条路径对不齐(详见 _voiceCast 处的说明)。
              const _fromCast = _voiceCast.get(_speaker);
              if (_fromCast) _voiceId = _fromCast;
              else {
                try {
                  // 阵容表里没有(理论上不该发生)→ 退回单角色入口,仍走同一套选路
                  const { resolveCharacterVoice } = await import('@/lib/character-studio');
                  const _picked = resolveCharacterVoice(_speaker);
                  if (_picked) _voiceId = _picked;
                } catch { /* 取不到就沿用旧的性别兜底,不阻塞配音 */ }
              }
            }
            // v3.2 P4.3: TTS 走 withTTSPlugin. off → 直接 generateSpeech (行为不变),
            // primary → 先 plugin chain 失败落老 generateSpeech, shadow → 老逻辑出结果 + plugin 采样比对.
            const { withTTSPlugin } = await import('@/lib/plugin-chain-router');
            const _ttsResult = await withTTSPlugin(
              {
                text: cleanedDialogue,
                voiceId: _voiceId, // v12.288:按角色恒定,不再逐句按情绪猜
                emotion: t.emotion,
                speed: prosody.speed,
                pitch: prosody.pitch,
                volume: prosody.vol,
                language: ttsLangCode(ctx.targetLanguage()), // v12.6.1: 按目标语种(zh-CN/en-US)
                label: `shot-${t.shotNumber}`,
              },
              async () => {
                // v12.7.0: 先走注册表(vectorengine-tts 50 → minimax-tts 100,按 priority);
                // 注册表全失败再退回直连 minimax(保旧行为为最后兜底);都没有 → 抛错走静音兜底。
                const d = await dispatchTTSGenerate({
                  text: cleanedDialogue,
                  voiceId: _voiceId, // v12.288:同上,注册表通道也用同一把嗓
                  emotion: t.emotion,
                  speed: prosody.speed,
                  pitch: prosody.pitch,
                  volume: prosody.vol,
                  language: ttsLangCode(ctx.targetLanguage()),
                });
                if (d.result?.audioUrl) {
                  return { audioUrl: d.result.audioUrl, duration: d.result.duration ?? 0, subtitle: d.result.subtitle ?? [], provider: d.result.provider ?? 'registry' };
                }
                if (ctx.minimaxService) {
                  const audioUrl = await ctx.minimaxService.generateSpeech(cleanedDialogue, {
                    emotion: t.emotion, gender: _gender, speed: prosody.speed, pitch: prosody.pitch, vol: prosody.vol,
                  });
                  return { audioUrl, duration: 0, subtitle: [], provider: 'minimax-legacy' };
                }
                throw new Error('TTS 全 provider 失败: ' + d.tried.map((x) => x.error).join(' | ').slice(0, 80));
              },
            );
            const audioUrl = _ttsResult.audioUrl;
            voiceoverClips.push({ shotNumber: t.shotNumber || 0, audioUrl });
            if (_ttsResult.duration && _ttsResult.duration > 0) voiceoverDurations[t.shotNumber || 0] = _ttsResult.duration; // v12.68
            ctx.emit('agentTalk', {
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
              const silenceUrl = `${serveFilePathUrl(silenceFile)}`;
              voiceoverClips.push({ shotNumber: t.shotNumber || 0, audioUrl: silenceUrl });
              const warn = `🔇 第 ${t.shotNumber} 镜 TTS 失败, 用 ${dur.toFixed(1)}s 静音兜底 (原因: ${errMsg.slice(0, 60)})`;
              audioWarnings.push(warn);
              ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
            } catch (se) {
              const warn = `⚠️ 第 ${t.shotNumber} 镜 TTS 和静音兜底都失败, 成片会少一段配音`;
              audioWarnings.push(warn);
              console.error('[Editor] silence fallback also failed:', se);
              ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
            }
          }
          ctx.update(AgentRole.EDITOR, { progress: 30 + Math.round((i / dialogueShots.length) * 15) });
        }

        if (voiceoverClips.length > 0) {
          const successfulTts = voiceoverClips.length - audioWarnings.filter(w => w.startsWith('🔇') || w.startsWith('⚠️')).length;
          ctx.emit('agentTalk', {
            role: AgentRole.EDITOR,
            text: audioWarnings.length > 0
              ? `🎙️ AI 配音部分完成: ${successfulTts}/${voiceoverClips.length} 真实音, ${audioWarnings.length} 降级`
              : `🎙️ AI 配音完成！${voiceoverClips.length} 段语音已就绪`,
          });
        }

        // ═══ v2.21 P1.3: Lip-sync — 把视频里的嘴型对齐到 TTS 配音 ═══
        // 仅对真实 http 视频 + 真实 http 音频 + Kling key 配置时跑.
        // 失败 / 没 key → 保留原视频, 仅 warning. 不阻塞 final cut.
        try {
          const { getLipSyncService } = await import('@/services/lipsync.service');
          const lipsync = getLipSyncService();
          if (lipsync.isAvailable() && voiceoverClips.length > 0) {
            ctx.update(AgentRole.EDITOR, { currentTask: '嘴型对齐 (lip-sync)...', progress: 45 });
            ctx.emit('agentTalk', {
              role: AgentRole.EDITOR,
              text: `👄 Lip-sync 启动: 把 ${voiceoverClips.length} 段配音对齐到视频嘴型 (Kling)...`,
            });
            let appliedCount = 0;
            for (const v of voiceoverClips) {
              const videoEntry = videos.find((x) => (x?.shotNumber ?? -1) === v.shotNumber);
              const videoUrl = videoEntry?.videoUrl || (videoEntry as any)?.mediaUrls?.[0];
              if (!videoEntry || !videoUrl || !videoUrl.startsWith('http')) continue;
              // audioUrl 可能是 /api/serve-file 形式 (本地 TTS 文件) — lip-sync 需要 http URL,
              // 不是 http 就 skip (Kling 抓不到 localhost)
              if (!v.audioUrl || !v.audioUrl.startsWith('http')) {
                console.log(`[LipSync] shot ${v.shotNumber} skipped — audio is non-http (likely local TTS)`);
                continue;
              }
              // v12.179:ko/ru 等音素差异过大的语种标 none —— 用 en viseme 驱动会口型-发音严重错位,
              // 错口型比无口型更伤观感;跳过口型保留原视频(字幕/配音不受影响)。
              const lsLang = lipsyncLangCode(ctx.targetLanguage());
              if (lsLang === 'none') {
                console.log(`[Lipsync] 语种 ${ctx.targetLanguage()} 无适配音素表,跳过口型(诚实降级)`);
                continue;
              }
              const r = await lipsync.syncMouthToAudio(videoUrl, v.audioUrl, { language: lsLang });
              if (r.applied && r.videoUrl && r.videoUrl.startsWith('http')) {
                videoEntry.videoUrl = r.videoUrl;
                appliedCount++;
              } else if (r.warning) {
                audioWarnings.push(`👄 shot ${v.shotNumber} lip-sync 跳过: ${r.warning.slice(0, 60)}`);
              }
            }
            ctx.emit('agentTalk', {
              role: AgentRole.EDITOR,
              text: appliedCount > 0
                ? `👄 Lip-sync 完成: ${appliedCount}/${voiceoverClips.length} 段视频嘴型已对齐 ✓`
                : `👄 Lip-sync: 没有可对齐的镜头 (TTS 是本地文件或 Kling 配额耗尽)`,
            });
          }
        } catch (e) {
          // 完全不阻塞主流程
          console.warn('[LipSync] block failed (non-blocking):', e instanceof Error ? e.message : e);
        }
      }
    }

    // ═══ 第4步：配乐生成（Minimax音乐API）═══
    let musicUrl = '';
    if (ctx.minimaxService) {
      try {
        ctx.update(AgentRole.EDITOR, { progress: 50, currentTask: '生成背景配乐...' });
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '正在生成背景配乐，为画面注入灵魂 🎵' });

        // 根据高光分析和剧情情绪生成配乐
        const emotions = script.shots?.map(s => s.emotion).filter(Boolean) || [];
        const dominantEmotion = emotions[0] || '平静';
        const genre = ctx.genre || '现代剧情';
        const highlightNote = highlightShots.length > 0
          ? `，在第${highlightShots.map(h => h.shotNumber).join('、')}镜头处需要情感高潮`
          : '';
        let musicPrompt = `${genre}风格配乐，情绪基调：${dominantEmotion}${highlightNote}，时长约${totalDuration}秒，适合短片叙事`;
        // v12.13.1(打斗劲爆度第二波):动作片要高能驱动配乐 —— 强劲鼓点/打击乐撑节奏,而非柔和氛围。
        if (actionMode) {
          musicPrompt += `. 高能动作配乐:强劲快节奏打击乐(太鼓/战鼓/工业鼓点)、紧张弦乐 staccato、强动态对比、BPM 140-160,突出冲击与肾上腺素;driving percussion, hard-hitting, aggressive, no soft ambient pads`;
        }

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

        // v2.16 P1.1: 长视频 (>30s 且 shots 标了 act 字段) 改成按幕切分 — Act 1 平静 / Act 2 紧张 / Act 3 释放。
        // 解决 v2.14 P1.2 修复后还存在的"全程一段 BGM 循环听腻"问题, 同时给观众 act-transition 的声音线索。
        // 短视频 (<30s) 或 shots 没标 act → 走原 single-segment 路径。
        const { computeActDurations, moodPromptForAct, concatActBgms } =
          await import('@/lib/bgm-multi-act');
        const actDurations = computeActDurations(
          (timeline as any[]).map((t) => ({ duration: t.duration, act: t.act ?? null })),
        );
        const useMultiAct = actDurations.canSplit && totalDuration >= 30;

        if (useMultiAct) {
          ctx.emit('agentTalk', {
            role: AgentRole.EDITOR,
            text: `三幕结构: 分别生成 Act 1 (${actDurations.act1}s) / Act 2 (${actDurations.act2}s) / Act 3 (${actDurations.act3}s) 配乐 🎵×3`,
          });
          try {
            const [a1, a2, a3] = await Promise.all([
              ctx.minimaxService.generateMusic(
                moodPromptForAct(1, dominantEmotion, genre),
                { duration: Math.min(actDurations.act1, 120), style: genre },
              ),
              ctx.minimaxService.generateMusic(
                moodPromptForAct(2, dominantEmotion, genre),
                { duration: Math.min(actDurations.act2, 120), style: genre },
              ),
              ctx.minimaxService.generateMusic(
                moodPromptForAct(3, dominantEmotion, genre),
                { duration: Math.min(actDurations.act3, 120), style: genre },
              ),
            ]);
            const concatPath = await concatActBgms([
              { url: a1, durationSec: actDurations.act1, act: 1 },
              { url: a2, durationSec: actDurations.act2, act: 2 },
              { url: a3, durationSec: actDurations.act3, act: 3 },
            ]);
            // composer 接受任何 http URL 或者 fs path; 用 file:// 形式包装一下
            // 实际 composer 的 downloadFile 会判断 https? 协议, 非 http 走 fs.copyFileSync
            // 这里直接 serve-file 形式让 composer 走文件路径
            musicUrl = `${serveFilePathUrl(concatPath)}`;
            console.log(`[Editor] Multi-act BGM done: ${concatPath}`);
            ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '🎵 三幕配乐拼接完成!' });
          } catch (e) {
            // 三幕生成或拼接失败 → 退回 single-segment 路径
            console.warn('[Editor] Multi-act BGM failed, fallback to single segment:', e instanceof Error ? e.message : e);
            ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 三幕配乐失败, 退回单段 BGM` });
            musicUrl = await ctx.minimaxService.generateMusic(musicPrompt, {
              duration: Math.min(totalDuration, 120),
              style: genre,
            });
          }
        } else {
          // 短视频或 act 未标 → 单段 BGM (v2.14 P1.2 路径)
          musicUrl = await ctx.minimaxService.generateMusic(musicPrompt, {
            duration: Math.min(totalDuration, 120),
            style: genre,
          });
        }

        console.log(`[Editor] Music generated: ${musicUrl.slice(0, 80)}...`);
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: '🎵 配乐生成完成！' });

        // v10.6.2: BGM 卡点对齐率 — 真 BGM 落盘后 ffmpeg 析拍,回填钩子审计并重推 SSE。
        // 仅本地文件可析(serve-file 路径);远端 URL / 析不出拍 → 保持「不可测」诚实呈现。
        try {
          // v12.241:走验签+白名单(BGM 是本管线自己生成并签发的)
          const bgmLocalPath = musicUrl.startsWith('/api/serve-file')
            ? (resolveVerifiedServeFilePath(musicUrl) || '')
            : '';
          let pacingReport = (script as any).pacingReport;
          if (!pacingReport?.hooks) {
            // 续跑路径:checkpoint 里的 script 不含审计 → 现算补挂(确定性可重算),
            // 同时让 finalize 落库的 script_data 重新带上节奏报告
            const { auditScript } = await import('@/lib/pacing-audit');
            const { auditHooks } = await import('@/lib/hook-audit');
            const { isDramaContext } = await import('@/lib/drama-tropes');
            pacingReport = pacingReport
              ?? auditScript(script as any, { dramaMode: isDramaContext(ctx.genre || '', ctx.originalIdea) });
            pacingReport.hooks = pacingReport.hooks ?? auditHooks(script as any);
            (script as any).pacingReport = pacingReport;
          }
          if (bgmLocalPath && pacingReport?.hooks) {
            const { detectBeats } = await import('@/lib/beat-detect');
            const { beatAlignmentRate } = await import('@/lib/hook-audit');
            const beats = await detectBeats(bgmLocalPath);
            if (beats.length > 0) {
              const durations = (timeline as any[]).map((t) => (Number(t.duration) > 0 ? Number(t.duration) : 5));
              pacingReport.hooks.bgmSync = beatAlignmentRate(durations, beats);
              ctx.emit('pacingAudit', pacingReport);
              const pct = Math.round((pacingReport.hooks.bgmSync.rate ?? 0) * 100);
              ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🥁 BGM 卡点对齐率 ${pct}%(${pacingReport.hooks.bgmSync.alignedCuts}/${pacingReport.hooks.bgmSync.totalCuts} 个切点踩拍)` });
            }
          }
        } catch (e) {
          console.warn('[Editor] BGM beat alignment failed (non-blocking):', e instanceof Error ? e.message : e);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error('[Editor] Music generation failed:', errMsg);
        const warn = `🎵 BGM 生成失败, 成片为无配乐版本 (原因: ${errMsg.slice(0, 80)})`;
        audioWarnings.push(warn);
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: warn });
      }
    }

    // ═══ v12.106.0 AI 视频镜烤字抽查 ═══
    // gate 只查分镜图,AI 视频生成阶段仍可能把字烤进画面(实测疑云)。对 AI CDN 片源抽帧 VLM 查:
    // 默认只记账告警(qualityLedger 'video-baked-text');VIDEO_BAKED_DROP=1 时清掉该镜 videoUrl
    // → 下方双层兜底自动以干净素材顶上。VIDEO_TEXT_SCREEN_DISABLE=1 关。商业题材 only(省 VLM)。
    try {
      const { isCommercialIdea } = await import('@/lib/end-card');
      if (process.env.VIDEO_TEXT_SCREEN_DISABLE !== '1' && isCommercialIdea(ctx.originalIdea || '')) {
        const { classifyClipSource, screenVideoForBakedText, buildNoTextPrompt } = await import('@/lib/broll');
        for (const t of timeline) {
          if (classifyClipSource(t.videoUrl) !== 'ai') continue;
          const verdict = await screenVideoForBakedText(t.videoUrl);
          if (verdict === 'baked-text') {
            // v12.126:先自愈一次 —— 用分镜图 I2V 重生(prompt 追加去字指令)+ 重新抽查;仍烤字才记账/剔除。
            // VIDEO_BAKED_REGEN=0 关闭重生(退回旧行为)。重生走 minimax(veo 网关 503)。
            let healed = false;
            const frame = ctx.shotImageMap.get(t.shotNumber as number);
            if (process.env.VIDEO_BAKED_REGEN !== '0' && frame) {
              try {
                const shot = script?.shots?.find((s: any) => s.shotNumber === t.shotNumber);
                const clip = await ctx.regenerateShot(
                  t.shotNumber as number,
                  { shotNumber: t.shotNumber as number, imageUrl: frame, prompt: buildNoTextPrompt((shot as any)?.visualPrompt || '') } as any,
                  { duration: t.duration || 5, videoProvider: 'minimax' },
                );
                // regenerateShot 全引擎失败会退回 imageUrl(静图)—— 用 !==frame 排除,只认真视频
                if (clip?.videoUrl && !clip.videoUrl.startsWith('data:') && clip.videoUrl !== frame) {
                  const reVerdict = await screenVideoForBakedText(clip.videoUrl);
                  if (reVerdict !== 'baked-text') {
                    t.videoUrl = clip.videoUrl;
                    healed = true;
                    ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'video-baked-regen', detail: '烤字重生一次已清除' });
                    ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `✅ 第 ${t.shotNumber} 镜烤字已通过重生消除` });
                  }
                }
              } catch (e) { console.warn('[Editor] v12.126 烤字重生失败(退回记账):', e instanceof Error ? e.message : e); }
            }
            if (!healed) {
              ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'video-baked-text', detail: 'AI 镜画面含烤字' });
              ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 第 ${t.shotNumber} 镜 AI 视频画面检出烤字${process.env.VIDEO_BAKED_DROP === '1' ? ',已剔除交兜底重配' : '(重生未消除或已关,仅记录;VIDEO_BAKED_DROP=1 可自动剔除)'}` });
              if (process.env.VIDEO_BAKED_DROP === '1') t.videoUrl = '';
            }
          }
        }
      }
    } catch (e) { console.warn('[Editor] v12.106 烤字抽查失败(非阻塞):', e instanceof Error ? e.message : e); }

    // ═══ v12.62.0→v12.95.0 失败镜双层兜底(成片时长保障)═══
    // 供给侧翻车(引擎偶发/余额尽/分镜占位)时:先搜 Pexels 免版权实拍 B-roll(v12.95,
    // 比静图动画生动,商用安全;PEXELS_API_KEY 未配自动跳过),再 Ken Burns 静图动画(需分镜真图)。
    // 逐镜 try/catch,单镜失败不连累。
    {
      const missing = timeline.filter(t => !isValidVideoUrl(t.videoUrl) && typeof t.shotNumber === 'number');
      if (missing.length > 0) {
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🎞️ ${missing.length} 个镜头视频缺失,启动双层兜底(实拍素材 → 静图动画)` });
        const { stillFrameToVideo } = await import('@/services/video-composer');
        const { dimsForAspect } = await import('@/lib/video-reframe');
        const { buildBrollQuery, searchPexelsBroll, derivePersonaHint } = await import('@/lib/broll');
        // v12.107:主角性别注入查询(锁定角色 traits 优先,否则 brief 正则)—— 修 B-roll 男女混用
        const personaHint = derivePersonaHint(ctx.originalIdea || '', (ctx.lockedCharacters?.[0] as any)?.traits?.gender);
        const dims = dimsForAspect(ctx.aspect);
        const vertical = dims.h > dims.w;
        const dirs: Array<'in' | 'out' | 'pan'> = ['in', 'out', 'pan'];
        for (let k = 0; k < missing.length; k++) {
          const t = missing[k];
          // 第 1 层:Pexels B-roll(用该镜英文 visualPrompt 构造查询)
          try {
            const shot = script?.shots?.find((s: any) => s.shotNumber === t.shotNumber);
            const baseQuery = buildBrollQuery((shot as any)?.visualPrompt || (shot as any)?.sceneDescription || '');
            // 人物镜(prompt 含 man/woman/person 或该镜有角色)才注入人设词,产品特写镜不注入
            const isPeopleShot = /man|woman|person|people|face|portrait/i.test(baseQuery) || ((shot as any)?.characters || []).length > 0;
            const query = isPeopleShot && personaHint && !baseQuery.includes(personaHint) ? `${personaHint} ${baseQuery}`.slice(0, 100) : baseQuery;
            const link = await searchPexelsBroll(query, { vertical, minSec: t.duration || 4 });
            if (link) {
              t.videoUrl = link;
              ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'broll-fallback', detail: query.slice(0, 40) });
              console.log(`[Editor] v12.95 B-roll 兜底: 镜 ${t.shotNumber} ← "${query.slice(0, 50)}"`);
              continue;
            }
          } catch (e) {
            console.warn(`[Editor] B-roll 兜底失败 镜 ${t.shotNumber}(转 Ken Burns):`, e instanceof Error ? e.message : e);
          }
          // 第 2 层:Ken Burns(需分镜真图)
          const img = ctx.shotImageMap.get(t.shotNumber as number);
          if (!img) continue; // 无图无素材 → 交给 missing-video 记账
          try {
            const p = await stillFrameToVideo(img, t.duration || 4, undefined, dirs[k % 3], dims);
            t.videoUrl = `${serveFilePathUrl(p)}`;
            ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'kenburns-fallback', detail: dirs[k % 3] }); // v12.66
            console.log(`[Editor] v12.62 Ken Burns 兜底: 镜 ${t.shotNumber} (${dirs[k % 3]}, ${dims.w}x${dims.h})`);
          } catch (e) {
            console.warn(`[Editor] Ken Burns 兜底失败 镜 ${t.shotNumber}(跳过):`, e instanceof Error ? e.message : e);
          }
        }
      }
    }

    // v12.91.0 缺镜如实记账:KenBurns 兜底后仍无视频的镜(常见于分镜图是占位、无米下锅)
    // → qualityLedger 'missing-video'(重扣健康分),质检报告不再对残片报「一次成型」。
    for (const t of timeline) {
      if (!isValidVideoUrl(t.videoUrl)) {
        ctx.qualityLedger.push({ shot: t.shotNumber ?? 0, kind: 'missing-video', detail: ctx.shotImageMap.get(t.shotNumber as number) ? 'fallback-failed' : 'no-image-for-fallback' });
      }
    }

    // ═══ 第5步：FFmpeg 智能合成（高光变速 + 转场 + 配乐 + 配音）═══
    let finalVideoUrl = '';
    const validVideoClips = timeline.filter(t => isValidVideoUrl(t.videoUrl));

    if (validVideoClips.length >= 1) {
      try {
        ctx.update(AgentRole.EDITOR, { progress: 65, currentTask: 'FFmpeg 智能合成（高光变速 + 转场 + 配乐 + 配音）...' });
        ctx.emit('agentTalk', {
          role: AgentRole.EDITOR,
          text: `正在用 FFmpeg 合成最终成片 🎞️\n` +
            `• 高光镜头慢动作强调\n` +
            `• 智能转场匹配\n` +
            `${musicUrl ? '• 背景配乐叠加\n' : ''}` +
            `${voiceoverClips.length > 0 ? `• ${voiceoverClips.length} 段 AI 配音混入\n` : ''}`
        });

        const { composeVideo } = await import('@/services/video-composer');
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

        const { isCommercialIdea: _isCommercial } = await import('@/lib/end-card');
        const { pickCaptionPreset } = await import('@/lib/caption-style');
        const result = await composeVideo({
          clips: composerClips,
          aspect: ctx.aspect, // v12.49.0 成片画布跟项目画幅(修竖屏 9:16 成片仍出 16:9 的 bug)
          captionStyle: pickCaptionPreset(_isCommercial(ctx.originalIdea || '')), // v12.56.0 广告→karaoke 词级扫光
          voiceoverDurations: Object.keys(voiceoverDurations).length > 0 ? voiceoverDurations : undefined, // v12.68 扫光对齐 TTS
          musicUrl: musicUrl || undefined,
          voiceoverClips: voiceoverClips.length > 0 ? voiceoverClips : undefined,
          nativeAudioShots: nativeShotsSet.size > 0 ? [...nativeShotsSet] : undefined, // v12.29.0(P1):这些镜用成片真音轨

          transitionDuration: 0.5,
          musicVolume: voiceoverClips.length > 0 ? 0.2 : 0.3, // 有配音时降低配乐音量
          voiceoverVolume: 0.9,
          editStyle: ctx.editStyleInstruction || undefined, // v12.0.4 一句指令调风格
          actionMode, // v12.13.0 动作片:快切+硬切+不整段慢放,片段按设计时长裁切
          impactCues, // v12.13.1 打击音效:冲击点 → 程序化合成闷响打击音
          impactShots: impactShotsArr, // v12.13.1 选择性 impact 慢镜:短冲击镜给强调慢镜
          onProgress: (pct, stage) => {
            const mappedPct = 65 + Math.round(pct * 0.30);
            ctx.update(AgentRole.EDITOR, { progress: mappedPct, currentTask: stage });
          },
        });

        finalVideoUrl = `${serveFilePathUrl(result.outputPath)}`;
        console.log(`[Editor] Final video: ${result.clipCount} clips, ${result.totalDuration}s, music=${result.hasMusic}, voiceover=${result.hasVoiceover}, highlights=${result.highlights.length}`);

        // v12.289:**成片实际转场回写 timeline**。
        // 病根:上面第 171 行按镜号奇偶给 transition,而合成时 `selectTransitions` 会按张力/关键镜**重挑**,
        // 时长还被 `min(相邻时长)/2` 夹过 —— 两者从不一致,且 `transitionDurationS` 生产端**从没被写过**
        // (EDL 导出恒用 `?? 0.5` 兜底)。于是 v12.277 接进 EDL/AAF 的转场,导出的是**设计值而非成片值**:
        // 剪辑线里写「溶解 0.5s」,成片里其实是硬切或 1.3× 长的 fade。与 v12.277 修的「设计时长 vs 成片时长」同一类。
        // 回写按 shotNumber 对齐(validClips 是过滤后的子集,下标会错位)。
        try {
          const { applyRenderedTransitions } = await import('@/lib/edit-rhythm');
          const _n = applyRenderedTransitions(timeline as any[], result.renderedTransitions);
          if (_n > 0) console.log(`[Editor] 转场回写 timeline: ${_n}/${timeline.length} 镜(导出剪辑线与成片对齐)`);
        } catch (e) {
          console.warn('[Editor] 转场回写跳过(非阻塞):', e instanceof Error ? e.message : e);
        }

        // v12.51.0/v12.53.0 商业题材自动拼结构化文字卡(文字全走 ffmpeg drawtext,根治模型烤乱码):
        // 片头 Hook 卡(提留存)+ 片尾 CTA 卡。宁缺毋滥:非广告 / 无干净短句 → derive 返 null 不加。非阻塞。
        try {
          const { deriveEndCard, deriveHookCard, pickHookLine } = await import('@/lib/end-card');
          const { prependHookCard, appendEndCard } = await import('@/services/video-composer');
          const { dimsForAspect } = await import('@/lib/video-reframe');
          const { w, h } = dimsForAspect(ctx.aspect);
          // v12.77:开场 3 句里按留存公式挑最抓人的(问句>感叹>短句),而非傻取首镜
          const firstDialogue = pickHookLine(composerClips.map((c) => c.dialogue)) || undefined;
          const lastDialogue = [...composerClips].reverse().find((c) => (c.dialogue || '').trim())?.dialogue;
          let outPath = result.outputPath;

          const hook = deriveHookCard(ctx.originalIdea || '', firstDialogue);
          if (hook) {
            const r = await prependHookCard(outPath, { title: hook.title, w, h, bg: 'blur' });
            if (r.appended) { outPath = r.outputPath; console.log(`[Editor] Hook 片头卡: "${hook.title}"`); ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🎯 自动生成开场 Hook 卡:「${hook.title}」` }); }
          }
          const ec = deriveEndCard(ctx.originalIdea || '', lastDialogue);
          if (ec) {
            const r = await appendEndCard(outPath, { title: ec.title, slogan: ec.slogan, w, h, bg: 'blur' });
            if (r.appended) { outPath = r.outputPath; console.log(`[Editor] 商业片尾卡: "${ec.title}"`); ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🏷️ 自动生成干净 CTA 片尾卡:「${ec.title}」` }); }
          }
          if (outPath !== result.outputPath) finalVideoUrl = `${serveFilePathUrl(outPath)}`;
        } catch (e) {
          console.warn('[Editor] 文字卡拼接失败(非阻塞,跳过):', e instanceof Error ? e.message : e);
        }
        ctx.emit('agentTalk', {
          role: AgentRole.EDITOR,
          text: `🎬 FFmpeg 合成完成！${result.clipCount}个片段` +
            `${result.highlights.length > 0 ? `，${result.highlights.length}个高光慢动作` : ''}` +
            `${result.hasMusic ? '，已配乐' : ''}` +
            `${result.hasVoiceover ? '，已配音' : ''} ✅`
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Editor] FFmpeg compose failed (${validVideoClips.length} clips):`, errMsg);
        ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ FFmpeg 合成失败: ${errMsg.slice(0, 100)}` });

        // ═══ 降级方案：如果多片段合成失败，尝试逐个片段单独处理后 concat ═══
        if (validVideoClips.length > 1) {
          ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🔄 尝试简化合成模式（无转场直接拼接）...` });
          try {
            const { composeVideo: composeVideoRetry } = await import('@/services/video-composer');
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
              aspect: ctx.aspect, // v12.49.0 降级路径也跟项目画幅
              musicUrl: musicUrl || undefined,
              transitionDuration: 0.1, // 极短转场
              musicVolume: 0.3,
            });
            finalVideoUrl = `${serveFilePathUrl(simpleResult.outputPath)}`;
            console.log(`[Editor] Simplified compose succeeded: ${simpleResult.clipCount} clips`);
            ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `✅ 简化合成成功！${simpleResult.clipCount}个片段` });
            // v12.292:**降级路径同样要回写转场**。v12.289 只接了主路径 —— 主合成抛异常时控制流
            // 直接跳到这里,timeline 里留着的还是设计值(溶解),而降级成片是**全硬切**,
            // 导出的剪辑线会凭空多出几条实际不存在的溶解。这正是 v12.289 自己在修的那个病。
            try {
              const { applyRenderedTransitions } = await import('@/lib/edit-rhythm');
              const n2 = applyRenderedTransitions(timeline as any[], simpleResult.renderedTransitions);
              if (n2 > 0) console.log(`[Editor] 降级路径转场回写: ${n2}/${timeline.length} 镜`);
            } catch (e3) {
              console.warn('[Editor] 降级路径转场回写跳过(非阻塞):', e3 instanceof Error ? e3.message : e3);
            }
          } catch (e2) {
            const e2Msg = e2 instanceof Error ? e2.message : String(e2);
            console.error('[Editor] Simplified compose also failed:', e2Msg);
            ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `⚠️ 简化合成失败: ${e2Msg.slice(0, 100)}` });

            // ═══ v2.13.5 第 3 级降级:concat demuxer (-c copy, 无重新编码,极少失败) ═══
            // 之前到这一步直接退化为"用 shots[0] 当成片", 用户体验是
            // "我有 6 个分镜, 成片只有第 1 个, 而且后面 5 个都没拼上" — 这条修复路径就是用户报的 bug。
            // concat demuxer 模式: 写一份 list.txt → ffmpeg -f concat -i list.txt -c copy out.mp4。
            // 不做转场 / 不做变速 / 不混 BGM / 不做配音, 但能把 N 个真视频拼成一个真视频, 比"假成片"靠谱得多。
            ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `🔄 尝试最稳定模式 (concat demuxer, 无任何重编码)...` });
            try {
              const { concatVideosSimple } = await import('@/services/video-composer');
              const concatOut = await concatVideosSimple(
                validVideoClips.map(t => t.videoUrl),
                musicUrl || undefined,
              );
              finalVideoUrl = `${serveFilePathUrl(concatOut)}`;
              // v12.293:**第三级降级也要回写**。concat 是纯拼接、镜间全是硬切(上一行的提示语
              // 自己写着「无转场」),而 timeline 里留着的设计值常是溶解 —— 不回写的话,
              // 导出的剪辑线会凭空多出实际不存在的过渡帧。这条路径不走 composeVideo,
              // 所以 v12.292 那道按 composeVideo 调用点扫的门禁**结构上看不见它**(门禁边界已在本版扩大)。
              try {
                const { applyRenderedTransitions, hardCutTransitions } = await import('@/lib/edit-rhythm');
                const n3 = applyRenderedTransitions(
                  timeline as any[],
                  hardCutTransitions(validVideoClips.map((t) => t.shotNumber)),
                );
                if (n3 > 0) console.log(`[Editor] concat 降级转场回写(全硬切): ${n3} 镜`);
              } catch (e4) {
                console.warn('[Editor] concat 转场回写跳过(非阻塞):', e4 instanceof Error ? e4.message : e4);
              }
              audioWarnings.push('🎬 已用最稳定 concat 模式合成 (无转场 / 无配音)');
              ctx.emit('agentTalk', { role: AgentRole.EDITOR, text: `✅ concat 模式成功:${validVideoClips.length} 段已拼成完整成片(无转场/配音)` });
            } catch (e3) {
              const e3Msg = e3 instanceof Error ? e3.message : String(e3);
              console.error('[Editor] concat demuxer also failed:', e3Msg);
              // 三级降级全都炸 → 此时再退化到首段, 但要把真实原因明确推给前端
              finalVideoUrl = validVideoClips[0]?.videoUrl || timeline[0]?.videoUrl || '';
              audioWarnings.push(
                `❌ 三级 FFmpeg 合成全部失败 (主链: ${errMsg.slice(0, 80)} / 简化: ${e2Msg.slice(0, 60)} / concat: ${e3Msg.slice(0, 60)}). ` +
                `临时退化为首段视频 — 请检查服务器 ffmpeg 是否可执行 (which ffmpeg) 并查看片段编码是否一致。`
              );
              ctx.emit('agentTalk', {
                role: AgentRole.EDITOR,
                text: `❌ 三级合成全部失败,临时用首段视频替代。可能原因:1) ffmpeg 二进制找不到;2) 片段编码不一致;3) 磁盘空间不足。`,
              });
            }
          }
        } else {
          finalVideoUrl = validVideoClips[0]?.videoUrl || timeline[0]?.videoUrl || '';
        }
      }
    } else {
      console.warn(`[Editor] No valid video clips for composition! timeline=${timeline.length}, validClips=${validVideoClips.length}`);
      ctx.emit('agentTalk', {
        role: AgentRole.EDITOR,
        text: `⚠️ 没有有效的视频片段可合成 (timeline=${timeline.length}, valid=0). 请检查是否所有镜头视频生成都失败了。`,
      });
      audioWarnings.push(`❌ 0 个有效视频片段, 成片无法合成 (timeline 中 ${timeline.length} 个镜头都未产出可用视频 URL)`);
      finalVideoUrl = timeline[0]?.videoUrl || '';
    }

    ctx.update(AgentRole.EDITOR, { progress: 98, currentTask: '最终收尾...' });
    await sleep(300);

    ctx.update(AgentRole.EDITOR, { status: 'completed', progress: 100 });
    const highlightSummary = highlightShots.length > 0
      ? `\n🔥 高光镜头: ${highlightShots.map(h => `#${h.shotNumber}`).join(' ')}`
      : '';
    const voiceSummary = voiceoverClips.length > 0
      ? `\n🎙️ AI配音: ${voiceoverClips.length}段`
      : '';
    ctx.emit('agentTalk', {
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
      hasVoiceover: voiceoverClips.length > 0,   // v12.1.1 成片音频体检用
      // v12.66.0 质检报告:全片质量防线事件账本汇总(gate/cameo/styleAudit/KenBurns)
      qualityReport: (await import('@/lib/quality-report')).summarizeQualityLedger(ctx.qualityLedger),
    };
  }

