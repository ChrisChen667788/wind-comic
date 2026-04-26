'use client';

import { useState, useEffect, useMemo } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AgentChat } from '@/components/agent-chat';
import { PipelineCanvas, buildInitialNodes, initialEdges } from '@/components/pipeline-canvas';
import { Mascot } from '@/components/mascot';
import { useProjectWorkspaceStore } from '@/lib/store';
import { type Project } from '@/types/agents';
import { PanelLeftClose, PanelLeftOpen, MoreHorizontal, Share2, Play, Film, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { VideoModal } from '@/components/ui/video-modal';
import { OverallProgressBar } from '@/components/ui/overall-progress';
import { WorkspaceHotkeys } from '@/components/workspace-hotkeys';

interface Props {
  project: Project;
}

export function CreationWorkspace({ project }: Props) {
  // 移动端默认收起 chat 面板
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 768px)').matches;
  });
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [selectedVideoSrc, setSelectedVideoSrc] = useState('');
  const [selectedVideoTitle, setSelectedVideoTitle] = useState('');
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const { setCurrentProject, setNodes, setEdges, assets, isProducing } = useProjectWorkspaceStore();

  useEffect(() => {
    setCurrentProject(project);
    const nodes = buildInitialNodes(assets);
    setNodes(nodes);
    setEdges(initialEdges);
  }, [project.id]);

  const mascotMood = isProducing ? 'working' : 'completed';

  // 时间线镜头数据
  const timelineShots = useMemo(() => {
    const videoAssets = assets.filter(a => a.type === 'video' && a.mediaUrls?.[0]);
    const storyboardAssets = assets.filter(a => a.type === 'storyboard');
    return videoAssets.map(v => {
      const sb = storyboardAssets.find(s => s.shotNumber === v.shotNumber);
      return {
        shotNumber: v.shotNumber || 0,
        videoUrl: v.mediaUrls?.[0] || '',
        description: sb?.data?.description || v.name || `镜头 ${v.shotNumber}`,
        duration: v.data?.duration || 8,
        status: v.data?.status || 'pending',
        cameraAngle: sb?.data?.planData?.cameraAngle || '',
      };
    }).sort((a, b) => a.shotNumber - b.shotNumber);
  }, [assets]);

  const handleShotPlay = (videoUrl: string, shotNumber: number) => {
    if (videoUrl && !videoUrl.startsWith('data:')) {
      setSelectedVideoSrc(videoUrl);
      setSelectedVideoTitle(`镜头 ${shotNumber}`);
      setVideoModalOpen(true);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <WorkspaceHotkeys />
      {/* 顶部工具栏 */}
      <div className="shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-white/[0.04] bg-[#0A0A0B]/80 backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/40 hover:text-white/70"
            title={chatOpen ? '收起对话面板' : '展开对话面板'}
          >
            {chatOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          <div>
            <h1 className="text-sm font-medium text-white/90 tracking-tight">{project.title || '未命名项目'}</h1>
            <div className="text-[10px] text-white/25 font-medium tracking-wider uppercase">创作中</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Mascot mood={mascotMood} />
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-[12px] text-white/50 hover:text-white/70 transition-all border border-transparent hover:border-white/[0.06]">
            <Share2 className="w-3 h-3" />
            分享
          </button>
          <button className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors text-white/30 hover:text-white/60">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 总体进度条 — 替代每节点独立条,展示阶段+整体 */}
      <OverallProgressBar />

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {chatOpen && (
          <div className="w-full md:w-[340px] shrink-0 border-r border-white/[0.04] overflow-hidden bg-[#0C0C0C]/50 absolute md:relative inset-y-0 left-0 z-30 md:z-0">
            <AgentChat />
          </div>
        )}
        <div className="flex-1 relative flex flex-col">
          <div className="flex-1">
            <ReactFlowProvider>
              <PipelineCanvas />
            </ReactFlowProvider>
          </div>

          {/* ═══ 时间线面板 ═══ */}
          {timelineShots.length > 0 && (
            <div className={`shrink-0 border-t border-white/[0.04] bg-[#0C0C0C]/95 backdrop-blur-xl transition-all duration-300 ${timelineOpen ? 'max-h-[130px]' : 'max-h-[34px]'} overflow-hidden`}>
              {/* Timeline header */}
              <button
                onClick={() => setTimelineOpen(!timelineOpen)}
                className="w-full flex items-center justify-between px-4 py-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Film className="w-3 h-3 text-[#E8C547]/60" />
                  <span className="font-medium">时间线</span>
                  <span className="text-[10px] text-white/20">
                    {timelineShots.length} 镜头 · {timelineShots.reduce((s, t) => s + t.duration, 0)}s
                  </span>
                </div>
                {timelineOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>

              {/* Timeline strip */}
              {timelineOpen && (
                <div className="px-4 pb-2.5 overflow-x-auto custom-scrollbar">
                  <div className="flex gap-1.5 min-w-min">
                    {timelineShots.map((shot, i) => {
                      const isVideoReady = shot.videoUrl && !shot.videoUrl.startsWith('data:');
                      return (
                        <div
                          key={shot.shotNumber}
                          className={`shrink-0 w-[130px] rounded-lg overflow-hidden border transition-all cursor-pointer group
                            ${isVideoReady
                              ? 'border-white/[0.06] hover:border-white/15 hover:shadow-lg'
                              : 'border-white/[0.03] opacity-40'}`}
                          onClick={() => isVideoReady && handleShotPlay(shot.videoUrl, shot.shotNumber)}
                        >
                          <div className="flex items-center justify-between px-2 py-1 bg-white/[0.02]">
                            <span className="text-[9px] font-bold text-[#E8C547]/70">S{shot.shotNumber}</span>
                            <span className="text-[8px] text-white/20">{shot.duration}s</span>
                          </div>
                          <div className="h-[55px] bg-black/30 relative flex items-center justify-center">
                            {isVideoReady ? (
                              <>
                                <video src={shot.videoUrl} muted preload="metadata" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                                  <Play className="w-4 h-4 text-white/80" />
                                </div>
                              </>
                            ) : (
                              <div className="text-[8px] text-white/20">
                                {isProducing ? '生成中...' : '待生成'}
                              </div>
                            )}
                          </div>
                          <div className="px-2 py-1 bg-white/[0.015]">
                            <div className="text-[8px] text-white/30 truncate">{shot.description.slice(0, 18)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Video playback modal */}
      <VideoModal
        open={videoModalOpen}
        onOpenChange={setVideoModalOpen}
        src={selectedVideoSrc}
        title={selectedVideoTitle}
      />
    </div>
  );
}
