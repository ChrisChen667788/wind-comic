'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNodeData } from '@/types/agents';
import { NodeShell } from './node-shell';
import { FilmStrip as Film, CircleNotch as Loader2, CheckCircle as CheckCircle2, Clock, Camera, Sun, Palette, ArrowRight as MoveRight } from '@phosphor-icons/react';

// Runway-style camera icon mapping
const CAMERA_ICONS: Record<string, string> = {
  '远景': '🔭', '全景': '🏔️', '中景': '🎥', '近景': '👤', '特写': '🔍',
  '大特写': '🔬', '俯拍': '⬇️', '仰拍': '⬆️', '平拍': '➡️', '跟拍': '🏃',
};

function StoryboardNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PipelineNodeData;
  const storyboards = d.assets?.filter(a => a.type === 'storyboard') || [];
  // v12.10.0(#2):逐秒 beat 来自剧本 shot(Writer 已产出),按 shotNumber 关联到分镜卡,
  // 让分镜「精确到第几秒是什么内容」可见。
  const scriptShots: any[] = (d.assets?.find(a => a.type === 'script')?.data as any)?.shots || [];
  const beatsByShot = new Map<number, any[]>(
    scriptShots.filter(s => Array.isArray(s?.beats) && s.beats.length).map(s => [s.shotNumber, s.beats]),
  );

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

                {/* v12.10.0(#2):逐秒 beat sheet —— 精确到第几秒是什么内容 */}
                {beatsByShot.get(sb.shotNumber as number)?.length ? (
                  <div className="mt-2 space-y-1 border-l-2 border-cyan-500/30 pl-2">
                    {beatsByShot.get(sb.shotNumber as number)!.map((b: any, bi: number) => (
                      <div key={bi} className="flex gap-1.5 text-[10px] leading-snug">
                        <span className="shrink-0 font-mono text-cyan-400/90 tabular-nums">{b.ts}</span>
                        <span className="text-gray-300 min-w-0">
                          {/* v12.11.0:谁/在哪 前缀 */}
                          {Array.isArray(b.characters) && b.characters.length ? <span className="text-emerald-300/80">👤{b.characters.join('/')} </span> : null}
                          {b.scene ? <span className="text-cyan-200/70">🏞{b.scene} </span> : null}
                          {b.action}
                          {b.camera ? <span className="text-gray-500"> · 🎥{b.camera}</span> : null}
                          {/* v12.11.0:微表情 / 慢镜 / 氛围 */}
                          {b.microExpression ? <span className="text-violet-300/80"> · 😶{b.microExpression}</span> : null}
                          {b.speedRamp ? <span className="text-amber-300/80"> · ⏱{b.speedRamp}</span> : null}
                          {b.mood ? <span className="text-rose-300/70"> · {b.mood}</span> : null}
                          {b.dialogue ? <span className="text-cyan-300/80"> · 💬{b.dialogue}</span> : null}
                        </span>
                      </div>
                    ))}
                    {/* v12.11.0:镜头级 Must-Show 目标物 */}
                    {(() => {
                      const ms = scriptShots.find((s) => s.shotNumber === sb.shotNumber)?.mustShow;
                      return Array.isArray(ms) && ms.length ? (
                        <div className="flex gap-1.5 text-[10px] leading-snug pt-0.5">
                          <span className="shrink-0 text-yellow-400/90">必现</span>
                          <span className="text-yellow-200/70 min-w-0">{ms.join(' · ')}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                ) : null}

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
