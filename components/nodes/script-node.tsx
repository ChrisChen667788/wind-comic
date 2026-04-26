'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { FileText, Loader2, CheckCircle2, Clock } from 'lucide-react';

function ScriptNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const scriptAsset = d.assets?.find(a => a.type === 'script');
  const scriptData = scriptAsset?.data as any;
  const characters = d.assets?.filter(a => a.type === 'character') || [];

  return (
    <NodeShell status={d.status} color="purple" className="min-w-[340px] max-w-[420px]" agentRole={d.agentRole}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[#E8C547]/20 grid place-items-center">
          <FileText className="w-5 h-5 text-[#FF6B6B]" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            编剧
            <StatusIcon status={d.status} />
          </div>
          <div className="text-[11px] text-gray-400">剧本 · 角色 · 世界观</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {scriptData?.synopsis && (
        <div className="mb-3">
          <div className="text-[11px] text-gray-500 mb-1 font-medium">剧本摘要</div>
          <div className="text-xs text-gray-300 leading-relaxed bg-black/20 rounded-lg p-2.5 max-h-[120px] overflow-y-auto custom-scrollbar cursor-default select-text">
            {scriptData.synopsis}
          </div>
        </div>
      )}

      {characters.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] text-gray-500 mb-1.5 font-medium">角色列表</div>
          <div className="grid grid-cols-2 gap-1.5">
            {characters.slice(0, 6).map((c) => (
              <div key={c.id} className="bg-black/20 rounded-lg px-2.5 py-1.5">
                <div className="text-xs font-medium text-white">{c.name}</div>
                <div className="text-[10px] text-gray-400 line-clamp-1">{c.data?.description || ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {scriptData?.shots?.length > 0 && (
        <div>
          <div className="text-[11px] text-gray-500 mb-1.5 font-medium">分镜描述</div>
          <div className="space-y-1 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar">
            {scriptData.shots.map((shot: any, i: number) => (
              <div key={i} className="bg-black/20 rounded-lg px-2.5 py-2 select-text cursor-default group/shot">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#FF6B6B] font-medium shrink-0">镜头 {shot.shotNumber || i + 1}</span>
                  {shot.emotion && <span className="text-[9px] text-gray-500">{shot.emotion}</span>}
                </div>
                <div className="text-[11px] text-gray-300 mt-0.5 leading-relaxed group-hover/shot:line-clamp-none line-clamp-2 transition-all">
                  {shot.sceneDescription}
                </div>
                {shot.dialogue && <div className="text-[10px] text-amber-400/70 mt-1 italic">&ldquo;{shot.dialogue}&rdquo;</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#E8C547] to-[#D4A830] rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-[#E8C547] !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />
    </NodeShell>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />;
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />;
  if (status === 'pending') return <Clock className="w-3.5 h-3.5 text-gray-500" />;
  return null;
}

export const ScriptNode = memo(ScriptNodeComponent);
