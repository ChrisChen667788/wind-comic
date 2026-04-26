'use client';

/**
 * ConsistencyPanel (v2.11 #1)
 *
 * 实时显示本次 run 的"角色锁得住 / 镜头接得顺"可感知指标,聚合
 * orchestrator emit 过来的 `consistencyStatus` 事件。
 *
 * 为什么要给用户看这个:
 *   Cameo 和 Keyframes 的价值都是"连续性",但用户肉眼很难在生成过程中
 *   判断"它真的接上了么?"。把后端已经在做的信号直接可视化,让用户当场
 *   感受到差异化 —— 这是国内同类竞品没有的可视反馈。
 *
 * 两条进度条:
 *   - 已锁脸 X/N:说明有几个 shot 把用户上传的 Cameo 脸塞进了 subject_reference
 *   - 已衔接 X/N:说明有几个 shot 从前一条 clip 的末帧做视觉锚定
 *
 * 数据源 zustand.useAgentStore,在 /api/create-stream 的 SSE 回调里
 * 逐条 addConsistencyEvent(ev) 入栈。
 */

import { useMemo } from 'react';
import { UserCircle2, Link2, Sparkles, Anchor } from 'lucide-react';
import { useAgentStore, type ConsistencyEvent } from '@/lib/store';

interface Props {
  /** 可选:当 totalShots 未被上报时,父组件传进来的估算值(例如从已生成的 storyboard 数来) */
  fallbackTotal?: number;
  /** 紧凑模式:用于侧边栏窄版展示 */
  compact?: boolean;
}

export function ConsistencyPanel({ fallbackTotal = 0, compact = false }: Props) {
  const events = useAgentStore((s) => s.consistencyEvents);
  const totalShots = useAgentStore((s) => s.totalShots);

  const { cameoShots, keyframeShots, globalAnchorShots, total } = useMemo(() => computeStats(events, totalShots, fallbackTotal), [events, totalShots, fallbackTotal]);

  // 一条事件都没有 —— 可能 Cameo 没锁 + 第一个 shot 还没跑完
  if (events.length === 0) {
    return (
      <div className={`${compact ? 'p-3' : 'p-4'} bg-white/5 border border-white/10 rounded-xl`}>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Sparkles className="w-3.5 h-3.5" />
          连续性检测将在镜头生成中逐条上报…
        </div>
      </div>
    );
  }

  const cameoPct = total > 0 ? Math.round((cameoShots / total) * 100) : 0;
  const keyframePct = total > 0 ? Math.round((keyframeShots / total) * 100) : 0;

  return (
    <div className={`${compact ? 'p-3' : 'p-4'} bg-gradient-to-br from-[#E8C547]/5 to-white/5 border border-[#E8C547]/20 rounded-xl space-y-3`}>
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[#E8C547]" />
        <h4 className="text-sm font-semibold text-[#E8C547]">连续性监控</h4>
      </div>

      {/* Cameo 锁脸 */}
      <StatRow
        icon={<UserCircle2 className="w-3.5 h-3.5" />}
        label="主角脸锁定"
        value={cameoShots}
        total={total}
        pct={cameoPct}
        color="from-[#E8C547] to-[#D4A830]"
        tooltip={cameoShots === 0 ? '本次未使用 Cameo(可在项目详情页上传主角脸锁死全片 IP)' : `${cameoShots} 个镜头使用了同一张主角脸参考`}
      />

      {/* Keyframe 衔接 */}
      <StatRow
        icon={<Link2 className="w-3.5 h-3.5" />}
        label="镜头间衔接"
        value={keyframeShots}
        total={Math.max(1, total - 1)}  // 第一个 shot 没有前帧,分母扣 1
        pct={total > 1 ? Math.round((keyframeShots / (total - 1)) * 100) : 0}
        color="from-blue-400 to-cyan-400"
        tooltip={`${keyframeShots} 个镜头从上一条 clip 末帧做了视觉锚定`}
      />

      {/* v2.11 #3 智能插帧:全局风格锚点 */}
      <StatRow
        icon={<Anchor className="w-3.5 h-3.5" />}
        label="全局风格锚"
        value={globalAnchorShots}
        total={Math.max(1, total - 1)}
        pct={total > 1 ? Math.round((globalAnchorShots / (total - 1)) * 100) : 0}
        color="from-purple-400 to-pink-400"
        tooltip={`${globalAnchorShots} 个镜头引用了全局风格锚点,抗链式漂移`}
      />
    </div>
  );
}

/** 把事件列表折算成统计 */
function computeStats(events: ConsistencyEvent[], totalShots: number, fallbackTotal: number) {
  const cameoSet = new Set<number>();
  const keyframeSet = new Set<number>();
  const globalAnchorSet = new Set<number>();
  let maxShot = 0;
  for (const e of events) {
    maxShot = Math.max(maxShot, e.shotNumber);
    if (e.type === 'cameoApplied') cameoSet.add(e.shotNumber);
    if (e.type === 'keyframeChained') keyframeSet.add(e.shotNumber);
    if (e.type === 'globalAnchorApplied') globalAnchorSet.add(e.shotNumber);
  }
  // total 优先用 orchestrator 上报,没报就用观察到的最大 shot 号,再 fallback 到 estimate
  const total = totalShots || maxShot || fallbackTotal || 0;
  return {
    cameoShots: cameoSet.size,
    keyframeShots: keyframeSet.size,
    globalAnchorShots: globalAnchorSet.size,
    total,
  };
}

function StatRow(props: {
  icon: React.ReactNode;
  label: string;
  value: number;
  total: number;
  pct: number;
  color: string;
  tooltip?: string;
}) {
  return (
    <div title={props.tooltip}>
      <div className="flex items-center justify-between text-xs mb-1">
        <div className="flex items-center gap-1.5 text-gray-300">
          {props.icon}
          <span>{props.label}</span>
        </div>
        <span className="font-mono text-gray-400">
          {props.value}<span className="text-gray-600">/{props.total || '—'}</span>
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${props.color} transition-all duration-500`}
          style={{ width: `${props.pct}%` }}
        />
      </div>
    </div>
  );
}
