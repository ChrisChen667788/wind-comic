'use client';

/**
 * v9.7.3 — 一键全片口型(阶段十六 T1 收口)。复用 oneclick-film-panel 的闭环编排骨架
 * (running / 实时 log / stopRef / 运行前 confirm):一键把全片对白镜跑完
 *   ① 合成配音(POST /shot-audio)→ ② 逐镜真渲染口型(POST /lipsync/render,自动取音 + 写回分镜)。
 * 引擎未配置 → 首镜即终止并提示;支持中途停止。挂在「配音口型」面板内。
 */
import { useRef, useState } from 'react';
import { Lightning, CircleNotch as Loader2, X } from '@phosphor-icons/react';

type LogKind = 'info' | 'ok' | 'warn' | 'err';
const logColor = (k: LogKind) => (k === 'ok' ? 'text-emerald-400' : k === 'warn' ? 'text-amber-400' : k === 'err' ? 'text-rose-400' : 'text-white/45');

export function LipSyncBatchPanel({ projectId, shotNumbers }: { projectId: string; shotNumbers: number[] }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<{ kind: LogKind; text: string }[]>([]);
  const stopRef = useRef(false);
  const addLog = (kind: LogKind, text: string) => setLog((l) => [...l, { kind, text }]);

  async function run() {
    if (running || !shotNumbers.length) return;
    if (!window.confirm(`「一键全片口型」将为 ${shotNumbers.length} 句对白:① 合成配音 → ② 逐镜真渲染口型 → 写回分镜/时间线。会消耗 TTS + 口型引擎算力。确认运行?`)) return;
    setRunning(true); setLog([]); stopRef.current = false;
    try {
      // 步骤 1:合成全片配音(render 端点据此自动取音)
      addLog('info', `合成全片配音(${shotNumbers.length} 句)…`);
      const aRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-audio`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const aBody = await aRes.json().catch(() => ({}));
      if (!aBody.ok) { addLog('err', `${aBody.message || '配音合成失败'} —— 已终止`); setRunning(false); return; }
      addLog('ok', `配音完成 ${aBody.synthesized}/${aBody.total}`);

      // 步骤 2:逐镜真渲染口型(自动取音 + 写回)
      let done = 0;
      for (const n of shotNumbers) {
        if (stopRef.current) { addLog('warn', '已手动停止'); break; }
        addLog('info', `渲染镜 ${n} 口型…`);
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync/render`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shotNumber: n }),
        });
        const b = await r.json().catch(() => ({}));
        if (b.configured === false) { addLog('err', `${b.message || '口型引擎未配置'} —— 已终止`); break; }
        if (b.ok) { done++; addLog('ok', `镜 ${n} ✓${b.writtenBack ? ' 已写回分镜' : ''}`); }
        else addLog('warn', `镜 ${n}:${b.message || '渲染失败'}`);
      }
      addLog(done ? 'ok' : 'warn', `一键全片完成:${done}/${shotNumbers.length} 镜出口型${done ? '(已进时间线/分镜)' : ''}`);
    } catch (e) {
      addLog('err', e instanceof Error ? e.message : '批处理失败');
    } finally { setRunning(false); }
  }

  if (!shotNumbers.length) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] text-white/70 flex items-center gap-1.5">
          <Lightning className="w-3.5 h-3.5" /> 一键全片口型 · {shotNumbers.length} 句对白(配音 → 渲染 → 写回)
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {running && (
            <button onClick={() => { stopRef.current = true; }} className="cinema-btn !px-2 !py-1 !text-[10px] inline-flex items-center gap-1">
              <X className="w-3 h-3" /> 停止
            </button>
          )}
          <button onClick={run} disabled={running} className="cinema-btn cinema-btn-primary !px-2.5 !py-1 !text-[10px] inline-flex items-center gap-1 disabled:opacity-50">
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lightning className="w-3 h-3" />}
            {running ? '运行中…' : '一键全片'}
          </button>
        </div>
      </div>
      {log.length > 0 && (
        <div className="mt-2 max-h-40 overflow-auto space-y-0.5 font-mono text-[10px] leading-relaxed">
          {log.map((l, i) => (<div key={i} className={logColor(l.kind)}>{l.text}</div>))}
        </div>
      )}
    </div>
  );
}
