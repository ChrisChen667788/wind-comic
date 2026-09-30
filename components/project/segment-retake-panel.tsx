'use client';

/**
 * SegmentRetakePanel — 片段重拍的完整界面(v12.459,放在逐帧检视弹窗里)。
 *
 * v12.330 把「框选坏的一段」接到了重拍,但只接到**预演**为止:点了只弹一个「可以重拍」的提示,
 * 没有真重拍的按钮、也看不到 take、无从采用 —— 功能在界面上走不通。这里把三步接完:
 *   ① 预演:服务端按项目帧率算计划(要生成几秒、补在哪、总长不变),不花钱;
 *   ② 确认重拍:服务端生成补丁(首帧取原片切入点那一帧)→ 缝合 → 校验时长 → 记 take;
 *   ③ take 列表:每条可预览、可采用;第一次采用前服务端会自动记下「原片」,采用它就是回退。
 * 区间来自父组件(服务端换算好的秒数),本组件不做任何时间换算。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth';

interface Plan { ok: boolean; reason?: string; patchFromS: number; patchToS: number; generateDurationS: number; totalAfterS: number; padSeconds: number }
interface TakeRow {
  takeId: string; fromS: number; toS: number; prompt?: string; videoUrl: string; createdAt: string;
  adopted: boolean; original: boolean; patchIsAnimatic: boolean; measuredDurationS?: number;
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

/** 服务端给了人话就用它;没有就按状态码翻译(与 v12.454 开机失败同一口径) */
function describeFailure(status: number, body: any): string {
  const msg = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
  if (msg) return msg.slice(0, 200);
  if (status === 401) return '登录已失效,请重新登录';
  if (status === 402) return '超出预算上限';
  if (status === 403) return '没有编辑这个项目的权限';
  return `请求失败(HTTP ${status})`;
}

