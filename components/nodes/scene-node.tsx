'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Mountain, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { ZoomableImage } from '@/components/ui/image-lightbox';

function SceneNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const scenes = d.assets?.filter(a => a.type === 'scene') || [];

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
            <div key={s.id} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden">
              {s.mediaUrls?.[0] && (
                <ZoomableImage
                  src={s.mediaUrls[0]}
                  alt={s.name}
                  title={`${s.name} — ${s.data?.location || ''}`}
                  className="aspect-video bg-white/5"
                />
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

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-emerald-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />
    </NodeShell>
  );
}

export const SceneNode = memo(SceneNodeComponent);
