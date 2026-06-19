'use client';

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Mountains as Mountain, CircleNotch as Loader2, CheckCircle as CheckCircle2, Clock, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { ZoomableImage } from '@/components/ui/image-lightbox';
import { useProjectWorkspaceStore } from '@/lib/store';

function SceneNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const scenes = d.assets?.filter(a => a.type === 'scene') || [];
  // v12.10.0(#1):单张场景图重生
  const [regenBusy, setRegenBusy] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);

  const regenImage = async (sceneName: string, assetId: string, projectId: string) => {
    if (regenBusy) return;
    setRegenBusy(sceneName); setRegenError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/regenerate-asset-image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scene', name: sceneName }),
      });
      const body = await res.json();
      if (!res.ok || !body.imageUrl) { setRegenError(body?.error || `失败 ${res.status}`); return; }
      useProjectWorkspaceStore.getState().updateAsset(assetId, { mediaUrls: [body.imageUrl] });
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : '请求失败');
    } finally { setRegenBusy(null); }
  };

  return (
    <NodeShell status={d.status} color="emerald" className="min-w-[320px] max-w-[400px]" agentRole={d.agentRole}>
      <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-emerald-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 grid place-items-center">
          <Mountain className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            场景设计师
            {d.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
            {d.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            {d.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <div className="text-[11px] text-gray-400">场景概念图</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {scenes.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {scenes.map((s) => (
            <div key={s.id} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden group relative">
              {s.mediaUrls?.[0] && (
                <ZoomableImage
                  src={s.mediaUrls[0]}
                  alt={s.name}
                  title={`${s.name} — ${s.data?.location || ''}`}
                  className="aspect-video bg-white/5"
                />
              )}
              {/* v12.10.0(#1):单张场景图重生 */}
              {(s as any).projectId && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); regenImage(s.name, s.id, (s as any).projectId); }}
                  disabled={regenBusy !== null}
                  title="重新生成这张场景图(只换这一张)"
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg bg-black/50 hover:bg-black/70 disabled:opacity-30">
                  {regenBusy === s.name ? <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" /> : <RefreshCw className="w-3 h-3 text-white/80" />}
                </button>
              )}
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-medium text-white">{s.name}</div>
                <div className="text-[10px] text-gray-400 line-clamp-1">{s.data?.location || ''}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-xs">
          {d.status === 'pending' ? '等待角色设计完成...' : d.status === 'running' ? '场景设计中...' : ''}
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}
      {regenError && (
        <div className="mt-2 text-[10px] text-red-300/80 bg-red-900/20 border border-red-500/20 rounded px-2 py-1">重生失败: {regenError}</div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-emerald-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />
    </NodeShell>
  );
}

export const SceneNode = memo(SceneNodeComponent);
