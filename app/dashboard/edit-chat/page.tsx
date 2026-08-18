'use client';

/**
 * /dashboard/edit-chat · 对话式编辑台(v12.251:解析 → 真执行闭环)
 *
 * 对成片用自然语言说「删掉第3镜,改成竖屏卡点字幕」→ 解析成编辑意图 → 「我将:①②③」确认卡 →
 * 选一个项目 + 确认 → 组合级编辑经 `POST /api/projects/[id]/recompose` **真正重合成成片**。
 *
 * 安全契约:解析只读;破坏性操作(删镜/重配音/重生镜)走**两步确认**(先亮红,再点才执行)。
 * recompose 端点自身还有属主守卫 + 白名单校验(防御纵深)。重生镜/节奏调整不在 recompose 内,
 * 页内如实指路(去项目页重生 / 整片重跑),不假装已执行。
 */

import { useEffect, useRef, useState } from 'react';
import { ChatText, PaperPlaneRight, Warning as AlertTriangle, CircleNotch as Loader2, CheckCircle, ShieldWarning, FilmSlate, Download } from '@phosphor-icons/react';
import { useToast } from '@/components/ui/toast-provider';
import { api } from '@/lib/api-client';
import type { EditOp } from '@/lib/edit-intent';
import { planExecution, type ExecutionPlan } from '@/lib/edit-intent-execute';

interface ParseResult {
  intents: EditOp[];
  describe: string[];
  destructive: boolean;
  unmatched: boolean;
  hint?: string;
}
interface ProjectLite { id: string; title: string; status?: string; }

const EXAMPLES = [
  '删掉第3镜,改成竖屏卡点字幕',
  '节奏快一点,适配抖音',
  '第2镜调暗一点',
  '重新配音',
];

