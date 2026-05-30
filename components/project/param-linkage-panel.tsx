'use client';

/**
 * components/project/param-linkage-panel (v8.2) — 参数联动 / JSON↔可视化同步
 * (对标 CineMatrix「Parameter Linkage / JSON to Visual Sync」)
 *
 * 把项目结构化参数 (每镜 ShotSpec + 连贯性 + 格式) 以 JSON 呈现 + 编辑, 校验后一键写回 (Sync Now)。
 * 顶部联动示意图: 时间线 ↔ 分镜卡 ↔ 参数, 实时同步 + 上次同步时间。
 */

import { useMemo, useState } from 'react';
import { BracketsCurly as Braces, ArrowsClockwise as RefreshCw, Check, WarningCircle as AlertCircle, CircleNotch as Loader2, GitDiff as GitCompareArrows } from '@phosphor-icons/react';
import {
  buildParamDoc, paramDocToJson, parseParamDoc, diffParamDoc, type ParamDoc,
} from '@/lib/param-linkage';

export function ParamLinkagePanel({ projectId, shots = [], continuity, format, onSynced }: {
  projectId: string;
  shots?: { shotNumber: number; cameraSpec?: any }[];
  continuity?: any;
  format?: any;
  onSynced?: (doc: ParamDoc) => void;
}) {
  const initial = useMemo(() => buildParamDoc({ shots, continuity, format }), [shots, continuity, format]);
  const [baseDoc, setBaseDoc] = useState<ParamDoc>(initial);
  const [text, setText] = useState<string>(() => paramDocToJson(initial));
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string>('从未');
  const [msg, setMsg] = useState('');

  const parsed = useMemo(() => parseParamDoc(text), [text]);
  const diff = useMemo(() => (parsed.ok && parsed.doc ? diffParamDoc(baseDoc, parsed.doc) : null), [parsed, baseDoc]);

  async function sync() {
    if (!parsed.ok || !parsed.doc) return;
    setSyncing(true); setMsg('');
    try {
      const r = await fetch(`/api/projects/${projectId}/param-sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc: parsed.doc }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || `同步失败 (${r.status})`); }
      else {
        setBaseDoc(parsed.doc);
        setText(paramDocToJson(parsed.doc));
        setLastSync(new Date().toLocaleTimeString());
        setMsg(`已同步 ${j.syncedShots ?? 0} 镜 + 连贯性 + 格式`);
        onSynced?.(parsed.doc);
        setTimeout(() => setMsg(''), 4000);
      }
    } catch (e: any) { setMsg(e?.message || '网络错误'); }
    finally { setSyncing(false); }
  }

  const dirty = !!diff && diff.total > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 联动示意图 */}
      <div className="cinema-card !p-4">
        <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><GitCompareArrows size={13} className="text-[var(--primary)]" /> 参数联动 · PARAMETER LINKAGE</div>
        <div className="flex items-center justify-center gap-3 py-2">
          {['时间线', '分镜卡', '参数'].map((n, i) => (
            <div key={n} className="flex items-center gap-3">
              <div className="rounded-lg border border-[var(--border)] px-3 py-2 text-center min-w-[72px]">
                <div className="text-[11px] font-semibold">{n}</div>
                <div className="cinema-mono text-[9px] opacity-50">{['TIMELINE', 'SHOT CARD', 'PARAMS'][i]}</div>
              </div>
              {i < 2 && <span className="text-[var(--primary)] text-lg leading-none">⇌</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${dirty ? 'bg-[var(--secondary)]' : 'bg-[var(--accent-green)]'} ${dirty ? '' : 'animate-pulse'}`} />
          <span className="cinema-mono text-[10px] opacity-70">{dirty ? '有未同步改动' : '实时同步 · 已一致'} · 上次同步 {lastSync}</span>
        </div>
      </div>

      {/* JSON 编辑 + 同步 */}
      <div className="cinema-card !p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="cinema-eyebrow flex items-center gap-1.5"><Braces size={13} /> 参数 JSON ({baseDoc.shots.length} 镜)</span>
          {parsed.ok
            ? <span className="cinema-mono text-[10px] text-[var(--accent-green)] flex items-center gap-1"><Check size={11} /> JSON 合法{diff && diff.total > 0 ? ` · ${diff.changedShots.length} 镜${diff.formatChanged ? '+格式' : ''}${diff.continuityChanged ? '+连贯性' : ''} 待同步` : ''}</span>
            : <span className="cinema-mono text-[10px] text-[var(--secondary)] flex items-center gap-1"><AlertCircle size={11} /> {parsed.error}</span>}
        </div>
        <textarea
          className="cinema-textarea w-full cinema-mono !text-[10px] leading-relaxed"
          rows={16} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => { setText(paramDocToJson(baseDoc)); }} className="cinema-btn-ghost !text-[11px]">还原</button>
          <button onClick={sync} disabled={!parsed.ok || !dirty || syncing} className="cinema-btn-primary !text-[11px] ml-auto disabled:opacity-50">
            {syncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 应用并同步 (Sync Now)
          </button>
        </div>
        {msg && <p className="cinema-mono text-[10px] mt-1.5 text-[var(--accent-green)]">{msg}</p>}
        <p className="cinema-mono text-[9px] opacity-40 mt-1">编辑每镜 spec / continuity / format 后点同步 → 写回分镜资产; 摄影台/连贯性/格式条的改动也会在重载后回流到这里。</p>
      </div>
    </div>
  );
}
