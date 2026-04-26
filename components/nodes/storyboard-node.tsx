'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Film, Loader2, CheckCircle2, Clock, Camera, Sun, Palette, MoveRight } from 'lucide-react';

// Runway-style camera icon mapping
const CAMERA_ICONS: Record<string, string> = {
  '远景': '🔭', '全景': '🏔️', '中景': '🎥', '近景': '👤', '特写': '🔍',
  '大特写': '🔬', '俯拍': '⬇️', '仰拍': '⬆️', '平拍': '➡️', '跟拍': '🏃',
};

function StoryboardNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const storyboards = d.assets?.filter(a => a.type === 'storyboard') || [];

  return (
    <NodeShell status={d.status} color="cyan" className="min-w-[360px] max-w-[460px]" agentRole={d.agentRole}>
      <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-cyan-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/20 grid place-items-center">
          <Film className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            分镜师
            {d.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
            {d.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            {d.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <div className="text-[11px] text-gray-400">分镜脚本 · 镜头语言设计</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {storyboards.length > 0 ? (
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 custom-scrollbar">
          {storyboards.map((sb) => {
            const planData = sb.data?.planData || {};
            const cameraIcon = CAMERA_ICONS[planData.cameraAngle] || '🎥';

            return (
              <div key={sb.id} className="bg-black/20 rounded-xl p-2.5 group border border-transparent hover:border-cyan-500/20 transition-all">
                {/* Shot header with camera visualization */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md">
                    S{sb.shotNumber || '?'}
                  </span>
                  {/* Runway-style camera control chips */}
                  {planData.cameraAngle && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-cyan-300/80 bg-cyan-500/10 px-1.5 py-0.5 rounded-md">
                      <Camera className="w-2.5 h-2.5" />{cameraIcon} {planData.cameraAngle}
                    </span>
                  )}
                  {planData.lighting && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-amber-300/80 bg-amber-500/10 px-1.5 py-0.5 rounded-md">
                      <Sun className="w-2.5 h-2.5" />{planData.lighting}
                    </span>
                  )}
                  {planData.colorTone && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-pink-300/80 bg-[#D4A830]/08 px-1.5 py-0.5 rounded-md">
                      <Palette className="w-2.5 h-2.5" />{planData.colorTone}
                    </span>
                  )}
                </div>

                {/* Text description */}
                <div className="text-[11px] text-gray-300 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all">
                  {sb.data?.description || sb.name}
                </div>

                {/* Transition note */}
                {planData.transitionNote && (
                  <div className="flex items-center gap-1 mt-1.5 text-[9px] text-gray-500">
                    <MoveRight className="w-2.5 h-2.5" />
                    <span>{planData.transitionNote}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-xs">
          {d.status === 'pending' ? '等待场景设计完成...' : d.status === 'running' ? '分镜脚本编写中...' : ''}
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-cyan-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />
    </NodeShell>
  );
}

export const StoryboardNode = memo(StoryboardNodeComponent);
