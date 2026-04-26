'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreationWorkspace } from '@/components/creation-workspace';
import { useProjectWorkspaceStore } from '@/lib/store';
import { AgentRole, type Project } from '@/types/agents';
import { Wand2, Zap, Sparkles, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';
import { validateIdea, sanitizeInput } from '@/lib/validation';
import { useToast } from '@/components/ui/toast-provider';
import { IMG_PREVIEW_DEFAULT } from '@/lib/placeholder-images';
import { buildInitialNodes, initialEdges } from '@/components/pipeline-canvas';
import { storyTemplates, type StoryTemplate } from '@/lib/story-templates';
import { CharacterLockSection, type LockedCharacter } from '@/components/create/character-lock-section';

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
const aspectOptions = ['16:9', '9:16', '1:1', '2.35:1'];

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
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Vidu-style: pre-fill idea from URL query param (from cases page "用这个创作")
  useEffect(() => {
    const ideaParam = searchParams.get('idea');
    if (ideaParam) {
      setIdea(decodeURIComponent(ideaParam));
    }
  }, [searchParams]);
  const [duration, setDuration] = useState(durationOptions[1]); // 默认5秒
  const [aspect, setAspect] = useState(aspectOptions[0]);
  // v2.12 Phase 1: 多角色锁脸 (1-3 人,前置在创作管线里)
  const [lockedCharacters, setLockedCharacters] = useState<LockedCharacter[]>([]);
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
    }
  };

  const handleStartCreation = async () => {
    const validation = validateIdea(idea);
    if (!validation.valid) {
      showToast({ title: validation.error || '输入无效', type: 'error' });
      return;
    }
    const sanitizedIdea = sanitizeInput(idea);

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
    setIsProducing(true);
    setWorkspaceProject(project);

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
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : '创作失败', type: 'error' });
    } finally {
      setIsProducing(false);
    }
  };

  // ── SSE 事件处理 ──
  const handleSSEEvent = (event: any, projectId: string) => {
    const { type, data } = event;
    const ts = new Date().toISOString();
    const s = useProjectWorkspaceStore.getState();

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

  // ── 创意输入入口 ──
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">创作/生成</h2>
          <p className="text-sm text-[var(--muted)] mt-1">设定文本、镜头、风格与节奏</p>
        </div>
        <button
          onClick={handleStartCreation}
          className={`btn-primary px-5 py-2.5 rounded-xl text-sm transition-opacity ${idea.trim().length < 10 ? 'opacity-60' : ''}`}
          title={idea.trim().length < 10 ? '请先在左侧输入至少 10 个字符的故事创意' : '点击进入创作工坊'}
        >
          进入创作模式
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-[20px] p-5 flex flex-col gap-5">
          <label className="text-[13px] text-[var(--soft)]">
            故事创意 / 完整剧本
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={10} placeholder={"支持两种输入：\n1. 简短创意：暮色城市中的旅人，霓虹雨夜...\n2. 完整剧本：直接粘贴含场景、角色对白、△画面描述的剧本文本"}
              className="mt-2 w-full bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-xl p-3 text-white resize-y text-sm" />
          </label>

          {/* Story Template shelf */}
          <div>
            <span className="text-[13px] text-[var(--soft)] mb-2 block">故事模板</span>
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
              {storyTemplates.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;
                const isExpanded = expandedTemplate === template.id;
                return (
                  <div key={template.id} className="shrink-0 flex flex-col">
                    <button
                      onClick={() => handleSelectTemplate(template)}
                      className={`w-[90px] rounded-xl overflow-hidden border-2 transition-all duration-200 text-left
                        ${isSelected
                          ? 'border-[#E8C547] shadow-[0_0_10px_rgba(232,197,71,0.2)] scale-[1.02]'
                          : 'border-transparent hover:border-white/12'}`}
                    >
                      <div className="h-[54px] bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-2xl">
                        {template.icon}
                      </div>
                      <div className="px-1.5 py-1.5 bg-white/[0.04] text-center">
                        <div className="text-[10px] font-medium text-white truncate">{template.name}</div>
                        <div className="text-[8px] text-gray-500 truncate">{template.description}</div>
                      </div>
                    </button>
                    <button
                      onClick={() => setExpandedTemplate(isExpanded ? null : template.id)}
                      className="mt-0.5 mx-auto text-[8px] text-[var(--soft)] hover:text-white transition-colors flex items-center gap-0.5"
                    >
                      {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                      详情
                    </button>
                  </div>
                );
              })}
            </div>
            {/* Expanded template detail */}
            {expandedTemplate && (() => {
              const t = storyTemplates.find(x => x.id === expandedTemplate);
              if (!t) return null;
              return (
                <div className="mt-2 p-3 bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-xl text-xs text-[var(--soft)] space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{t.icon}</span>
                    <span className="text-white font-medium">{t.name}</span>
                    <span className="text-[10px] opacity-60">/ {t.nameEn}</span>
                  </div>
                  <p className="leading-relaxed text-[11px]">{t.structureHint}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {t.keyElements.map((el) => (
                      <span key={el} className="px-1.5 py-0.5 bg-[rgba(232,197,71,0.1)] border border-[rgba(232,197,71,0.3)] rounded text-[9px] text-[#E8C547]">{el}</span>
                    ))}
                  </div>
                  <div className="text-[10px] opacity-60">情绪曲线：{t.emotionCurve}</div>
                </div>
              );
            })()}
          </div>

          {/* Pika-style art preset shelf */}
          <div>
            <span className="text-[13px] text-[var(--soft)] mb-2 block">画风预设</span>
            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar -mx-1 px-1">
              {stylePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setStyle(preset.en)}
                  className={`shrink-0 min-w-[140px] rounded-xl overflow-hidden border-2 transition-all duration-300 group
                    ${style === preset.en
                      ? 'border-[#E8C547] shadow-[0_0_16px_rgba(232,197,71,0.25)] scale-[1.03]'
                      : 'border-transparent hover:border-white/15 hover:shadow-lg'}`}
                >
                  <div className={`h-[90px] bg-gradient-to-br ${preset.color} flex items-center justify-center text-xl relative overflow-hidden`}>
                    {stylePreviews[preset.id] ? (
                      <img src={stylePreviews[preset.id]} alt={preset.label} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    ) : (
                      <span className="text-3xl transition-transform duration-300 group-hover:scale-110">{preset.icon}</span>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </div>
                  <div className="px-2 py-2 bg-white/[0.04] text-center">
                    <div className="text-[11px] font-medium text-white truncate">{preset.label}</div>
                    <div className="text-[9px] text-gray-500 mt-0.5">{preset.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* v2.12 Phase 1 — 角色锁脸前置(1-3 人) */}
          <CharacterLockSection
            value={lockedCharacters}
            onChange={setLockedCharacters}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-[13px] text-[var(--soft)]">时长</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {durationOptions.map((d) => (<button key={d} onClick={() => setDuration(d)} className={`chip ${duration === d ? 'active' : ''}`}>{d}</button>))}
              </div>
            </div>
          </div>

          <div>
            <span className="text-[13px] text-[var(--soft)]">画幅</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {aspectOptions.map((a) => (<button key={a} onClick={() => setAspect(a)} className={`chip ${aspect === a ? 'active' : ''}`}>{a}</button>))}
            </div>
          </div>

          <div>
            <span className="text-[13px] text-[var(--soft)]">视频引擎</span>
            <div className="grid grid-cols-3 gap-3 mt-2">
              {[
                { id: 'veo', label: 'Veo 3.1', sub: '画质顶级', Icon: Sparkles, color: 'rose' },
                { id: 'minimax', label: 'Minimax', sub: '速度快', Icon: Zap, color: 'amber' },
                { id: 'keling', label: '可灵 AI', sub: '中文好', Icon: Lightbulb, color: 'teal' },
              ].map((v) => (
                <button key={v.id} onClick={() => setVideoProvider(v.id)}
                  className={`p-3 rounded-xl border-2 transition-all text-center ${videoProvider === v.id ? `border-${v.color}-500 bg-${v.color}-500/10` : 'border-[var(--border)] bg-[rgba(255,255,255,0.04)] hover:border-[rgba(255,255,255,0.2)]'}`}>
                  <v.Icon className={`w-5 h-5 mx-auto mb-1 ${videoProvider === v.id ? `text-${v.color}-400` : 'text-[var(--soft)]'}`} />
                  <div className="text-sm font-semibold">{v.label}</div>
                  <div className="text-[11px] text-[var(--soft)]">{v.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-dashed border-[rgba(255,255,255,0.2)] rounded-2xl p-5 text-center text-[var(--soft)] bg-[rgba(255,255,255,0.03)]">
            <div>参考图 / 音频 / 文本脚本</div>
            <div className="text-xs mt-1">拖拽或点击上传</div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-[var(--soft)]">
            <div>输出格式 <strong className="block text-white mt-1">MP4 / 24fps</strong></div>
            <div>渲染队列 <strong className="block text-white mt-1">实时优先</strong></div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="relative rounded-[20px] overflow-hidden border border-[var(--border)] bg-[var(--foreground)]">
            <img src={IMG_PREVIEW_DEFAULT} alt="preview" className="w-full h-[260px] object-cover" />
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-[rgba(0,0,0,0.6)] text-xs">Live Preview</div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-sm text-[var(--soft)]">
              <Lightbulb className="w-4 h-4" /><span>试试这些创意灵感</span>
            </div>
            {exampleIdeas.map((ex) => (
              <button key={ex.title} onClick={() => setIdea(ex.content)}
                className="group flex items-start gap-3 p-3 bg-[rgba(255,255,255,0.04)] border border-[var(--border)] rounded-xl hover:border-[rgba(239,49,159,0.4)] hover:bg-[rgba(255,255,255,0.06)] transition-all text-left">
                <div className="w-9 h-9 bg-[rgba(239,49,159,0.15)] rounded-lg grid place-items-center shrink-0">
                  <ex.icon className="w-4 h-4 text-[var(--primary)]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium group-hover:text-[var(--primary)] transition-colors">{ex.title}</div>
                  <div className="text-xs text-[var(--soft)] line-clamp-2 mt-0.5">{ex.content}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
