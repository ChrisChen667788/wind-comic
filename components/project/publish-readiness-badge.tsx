'use client';

/**
 * v9.4.1 / v9.7.14 — 发布就绪徽章 (PublishReadinessBadge).
 *
 * 自包含:fetch GET /api/projects/[id]/publish-readiness,把成片质量门禁裁决收成
 * pass/warn/block 状态条 + 原因列表 + **四维质量明细**(画面对剧本 / 一致性 / 口型可对齐 / 实测口型对齐)。
 * 挂在「成片质检」tab 顶部。非破坏性:纯展示。refreshKey 变化 → 重新拉取。
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
interface ReadinessBody {
  gate: GateResult;
  hasAudit?: boolean;
  hasQualityScore?: boolean;
  hasLipSync?: boolean;
  lipSync?: { lines: number; readiness: number; level: string } | null;
  hasLipAudioAlign?: boolean;
  lipAudioAlign?: { measuredShots: number; weakShots: number; avgScore: number } | null;
}

const LEVEL_CFG: Record<GateResult['level'], { cls: string; Icon: typeof CheckCircle }> = {
  pass: { cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10', Icon: CheckCircle },
  warn: { cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10', Icon: Warning },
  block: { cls: 'text-rose-400 border-rose-500/40 bg-rose-500/10', Icon: XCircle },
};

type DimStatus = 'ok' | 'weak' | 'na';
const DIM_DOT: Record<DimStatus, string> = { ok: 'bg-emerald-400', weak: 'bg-amber-400', na: 'bg-white/20' };
const DIM_TEXT: Record<DimStatus, string> = { ok: '达标', weak: '偏弱', na: '未测' };

function buildDims(b: ReadinessBody): Array<{ label: string; status: DimStatus; detail?: string }> {
  const fd = b.gate.failedDimensions || [];
  const ls = b.lipSync; const la = b.lipAudioAlign;
  return [
    {
      label: '画面对剧本',
      status: !b.hasAudit ? 'na' : fd.includes('画面对剧本') ? 'weak' : 'ok',
    },
    {
      label: '一致性',
      status: !b.hasQualityScore ? 'na' : fd.some((d) => /连贯|光影|脸|成片综合/.test(d)) ? 'weak' : 'ok',
    },
    {
      label: '口型可对齐',
      status: !ls || ls.lines === 0 ? 'na' : ls.level === 'pass' ? 'ok' : 'weak',
      detail: ls && ls.lines > 0 ? `就绪 ${ls.readiness}` : undefined,
    },
    {
      label: '实测口型对齐',
      status: !la || la.measuredShots === 0 ? 'na' : (la.weakShots > 0 || la.avgScore < 75) ? 'weak' : 'ok',
      detail: la && la.measuredShots > 0 ? `均分 ${la.avgScore}` : undefined,
    },
  ];
}

export function PublishReadinessBadge({ projectId, refreshKey }: { projectId: string; refreshKey?: number }) {
  const [body, setBody] = useState<ReadinessBody | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/publish-readiness`);
        const b = await res.json();
        if (alive && res.ok) {
          setBody(b as ReadinessBody);
          setShow(Boolean(b.hasAudit || b.hasQualityScore || b.hasLipSync || b.hasLipAudioAlign));
        }
      } catch { /* 静默:徽章是增强信息 */ } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  if (loading || !body || !show) return null;
  const gate = body.gate;
  const cfg = LEVEL_CFG[gate.level];
  const { Icon } = cfg;
  const dims = buildDims(body);

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${cfg.cls}`}>
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="text-[10px] uppercase tracking-wider opacity-60">发布就绪门禁</span>
        {!gate.ready && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">未达发布线</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <Icon className="w-4 h-4 shrink-0" weight="fill" />
        <span className="text-xs font-medium">{gate.message}</span>
      </div>

      {/* v9.7.14 四维质量明细 */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {dims.map((d) => (
          <div key={d.label} className="flex items-center gap-1.5 text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DIM_DOT[d.status]}`} />
            <span className="text-white/60">{d.label}</span>
            <span className="ml-auto text-white/40 tabular-nums">{d.detail || DIM_TEXT[d.status]}</span>
          </div>
        ))}
      </div>

      {gate.reasons.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {gate.reasons.slice(0, 4).map((r, i) => (
            <li key={i} className="text-[11px] text-white/60 flex gap-1.5"><span className="opacity-40 shrink-0">·</span><span>{r}</span></li>
          ))}
        </ul>
      )}
      {gate.weakestShots.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-white/40">最弱镜:</span>
          {gate.weakestShots.map((s) => (
            <span key={s.shotNumber} className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/60">#{s.shotNumber} · {s.score}</span>
          ))}
        </div>
      )}
    </div>
  );
}