export default function EditChatPage() {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const { showToast } = useToast();

  // v12.251 执行态
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [projectId, setProjectId] = useState('');
  const [executing, setExecuting] = useState(false);
  const [armed, setArmed] = useState(false);
  // v12.337 单镜重生执行态:逐镜串行(并行会同时烧多份预算,且失败难归因)
  const [shotRunning, setShotRunning] = useState<number | null>(null);
  const [shotLog, setShotLog] = useState<Array<{ shotNumber: number; status: 'ok' | 'fail' | 'running'; msg: string }>>([]);
  const [shotArmed, setShotArmed] = useState(false);           // 破坏性两步确认:先亮红再执行
  // v12.251 复检修:arm 后短暂禁用按钮(冷却),让**双击**的第二击落空 —— 否则一次双击会
  // 「arm→立刻执行」一气呵成绕过两步确认(React 在两个 click 宏任务间已提交 armed=true)。
  const [cooldown, setCooldown] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resultVideoUrl, setResultVideoUrl] = useState('');
  const [execError, setExecError] = useState('');

  useEffect(() => {
    api.projects()
      .then((rows: any) => setProjects((Array.isArray(rows) ? rows : []).map((r: any) => ({ id: r.id, title: r.title, status: r.status }))))
      .catch(() => { /* 列表拉取失败不致命,用户仍可解析预览 */ });
  }, []);
  useEffect(() => () => { if (cooldownRef.current) clearTimeout(cooldownRef.current); }, []);

  const plan: ExecutionPlan | null = result && !result.unmatched ? planExecution(result.intents) : null;

  // 解除武装:清 armed + 冷却 + 计时器。切项目 / 重解析都要归零,防「上一条破坏性指令的 armed」被下一条复用。
  const disarm = () => {
    setArmed(false);
    setCooldown(false);
    if (cooldownRef.current) { clearTimeout(cooldownRef.current); cooldownRef.current = null; }
  };
  const resetExec = () => { disarm(); setResultVideoUrl(''); setExecError(''); };

  const parse = async (override?: string) => {
    const q = (override ?? text).trim();
    if (!q) { showToast({ title: '先说一句要改什么', type: 'error' }); return; }
    if (override) setText(override);
    setParsing(true);
    setErrorMsg('');
    setResult(null);
    resetExec();
    try {
      const res = await fetch('/api/edit-intent/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.message || `解析失败 (HTTP ${res.status})`;
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      // 防御:200 但返回异常/非 JSON(body 被兜成 {})时,ok 不为 true → 明示报错,别让下面的
      // result.describe.length 撞 undefined 崩页。同时把数组字段归一,渲染永不 undefined.length。
      if (!body || body.ok !== true) {
        const msg = '解析返回异常,请重试';
        setErrorMsg(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setResult({
        intents: Array.isArray(body.intents) ? body.intents : [],
        describe: Array.isArray(body.describe) ? body.describe : [],
        destructive: !!body.destructive,
        unmatched: !!body.unmatched,
        hint: typeof body.hint === 'string' ? body.hint : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,解析失败';
      setErrorMsg(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setParsing(false);
    }
  };

  /**
   * v12.337:执行**单镜重生**。竞品对标清单最后一项(Seko 自然语言改单镜)。
   *
   * 关键契约:把用户那句话作为 `editNote` 交给服务端,由服务端读原镜描述后**合并**,
   * 而不是当作新的 description 传过去 —— 后者会把原镜的人物/场景/动作整个抹掉,
   * 且会「成功」返回不报错(见 lib/shot-edit-merge)。
   *
   * 逐镜**串行**:每镜都是真金白银的一次视频生成,并行等于同时烧 N 份预算。
   */
  const executeShots = async () => {
    if (!plan || plan.regenShots.length === 0) return;
    if (!projectId) { showToast({ title: '先选一个要修改的项目', type: 'error' }); return; }
    if (cooldown) return;
    if (!shotArmed) {           // 与组合级同一套两步确认:第一次点只亮红
      setShotArmed(true);
      setCooldown(true);
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      cooldownRef.current = setTimeout(() => setCooldown(false), 600);
      return;
    }
    setShotLog([]);
    for (const rs of plan.regenShots) {
      setShotRunning(rs.shotNumber);
      setShotLog((L) => [...L, { shotNumber: rs.shotNumber, status: 'running', msg: '正在重生…' }]);
      try {
        const res = await fetch(`/api/projects/${projectId}/regenerate-shot`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shotNumber: rs.shotNumber, editNote: rs.note || '' }),
        });
        if (!res.ok || !res.body) {
          const t = await res.text().catch(() => '');
          throw new Error(t.slice(0, 120) || `HTTP ${res.status}`);
        }
        // SSE:只取最后的 complete/error,过程中的 status 用于回显服务端的合并说明
        const reader = res.body.getReader(); const dec = new TextDecoder();
        let buf = '', done = false, lastMsg = '';
        while (!done) {
          const { value, done: d } = await reader.read();
          if (d) break;
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split('\n\n'); buf = chunks.pop() || '';
          for (const c of chunks) {
            const line = c.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'status' && ev.data?.message) lastMsg = String(ev.data.message);
              if (ev.type === 'complete') { done = true; lastMsg = '已重生 ✓'; }
              if (ev.type === 'error') { throw new Error(ev.data?.message || '重生失败'); }
            } catch { /* 半包/非 JSON 行忽略 */ }
          }
        }
        setShotLog((L) => L.map((x) => x.shotNumber === rs.shotNumber ? { ...x, status: 'ok', msg: lastMsg || '已重生 ✓' } : x));
      } catch (e) {
        const msg = e instanceof Error ? e.message : '重生失败';
        setShotLog((L) => L.map((x) => x.shotNumber === rs.shotNumber ? { ...x, status: 'fail', msg } : x));
        // 一镜失败不连累后面的 —— 但如实记下来,不静默跳过
      }
    }
    setShotRunning(null);
    setShotArmed(false);
  };

  /** 执行组合级编辑(recompose)。破坏性操作需先 armed(第一次点只亮红,第二次才真跑)。 */
  const execute = async () => {
    if (!plan || !plan.recompose) return;
    if (!projectId) { showToast({ title: '先选一个要修改的项目', type: 'error' }); return; }
    if (cooldown) return; // 冷却期(刚 arm)内的点击一律忽略 —— 挡双击直冲执行。
    // 两步确认:破坏性但未 armed → 只亮红 + 进冷却,不执行。第二次(冷却结束后)刻意点击才真跑。
    if (plan.destructive && !armed) {
      setArmed(true);
      setCooldown(true);
      if (cooldownRef.current) clearTimeout(cooldownRef.current);
      cooldownRef.current = setTimeout(() => setCooldown(false), 600);
      return;
    }

    setExecuting(true);
    setExecError('');
    setResultVideoUrl('');
    try {
      const res = await fetch(`/api/projects/${projectId}/recompose`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan.recompose),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        const msg = body?.message || `重合成失败 (HTTP ${res.status})`;
        setExecError(msg); showToast({ title: msg, type: 'error' });
        return;
      }
      setResultVideoUrl(body.finalVideoUrl || '');
      setArmed(false);
      showToast({ title: '已重合成成片', type: 'success' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '网络错误,重合成失败';
      setExecError(msg); showToast({ title: msg, type: 'error' });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ChatText className="w-6 h-6 text-[#E8C547]" weight="duotone" />
          对话式编辑台
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          对成片用大白话说要改什么 → 解析成一组编辑意图,确认后调既有 recompose / regenerate-shot。
          <span className="text-[var(--soft)]"> 解析只读,破坏性操作(删镜/重配音)必须二次确认。</span>
        </p>
      </div>

      {/* 输入区 */}
      <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) parse(); }}
          placeholder="例如:删掉第3镜,改成竖屏卡点字幕,节奏快一点"
          maxLength={2000}
          rows={3}
          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map(ex => (
            <button key={ex} onClick={() => parse(ex)} disabled={parsing}
              className="px-2.5 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[11px] text-[var(--muted)] disabled:opacity-40">
              {ex}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--soft)] opacity-60">⌘/Ctrl + Enter 解析 · {text.length}/2000</span>
          <button
            onClick={() => parse()}
            disabled={parsing || !text.trim()}
            className="px-4 py-2 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center gap-2 text-sm"
          >
            {parsing ? (<><Loader2 className="w-4 h-4 animate-spin" /> 解析中…</>) : (<><PaperPlaneRight className="w-4 h-4" weight="bold" /> 解析</>)}
          </button>
        </div>
      </div>

      {/* 结果区 */}
      <div className="mt-5">
        {errorMsg ? (
          <div className="bg-[rgba(255,255,255,0.04)] border border-rose-500/20 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-rose-400" />
            <div className="text-sm text-rose-300 mb-1">解析失败</div>
            <div className="text-[11px] text-white/50">{errorMsg}</div>
          </div>
        ) : result ? (
          result.unmatched || (result.describe?.length ?? 0) === 0 ? (
            <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 text-[13px] text-[var(--muted)]">
              {result.hint || '没听懂这句 —— 换个说法试试(如「删掉第3镜」「改成竖屏卡点字幕」)。'}
            </div>
          ) : (
            <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="w-4 h-4 text-emerald-400" weight="duotone" />
                <span className="text-sm text-white font-medium">我将执行以下 {result.describe.length} 项修改:</span>
              </div>
              <ol className="space-y-2 mb-4">
                {result.describe.map((d, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="w-5 h-5 rounded-full bg-[#E8C547]/15 text-[#E8C547] grid place-items-center text-[11px] font-mono shrink-0 mt-0.5">{i + 1}</span>
                    <span className="text-[var(--text)]">{d}</span>
                  </li>
                ))}
              </ol>

              {result.destructive && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/25 px-3 py-2 mb-4">
                  <ShieldWarning className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" weight="duotone" />
                  <span className="text-[12px] text-rose-200/90">
                    含删镜 / 重生 / 重配音等**花钱或不可逆**操作 —— 需点两次确认才执行。
                  </span>
                </div>
              )}

              {/* v12.337:单镜重生**在本页直接执行**(此前只指路,让用户自己跑去项目页) */}
              {plan && plan.regenShots.length > 0 && (
                <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 mb-4 text-[11px] text-amber-200/85 leading-relaxed">
                  <div className="mb-2">
                    · 第 {plan.regenShots.map(r => r.shotNumber).join('、')} 镜将<b>重生画面</b> —— 逐镜串行,每镜都是一次真实的付费视频生成。
                    你的说明会<b>合并进原镜描述</b>(不是替换),其余保持不变。
                  </div>
                  <button
                    type="button"
                    onClick={executeShots}
                    disabled={!projectId || shotRunning !== null || cooldown}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40 ${
                      shotArmed ? 'bg-red-500/85 text-white hover:bg-red-500' : 'bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                    }`}
                  >
                    {shotRunning !== null ? `正在重生第 ${shotRunning} 镜…`
                      : shotArmed ? `确认重生 ${plan.regenShots.length} 个镜头(要花钱)` : `重生这 ${plan.regenShots.length} 个镜头`}
                  </button>
                  {shotLog.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {shotLog.map((l) => (
                        <div key={l.shotNumber} className={l.status === 'fail' ? 'text-red-300' : l.status === 'ok' ? 'text-emerald-300' : ''}>
                          第 {l.shotNumber} 镜:{l.msg}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {plan?.paceHint && (
                <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2 mb-4 text-[11px] text-amber-200/85 leading-relaxed">
                  · 「节奏{plan.paceHint === 'fast' ? '快' : '慢'}一点」需整片重跑(recompose 不改节奏),本页不执行。
                </div>
              )}

              {/* 项目选择 + 执行(仅组合级 recompose 可在本页直接跑) */}
              {plan?.recompose ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-[var(--soft)] uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                      <FilmSlate className="w-3.5 h-3.5" /> 对哪个项目的成片执行
                    </label>
                    <select
                      value={projectId}
                      onChange={e => { setProjectId(e.target.value); disarm(); }}
                      className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm"
                    >
                      <option value="">— 选择项目 —</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.title}{p.status ? ` · ${p.status}` : ''}</option>
                      ))}
                    </select>
                    {projects.length === 0 && <div className="text-[10px] text-[var(--soft)] mt-1 opacity-60">还没有项目 —— 先去创作工坊出一片。</div>}
                  </div>

                  <button
                    onClick={execute}
                    disabled={executing || !projectId || cooldown}
                    className={`w-full px-4 py-2.5 rounded-xl font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                      armed ? 'bg-rose-500 hover:bg-rose-500/90 text-white' : 'bg-[#E8C547] hover:bg-[#E8C547]/90 text-black'
                    }`}
                  >
                    {executing
                      ? (<><Loader2 className="w-4 h-4 animate-spin" /> 重合成中…</>)
                      : cooldown
                        ? (<><ShieldWarning className="w-4 h-4" weight="bold" /> 确认删改?稍候…</>)
                        : armed
                          ? (<><ShieldWarning className="w-4 h-4" weight="bold" /> 确认执行(含不可逆操作)</>)
                          : (<><CheckCircle className="w-4 h-4" weight="bold" /> {plan.destructive ? '执行(将二次确认)' : '确认执行'}</>)}
                  </button>
                  {armed && !executing && (
                    <div className="text-[11px] text-rose-300/80 text-center">
                      {cooldown ? '请稍候,确认按钮即将就绪…' : '这条含不可逆操作,再刻意点一次确认;或'}
                      {!cooldown && <button onClick={disarm} className="underline ml-1 hover:text-rose-200">取消</button>}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-[var(--soft)] mt-1 opacity-70">本条指令没有可在此直接执行的组合级编辑(见上方指路)。</p>
              )}

              {/* 执行结果 */}
              {execError && <div className="mt-3 text-[12px] text-rose-300">✕ {execError}</div>}
              {resultVideoUrl && (
                <div className="mt-4">
                  <div className="text-[12px] text-emerald-400 mb-2 inline-flex items-center gap-1.5"><CheckCircle className="w-4 h-4" weight="duotone" /> 重合成完成</div>
                  <video src={resultVideoUrl} controls className="w-full rounded-xl bg-black/40 max-h-[420px]" />
                  <a href={resultVideoUrl} target="_blank" rel="noopener"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-white">
                    <Download className="w-3.5 h-3.5" /> 打开 / 下载成片
                  </a>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="text-center text-[var(--soft)] text-sm opacity-60 py-10">
            说一句要改什么,或点上面的示例 —— 解析出的意图会以确认卡形式出现在这里。
          </div>
        )}
      </div>
    </div>
  );
}
