'use client';

/**
 * v9.7.3 — 一键全片口型(阶段十六 T1 收口)。复用 oneclick-film-panel 的闭环编排骨架
 * (running / 实时 log / stopRef / 运行前 confirm):一键把全片对白镜跑完
 *   ① 合成配音(POST /shot-audio)→ ② 逐镜真渲染口型(POST /lipsync/render,自动取音 + 写回分镜)。
 * 引擎未配置 → 首镜即终止并提示;支持中途停止。挂在「配音口型」面板内。
 */
import { useRef, useState } from 'react';
import { Lightning, CircleNotch as Loader2, X } from '@phosphor-icons/react';
import { planLipSyncQc } from '@/lib/lipsync-qc';
import { rmsEnvelope, scoreLipAudioAlignment } from '@/lib/lipsync-align';

const QC_ALIGN_MAX_SHOTS = 40; // 客户端逐镜解码音频较重,封顶

const QC_MAX_ROUNDS = 2;

type LogKind = 'info' | 'ok' | 'warn' | 'err';
const logColor = (k: LogKind) => (k === 'ok' ? 'text-emerald-400' : k === 'warn' ? 'text-amber-400' : k === 'err' ? 'text-rose-400' : 'text-white/45');

export function LipSyncBatchPanel({ projectId, shotNumbers }: { projectId: string; shotNumbers: number[] }) {
  const [running, setRunning] = useState(false);
  const [qcEnabled, setQcEnabled] = useState(true);
  const [log, setLog] = useState<{ kind: LogKind; text: string }[]>([]);
  const stopRef = useRef(false);
  const addLog = (kind: LogKind, text: string) => setLog((l) => [...l, { kind, text }]);

  /** 渲染单镜口型,返回是否成功;configured===false → 抛出让上层终止。 */
  async function renderShot(n: number): Promise<boolean> {
    const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync/render`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shotNumber: n }),
    });
    const b = await r.json().catch(() => ({}));
    if (b.configured === false) throw new Error(b.message || '口型引擎未配置');
    if (b.ok) { addLog('ok', `镜 ${n} ✓${b.writtenBack ? ' 已写回分镜' : ''}`); return true; }
    addLog('warn', `镜 ${n}:${b.message || '渲染失败'}`);
    return false;
  }

  /** 客户端 Web Audio 算各镜「口型-音频对齐分」(viseme 轨 vs 配音能量包络),稳定不随重渲变。 */
  async function computeAlignScores(): Promise<Record<number, number>> {
    const out: Record<number, number> = {};
    try {
      const [pr, sr] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync`).then((r) => r.json()),
        fetch(`/api/projects/${encodeURIComponent(projectId)}/shot-audio`).then((r) => r.json()),
      ]);
      const lines = (pr?.plan?.perLine || []) as Array<{ shotNumber: number; visemes: { t: number; mouthOpen: number }[]; windowSec: { start: number; end: number } }>;
      const urls = new Map<number, string>();
      for (const s of (sr?.shots || [])) if (s.audioUrl) urls.set(s.shotNumber, s.audioUrl);
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return out;
      const ac = new AC();
      const batch = new Set(shotNumbers);
      let processed = 0;
      for (const line of lines) {
        if (!batch.has(line.shotNumber) || processed >= QC_ALIGN_MAX_SHOTS) continue;
        const url = urls.get(line.shotNumber);
        if (!url) continue;
        try {
          const arr = await fetch(url).then((r) => r.arrayBuffer());
          const audio = await ac.decodeAudioData(arr);
          const energy = rmsEnvelope(audio.getChannelData(0), 64);
          const res = scoreLipAudioAlignment({
            visemes: line.visemes.map((f) => ({ t: f.t, mouthOpen: f.mouthOpen })),
            audioEnergy: energy, durationSec: audio.duration || (line.windowSec.end - line.windowSec.start),
          });
          out[line.shotNumber] = res.score;
          processed++;
        } catch { /* 单镜解码失败则跳过(不参与对齐判定) */ }
      }
      ac.close();
      // v9.7.14:存实测对齐分 → 并入发布门禁
      if (Object.keys(out).length) {
        fetch(`/api/projects/${encodeURIComponent(projectId)}/lipsync-align`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scores: out }),
        }).catch(() => {});
      }
    } catch { /* 对齐分不可得则只用 Vision 分 */ }
    return out;
  }

  /** 口型质检回环:Vision 质检 + 音画对齐分 → planLipSyncQc 裁决 → 弱镜自动重渲(≤ QC_MAX_ROUNDS 轮)。 */
  async function qcLoop() {
    addLog('info', '计算口型-音频对齐分…');
    const alignScores = await computeAlignScores();
    const alignWeak = Object.values(alignScores).filter((s) => s < 60).length;
    if (Object.keys(alignScores).length) addLog('info', `音画对齐:${alignWeak} 镜偏低(已并入弱镜判定)`);
    for (let round = 1; round <= QC_MAX_ROUNDS; round++) {
      if (stopRef.current) { addLog('warn', '已手动停止'); return; }
      addLog('info', `口型质检 第 ${round}/${QC_MAX_ROUNDS} 轮:Vision 复评…`);
      const ar = await fetch(`/api/projects/${encodeURIComponent(projectId)}/vision-audit/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const ab = await ar.json().catch(() => ({}));
      const audits = (ab.audits || []) as Array<{ shotNumber: number; score: number }>;
      const verdict = planLipSyncQc({ audits, round, maxRounds: QC_MAX_ROUNDS, onlyShots: shotNumbers, alignScores });
      if (verdict.decision === 'done') { addLog('ok', verdict.message); return; }
      if (verdict.decision === 'stop') { addLog('warn', verdict.message); return; }
      addLog('warn', verdict.message);
      for (const n of verdict.weakShots) {
        if (stopRef.current) { addLog('warn', '已手动停止'); return; }
        addLog('info', `重渲弱镜 ${n} 口型…`);
        try { await renderShot(n); } catch (e) { addLog('err', `${e instanceof Error ? e.message : '重渲失败'} —— 已终止`); return; }
      }
    }
  }

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
      let done = 0; let engineMissing = false;
      for (const n of shotNumbers) {
        if (stopRef.current) { addLog('warn', '已手动停止'); break; }
        addLog('info', `渲染镜 ${n} 口型…`);
        try { if (await renderShot(n)) done++; }
        catch (e) { engineMissing = true; addLog('err', `${e instanceof Error ? e.message : '渲染失败'} —— 已终止`); break; }
      }
      addLog(done ? 'ok' : 'warn', `渲染完成:${done}/${shotNumbers.length} 镜出口型${done ? '(已进时间线/分镜)' : ''}`);

      // 步骤 3:口型质检回环(可选)—— Vision 复评 → 弱镜自动重渲
      if (qcEnabled && done > 0 && !engineMissing && !stopRef.current) {
        await qcLoop();
      }
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
          <label className="text-[10px] text-white/45 inline-flex items-center gap-1 cursor-pointer" title="渲染后跑 Vision 质检,弱镜自动重渲(≤2 轮)">
            <input type="checkbox" checked={qcEnabled} disabled={running} onChange={(e) => setQcEnabled(e.target.checked)} className="accent-current w-3 h-3" />
            质检回环
          </label>
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
