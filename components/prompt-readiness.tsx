'use client';

/**
 * v6.1.3 — 生成前就绪度预览. 实时(随创意/参考变化)算一个就绪度分 + 检查清单,
 * 让用户按"开始创作"前先补齐. 纯逻辑在 lib/prompt-readiness (已单测), 这里组装数据 + 展示.
 * 复用: lib/prompt-ide compilePrompt (解析 @引用) + cameo-vision 试穿评分 (cameoScore 透传).
 */

import { useEffect, useState } from 'react';
import { CheckCircle as CheckCircle2, Circle, Gauge } from '@phosphor-icons/react';
import { compilePrompt, type MentionableAsset } from '@/lib/prompt-ide';
import { summarizeRefs, type ReferenceAsset } from '@/lib/multimodal-ref';
import { assessPromptReadiness } from '@/lib/prompt-readiness';

export function PromptReadiness({
  idea,
  hasFace,
  cameoScore,
  refs,
}: {
  idea: string;
  hasFace: boolean;
  cameoScore?: number | null;
  refs: ReferenceAsset[];
}) {
  const [assets, setAssets] = useState<MentionableAsset[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/prompt-ide/assets')
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d?.assets)) setAssets(d.assets); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!(idea || '').trim()) return null; // 空创意不显示

  const compiled = compilePrompt(idea, assets);
  const report = assessPromptReadiness({
    compiledPrompt: compiled.prompt,
    usedKinds: compiled.used.map((a) => a.kind),
    unresolvedCount: compiled.unresolved.length,
    hasFace,
    refs: summarizeRefs(refs),
    cameoScore: cameoScore ?? null,
  });

  const color = report.level === 'high' ? 'text-emerald-400' : report.level === 'mid' ? 'text-amber-400' : 'text-rose-400';
  const ring = report.level === 'high' ? 'border-emerald-500/40' : report.level === 'mid' ? 'border-amber-500/40' : 'border-rose-500/40';
  const blurb = report.level === 'high' ? '已就绪,可以开始创作' : report.level === 'mid' ? '基本就绪,补齐下面几项更稳' : '建议先补齐关键项再生成';

  return (
    <div className={`rounded-2xl border ${ring} bg-white/[0.03] p-4`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-12 h-12 rounded-full border-2 ${ring} flex items-center justify-center text-lg ${color} font-bold shrink-0`}>
          {report.score}
        </div>
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-1.5"><Gauge className="w-4 h-4" />生成就绪度</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{blurb}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {report.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-[12px]">
            {c.ok
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
              : <Circle className="w-3.5 h-3.5 text-gray-600 mt-0.5 shrink-0" />}
            <span className={c.ok ? 'text-gray-300' : 'text-gray-400'}>
              {c.label}
              {!c.ok && c.hint ? <span className="text-gray-500"> — {c.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
