'use client';

import { memo, useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData, AgentRole } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Scissors, Loader2, CheckCircle2, Clock, Play, Film, Save, RefreshCw, Music, Volume2, ArrowUp, ArrowDown, Trash2, Undo2 } from 'lucide-react';
import { VideoModal } from '@/components/ui/video-modal';
import { useProjectWorkspaceStore } from '@/lib/store';

function EditorNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData & {
    editResult?: {
      timeline: any[];
      totalDuration: number;
      videoCount: number;
      finalVideoUrl?: string;
      musicUrl?: string;
    };
  };

  const editResult = d.editResult;
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVideoSrc, setSelectedVideoSrc] = useState('');
  const [selectedVideoTitle, setSelectedVideoTitle] = useState('');
  const [saved, setSaved] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);

  // ═══ 时间线本地可编辑 state ═══
  // 仅在用户主动改动时赋值;未改动则直接用 editResult.timeline
  const [draftTimeline, setDraftTimeline] = useState<any[] | null>(null);
  const activeTimeline = draftTimeline || editResult?.timeline || [];
  const isDirty = !!draftTimeline;

  // 当 editResult 更新（例如重新剪辑后）重置草稿
  useEffect(() => {
    setDraftTimeline(null);
  }, [editResult?.timeline]);

  const moveShot = (from: number, to: number) => {
    if (!editResult?.timeline) return;
    if (to < 0 || to >= activeTimeline.length) return;
    const next = [...activeTimeline];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraftTimeline(next);
  };
  const removeShot = (idx: number) => {
    if (!editResult?.timeline) return;
    const next = activeTimeline.filter((_, i) => i !== idx);
    setDraftTimeline(next);
  };
  const resetTimeline = () => setDraftTimeline(null);

  const confirmNodeAssets = useProjectWorkspaceStore(s => s.confirmNodeAssets);

  const handlePlayAll = () => {
    // 优先播放 FFmpeg 合成的最终成片
    if (editResult?.finalVideoUrl) {
      setSelectedVideoSrc(editResult.finalVideoUrl);
      setSelectedVideoTitle('成片预览（合成版）');
      setModalOpen(true);
      return;
    }
    // 降级：播放时间线第一个有效视频
    if (editResult?.timeline) {
      const firstValid = editResult.timeline.find((t: any) => t.videoUrl && !t.videoUrl.startsWith('data:'));
      if (firstValid) {
        setSelectedVideoSrc(firstValid.videoUrl);
        setSelectedVideoTitle('成片预览');
        setModalOpen(true);
      }
    }
  };

  const handleShotClick = (videoUrl: string, shotNumber: number) => {
    if (videoUrl && !videoUrl.startsWith('data:')) {
      setSelectedVideoSrc(videoUrl);
      setSelectedVideoTitle(`镜头 ${shotNumber}`);
      setModalOpen(true);
    }
  };

  const handleSaveToProject = async () => {
    // 确认所有剪辑相关资产并保存到项目
    confirmNodeAssets('editor' as any);
    setSaved(true);

    // 如果用户编辑了时间线，把更新后的 editResult 写回 store（供后续播放/导出使用）
    if (draftTimeline && editResult) {
      const newTotal = draftTimeline.reduce((s, x: any) => s + (x.duration || 0), 0);
      const s = useProjectWorkspaceStore.getState();
      s.updateNodeData('node-editor', {
        editResult: { ...editResult, timeline: draftTimeline, videoCount: draftTimeline.length, totalDuration: newTotal },
      } as any);
      setDraftTimeline(null);
    }

    // 调用后端保存API
    try {
      const s = useProjectWorkspaceStore.getState();
      const projectId = s.currentProject?.id;
      if (projectId && editResult) {
        await fetch('/api/assets/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            agentRole: 'editor',
            assets: s.assets.filter(a => ['timeline', 'final_video', 'music', 'video'].includes(a.type)),
            timeline: draftTimeline || editResult.timeline,
          }),
        }).catch(() => {});
      }
    } catch {}
  };

  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleRegenerate = async () => {
    const s = useProjectWorkspaceStore.getState();
    const projectId = s.currentProject?.id;
    if (!projectId || isRegenerating) return;

    setIsRegenerating(true);
    setSaved(false);

    // 更新节点状态为 running
    s.updateNodeData('node-editor', { status: 'running', progress: 10 } as any);

    try {
      const response = await fetch('/api/regenerate-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, stage: 'editor' }),
      });

      if (!response.ok) throw new Error('请求失败');

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
            if (event.type === 'editResult') {
              s.updateNodeData('node-editor', { status: 'completed', progress: 100, editResult: event.data } as any);
            }
            if (event.type === 'heartbeat') {
              const cur = (s.nodes.find(n => n.id === 'node-editor')?.data as any)?.progress || 10;
              if (cur < 90) s.updateNodeData('node-editor', { progress: cur + 5 } as any);
            }
          } catch { /* skip */ }
        }
      }
    } catch (error) {
      console.error('[EditorNode] Regenerate failed:', error);
      s.updateNodeData('node-editor', { status: 'completed', progress: 100 } as any);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handlePlayMusic = () => {
    if (editResult?.musicUrl) {
      const audio = new Audio(editResult.musicUrl);
      if (musicPlaying) {
        audio.pause();
        setMusicPlaying(false);
      } else {
        audio.play().catch(() => {});
        setMusicPlaying(true);
        audio.onended = () => setMusicPlaying(false);
      }
    }
  };

  return (
    <NodeShell status={d.status} color="blue" className="min-w-[300px] max-w-[400px]" agentRole={d.agentRole}>
      <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-blue-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 grid place-items-center">
          <Scissors className="w-4 h-4 text-blue-400/80" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            剪辑师
            {d.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
            {d.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            {d.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <div className="text-[11px] text-gray-400">剪辑 · 配乐 · 合成</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {editResult ? (
        <div>
          {/* 成片播放条 */}
          <div
            className="flex items-center gap-3 mb-3 bg-black/20 rounded-lg p-3 cursor-pointer hover:bg-black/30 transition-colors group"
            onClick={handlePlayAll}
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 grid place-items-center group-hover:bg-blue-500/30 transition-colors">
              <Play className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-white font-medium">{editResult.videoCount} 个镜头</div>
              <div className="text-[10px] text-gray-400">总时长 {editResult.totalDuration}s</div>
            </div>
            <div className="text-[10px] text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
              播放成片
            </div>
          </div>

          {/* 配乐状态 */}
          {editResult.musicUrl && (
            <div
              className="flex items-center gap-2 mb-3 bg-black/20 rounded-lg px-3 py-2 cursor-pointer hover:bg-black/30 transition-colors"
              onClick={handlePlayMusic}
            >
              {musicPlaying ? (
                <Volume2 className="w-3.5 h-3.5 text-green-400 animate-pulse" />
              ) : (
                <Music className="w-3.5 h-3.5 text-purple-400" />
              )}
              <span className="text-[11px] text-gray-300">背景配乐</span>
              <span className="text-[9px] text-gray-500 ml-auto">{musicPlaying ? '播放中' : '点击试听'}</span>
            </div>
          )}

          {/* 镜头时间线 — 可编辑（上下移/删除） */}
          {activeTimeline.length > 0 && (
            <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
              {activeTimeline.map((t: any, i: number) => {
                const activeTotal = activeTimeline.reduce((s: number, x: any) => s + (x.duration || 0), 0) || 1;
                return (
                  <div
                    key={`${t.shotNumber}-${i}`}
                    className="flex items-center gap-1.5 bg-black/20 rounded-lg px-2 py-1.5 text-[11px] group/shot hover:bg-black/30 transition-colors"
                  >
                    <span
                      className="text-blue-400 font-medium w-6 cursor-pointer"
                      onClick={() => handleShotClick(t.videoUrl, t.shotNumber)}
                    >
                      #{t.shotNumber}
                    </span>
                    <div
                      className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
                      onClick={() => handleShotClick(t.videoUrl, t.shotNumber)}
                    >
                      <div className="h-full bg-blue-500/50 rounded-full" style={{ width: `${(t.duration / activeTotal) * 100}%` }} />
                    </div>
                    <span className="text-gray-400 w-7 text-right text-[10px]">{t.duration}s</span>
                    {/* 编辑按钮：仅 hover 时显示 */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/shot:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveShot(i, i - 1); }}
                        disabled={i === 0}
                        className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="上移"
                      >
                        <ArrowUp className="w-2.5 h-2.5 text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveShot(i, i + 1); }}
                        disabled={i === activeTimeline.length - 1}
                        className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="下移"
                      >
                        <ArrowDown className="w-2.5 h-2.5 text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeShot(i); }}
                        className="p-0.5 rounded hover:bg-red-500/20"
                        title="删除"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* 时间线变更提示 */}
          {isDirty && (
            <div className="flex items-center justify-between mt-2 px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-[10px]">
              <span className="text-orange-300">时间线已修改（{activeTimeline.length} 镜头）</span>
              <button
                onClick={resetTimeline}
                className="flex items-center gap-1 text-orange-400 hover:text-orange-300 transition-colors"
              >
                <Undo2 className="w-3 h-3" /> 撤销
              </button>
            </div>
          )}

          {/* ═══ 保存/重新生成 操作栏 ═══ */}
          {d.status === 'completed' && (
            <div className="flex gap-2 mt-3 pt-3 border-t border-white/5">
              <button
                onClick={handleSaveToProject}
                disabled={saved}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  saved
                    ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                    : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                }`}
              >
                {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saved ? '已保存' : '保存到项目'}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  isRegenerating
                    ? 'bg-orange-500/25 text-orange-300 cursor-wait'
                    : 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                {isRegenerating ? '重做中...' : '重新剪辑'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-xs">
          {d.status === 'pending' ? '等待视频生成完成...' : d.status === 'running' ? '剪辑中...' : ''}
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-blue-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <VideoModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        src={selectedVideoSrc}
        title={selectedVideoTitle}
      />
    </NodeShell>
  );
}

export const EditorNode = memo(EditorNodeComponent);
