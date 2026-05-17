'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { Users, Loader2, CheckCircle2, RefreshCw, Clock, Dna } from 'lucide-react';
import { ZoomableImage } from '@/components/ui/image-lightbox';

function CharacterNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const characters = d.assets?.filter(a => a.type === 'character') || [];

  return (
    <NodeShell status={d.status} color="amber" className="min-w-[380px] max-w-[480px]" agentRole={d.agentRole}>
      <Handle type="target" position={Position.Left} className="!w-4 !h-4 !bg-amber-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-500/10 grid place-items-center">
          <Users className="w-5 h-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            角色设计师
            {d.status === 'running' && <Loader2 className="w-3.5 h-3.5 text-green-400 animate-spin" />}
            {d.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            {d.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-500" />}
          </div>
          <div className="text-[11px] text-gray-400">角色资产 · 多视角设计</div>
        </div>
        {d.status === 'running' && <span className="text-[10px] text-green-400 font-medium">{d.progress}%</span>}
      </div>

      {characters.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {characters.map((c) => {
            // v2.23 P0.3: 拿 DNA 命中率 (8 维 vision 抽取)
            const dna = (c.data as any)?.dna;
            const dnaFilled = dna?.filledCount;
            const dnaTotal = dna?.totalCount;
            const dnaMissing: string[] = dna?.missing || [];
            const dnaStrong = dnaFilled != null && dnaTotal != null && dnaFilled >= dnaTotal * 0.75;
            return (
            <div key={c.id} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden group">
              <div className="px-3 py-2 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5 flex-wrap">
                    {c.name}
                    {/* v2.23 P0.3: DNA 覆盖度 chip */}
                    {dnaFilled != null && dnaTotal != null && (
                      <span
                        title={dnaMissing.length > 0 ? `已抽 ${dnaFilled}/${dnaTotal} 维; 缺: ${dnaMissing.join(', ')}` : `DNA 全部 ${dnaTotal} 维已抽取`}
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] ${
                          dnaStrong
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        <Dna className="w-2.5 h-2.5" />
                        {dnaFilled}/{dnaTotal}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 line-clamp-2 mt-0.5">{c.data?.description || ''}</div>
                </div>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/10 flex-shrink-0">
                  <RefreshCw className="w-3 h-3 text-gray-400" />
                </button>
              </div>
              {c.mediaUrls?.length > 0 && (
                <div className="px-1 pb-1">
                  <ZoomableImage
                    src={c.mediaUrls[0]}
                    alt={`${c.name} 三视图`}
                    title={`${c.name} — 三视图`}
                    className="aspect-[16/9] rounded-lg overflow-hidden bg-white/5"
                  />
                </div>
              )}
            </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-xs">
          {d.status === 'pending' ? '等待编剧完成...' : d.status === 'running' ? '角色设计中...' : ''}
        </div>
      )}

      {d.status === 'running' && (
        <div className="mt-3">
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500" style={{ width: `${d.progress}%` }} />
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} className="!w-4 !h-4 !bg-amber-500 !border-2 !border-[#141414] !rounded-full hover:!scale-125 !transition-transform" />
    </NodeShell>
  );
}

export const CharacterNode = memo(CharacterNodeComponent);
