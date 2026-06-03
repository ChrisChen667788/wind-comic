'use client';

/**
 * v9.4.6 — 一键成片自愈闭环面板(对标可灵「一键成片」,但我们是闭环)。
 *
 * 跑通 lib/oneclick-film 的闭环:每轮 ① Vision 质检(/vision-audit/run)→ ② decideIteration 裁决
 * (done/rebirth/blocked)→ ③ rebirth 则按重生计划自动重拍弱镜(/regenerate-storyboard,带最弱维度
 * steer)→ 复检,最多 N 轮。可灵一键成片是开环;我们生成后自检 + 自动重拍弱镜,达标才停。
 *
 * ⚠️ 真实执行:会调用质检 + 重拍(消耗 token)。有上轮数 / 停止 / 运行前确认 三重保护。
 */
import { useRef, useState } from 'react';
import { MagicWand, Play, CircleNotch as Loader2, CheckCircle, Warning, X } from '@phosphor-icons/react';
import { planOneClickFilm, decideIteration } from '@/lib/oneclick-film';

interface ShotPrompt { shotNumber: number; prompt: string; }
type LogKind = 'info' | 'ok' | 'warn' | 'err';

const DIM_STEER: Record<string, string> = {
  sceneMatch: 'match the scripted scene and setting more faithfully',
  actionMatch: 'clearer, more readable character action and pose',
  moodMatch: 'stronger intended mood, lighting and atmosphere',
  composition: 'stronger composition and framing',
};

function authHeader(): Record<string, string> {
  const t = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function OneClickFilmPanel({ projectId, shotPrompts }: { projectId: string; shotPrompts: ShotPrompt[] }) {
  const plan = planOneClickFilm({ idea: '当前项目', maxRebirthRounds: 2 });
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<{ kind: LogKind; text: string }[]>([]);
  const [decision, setDecision] = useState<'done' | 'blocked' | null>(null);
  const stopRef = useRef(false);

  const promptMap = new Map(shotPrompts.filter((s) => s.prompt).map((s) => [s.shotNumber, s.prompt]));
  const addLog = (kind: LogKind, text: string) => setLog((l) => [...l, { kind, text }]);

  async function run() {
    if (running) return;
    const ok = window.confirm(
      `「一键成片」自愈闭环将:质检每镜 → 自动重拍低分镜(消耗 token)→ 复检,最多 ${plan.maxRebirthRounds + 1} 轮。\n确认运行?`,
    );
    if (!ok) return;
    setRunning(true); setLog([]); setDecision(null); stopRef.current = false;

    try {
      for (let round = 1; round <= plan.maxRebirthRounds + 1; round++) {
        if (stopRef.current) { addLog('warn', '已手动停止'); break; }
        addLog('info', `第 ${round} 轮 · 质检中…`);
        const aRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/vision-audit/run`, {
          method: 'POST', headers: authHeader(),
        });
        const aBody = await aRes.json().catch(() => ({}));
        if (!aRes.ok) { addLog('err', aBody?.error || `质检失败 (HTTP ${aRes.status})`); break; }

        const audits = aBody.audits || [];
        const summary = aBody.summary || null;
        const verdict = decideIteration(plan, { round, audits, filmAudit: summary });
        addLog(verdict.decision === 'done' ? 'ok' : verdict.decision === 'blocked' ? 'warn' : 'info', verdict.message);

        if (verdict.decision === 'done') { setDecision('done'); break; }
        if (verdict.decision === 'blocked') { setDecision('blocked'); break; }

        // rebirth — 按重生计划自动重拍弱镜
        let regen = 0;
        for (const s of verdict.rebirthShots) {
          if (stopRef.current) { addLog('warn', '已手动停止'); break; }
          const base = promptMap.get(s.shotNumber);
          if (!base) { addLog('warn', `镜 ${s.shotNumber} 缺分镜 prompt,跳过`); continue; }
          const steer = s.weakestDimension ? DIM_STEER[s.weakestDimension] : '';
          const customPrompt = (steer ? `${base}, ${steer}` : base).slice(0, 1900);
          addLog('info', `重拍镜 ${s.shotNumber} · ${s.focusHint}`);
          try {
            const rRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/regenerate-storyboard`, {
              method: 'POST',
              headers: { ...authHeader(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ shotNumber: s.shotNumber, customPrompt, useStyleBible: true, useCref: true }),
            });
            // SSE: 读完整 body, 看是否 complete
            const txt = await rRes.text();
            if (rRes.ok && /"type"\s*:\s*"complete"/.test(txt)) regen++;
            else addLog('warn', `镜 ${s.shotNumber} 重拍未完成`);
          } catch { addLog('warn', `镜 ${s.shotNumber} 重拍出错`); }
        }
        addLog('info', `本轮重拍 ${regen} 镜,进入复检`);
        if (regen === 0) { addLog('warn', '无可自动重拍的镜(缺 prompt),转人工'); setDecision('blocked'); break; }
      }
    } catch (e) {
      addLog('err', e instanceof Error ? e.message : '运行出错');
    } finally {
      setRunning(false);
    }
  }

  const auditable = shotPrompts.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#E8C547]/25 bg-[#E8C547]/[0.05] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#E8C547] text-sm font-medium">
            <MagicWand className="w-4 h-4" weight="fill" /> 一键成片 · 自愈闭环
          </div>
          <span className="text-[10px] text-white/40">对标可灵一键成片 · 我们多了「自检 + 自动重拍」</span>
        </div>
        <p className="mt-2 text-[11px] text-white/55 leading-relaxed">
          每轮 <b className="text-white/75">质检每镜</b> → <b className="text-white/75">门禁裁决</b> → 低分镜 <b className="text-white/75">自动重拍</b>(带针对最弱维度的修补 steer)→ 复检;
          达标(pass / warn)即停,最多 {plan.maxRebirthRounds + 1} 轮,到顶仍不达标转人工。
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={running ? () => { stopRef.current = true; } : run}
            disabled={auditable === 0}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
              running ? 'bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25'
                      : 'bg-[#E8C547]/15 border border-[#E8C547]/40 text-[#E8C547] hover:bg-[#E8C547]/25'
            }`}
          >
            {running ? <><X className="w-3.5 h-3.5" /> 停止</> : <><Play className="w-3.5 h-3.5" weight="fill" /> 运行自愈闭环</>}
          </button>
          {auditable === 0 && <span className="text-[11px] text-white/40">先生成分镜后再运行</span>}
          {decision === 'done' && <span className="text-[11px] text-emerald-400 inline-flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" weight="fill" /> 已达标</span>}
          {decision === 'blocked' && <span className="text-[11px] text-amber-400 inline-flex items-center gap-1"><Warning className="w-3.5 h-3.5" weight="fill" /> 转人工</span>}
        </div>
      </div>

      {log.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] space-y-1 max-h-72 overflow-auto">
          {log.map((l, i) => (
            <div key={i} className={
              l.kind === 'ok' ? 'text-emerald-400' : l.kind === 'warn' ? 'text-amber-400' : l.kind === 'err' ? 'text-rose-400' : 'text-white/55'
            }>
              {running && i === log.length - 1 && <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />}
              {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
