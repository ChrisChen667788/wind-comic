'use client';

import { useProjectWorkspaceStore } from '@/lib/store';
import { useMemo } from 'react';
import { STAGE_WEIGHTS, calculateOverallProgress, type StageProgress } from '@/lib/progress-calculator';

/**
 * 节点 ID → 阶段键映射
 */
const NODE_TO_STAGE: Record<string, keyof typeof STAGE_WEIGHTS> = {
  'node-director': 'DIRECTOR',
  'node-writer': 'WRITER',
  'node-character': 'CHARACTER',
  'node-scene': 'SCENE',
  'node-storyboard': 'STORYBOARD',
  'node-video': 'VIDEO',
  'node-editor': 'EDITOR',
  'node-producer': 'REVIEW',
};

const STAGE_LABELS: Record<keyof typeof STAGE_WEIGHTS, string> = {
  DIRECTOR: '导演分析',
  WRITER: '编剧创作',
  CHARACTER: '角色设计',
  SCENE: '场景设计',
  STORYBOARD: '分镜绘制',
  VIDEO: '视频生成',
  EDITOR: '剪辑合成',
  REVIEW: '导演审核',
};

/**
 * 把每个节点的 {status, progress} 折算成总体进度 + 当前阶段标签。
 * 替代原先"每节点独立进度条"的散乱展示。
 */
export function OverallProgressBar() {
  const nodes = useProjectWorkspaceStore(s => s.nodes);
  const isProducing = useProjectWorkspaceStore(s => s.isProducing);

  const { overall, currentStageLabel, runningStages } = useMemo(() => {
    const stages: StageProgress[] = [];
    let current: string | null = null;

    for (const node of nodes) {
      const stageKey = NODE_TO_STAGE[node.id];
      if (!stageKey) continue;
      const data = node.data as any;
      const status = (data?.status || 'pending') as StageProgress['status'];
      const progress = typeof data?.progress === 'number' ? data.progress : (status === 'completed' ? 100 : 0);
      stages.push({ stage: stageKey, status, progress });
      if (status === 'running' && !current) current = STAGE_LABELS[stageKey];
    }

    const overall = calculateOverallProgress(stages);
    const running = stages.filter(s => s.status === 'running');
    return { overall, currentStageLabel: current, runningStages: running };
  }, [nodes]);

  if (!isProducing && overall === 0) return null;
  if (!isProducing && overall >= 100) return null;

  return (
    <div className="shrink-0 border-b border-white/[0.04] bg-[#0B0B0C]/90 backdrop-blur-xl px-5 py-2">
      <div className="flex items-center gap-3">
        <div className="shrink-0 text-[11px] font-medium text-white/60">
          {currentStageLabel ? `${currentStageLabel} · ` : ''}{overall}%
        </div>
        <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#E8C547] via-[#F4A261] to-[#E76F51] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, overall))}%` }}
          />
        </div>
        {runningStages.length > 1 && (
          <div className="shrink-0 text-[10px] text-white/30">
            并行 {runningStages.length} 阶段
          </div>
        )}
      </div>
    </div>
  );
}
