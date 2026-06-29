'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CreationWorkspace } from '@/components/creation-workspace';
import { useProjectWorkspaceStore, useActiveGenerationStore } from '@/lib/store';
import { AgentRole, type Project } from '@/types/agents';
import { MagicWand as Wand2, Lightning as Zap, Sparkle as Sparkles, Lightbulb, FilmSlate, Play, Pencil } from '@phosphor-icons/react';
import { validateIdea, sanitizeInput } from '@/lib/validation';
import { useToast } from '@/components/ui/toast-provider';
import { IMG_PREVIEW_DEFAULT } from '@/lib/placeholder-images';
import { buildInitialNodes, initialEdges } from '@/components/pipeline-canvas';
import { storyTemplates, type StoryTemplate } from '@/lib/story-templates';
import { CharacterLockSection, type LockedCharacter } from '@/components/create/character-lock-section';
import { MultimodalRefShelf } from '@/components/multimodal-ref-shelf';
import type { ReferenceAsset } from '@/lib/multimodal-ref';
// v2.13 cinema redesign — opt-in primitives, 不影响其他页
import {
  SlateCard,
  AspectChip,
  TimecodeChip,
  FilmStripDivider,
  StatusBar,
  Eyebrow,
  TechReadout,
} from '@/components/cinema/primitives';
import { MovingBorderButton } from '@/components/cinema/effects';
import { CameraLanguagePicker } from '@/components/create/camera-language-picker';
import { ScriptDraftsCompare } from '@/components/create/script-drafts-compare';
import { StyleLoraLibrary } from '@/components/create/style-lora-library';
import { TemplateLibraryPicker } from '@/components/create/template-library-picker';
import { FirstRunGuide } from '@/components/create/first-run-guide';
import { PreviewShotModal } from '@/components/create/preview-shot-modal';
import { DemoModeBanner } from '@/components/demo-mode-banner';
import type { ScriptDraft } from '@/lib/script-drafts';

// Pika-style art presets with visual indicators and color themes
const stylePresets = [
  { id: 'poetic-mist', label: '诗意水墨', en: 'Poetic Mist', color: 'from-slate-600 to-blue-900', icon: '🌫️', desc: '朦胧意境' },
  { id: 'neo-noir', label: '新黑色', en: 'Neo Noir', color: 'from-gray-900 to-red-950', icon: '🌃', desc: '暗黑悬疑' },
  { id: 'ink-wash', label: '水墨丹青', en: 'Ink Wash', color: 'from-stone-700 to-stone-900', icon: '🎋', desc: '东方写意' },
  { id: 'dreamwave', label: '梦境波浪', en: 'Dreamwave', color: 'from-indigo-600 to-rose-500', icon: '🌊', desc: '迷幻梦境' },
  { id: 'cyber-neon', label: '赛博霓虹', en: 'Cyber Neon', color: 'from-cyan-600 to-violet-700', icon: '⚡', desc: '未来科幻' },
  { id: 'anime-3d', label: '3D国创', en: 'Anime 3D', color: 'from-amber-600 to-orange-700', icon: '🏮', desc: '国漫风格' },
  { id: 'cinematic', label: '电影写实', en: 'Cinematic', color: 'from-neutral-700 to-neutral-900', icon: '🎬', desc: '院线品质' },
  { id: 'ghibli', label: '吉卜力风', en: 'Ghibli', color: 'from-green-600 to-emerald-800', icon: '🍃', desc: '温暖治愈' },
  // v9.5.5: 与风格画廊新增画风对齐 (二次元 / 国漫细分);en 用画廊 nameEn,预览图复用 /styles/<id>.jpg
  { id: 'american-comic', label: '美漫', en: 'American Comic', color: 'from-red-700 to-amber-600', icon: '💥', desc: '美式超英漫画' },
  { id: 'mihoyo-game', label: '原神崩坏', en: 'Game Anime (miHoYo)', color: 'from-sky-500 to-violet-600', icon: '🎮', desc: '游戏 CG 二次元' },
  { id: 'wushan-ink', label: '雾山水墨', en: 'Ink-Wash Action', color: 'from-stone-600 to-zinc-800', icon: '🖌️', desc: '水墨飞白动作' },
  { id: 'haitang-ethereal', label: '海棠唯美', en: 'Ethereal Donghua', color: 'from-orange-500 to-rose-600', icon: '🏮', desc: '唯美梦幻国漫' },
];

// Dynamically load MJ-generated style preview images
function useStylePreviews() {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/style-previews.json')
      .then(r => r.ok ? r.json() : {})
      .then(d => setPreviews(d || {}))
      .catch(() => {});
  }, []);
  return previews;
}
const durationOptions = ['3s', '5s', '8s']; // 调整为适配当前API能力的时长选项
// v10.6.0 竖屏优先:9:16 置首 = 新项目默认竖屏(2026 短剧主战场);横屏仍一键可选
const aspectOptions = ['9:16', '16:9', '1:1', '2.35:1'];

// v12.5.0(#4):SSE 里程碑事件 → 全局指示条阶段中文名
const SSE_PHASE: Record<string, string> = {
  plan: '导演规划', script: '编写剧本', characters: '设计角色', scenes: '构建场景',
  storyboardPlans: '分镜规划', storyboards: '渲染分镜', videoClip: '生成视频', videos: '生成视频',
  pacingAudit: '节奏审计', editResult: '剪辑合成', review: '导演审核', complete: '完成',
};

const exampleIdeas = [
  { title: '赛博朋克侦探', content: '2077年的新东京，一位赛博侦探接到神秘委托，调查连环失踪案，却发现背后隐藏着惊天阴谋', icon: Zap },
  { title: '古代宫廷', content: '大唐盛世，一位才女入宫，凭借智慧在后宫中周旋，最终成为影响朝政的关键人物', icon: Sparkles },
  { title: '末日废土', content: '核战后的世界，幸存者们在废墟中寻找希望，一个神秘信号指引他们前往传说中的避难所', icon: Wand2 },
  { title: '魔法学院', content: '魔法学院新生入学，发现自己拥有罕见的魔法天赋，却也因此卷入了一场古老的魔法战争', icon: Lightbulb },
];

