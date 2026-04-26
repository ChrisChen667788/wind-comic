'use client';

import { memo, useState, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Video, Loader2, CheckCircle2, RefreshCw, Play, Clock, AlertCircle } from 'lucide-react';
import { VideoModal } from '@/components/ui/video-modal';
import { useProjectWorkspaceStore } from '@/lib/store';

// 更宽松的视频URL检测：只要不是明确的图片格式，都尝试作为视频播放
function isLikelyVideoUrl(url: string): boolean {
  if (!url || url.startsWith('data:image')) return false;
  // 本地 API 文件服务（FFmpeg 合成视频）
  if (url.startsWith('/api/serve-file')) return true;
  if (/\.(mp4|webm|mov|m3u8|avi|mkv)([\?#]|$)/i.test(url)) return true;
  if (/oss.*aliyuncs\.com|cos\..+myqcloud\.com|vod\.|video\.|cdn\./i.test(url)) return true;
  if (url.startsWith('http') && !/\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)([\?#]|$)/i.test(url)) return true;
  return false;
}

function VideoNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const videos = d.assets?.filter(a => a.type === 'video') || [];
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ url: string; title: string } | null>(null);
  const [regeneratingShots, setRegeneratingShots] = useState<Set<number>>(new Set());

  const handleVideoClick = (url: string, shotNumber: number) => {
    if (url && !url.startsWith('data:image')) {
      setSelectedVideo({ url, title: `镜头 ${shotNumber}` });
      setModalOpen(true);
    }
  };

  // ═══ 重新生成单个镜头视频 ═══
  const handleRegenerateShot = useCallback(async (shotNumber: number, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止触发视频播放
    if (regeneratingShots.has(shotNumber)) return;

    const s = useProjectWorkspaceStore.getState();
    const projectId = s.currentProject?.id;
    if (!projectId) return;

    setRegeneratingShots(prev => new Set(prev).add(shotNumber));

    // 更新对应资产状态为 generating
    const va = s.assets.find(a => a.type === 'video' && a.shotNumber === shotNumber);
    if (va) {
      s.updateAsset(va.id, { data: { ...va.data, status: 'generating', progress: 0 } });
    }

    try {
      const response = await fetch('/api/regenerate-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, shotNumber }),
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
            if (event.type === 'regenerateComplete') {
              // 更新视频资产
              const st = useProjectWorkspaceStore.getState();
              const videoAsset = st.assets.find(a => a.type === 'video' && a.shotNumber === shotNumber);
              if (videoAsset) {
                st.updateAsset(videoAsset.id, {
                  mediaUrls: [event.data.videoUrl],
                  data: { duration: event.data.duration, status: 'completed' },
                  version: videoAsset.version + 1,
                });
              }
              // 同步刷新节点资产
              const allAssets = useProjectWorkspaceStore.getState().assets;
              st.updateNodeData('node-video', { assets: allAssets.filter(a => a.type === 'video') } as any);
            }
            if (event.type === 'regenerateError') {
              const st = useProjectWorkspaceStore.getState();
              const videoAsset = st.assets.find(a => a.type === 'video' && a.shotNumber === shotNumber);
              if (videoAsset) {
                st.updateAsset(videoAsset.id, { data: { ...videoAsset.data, status: 'error', error: event.data.error } });
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (error) {
      console.error(`[VideoNode] Regenerate shot ${shotNumber} failed:`, error);
      if (va) {
        s.updateAsset(va.id, { data: { ...va.data, status: 'error' } });
      }
    } finally {
      setRegeneratingShots(prev => {
        const next = new Set(prev);
        next.delete(shotNumber);
        return next;
      });
    }
  }, [regeneratingShots]);

  return (
    <NodeShell status={d.status} color="pink" className="min-w-[340px] max-w-[440px]" agentRole={d.agentRole}>
      <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-pink-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-pink-500/10 grid place-items-center">
          <Video className="w-4 h-4 text-pink-400/80" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            视频生成
            {d.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
            {d.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            {d.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <div className="text-[11px] text-gray-400">逐段分镜视频</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {videos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
          {videos.map((v) => {
            const mediaUrl = v.mediaUrls?.[0] || '';
            const hasMedia = !!mediaUrl && !mediaUrl.startsWith('data:image');
            const isVideo = isLikelyVideoUrl(mediaUrl);
            const sn = v.shotNumber || 0;
            const isRegenerating = regeneratingShots.has(sn);
            const isFailed = !hasMedia && d.status === 'completed';
            const isGeneratingStatus = v.data?.status === 'generating' || isRegenerating;

            return (
              <div key={v.id} className={`bg-black/30 border rounded-xl overflow-hidden group relative ${
                isFailed ? 'border-red-500/30' : isRegenerating ? 'border-pink-500/40' : 'border-white/5'
              }`}>
                <div
                  className={`aspect-video bg-white/5 relative ${hasMedia ? 'cursor-pointer' : ''}`}
                  onClick={() => hasMedia && handleVideoClick(mediaUrl, sn)}
                >
                  {isRegenerating ? (
                    <div className="w-full h-full grid place-items-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
                        <span className="text-[9px] text-pink-400">重新生成中...</span>
                      </div>
                    </div>
                  ) : hasMedia ? (
                    <>
                      {isVideo ? (
                        <video
                          src={mediaUrl}
                          muted
                          preload="metadata"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.currentTarget;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              const fallback = document.createElement('div');
                              fallback.className = 'w-full h-full grid place-items-center text-[10px] text-pink-400';
                              fallback.textContent = '点击播放';
                              parent.appendChild(fallback);
                            }
                          }}
                        />
                      ) : (
                        <img src={mediaUrl} alt={`视频${sn}`} className="w-full h-full object-cover" />
                      )}
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                        <Play className="w-6 h-6 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      {isGeneratingStatus ? (
                        <Loader2 className="w-4 h-4 animate-spin text-pink-400" />
                      ) : isFailed ? (
                        <div className="flex flex-col items-center gap-1.5 cursor-pointer" onClick={() => handleRegenerateShot(sn, { stopPropagation: () => {} } as any)}>
                          <AlertCircle className="w-4 h-4 text-red-400" />
                          <span className="text-[9px] text-red-400">生成失败</span>
                          <span className="text-[8px] text-gray-500 hover:text-pink-400 transition-colors">点击重试</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-500">待生成</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="px-2 py-1.5 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-pink-400 font-medium">镜头 {sn || '?'}</span>
                    {v.data?.duration && <span className="text-[9px] text-gray-500 ml-1">{v.data.duration}s</span>}
                  </div>
                  <button
                    onClick={(e) => handleRegenerateShot(sn, e)}
                    disabled={isRegenerating}
                    className={`opacity-0 group-hover:opacity-100 transition-all p-1 rounded-lg ${
                      isRegenerating
                        ? 'bg-pink-500/20 cursor-wait'
                        : 'hover:bg-white/10 active:scale-90'
                    }`}
                    title="重新生成"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'text-pink-400 animate-spin' : 'text-gray-400 hover:text-pink-400'}`} />
                  </button>
                </div>
                {v.version > 1 && (
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-pink-500/80 text-[8px] text-white font-medium">
                    v{v.version}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-xs">
          {d.status === 'pending' ? '等待分镜完成...' : d.status === 'running' ? '视频生成中...' : ''}
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-pink-500 to-rose-400 rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-pink-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      {selectedVideo && (
        <VideoModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          src={selectedVideo.url}
          title={selectedVideo.title}
        />
      )}
    </NodeShell>
  );
}

export const VideoNode = memo(VideoNodeComponent);
