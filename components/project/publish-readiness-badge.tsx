'use client';

/**
 * v9.4.1 — 发布就绪徽章 (PublishReadinessBadge).
 *
 * 自包含:自己 fetch GET /api/projects/[id]/publish-readiness,把成片质量门禁裁决
 * (综合 Vision 每镜质检 + 成片 3 维评分 → evaluateQualityGate) 收成一个
 * pass/warn/block 状态条 + 原因列表。挂在「成片质检」tab 顶部,作为质检的「结论」。
 *
 * 非破坏性:纯展示,不改任何导出/发布行为。block 级硬拦截留后续。
 * refreshKey 变化 → 重新拉取 (质检跑完后由父组件 bump)。
 */

import { useEffect, useState } from 'react';
import { CheckCircle, Warning, XCircle, ShieldCheck } from '@phosphor-icons/react';

interface GateResult {
  level: 'pass' | 'warn' | 'block';
  ready: boolean;
  reasons: string[];
  weakestShots: Array<{ shotNumber: number; score: number }>;
  failedDimensions: string[];
  message: string;
}

const LEVEL_CFG: Record<GateResult['level'], { cls: string; Icon: typeof CheckCircle }> = {
  pass: { cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10', Icon: CheckCircle },
  warn: { cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10', Icon: Warning },
  block: { cls: 'text-rose-400 border-rose-500/40 bg-rose-500/10', Icon: XCircle },
};

export function PublishReadinessBadge({ projectId, refreshKey }: { projectId: string; refreshKey?: number }) {
  const [gate, setGate] = useState<GateResult | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/publish-readiness`);
        const body = await res.json();
        if (alive && res.ok) {
          setGate(body.gate as GateResult);
          // 有任一质量信号 (Vision 质检 OR 成片评分) 才显示;两者皆无交给 panel 空状态提示
          setShow(Boolean(body.hasAudit || body.hasQualityScore));
        }
      } catch {
        /* 静默:徽章是增强信息,失败不打断质检主流程 */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  if (loading || !gate || !show) return null;

  const cfg = LEVEL_CFG[gate.level];
  const { Icon } = cfg;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${cfg.cls}`}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="text-[10px] uppercase tracking-wider opacity-60">发布就绪门禁</span>
        {!gate.ready && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
            未达发布线
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <Icon className="w-4 h-4 shrink-0" weight="fill" />
        <span className="text-xs font-medium">{gate.message}</span>
      </div>
      {gate.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {gate.reasons.slice(0, 4).map((r, i) => (
            <li key={i} className="text-[11px] text-white/60 flex gap-1.5">
              <span className="opacity-40 shrink-0">·</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {gate.weakestShots.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-white/40">最弱镜:</span>
          {gate.weakestShots.map((s) => (
            <span key={s.shotNumber} className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/60">
              #{s.shotNumber} · {s.score}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