export default function DashboardCreatePage() {
  const searchParams = useSearchParams();
  const [idea, setIdea] = useState('');
  const [videoProvider, setVideoProvider] = useState('veo');
  const [style, setStyle] = useState(stylePresets[0].en);
  const [selectedTemplate, setSelectedTemplate] = useState<StoryTemplate | null>(null);
  // v2.18 P1: 模板展开 / 详情逻辑 已迁移到 <TemplateLibraryPicker> 内, 老 expandedTemplate 状态废弃

  // Vidu-style: pre-fill idea from URL query param (from cases page "用这个创作")
  useEffect(() => {
    const ideaParam = searchParams.get('idea');
    if (ideaParam) {
      setIdea(decodeURIComponent(ideaParam));
      return;
    }
    // v6.2.1: 长篇拆解的某一集经 sessionStorage 传入 (长文本避免超 URL 长度上限)
    try {
      const seed = sessionStorage.getItem('qfmj-create-seed');
      if (seed) {
        setIdea(seed);
        sessionStorage.removeItem('qfmj-create-seed');
      }
    } catch { /* ignore */ }
    // v6.3: 风格画廊「套用此风格」经 sessionStorage 传入风格名
    try {
      const styleSeed = sessionStorage.getItem('qfmj-create-style');
      if (styleSeed) {
        setStyle(styleSeed);
        sessionStorage.removeItem('qfmj-create-style');
      }
    } catch { /* ignore */ }
    // v9.6.8 (T2 模板市场): 「用此模板起片」经 sessionStorage 预填 画风 + 多参元素 + 锁定角色
    try {
      const tplRaw = sessionStorage.getItem('qfmj-create-template');
      if (tplRaw) {
        const tpl = JSON.parse(tplRaw) as { style?: string; styleEn?: string; references?: ReferenceAsset[]; lockedCharacters?: LockedCharacter[]; voiceOverrides?: Record<string, string> };
        if (tpl.styleEn || tpl.style) setStyle(tpl.styleEn || tpl.style!);
        if (Array.isArray(tpl.references) && tpl.references.length) setReferences(tpl.references);
        if (Array.isArray(tpl.lockedCharacters) && tpl.lockedCharacters.length) setLockedCharacters(tpl.lockedCharacters);
        // v9.7.9:音色覆盖暂存,待新项目生成后应用(项目此刻尚未创建)
        if (tpl.voiceOverrides && Object.keys(tpl.voiceOverrides).length) sessionStorage.setItem('qfmj-pending-voice-overrides', JSON.stringify(tpl.voiceOverrides));
        sessionStorage.removeItem('qfmj-create-template');
      }
    } catch { /* ignore */ }
  }, [searchParams]);
  const [duration, setDuration] = useState(durationOptions[1]); // 默认5秒
  const [aspect, setAspect] = useState(aspectOptions[0]);
  // v2.12 Phase 1: 多角色锁脸 (1-3 人,前置在创作管线里)
  const [lockedCharacters, setLockedCharacters] = useState<LockedCharacter[]>([]);
  const [references, setReferences] = useState<ReferenceAsset[]>([]); // v9.5.6: 多参元素(对标可灵 Elements)
  // v2.14 P1.1: 全局默认镜头语言 — 选了之后所有镜头都默认走这个运镜, 单镜可在分镜调整时覆盖
  const [cameraDefault, setCameraDefault] = useState<string | null>(null);
  // v12.0.4: 一句指令调剪辑风格(''=默认中速 / preset / 自由文本)→ 智能剪辑管线 pacing+转场
  const [editStyle, setEditStyle] = useState('');
  // v2.15 G9: 草稿数 (1=直接走 Writer; 2/3=先 hit /api/script-drafts 拿对比卡, 用户选完再走完整流程)
  const [draftCount, setDraftCount] = useState<1 | 2 | 3>(1);
  // v10.5.3: 简易/专业开关 —— 默认 pro(与既有 UI 逐像素一致,验收条款);localStorage 记忆
  const [createMode, setCreateMode] = useState<'simple' | 'pro'>('pro');
  useEffect(() => {
    try {
      const m = localStorage.getItem('qfmj-create-mode');
      if (m === 'simple' || m === 'pro') setCreateMode(m);
    } catch { /* ignore */ }
  }, []);
  const switchCreateMode = (m: 'simple' | 'pro') => {
    setCreateMode(m);
    try { localStorage.setItem('qfmj-create-mode', m); } catch { /* ignore */ }
  };
  const [showDraftCompare, setShowDraftCompare] = useState(false);
  // v2.18 P1.3: 试拍 1 镜端到端 modal
  const [showPreview, setShowPreview] = useState(false);
  const [workspaceProject, setWorkspaceProject] = useState<Project | null>(null);
  const { showToast } = useToast();

  const stylePreviews = useStylePreviews();
  const {
    setCurrentProject, setNodes, setEdges, setIsProducing,
    addChatMessage, setAssets,
  } = useProjectWorkspaceStore();

  const handleSelectTemplate = (template: StoryTemplate) => {
    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(null);
    } else {
      setSelectedTemplate(template);
      setIdea(template.exampleIdea);
      // Set recommended style if it matches one of the presets
      const matchedPreset = stylePresets.find(p => p.label === template.styleRecommendation || p.en === template.styleRecommendation);
      if (matchedPreset) setStyle(matchedPreset.en);
      // v2.18: 模板带 recommendedDuration / recommendedAspect / recommendedCamera 时自动填表单
      if (template.recommendedDuration && durationOptions.includes(`${template.recommendedDuration}s` as any)) {
        setDuration(`${template.recommendedDuration}s` as any);
      }
      if (template.recommendedAspect && aspectOptions.includes(template.recommendedAspect as any)) {
        setAspect(template.recommendedAspect as any);
      }
      if (template.recommendedCamera) {
        setCameraDefault(template.recommendedCamera);
      }
    }
  };

  const handleStartCreation = async () => {
    const validation = validateIdea(idea);
    if (!validation.valid) {
      showToast({ title: validation.error || '输入无效', type: 'error' });
      return;
    }

    // v2.15 G9: draftCount > 1 → 先弹草稿对比 modal, 用户选完再走完整流程
    if (draftCount > 1) {
      setShowDraftCompare(true);
      return;
    }

    return runFullPipeline(idea);
  };

  // v2.15 G9: 用户从对比卡选了一版草稿 → 把草稿的 synopsis + shots 拼成"准剧本",
  // 作为新 idea 提交给 /api/create-stream — orchestrator 的 isFullScriptInput() 会
  // 检测到结构化剧本特征, 走 parsedScript 适配模式, 编剧 agent 会基于此版做高质量改编。
  const handleDraftPicked = (draft: ScriptDraft) => {
    setShowDraftCompare(false);
    if (!draft.script) return;
    const lines: string[] = [];
    lines.push(`第 1 章 ${draft.script.title || '(草稿)'}`);
    lines.push('');
    if (draft.script.synopsis) lines.push(draft.script.synopsis);
    lines.push('');
    for (const sh of draft.script.shots || []) {
      lines.push(`${sh.shotNumber}-1 ${sh.sceneDescription || '场景'} 日`);
      if (sh.action) lines.push(`△画面：${sh.action}`);
      if (sh.dialogue && sh.characters?.[0]) {
        lines.push(`${sh.characters[0]}：${sh.dialogue}`);
      }
      lines.push('');
    }
    const adapted = lines.join('\n');
    setIdea(adapted);
    showToast({ title: `已采用草稿 #${draft.draftId.slice(-4)}, 进入完整创作流程`, type: 'success' });
    // 立刻提交完整 pipeline (用 adapted 而非 setIdea 的异步值)
    runFullPipeline(adapted);
  };

  // v2.19 P0.2: opts.previewSeedImage — 试拍 modal "用这张图走全流程" 透下来的图,
  // /api/create-stream 收到后 setPreviewSeedImage 注入到 orchestrator,
  // 第 1 镜的 storyboard 渲染会直接复用它, 跳过对应 MJ 调用。
  const runFullPipeline = async (rawIdea: string, opts?: { previewSeedImage?: string }) => {
    const sanitizedIdea = sanitizeInput(rawIdea);
    const projectId = `proj-${Date.now()}`;
    const project: Project = {
      id: projectId,
      userId: 'current-user',
      title: sanitizedIdea.slice(0, 20) + (sanitizedIdea.length > 20 ? '...' : ''),
      description: sanitizedIdea,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setCurrentProject(project);
    setAssets([]);
    setNodes(buildInitialNodes([]));
    setEdges(initialEdges);
    // v12.x(#3 修复):清掉上一轮的制片人评分 / 评审历史 / agent 气泡,新任务不再残留旧分数
    useProjectWorkspaceStore.getState().clearAgentOutputs();
    setIsProducing(true);
    setWorkspaceProject(project);
    // v12.5.0(#4):登记全局「进行中任务」→ 切模块/刷新后仍可见 + 一键返回,不再「丢任务」
    useActiveGenerationStore.getState().start({ projectId, idea: sanitizedIdea });

    addChatMessage(AgentRole.WRITER, {
      id: `msg-sys-${Date.now()}`, projectId, agentRole: AgentRole.WRITER, role: 'assistant',
      content: `收到创意：「${sanitizedIdea}」\n\n正在为你构思剧本、角色和分镜...`, createdAt: new Date().toISOString(),
    });

    try {
      const response = await fetch('/api/create-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: sanitizedIdea, videoProvider, style, duration, aspect, projectId,
          templateId: selectedTemplate?.id,
          // v2.12 Phase 1: 携带 1-3 角色锁脸;create-stream 会持久化到 projects.locked_characters,
          // 并把第一个角色 imageUrl 同步到 projects.primary_character_ref(兜底现有单角色编排链路)
          lockedCharacters: lockedCharacters.length > 0 ? lockedCharacters : undefined,
          // v2.14 P1.1: 全局默认镜头语言 id (CAMERA_LANGUAGE_PRESETS), 影响所有镜头的运镜默认值
          cameraDefault: cameraDefault || undefined,
          // v2.19 P0.2: 试拍图 → 第 1 镜首帧复用 (orchestrator 跳过 generateImage)
          previewSeedImage: opts?.previewSeedImage || undefined,
          // v9.5.6: 多参元素(角色/风格/场景/道具/...)— create-stream 经 bindElements 路由进 cref/sref/构图
          references: references.length ? references : undefined,
          // v12.0.4: 一句指令调剪辑风格(空 → 默认中速)
          editStyle: editStyle.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error('创作失败');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('无法读取响应流');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            handleSSEEvent(event, projectId);
          } catch { /* skip malformed */ }
        }
      }

      // v9.7.9:一键起片携带的音色覆盖 → 新项目已建好,落到该项目(下次合成配音按此音色)
      try {
        const pendingVO = sessionStorage.getItem('qfmj-pending-voice-overrides');
        if (pendingVO) {
          sessionStorage.removeItem('qfmj-pending-voice-overrides');
          const overrides = JSON.parse(pendingVO);
          if (overrides && Object.keys(overrides).length) {
            await fetch(`/api/projects/${encodeURIComponent(projectId)}/voice-overrides`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrides }),
            }).catch(() => {});
          }
        }
      } catch { /* 音色覆盖应用失败不影响成片 */ }
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : '创作失败', type: 'error' });
    } finally {
      setIsProducing(false);
      useActiveGenerationStore.getState().finish(); // v12.5.0(#4):任务结束,清全局指示
    }
  };

  // ── SSE 事件处理 ──
  const handleSSEEvent = (event: any, projectId: string) => {
    const { type, data } = event;
    const ts = new Date().toISOString();
    const s = useProjectWorkspaceStore.getState();

    // v12.5.0(#4):里程碑事件 → 更新全局指示条阶段名(切模块也能看到进度)
    const phase = SSE_PHASE[type];
    if (phase) useActiveGenerationStore.getState().setPhase(phase);

    switch (type) {
      case 'agents':
      case 'projectId':
        break;

      // Agent 吐槽气泡
      case 'agentTalk': {
        const role = data.role as AgentRole;
        s.addChatMessage(role, { id: `msg-talk-${Date.now()}-${Math.random()}`, projectId, agentRole: role, role: 'assistant', content: data.text, createdAt: ts });
        break;
      }

      // LLM 心跳 — 推进当前 running 节点的进度
      case 'heartbeat': {
        const nodes = s.nodes;
        const runningNode = nodes.find(n => (n.data as any)?.status === 'running');
        if (runningNode) {
          const cur = (runningNode.data as any)?.progress || 0;
          if (cur < 90) {
            s.updateNodeData(runningNode.id, { progress: Math.min(cur + 5, 90) } as any);
          }
        }
        break;
      }

      // MJ 进度
      // v2.11 #4: 单图百分比写到 imageProgress 字段, 不再覆盖节点的 stage-level progress.
      // 节点 progress 由 orchestrator 的 this.update(role, { progress }) 单源聚合 (i+1/total),
      // mjProgress/videoProgress 只反映"当前正在出的那一张图自身的进度"
      case 'mjProgress': {
        const pctMatch = (data.progress || '').match(/(\d+)/);
        if (pctMatch) {
          const nodes = s.nodes;
          const runningNode = nodes.find(n => (n.data as any)?.status === 'running');
          if (runningNode) {
            s.updateNodeData(runningNode.id, {
              imageProgress: parseInt(pctMatch[1]),
              imageProgressLabel: data.label || '当前图像',
            } as any);
          }
        }
        break;
      }

      // Veo 视频生成进度（每个镜头独立进度）
      // 同样: 写到镜头资产 + 节点的 currentShotProgress 字段, 不动 stage-level progress
      case 'videoProgress': {
        const progress = typeof data.progress === 'number' ? data.progress : 0;
        s.updateNodeData('node-video', { currentShotProgress: progress, status: 'running' } as any);
        // 更新对应镜头视频资产的生成状态
        if (data.shotNumber) {
          const va = s.assets.find(a => a.type === 'video' && a.shotNumber === data.shotNumber);
          if (va) {
            s.updateAsset(va.id, { data: { ...va.data, status: 'generating', progress } });
          }
        }
        break;
      }

      case 'status': {
        const msg: string = data.message || '';
        if (msg.includes('导演') && msg.includes('分析')) {
          s.updateNodeData('node-director', { status: 'running', progress: 50 });
          s.updateNodeData('node-writer', { status: 'running', progress: 10 });
          s.setActiveAgent(AgentRole.WRITER);
        } else if (msg.includes('编剧') && msg.includes('剧本')) {
          s.updateNodeData('node-director', { status: 'completed', progress: 100 });
          s.updateNodeData('node-writer', { status: 'running', progress: 40 });
          s.setActiveAgent(AgentRole.WRITER);
        } else if (msg.includes('角色设计师')) {
          s.updateNodeData('node-writer', { status: 'completed', progress: 100 });
          s.updateNodeData('node-character', { status: 'running', progress: 20 });
          s.setActiveAgent(AgentRole.CHARACTER_DESIGNER);
        } else if (msg.includes('场景设计师')) {
          s.updateNodeData('node-character', { status: 'completed', progress: 100 });
          s.updateNodeData('node-scene', { status: 'running', progress: 20 });
          s.setActiveAgent(AgentRole.SCENE_DESIGNER);
        } else if (msg.includes('分镜师')) {
          s.updateNodeData('node-scene', { status: 'completed', progress: 100 });
          s.updateNodeData('node-storyboard', { status: 'running', progress: 20 });
          s.setActiveAgent(AgentRole.STORYBOARD);
        } else if (msg.includes('视频') && msg.includes('生成')) {
          s.updateNodeData('node-storyboard', { status: 'completed', progress: 100 });
          s.updateNodeData('node-video', { status: 'running', progress: 20 });
          s.setActiveAgent(AgentRole.VIDEO_PRODUCER);
        } else if (msg.includes('剪辑师') || msg.includes('剪辑合成') || msg.includes('配乐')) {
          s.updateNodeData('node-video', { status: 'completed', progress: 100 });
          s.updateNodeData('node-editor', { status: 'running', progress: 30 });
          s.setActiveAgent(AgentRole.EDITOR);
        } else if (msg.includes('制片人') && msg.includes('审核')) {
          s.updateNodeData('node-editor', { status: 'completed', progress: 100 });
          s.updateNodeData('node-producer', { status: 'running', progress: 30 });
          s.setActiveAgent(AgentRole.PRODUCER);
        } else if (msg.includes('自动优化')) {
          s.updateNodeData('node-producer', { status: 'reviewing', progress: 50 });
        } else if (msg.includes('二次审核')) {
          s.updateNodeData('node-producer', { status: 'running', progress: 80 });
          s.setActiveAgent(AgentRole.PRODUCER);
        }
        break;
      }

      case 'plan': {
        s.updateNodeData('node-writer', { status: 'running', progress: 30 });
        s.addAsset({ id: `asset-script-${Date.now()}`, projectId, type: 'script', name: '剧本', data: { synopsis: '', genre: data.genre, style: data.style, shots: [] }, mediaUrls: [], version: 1, createdAt: ts, updatedAt: ts });
        (data.characters || []).forEach((c: any, i: number) => {
          s.addAsset({ id: `asset-char-${Date.now()}-${i}`, projectId, type: 'character', name: c.name, data: { description: c.description }, mediaUrls: [], version: 1, createdAt: ts, updatedAt: ts });
        });
        (data.scenes || []).forEach((sc: any, i: number) => {
          s.addAsset({ id: `asset-scene-${Date.now()}-${i}`, projectId, type: 'scene', name: sc.name || sc.location || `场景${i + 1}`, data: { description: sc.description, location: sc.location }, mediaUrls: [], version: 1, createdAt: ts, updatedAt: ts });
        });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.WRITER, { id: `msg-plan-${Date.now()}`, projectId, agentRole: AgentRole.WRITER, role: 'assistant', content: `导演已制定计划：${data.genre}风格，${data.characters?.length || 0}个角色，${data.scenes?.length || 0}个场景。`, createdAt: ts });
        break;
      }

      case 'script': {
        const sa = s.assets.find(a => a.type === 'script');
        if (sa) s.updateAsset(sa.id, { data: { ...sa.data, synopsis: data.synopsis, title: data.title, shots: data.shots } });
        s.updateNodeData('node-writer', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.WRITER, { id: `msg-script-${Date.now()}`, projectId, agentRole: AgentRole.WRITER, role: 'assistant', content: `剧本「${data.title}」创作完成！\n\n${data.synopsis}\n\n共 ${data.shots?.length || 0} 个镜头。`, createdAt: ts });
        break;
      }

      case 'characters': {
        (data || []).forEach((c: any) => {
          const ca = s.assets.find(a => a.type === 'character' && a.name === c.character);
          // 允许 data: URI（mockSvg 占位图）在 UI 上显示，让卡片至少有视觉反馈
          // 持久化层（route.ts saveAsset）已有独立 data: 过滤，不会写入 DB
          const mediaUrls = c.imageUrl ? [c.imageUrl] : [];
          if (ca) s.updateAsset(ca.id, { mediaUrls });
        });
        s.updateNodeData('node-character', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.CHARACTER_DESIGNER, { id: `msg-chars-${Date.now()}`, projectId, agentRole: AgentRole.CHARACTER_DESIGNER, role: 'assistant', content: `${data?.length || 0}个角色设计完成！`, createdAt: ts });
        break;
      }

      case 'scenes': {
        (data || []).forEach((sc: any) => {
          const sa = s.assets.find(a => a.type === 'scene' && (a.name === sc.name || a.data?.location === sc.name));
          const mediaUrls = sc.imageUrl ? [sc.imageUrl] : [];
          if (sa) s.updateAsset(sa.id, { mediaUrls });
        });
        s.updateNodeData('node-scene', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.SCENE_DESIGNER, { id: `msg-scenes-${Date.now()}`, projectId, agentRole: AgentRole.SCENE_DESIGNER, role: 'assistant', content: `${data?.length || 0}个场景概念图设计完成！`, createdAt: ts });
        break;
      }

      case 'storyboardPlans': {
        // 第1阶段：纯文本分镜描述（暂无图片）
        (data || []).forEach((sb: any, i: number) => {
          const sn = sb.shotNumber || i + 1;
          s.addAsset({ id: `asset-sb-${Date.now()}-${i}`, projectId, type: 'storyboard', name: `镜头 ${sn}`, data: { description: sb.prompt, planData: (sb as any).planData, duration: 10 }, mediaUrls: [], shotNumber: sn, version: 1, createdAt: ts, updatedAt: ts });
        });
        s.updateNodeData('node-storyboard', { status: 'running', progress: 50 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.STORYBOARD, { id: `msg-sbplan-${ts}`, projectId, agentRole: AgentRole.STORYBOARD, role: 'assistant', content: `${data?.length || 0}个分镜描述规划完成，正在统一渲染分镜图...`, createdAt: ts });
        break;
      }

      case 'storyboards': {
        // 第2阶段：渲染完成的分镜图，更新已有的分镜资产
        const existing = s.assets.filter(a => a.type === 'storyboard');
        (data || []).forEach((sb: any, i: number) => {
          const sn = sb.shotNumber || i + 1;
          const ex = existing.find(a => a.shotNumber === sn);
          const sbMediaUrls = sb.imageUrl ? [sb.imageUrl] : [];
          if (ex) { s.updateAsset(ex.id, { mediaUrls: sbMediaUrls, data: { ...ex.data, description: sb.prompt } }); }
          else { s.addAsset({ id: `asset-sb-${Date.now()}-${i}`, projectId, type: 'storyboard', name: `镜头 ${sn}`, data: { description: sb.prompt, duration: 10 }, mediaUrls: sbMediaUrls, shotNumber: sn, version: 1, createdAt: ts, updatedAt: ts }); }
        });
        s.updateNodeData('node-storyboard', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.STORYBOARD, { id: `msg-sb-${ts}-${Math.random()}`, projectId, agentRole: AgentRole.STORYBOARD, role: 'assistant', content: `${data?.length || 0}个分镜图渲染完成！角色/场景/画风一致性已确保 ✅`, createdAt: ts });
        break;
      }

      // 逐条视频完成（实时推送，每生成一段就展示一段）
      case 'videoClip': {
        const v = data;
        const sn = v.shotNumber || 1;
        const existing = s.assets.find(a => a.type === 'video' && a.shotNumber === sn);
        if (existing) {
          s.updateAsset(existing.id, { mediaUrls: v.videoUrl ? [v.videoUrl] : [], data: { duration: v.duration || 5, status: 'completed' } });
        } else {
          s.addAsset({ id: `asset-video-${Date.now()}-${sn}`, projectId, type: 'video', name: `视频 ${sn}`, data: { duration: v.duration || 5, status: 'completed' }, mediaUrls: v.videoUrl ? [v.videoUrl] : [], shotNumber: sn, version: 1, createdAt: ts, updatedAt: ts });
        }
        refreshNodeAssets();
        break;
      }

      case 'videos': {
        // 全部视频生成完成（最终确认，确保所有视频都已更新）
        const existingVids = s.assets.filter(a => a.type === 'video');
        (data || []).forEach((v: any, i: number) => {
          const sn = v.shotNumber || i + 1;
          const ex = existingVids.find(a => a.shotNumber === sn);
          if (ex) { s.updateAsset(ex.id, { mediaUrls: v.videoUrl ? [v.videoUrl] : [], data: { duration: v.duration || 5, status: 'completed' } }); }
          else { s.addAsset({ id: `asset-video-${Date.now()}-${i}`, projectId, type: 'video', name: `视频 ${sn}`, data: { duration: v.duration || 5, status: 'completed' }, mediaUrls: v.videoUrl ? [v.videoUrl] : [], shotNumber: sn, version: 1, createdAt: ts, updatedAt: ts }); }
        });
        s.updateNodeData('node-video', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.VIDEO_PRODUCER, { id: `msg-vid-${ts}-${Math.random()}`, projectId, agentRole: AgentRole.VIDEO_PRODUCER, role: 'assistant', content: `${data?.length || 0}个视频片段全部生成完成！如需重新生成，请告诉我镜头编号和时长。`, createdAt: ts });
        break;
      }

      // v10.6.2: 节奏/钩子审计(Writer 后首发,Editor BGM 析拍后回填重推)→ 并入 script 资产
      case 'pacingAudit': {
        const sa = s.assets.find(a => a.type === 'script');
        if (sa) s.updateAsset(sa.id, { data: { ...sa.data, pacingReport: data } });
        break;
      }
      case 'editResult': {
        s.updateNodeData('node-editor', { status: 'completed', progress: 100, editResult: data } as any);
        refreshNodeAssets();
        s.addChatMessage(AgentRole.EDITOR, { id: `msg-edit-${Date.now()}`, projectId, agentRole: AgentRole.EDITOR, role: 'assistant',
          content: `剪辑完成！${data.videoCount}个镜头，总时长${data.totalDuration}秒 ✂️`, createdAt: ts });
        break;
      }

      case 'review': {
        s.updateNodeData('node-producer', { status: 'completed', progress: 100, review: data } as any);
        s.setDirectorReview(data);
        s.addReviewToHistory(data);
        refreshNodeAssets();
        const score = data.overallScore || 0;
        const emoji = score >= 80 ? '👍' : score >= 70 ? '🤔' : '😤';
        s.addChatMessage(AgentRole.PRODUCER, { id: `msg-rev-${ts}-${Math.random()}`, projectId, agentRole: AgentRole.PRODUCER, role: 'assistant',
          content: `审核完成！综合评分：${score}/100 ${emoji}\n\n${data.summary}\n\n${data.items?.length ? `发现 ${data.items.length} 个改进建议。` : '没有需要改进的地方。'}${data.passed ? '\n\n✅ 审核通过！' : '\n\n⚠️ 未通过，正在自动优化...'}`, createdAt: ts });
        break;
      }

      case 'complete': {
        s.updateNodeData('node-producer', { status: 'completed', progress: 100 });
        refreshNodeAssets();
        s.addChatMessage(AgentRole.PRODUCER, { id: `msg-done-${Date.now()}`, projectId, agentRole: AgentRole.PRODUCER, role: 'assistant',
          content: '创作流程全部完成！所有资产已保存到项目中。\n\n你可以在「我的资产」中查看已确认的数字资产，或继续和各 Agent 对话进行调整。', createdAt: ts });
        break;
      }

      case 'pipelineError': {
        // 非致命错误,某个步骤失败但流程继续;支持"重试此步"
        const { code, userMsg, retryable, stage, details } = data || {};
        const shotNumber = details?.shotNumber;
        showToast({
          title: userMsg || '步骤失败',
          description: `[${code || 'UNKNOWN'}] 阶段:${stage || '-'}`,
          type: 'warning',
          duration: 8000,
          action: retryable && shotNumber && projectId ? {
            label: `重试镜头 ${shotNumber}`,
            onClick: () => {
              fetch(`/api/projects/${projectId}/regenerate-shot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shotNumber }),
              }).catch(() => {});
            },
          } : undefined,
        });
        break;
      }

      case 'error': {
        const title = data.userMsg || data.message || '创作出错';
        const desc = data.code ? `[${data.code}] ${data.stage || ''}` : undefined;
        showToast({
          title, description: desc, type: 'error', duration: 8000,
          action: data.retryable ? {
            label: '重新开始当前步骤',
            onClick: () => window.location.reload(),
          } : undefined,
        });
        break;
      }
    }
  };

  const refreshNodeAssets = () => {
    const s = useProjectWorkspaceStore.getState();
    const a = s.assets;
    const map: Record<string, string[]> = {
      'node-writer': ['script', 'character'],
      'node-character': ['character'],
      'node-scene': ['scene'],
      'node-storyboard': ['storyboard'],
      'node-video': ['video'],
      'node-editor': ['timeline', 'final_video', 'music'],
    };
    for (const [nid, types] of Object.entries(map)) {
      s.updateNodeData(nid, { assets: a.filter(x => types.includes(x.type)) } as any);
    }
  };

  // ── 已进入创作模式 ──
  if (workspaceProject) {
    return <CreationWorkspace project={workspaceProject} />;
  }

  // ── 创意输入入口 (v2.13 cinema redesign) ──
  // 影院仪表盘 + 工作室软件密度 — 不抄 oiioii 的粉色 / blob mascot / 点阵画布
  const ideaCharCount = idea.trim().length;
  const isReady = ideaCharCount >= 10;
  const totalDurationSec = parseFloat(duration.replace(/[^\d.]/g, '')) * 6; // 估 6 镜
  return (
    <div className="cinema-page -mx-[5vw] -my-6 px-[5vw] py-6">
      {/* v2.15 G9: 草稿对比 modal — draftCount > 1 且用户点 ROLL 时弹出 */}
      {showDraftCompare && (
        <ScriptDraftsCompare
          idea={idea}
          style={style}
          count={draftCount}
          onPick={handleDraftPicked}
          onCancel={() => setShowDraftCompare(false)}
        />
      )}

      {/* v2.18 P1.3: 试拍 modal — 1 镜端到端预览 */}
      {/* v2.19 P0.2: seed 接到 runFullPipeline 直接走 — 不再过 handleStartCreation
          (handleStartCreation 会重置很多状态, 也可能弹 draft compare modal, 而试拍场景
          用户已经做完选择, 直接进 pipeline 即可) */}
      {showPreview && (
        <PreviewShotModal
          idea={idea}
          style={style}
          aspect={aspect}
          videoToo={true}
          onAccept={(seed) => {
            setShowPreview(false);
            if (seed?.imageUrl) {
              showToast({ title: `已复用试拍图作为第 1 镜首帧, 进入完整创作`, type: 'success' });
              runFullPipeline(idea, { previewSeedImage: seed.imageUrl });
            } else {
              handleStartCreation();
            }
          }}
          onCancel={() => setShowPreview(false)}
        />
      )}

      {/* v10.1.2: 演示模式提示 — 无图像/视频引擎 key 时,告知产出为占位/示意 + 指引启用 */}
      <DemoModeBanner />
      {/* v10.5.3: 首跑三步引导(写创意→选风格→ROLL);完成/跳过后不再弹 */}
      <FirstRunGuide />

      {/* ── 顶部:场记板 (Slate) 形式标题 + Action — 替代单调 h2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start mb-6">
        <SlateCard
          title="创作工坊"
          scene="01"
          take={ideaCharCount > 0 ? String(Math.floor(ideaCharCount / 50) + 1).padStart(2, '0') : '—'}
          director="ChrisChen667788"
          notes="从一句创意到完整短剧 — 设定文本 · 角色 · 风格 · 时长后开机"
        />
        <div className="flex flex-col gap-2 items-stretch sm:items-end">
          {/* v10.5.3: 简易/专业开关 —— 简易只留「创意→风格→时长画幅→ROLL」主干 */}
          <div className="inline-flex self-stretch sm:self-end rounded-lg border border-[var(--cinema-border-hi)] overflow-hidden" role="group" aria-label="创作模式">
            {([['simple', '简易'], ['pro', '专业']] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => switchCreateMode(m)}
                aria-pressed={createMode === m}
                className={`px-3 py-1 cinema-mono text-[11px] transition-colors ${
                  createMode === m
                    ? 'bg-[var(--cinema-amber,#C9A35E)] text-[#0A0908] font-semibold'
                    : 'text-[var(--cinema-text-2)] hover:text-[var(--cinema-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* v2.18 P1.3: 试拍按钮 — 30-60s 出 1 镜让用户先看 vibe 再决定走全流程 */}
          <button
            onClick={() => setShowPreview(true)}
            disabled={!isReady}
            className="cinema-btn !px-4 !py-2 !text-[12px] inline-flex items-center justify-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
            title={isReady ? '生成 1 张图 + 5s 视频, 30-60s, 不消耗完整 pipeline 算力' : '至少输入 10 个字符'}
          >
            <FilmSlate className="w-3.5 h-3.5" weight="duotone" />
            试拍 1 镜
          </button>
          <MovingBorderButton
            data-guide="roll"
            onClick={handleStartCreation}
            disabled={!isReady}
            duration={3000}
            containerClassName={`whitespace-nowrap ${
              isReady
                ? 'shadow-[0_6px_18px_-8px_rgba(201,163,94,0.55)]'
                : 'opacity-40 cursor-not-allowed'
            }`}
            className={`cinema-btn cinema-btn-primary !px-6 !py-3 !text-[13px] whitespace-nowrap ${
              !isReady ? 'opacity-100' : ''
            }`}
            title={isReady ? '进入创作工坊' : '至少输入 10 个字符'}
          >
            <span className="inline-flex items-center gap-1.5">
              {isReady ? <><Play size={13} weight="fill" /> 开机 · ROLL</> : <><Pencil size={13} /> 待输入创意</>}
            </span>
          </MovingBorderButton>
          {/* v8.3 P5: 创意生成器并入此处 (不再独立 nav 模块) — 结构化导演级提示词 + 影片/LUT/导演预设 */}
          <Link
            href="/dashboard/master-prompt"
            className="text-[11px] text-[var(--cinema-text-2)] hover:text-[var(--cinema-amber)] transition-colors inline-flex items-center justify-end gap-1 whitespace-nowrap"
            title="结构化导演级提示词 · 影片 look / LUT / 导演运镜预设 · 专业术语表"
          >
            <Sparkles size={12} weight="duotone" /> 没灵感?用创意生成器搭一段导演级提示词 →
          </Link>
        </div>
      </div>

      <FilmStripDivider label="ACT 1 · 创意 + 设定" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="cinema-card p-5 flex flex-col gap-5">
          <label className="block">
            <div className="flex items-center justify-between mb-2">
              <Eyebrow>Script · 创意 / 剧本</Eyebrow>
              <span className="cinema-mono text-[10px] opacity-60 tabular-nums">
                {ideaCharCount} chars
              </span>
            </div>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={10}
              placeholder={"支持两种输入:\n1. 简短创意:暮色城市中的旅人,霓虹雨夜...\n2. 完整剧本:直接粘贴含场景、角色对白、△画面描述的剧本文本"}
              data-guide="idea"
              className="cinema-textarea"
            />
          </label>

          {/* v2.18 P1: 模板库 — 搜索 / tag 筛选 / 个人模板 / 克隆 / 保存当前 集中入口 */}
          {createMode === 'pro' && <TemplateLibraryPicker
            selectedId={selectedTemplate?.id || null}
            onSelect={(t) => {
              if (t === null) setSelectedTemplate(null);
              else handleSelectTemplate(t);
            }}
            onSaveCurrentAsTemplate={async () => {
              const trimmedIdea = idea.trim();
              if (!trimmedIdea || trimmedIdea.length < 10) {
                showToast({ title: '至少输入 10 字 idea 后才能存为模板', type: 'error' });
                return;
              }
              const name = window.prompt('给这个模板起个名字 (≤40 字)', '我的模板');
              if (!name?.trim()) return;
              try {
                const res = await fetch('/api/global-assets', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'template',
                    name: name.trim().slice(0, 40),
                    description: `自定义模板 · ${style} · ${duration} · ${aspect}`,
                    metadata: {
                      icon: '⭐',
                      nameEn: 'Custom',
                      exampleIdea: trimmedIdea,
                      structureHint: '基于用户当前 idea 的自定义模板, 无预设结构提示, Director/Writer 按 idea 自由发挥',
                      emotionCurve: '',
                      keyElements: [],
                      styleRecommendation: style,
                      shotCount: { min: 4, max: 8 },
                      colorPalette: '',
                      tags: ['个人', style],
                      recommendedDuration: parseInt(duration.replace(/[^\d]/g, '')) as 5 | 6 | 10 | 15,
                      recommendedAspect: aspect as any,
                      recommendedCamera: cameraDefault || undefined,
                    },
                  }),
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  showToast({ title: '保存失败: ' + (body.error || res.status), type: 'error' });
                  return;
                }
                showToast({ title: `已保存模板「${name.trim()}」, 下次创作直接选`, type: 'success' });
              } catch (e) {
                showToast({ title: e instanceof Error ? e.message : '保存失败', type: 'error' });
              }
            }}
          />}

          {/* Style preset shelf — cinema redesign */}
          <div data-guide="style">
            <div className="flex items-center justify-between mb-2">
              <Eyebrow>Look · 画风预设</Eyebrow>
              <span className="cinema-mono text-[10px] opacity-50">{stylePresets.length} looks</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
              {stylePresets.map((preset, idx) => {
                const isActive = style === preset.en;
                return (
                  <button
                    key={preset.id}
                    onClick={() => setStyle(preset.en)}
                    className={`shrink-0 min-w-[150px] overflow-hidden border text-left transition-colors group ${
                      isActive
                        ? 'border-[var(--cinema-amber)]'
                        : 'border-[var(--cinema-border)] hover:border-[var(--cinema-amber-deep)]'
                    }`}
                    style={{ borderRadius: 4 }}
                  >
                    <div className="aspect-[4/3] relative overflow-hidden">
                      {stylePreviews[preset.id] ? (
                        <img loading="lazy" decoding="async" src={stylePreviews[preset.id]} alt={preset.label} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        // v8.3 P6.3: AI 金色 emblem 兜底 (无动态预览图时), 再无图则露出 emoji
                        <div className="absolute inset-0 grid place-items-center text-3xl bg-[var(--cinema-surface-2)]">
                          <span aria-hidden>{preset.icon}</span>
                          <img src={`/look-icons/${preset.id}.jpg`} alt="" aria-hidden loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        </div>
                      )}
                      {/* 顶部胶片孔暗化 */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
                      {/* 选中态:左上 LOOK NN */}
                      <div className="absolute top-1.5 left-1.5 cinema-mono text-[8px] tracking-widest opacity-90 text-white/90 bg-black/40 px-1 rounded">
                        LOOK {String(idx + 1).padStart(2, '0')}
                      </div>
                      {isActive && (
                        <div className="absolute top-1.5 right-1.5 cinema-mono text-[8px] tracking-widest font-bold bg-[var(--cinema-amber)] text-black px-1 rounded">
                          ACTIVE
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5 bg-[var(--cinema-surface)]">
                      <div className="cinema-headline text-[11px] truncate">{preset.label}</div>
                      <div className="cinema-mono text-[9px] opacity-55 truncate mt-0.5">{preset.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* v2.12 Phase 1 — 角色锁脸前置(1-3 人)(v10.5.3: 专业模式专属) */}
          {createMode === 'pro' && (
            <>
              <CharacterLockSection
                value={lockedCharacters}
                onChange={setLockedCharacters}
              />
              {/* v9.5.6: 多参元素货架(对标可灵 Elements)— 角色/风格/场景/道具/运镜/音色 → 路由进 cref/sref/构图 */}
              <div className="mt-5">
                <MultimodalRefShelf refs={references} onChange={setReferences} />
              </div>
            </>
          )}

          <FilmStripDivider label="ACT 2 · 镜头规格" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <Eyebrow>Duration · 单镜时长</Eyebrow>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {durationOptions.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`cinema-btn !px-3 !py-1 cinema-mono !text-[11px] ${duration === d ? 'cinema-btn-primary' : ''}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Eyebrow>Aspect · 画幅</Eyebrow>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {aspectOptions.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAspect(a)}
                    className={`cinema-btn !px-3 !py-1 cinema-mono !text-[11px] ${aspect === a ? 'cinema-btn-primary' : ''}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {createMode === 'pro' && <div>
            <Eyebrow>Engine · 视频引擎</Eyebrow>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { id: 'veo', label: 'Veo 3.1', sub: 'cinematic · slow' },
                { id: 'minimax', label: 'Minimax', sub: 'balanced · fast' },
                { id: 'keling', label: '可灵 AI', sub: 'cn voice · ok' },
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVideoProvider(v.id)}
                  className={`cinema-card-hi p-3 transition-all text-left ${
                    videoProvider === v.id
                      ? 'border-[var(--cinema-amber-deep)] bg-[var(--cinema-amber-glow)]'
                      : 'hover:border-[var(--cinema-border-hi)]'
                  }`}
                  style={videoProvider === v.id ? { borderColor: 'var(--cinema-amber)' } : undefined}
                >
                  <div className="cinema-mono text-[10px] opacity-50 mb-0.5 tracking-wider">{v.id.toUpperCase()}</div>
                  <div className="cinema-headline text-sm">{v.label}</div>
                  <div className="cinema-mono text-[9px] mt-0.5 opacity-60">{v.sub}</div>
                </button>
              ))}
            </div>
          </div>}

          {/* v2.14 P1.1 + v2.16 P1.2: 全局默认镜头语言 — 包到 cinema-card-hi 与周围 cards 视觉对齐 */}
          {createMode === 'pro' && <div className="cinema-card-hi p-3">
            <CameraLanguagePicker value={cameraDefault} onChange={setCameraDefault} />
          </div>}

          {/* v12.0.4: 一句指令调剪辑风格 — 喂智能剪辑管线(情绪压缩力度 + 转场软硬) */}
          {createMode === 'pro' && <div className="cinema-card-hi p-3" data-testid="edit-style-picker">
            <div className="cinema-mono text-[10px] opacity-50 mb-1.5 tracking-wider">剪辑风格 · 一句话调节奏</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                { v: '', label: '默认中速' },
                { v: '快节奏燃向', label: '⚡ 快节奏燃向' },
                { v: '慢叙抒情', label: '🌙 慢叙抒情' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setEditStyle(p.v)}
                  className={`cinema-btn !px-3 !py-1 cinema-mono !text-[11px] ${editStyle === p.v ? 'cinema-btn-primary' : ''}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={editStyle}
              onChange={(e) => setEditStyle(e.target.value)}
              placeholder="或自定义:「抖音爆款卡点」「王家卫式留白」(配 LLM key 智能解析)"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-gray-500 focus:outline-none focus:border-[var(--cinema-amber)] transition-colors"
            />
          </div>}

          {/* v2.15 G8 + v2.16 P1.2: 我的风格库 — 同款卡片包装 */}
          {createMode === 'pro' && <div className="cinema-card-hi p-3">
            <StyleLoraLibrary
              currentStyle={style}
              currentCameraDefault={cameraDefault}
              onApply={(applied) => {
                if (applied.stylePreset) setStyle(applied.stylePreset);
                setCameraDefault(applied.cameraDefault);
                showToast({ title: `已应用风格: ${applied.stylePreset || ''}`, type: 'success' });
              }}
            />
          </div>}

          {/* v2.15 G9: 草稿数 — 1=直跑, 2/3=先弹对比卡 */}
          {createMode === 'pro' && <div>
            <Eyebrow>Drafts · 草稿对比</Eyebrow>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setDraftCount(n)}
                  title={n === 1 ? '直接生成 1 个剧本' : `先生成 ${n} 个版本对比, 选完再走完整流程`}
                  className={`cinema-btn !px-3 !py-1 cinema-mono !text-[11px] ${draftCount === n ? 'cinema-btn-primary' : ''}`}
                >
                  {n === 1 ? '直跑 ×1' : `对比 ×${n}`}
                </button>
              ))}
            </div>
            {draftCount > 1 && (
              <div className="cinema-mono text-[10px] opacity-60 mt-1">
                ↑ 点 ROLL 后会先弹 {draftCount} 个剧本草稿对比, 选完再走完整流程 (额外 +30-60s)
              </div>
            )}
          </div>}

          {/* 技术读数面板 — 当前选择的实时反馈 */}
          <div className="cinema-card-hi p-3">
            <Eyebrow>Readout · 设定预览</Eyebrow>
            <div className="mt-2">
              <TechReadout pairs={[
                ['fps', '24'],
                ['format', 'MP4'],
                ['shot', duration],
                ['aspect', aspect],
                ['engine', videoProvider],
                ['camera', cameraDefault || 'auto'],
                ['drafts', String(draftCount)],
                ['est_total', `~${(totalDurationSec).toFixed(0)}s`],
              ]} />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {/* 预览区:Eyebrow + 比例 chip + 时码 chip — 仪表盘信息密度 */}
          <div className="cinema-card-hi p-3">
            <div className="flex items-center justify-between mb-2">
              <Eyebrow>Live Preview · 实时预览</Eyebrow>
              <div className="flex items-center gap-1">
                <AspectChip ratio={aspect} />
                <TimecodeChip seconds={parseFloat(duration.replace(/[^\d.]/g, ''))} variant="amber" />
              </div>
            </div>
            <div className="relative rounded-[2px] overflow-hidden border border-[var(--cinema-border)] bg-black">
              {/* v12.46: 双城之战素材循环预览(autoplay/muted/loop;IMG_PREVIEW_DEFAULT 作 poster 兜底) */}
              <video
                src="/preview/live-preview.mp4"
                poster={IMG_PREVIEW_DEFAULT}
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-[260px] object-cover opacity-90"
              />
              {/* LIVE 指示 */}
              <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] bg-black/50 backdrop-blur-sm pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--cinema-red)] animate-pulse" />
                <span className="cinema-mono text-[8px] tracking-widest text-white/80">LIVE</span>
              </div>
              {/* 安全区裁切线 — 影院软件常见 */}
              <div className="absolute inset-[10%] border border-dashed border-[rgba(245,241,234,0.18)] pointer-events-none" />
            </div>
          </div>

          <FilmStripDivider label="ACT 3 · 灵感库" />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Eyebrow>Inspiration · 灵感库</Eyebrow>
              <span className="cinema-mono text-[10px] opacity-50">{exampleIdeas.length} cues</span>
            </div>
            {exampleIdeas.map((ex, i) => (
              <button
                key={ex.title}
                onClick={() => setIdea(ex.content)}
                className="cinema-card-hi p-3 group flex items-start gap-3 hover:border-[var(--cinema-amber-deep)] transition-colors text-left"
              >
                <div className="cinema-mono text-[10px] opacity-50 w-6 pt-0.5 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <ex.icon className="w-4 h-4 text-[var(--cinema-amber)] mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="cinema-subhead text-sm leading-tight">{ex.title}</div>
                  <div className="text-[11px] opacity-60 line-clamp-2 mt-1 leading-relaxed">{ex.content}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 底部 Logic Pro 风状态栏 ── */}
      <div className="sticky bottom-0 mt-8 -mx-[5vw]">
        <StatusBar
          items={[
            { label: 'STATUS', value: isReady ? 'READY' : 'AWAITING IDEA', status: isReady ? 'green' : 'amber' },
            { label: 'CHARS', value: <span className="cinema-mono">{ideaCharCount}</span> },
            { label: 'TEMPLATE', value: selectedTemplate?.name || '—' },
            { label: 'STYLE', value: style },
            { label: 'SHOT', value: <span className="cinema-mono">{duration}</span> },
            { label: 'ASPECT', value: <span className="cinema-mono">{aspect}</span> },
            { label: 'ENGINE', value: videoProvider.toUpperCase() },
            { label: 'LOCKED', value: <span className="cinema-mono">{lockedCharacters.length}/3</span>, status: lockedCharacters.length > 0 ? 'green' : 'neutral' },
          ]}
        />
      </div>
    </div>
  );
}