export function SegmentRetakePanel({
  projectId, shotNumber, range,
}: {
  projectId: string;
  shotNumber: number;
  /** 父组件(逐帧检视)换算好的区间;null = 还没框选 */
  range: { fromS: number; toS: number } | null;
}) {
  const api = `/api/projects/${encodeURIComponent(projectId)}/segment-retake`;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [takesError, setTakesError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  // 同步守卫:state 要等下一次渲染才生效,连点两下会在这个空档里发出两条请求(对抗复查挖出)。
  // 真重拍会花钱,采用会先记「原片」—— 两者都不能被连点放大。
  const busy = useRef(false);

  const loadTakes = useCallback(async () => {
    try {
      const r = await fetch(`${api}?shotNumber=${shotNumber}`, { headers: authHeaders() });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(b?.takes)) { setTakesError(describeFailure(r.status, b)); return; }
      setTakesError(null);
      // 「原片」排最后:它是回退用的,不是一次新的重拍
      setTakes([...b.takes].sort((a: TakeRow, c: TakeRow) => Number(a.original) - Number(c.original)));
    } catch (e) {
      setTakesError(e instanceof Error ? e.message : '读取重拍记录失败');
    }
  }, [api, shotNumber]);

  useEffect(() => { void loadTakes(); }, [loadTakes]);

  // 区间变了,旧计划作废
  useEffect(() => { setPlan(null); setPlanError(null); }, [range?.fromS, range?.toS]);

  // 真重拍期间显示已用时 —— 引擎出片要几十秒到两分钟,不显示会被当成卡死
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const h = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(h);
  }, [running]);

  const preview = async () => {
    if (!range) return;
    setPlanError(null); setNotice(null);
    try {
      const r = await fetch(api, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shotNumber, fromS: range.fromS, toS: range.toS, dryRun: true }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b?.plan?.ok === false) { setPlan(null); setPlanError(describeFailure(r.status, b?.plan?.reason ? { message: b.plan.reason } : b)); return; }
      setPlan(b.plan);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : '预演失败,请检查网络');
    }
  };

  const confirm = async () => {
    if (!range || !plan || busy.current) return;
    busy.current = true;
    setRunning(true); setElapsed(0); setNotice(null);
    try {
      const r = await fetch(api, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ shotNumber, fromS: range.fromS, toS: range.toS, prompt: prompt.trim() || undefined }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b?.ok) {
        setNotice({ tone: 'error', text: `重拍没有完成:${describeFailure(r.status, b)}` });
      } else {
        setNotice(b.patchIsAnimatic
          ? { tone: 'warn', text: '已缝合,但补丁是占位片(联调模式下引擎没出片)—— 仅用于验证流程,不建议采用' }
          : { tone: 'ok', text: `已生成新版本(缝合后 ${Number(b.measuredDurationS).toFixed(2)}s,时长不变)。在下方预览,满意再采用` });
        setPlan(null);
      }
      await loadTakes();
    } catch (e) {
      setNotice({ tone: 'error', text: `重拍没有完成:${e instanceof Error ? e.message : '网络错误'}` });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const adopt = async (t: TakeRow) => {
    if (busy.current) return;
    busy.current = true;
    setAdopting(t.takeId); setNotice(null);
    try {
      const r = await fetch(api, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ adoptTakeId: t.takeId }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b?.ok) {
        setNotice({ tone: 'error', text: `采用失败:${describeFailure(r.status, b)}` });
      } else {
        // 只在真的作废了成片时才这么说 —— 项目还没出过成片时,「成片需要重新合成」是一句假话
        const hadFinal = Array.isArray(b.invalidated) && b.invalidated.includes('final_video');
        const after = hadFinal ? '成片已标记为需要重新合成' : '本项目还没有成片,之后出片会用这一版';
        const warning = typeof b.warning === 'string' ? b.warning : '';
        setNotice({ tone: warning ? 'warn' : 'ok', text: `${t.original ? '已回退到原片' : '已采用'}。${after}${warning ? `。注意:${warning}` : ''}` });
      }
      await loadTakes();
    } catch (e) {
      setNotice({ tone: 'error', text: `采用失败:${e instanceof Error ? e.message : '网络错误'}` });
    } finally {
      busy.current = false;
      setAdopting(null);
    }
  };

  const toneClass = (tone: 'ok' | 'warn' | 'error') => tone === 'ok'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
    : tone === 'warn' ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
      : 'border-red-400/30 bg-red-400/10 text-red-200';

  return (
    <section className="max-h-[45vh] shrink-0 overflow-auto border-t border-white/10 px-5 py-3 text-sm" data-testid="segment-retake-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-200">片段重拍</span>
        {!range && <span className="text-xs text-neutral-400">先在上方框出要重拍的那一段</span>}
        {range && !plan && (
          <button onClick={() => void preview()} disabled={running}
            className="rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-300 disabled:opacity-50"
            data-testid="segment-retake-preview">
            用这段做片段重拍
          </button>
        )}
      </div>

      {planError && <p className="mt-2 text-xs text-red-300" role="alert">这段不能单独重拍:{planError}</p>}

      {plan && range && (
        <div className="mt-2 space-y-2 rounded border border-white/10 bg-white/[0.03] p-3" data-testid="segment-retake-plan">
          <p className="text-xs text-neutral-300">
            将重拍 <b className="font-mono">{plan.patchFromS.toFixed(3)}s → {plan.patchToS.toFixed(3)}s</b>:
            向引擎生成 {plan.generateDurationS.toFixed(1)}s{plan.padSeconds > 0 ? `(多生成 ${plan.padSeconds.toFixed(1)}s 以满足引擎下限,多出的丢弃)` : ''},
            补丁首帧取原片在切入点的那一帧;缝合后该镜总长仍是 {plan.totalAfterS.toFixed(3)}s。
          </p>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} disabled={running}
            placeholder="这一段想怎么改(可选,例如:她转身时别眨眼)"
            className="w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-neutral-100 outline-none" />
          <div className="flex items-center gap-2">
            <button onClick={() => void confirm()} disabled={running}
              className="rounded bg-amber-400 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-amber-300 disabled:opacity-60"
              data-testid="segment-retake-confirm">
              {running ? `生成中… ${elapsed}s` : `确认重拍(会调用视频引擎,按 ${plan.generateDurationS.toFixed(1)}s 计费)`}
            </button>
            {!running && <button onClick={() => setPlan(null)} className="rounded border border-white/15 px-3 py-1.5 text-xs hover:bg-white/5">取消</button>}
            {running && <span className="text-xs text-neutral-400">引擎出片通常要几十秒到两分钟,可以关掉弹窗,完成后记录会保留</span>}
          </div>
        </div>
      )}

      {notice && <p className={`mt-2 rounded border px-2.5 py-1.5 text-xs ${toneClass(notice.tone)}`} role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="segment-retake-notice">{notice.text}</p>}

      <div className="mt-3">
        <div className="mb-1.5 text-xs text-neutral-400">本镜的重拍记录</div>
        {takesError && <p className="text-xs text-red-300" role="alert">读取重拍记录失败:{takesError}</p>}
        {!takesError && takes.length === 0 && <p className="text-xs text-neutral-500">还没有。重拍完成后会出现在这里,可预览、可采用。</p>}
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="segment-retake-takes">
          {takes.map((t) => (
            <li key={t.takeId} className="rounded border border-white/10 bg-black/20 p-2" data-testid="segment-retake-take">
              <video src={t.videoUrl} controls preload="metadata" className="block w-full rounded bg-black" />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                {t.original
                  ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-neutral-200">原片</span>
                  : <span className="font-mono text-neutral-300">{t.fromS.toFixed(2)}–{t.toS.toFixed(2)}s</span>}
                {t.patchIsAnimatic && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-200">占位补丁</span>}
                {t.prompt && <span className="truncate text-neutral-400" title={t.prompt}>「{t.prompt}」</span>}
                <span className="ml-auto">
                  {t.adopted
                    ? <span className="text-emerald-300">当前采用</span>
                    : (
                      <button onClick={() => void adopt(t)} disabled={adopting !== null || running}
                        className="rounded border border-white/15 px-2 py-0.5 text-neutral-200 hover:bg-white/5 disabled:opacity-50">
                        {adopting === t.takeId ? '采用中…' : t.original ? '回退到原片' : '采用此版本'}
                      </button>
                    )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {takes.length > 0 && <p className="mt-1.5 text-[11px] text-neutral-500">采用后该镜时长不变;成片需要重新合成,其余镜头不受影响。</p>}
      </div>
    </section>
  );
}
