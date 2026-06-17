'use client';

/**
 * 极速分镜台 · 15s CineSpark (v7.6) — 对标 CineSpark 15s
 *
 * 短视频"驾驶舱": 一个创意 → 三幕(HOOK/BODY/CLIMAX)结构化分镜计划。
 *   - 左:15s 运镜词库 (开场钩子 / 叙事推进 / 结尾爆发) — 可点选替换某镜运镜
 *   - 中:三幕色彩时间轴 + 分镜表 (时间码/景别/运镜/画面/AI prompt)
 *   - 右:短视频参数面板 (运动控制 / 视觉增强 / 输出设置) + 一键生成
 *   - 底:总时长 + 节奏分布环 + 导出
 *
 * 结构/时长/运镜由 lib/short-video 确定性逻辑掌控 (可单测); LLM 只产画面内容 + AI prompt。
 * 改运镜/景别会在前端即时重编译该镜 prompt (compileShotToVideoPrompt), 体现"结构化控件"体感。
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lightning as Zap, FilmStrip as Film, FilmSlate as Clapperboard, Flame, Sparkle as Sparkles, Copy, Check, Download, CircleNotch as Loader2, WarningCircle as AlertCircle, MagicWand as Wand2, Eye, Gauge, Image as ImageUp, ShareNetwork as Share2, ArrowRight } from '@phosphor-icons/react';
import {
  RHYTHM_TEMPLATES, SHORT_DURATIONS, CAMERA_MOVE_VOCAB, ACT_LABEL_ZH,
  SHOT_SIZE_LABEL_ZH, cameraMovesByPhase, getCameraMove, getRhythmTemplate,
  compileShotToVideoPrompt,
  type ShortVideoPlan, type ShortVideoShot, type ShortVideoParams,
  type ActPhase, type ShotSize, type CameraSpeed, type UpscaleFactor,
} from '@/lib/short-video';

// v12.x 重设计:三幕节奏色从金橙黄(廉价/AI味)改为克制的 蓝 / 中灰 / 暗红(参考 Frame.io/Runway)。
const PHASE_COLOR: Record<ActPhase, string> = { hook: '#3B82F6', body: '#52525B', climax: '#B91C1C' };
const PHASE_TAG: Record<ActPhase, string> = { hook: 'HOOK', body: 'BODY', climax: 'CLIMAX' };
const SHOT_SIZES: ShotSize[] = ['ELS', 'WS', 'LS', 'MS', 'CU'];

export default function ShortVideoStudioPage() {
  const router = useRouter();
  const [idea, setIdea] = useState('');
  const [durationS, setDurationS] = useState<number>(15);
  const [rhythmId, setRhythmId] = useState<string>('suspense');
  const [style, setStyle] = useState('');
  const [plan, setPlan] = useState<ShortVideoPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<number, { loading?: boolean; url?: string; err?: string }>>({});

  const rhythm = getRhythmTemplate(rhythmId);

  async function generate() {
    if (idea.trim().length < 5) { setError('创意至少 5 个字符'); return; }
    setLoading(true); setError(''); setPreviews({});
    try {
      const r = await fetch('/api/short-video/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea.trim(), durationS, rhythmId, style: style.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error || `生成失败 (${r.status})`); setPlan(null); }
      else setPlan(j.plan);
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally { setLoading(false); }
  }

  // 改某镜的运镜 / 景别 → 即时重编译该镜 AI prompt
  function patchShot(index: number, patch: Partial<Pick<ShortVideoShot, 'cameraMoveId' | 'shotSize'>>) {
    setPlan((prev) => {
      if (!prev) return prev;
      const shots = prev.shots.map((s) => {
        if (s.index !== index) return s;
        const next = { ...s, ...patch };
        const move = getCameraMove(next.cameraMoveId);
        return {
          ...next,
          cameraMoveLabel: move?.labelZh ?? next.cameraMoveLabel,
          cameraType: move?.cameraType ?? next.cameraType,
          motion: move?.motion ?? next.motion,
          aiPrompt: compileShotToVideoPrompt({
            frameContent: s.frameContent,
            shotSize: next.shotSize,
            cameraMove: move,
            style: prev.style,
            cameraSpeed: prev.params.cameraSpeed,
          }),
        };
      });
      return { ...prev, shots };
    });
  }

  function patchParams(patch: Partial<ShortVideoParams>) {
    setPlan((prev) => (prev ? { ...prev, params: { ...prev.params, ...patch } } : prev));
  }

  function copyPrompt(shot: ShortVideoShot) {
    navigator.clipboard?.writeText(shot.aiPrompt).then(() => {
      setCopied(shot.index); setTimeout(() => setCopied(null), 1500);
    });
  }

  async function previewShot(shot: ShortVideoShot) {
    setPreviews((p) => ({ ...p, [shot.index]: { loading: true } }));
    try {
      const r = await fetch('/api/preview-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: `${shot.frameContent}. ${shot.aiPrompt}`.slice(0, 1000),
          style: plan?.style || 'cinematic',
          aspect: plan?.params.aspectRatio || '9:16',
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.imageUrl) setPreviews((p) => ({ ...p, [shot.index]: { err: j?.error || '预览失败' } }));
      else setPreviews((p) => ({ ...p, [shot.index]: { url: j.imageUrl } }));
    } catch (e: any) {
      setPreviews((p) => ({ ...p, [shot.index]: { err: e?.message || '网络错误' } }));
    }
  }

  function exportMarkdown() {
    if (!plan) return;
    const md = [
      `# ${plan.title}`,
      `> 创意:${plan.idea} · 时长:${plan.durationS}s · 节奏:${getRhythmTemplate(plan.rhythmTemplateId).label}`,
      '',
      ...plan.shots.map((s) =>
        `## ${PHASE_TAG[s.phase]} ${String(s.index).padStart(2, '0')} (${s.timeStartS}s–${s.timeEndS}s)\n` +
        `- 景别:${SHOT_SIZE_LABEL_ZH[s.shotSize]} · 运镜:${s.cameraMoveLabel} (Motion ${s.motion})\n` +
        `- 画面:${s.frameContent}\n- AI Prompt:\n\n\`\`\`\n${s.aiPrompt}\n\`\`\`\n`),
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${plan.title || 'shortvideo'}-storyboard.md`;
    a.click();
  }

  function sendToCreate() {
    if (!plan) return;
    const seed = `${plan.idea}\n\n[15s 三幕分镜]\n` +
      plan.shots.map((s) => `${PHASE_TAG[s.phase]} ${s.frameContent}（${s.cameraMoveLabel}）`).join('\n');
    try { sessionStorage.setItem('qfmj-create-seed', seed); } catch { /* ignore */ }
    router.push('/dashboard/create');
  }

  return (
    <div className="cinema-page min-h-screen px-5 py-5 max-w-[1680px] mx-auto">
      {/* ── 顶部:品牌 + 创意输入 + 时长 + 节奏模板 ── */}
      <header className="cinema-card-hi !p-4 mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-md grid place-items-center bg-zinc-800 border border-zinc-700">
              <Zap size={17} weight="fill" className="text-blue-400" />
            </div>
            <div>
              <div className="cinema-headline !text-lg leading-none">极速分镜台 <span className="cinema-mono text-blue-400">15s</span></div>
              <div className="cinema-eyebrow !mt-0.5">CINESPARK · 三幕极速短视频</div>
            </div>
          </div>

          <div className="flex-1 min-w-[280px]">
            <input
              className="cinema-input w-full"
              placeholder="输入创意,如:赛博朋克侦探在雨夜发现一个改变命运的线索"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !loading) generate(); }}
            />
          </div>

          {/* 时长锁定 */}
          <div className="shrink-0">
            <div className="cinema-eyebrow mb-1">时长锁定</div>
            <div className="flex gap-1">
              {SHORT_DURATIONS.map((d) => (
                <button key={d} onClick={() => setDurationS(d)}
                  className={`cinema-mono text-xs px-2.5 py-1.5 rounded-md border transition ${durationS === d ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)] hover:border-[var(--cinema-border-hi)]'}`}>
                  {d}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 节奏模板 + 风格 + 生成 */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {RHYTHM_TEMPLATES.map((t) => {
            const active = rhythmId === t.id;
            const Icon = t.id === 'suspense' ? Flame : t.id === 'blockbuster' ? Film : Sparkles;
            return (
              <button key={t.id} onClick={() => setRhythmId(t.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-left transition ${active ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--cinema-border)] hover:border-[var(--cinema-border-hi)]'}`}>
                <Icon size={15} className={active ? 'text-blue-400' : 'text-[var(--cinema-text-3)]'} />
                <span className="leading-tight">
                  <span className="block text-xs font-medium">{t.label}</span>
                  <span className="block cinema-mono text-[10px] opacity-60">{t.desc}</span>
                </span>
              </button>
            );
          })}
          <input className="cinema-input !py-1.5 !text-xs w-40" placeholder="画风(可选)" value={style} onChange={(e) => setStyle(e.target.value)} />
          <button onClick={generate} disabled={loading} className="ml-auto inline-flex items-center justify-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 font-medium text-sm rounded-sm px-5 py-2 transition disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {loading ? '生成分镜中…' : '生成分镜计划'}
          </button>
        </div>
        {error && <div className="mt-2 flex items-center gap-1.5 text-[var(--secondary)] text-xs"><AlertCircle size={13} />{error}</div>}
      </header>

      {/* ── 主体三栏 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr_270px] gap-4">
        {/* 左:运镜词库 */}
        <aside className="cinema-card !p-3 h-fit">
          <div className="cinema-eyebrow mb-2">15s 运镜词库</div>
          {(['hook', 'body', 'climax'] as ActPhase[]).map((phase, gi) => (
            <div key={phase} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: PHASE_COLOR[phase] }} />
                <span className="text-[11px] font-medium">{gi + 1}. {ACT_LABEL_ZH[phase]}</span>
              </div>
              <div className="flex flex-col gap-1">
                {cameraMovesByPhase(phase).map((m) => {
                  const usedBy = plan?.shots.find((s) => s.cameraMoveId === m.id);
                  return (
                    <button key={m.id}
                      onClick={() => { const tgt = plan?.shots.find((s) => s.phase === phase); if (tgt) patchShot(tgt.index, { cameraMoveId: m.id }); }}
                      disabled={!plan}
                      title={plan ? `应用到 ${PHASE_TAG[phase]} 镜` : '先生成分镜计划'}
                      className={`text-left px-2 py-1 rounded-md border text-[11px] transition disabled:opacity-40 ${usedBy ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--cinema-border)] hover:border-[var(--cinema-border-hi)]'}`}>
                      <span className="block leading-tight">{m.labelZh}</span>
                      <span className="block cinema-mono text-[9px] opacity-50">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* 中:三幕时间轴 + 分镜表 */}
        <main className="min-w-0">
          {!plan && !loading && (
            <div className="cinema-card grid place-items-center text-center py-20">
              <div>
                <Clapperboard size={40} className="mx-auto text-[var(--cinema-text-3)] mb-3" />
                <div className="cinema-subhead">输入创意,一键生成三幕分镜</div>
                <div className="cinema-mono text-[11px] opacity-50 mt-1">HOOK 钩子 · BODY 核心 · CLIMAX 高潮</div>
              </div>
            </div>
          )}
          {loading && (
            <div className="cinema-card grid place-items-center py-20">
              <Loader2 size={28} className="animate-spin text-blue-400" />
            </div>
          )}

          {plan && (
            <>
              {/* 三幕时间轴 */}
              <div className="cinema-card !p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="cinema-eyebrow">{plan.durationS}s 时间轴分镜</span>
                  <span className="cinema-mono text-[11px] text-blue-400">{plan.title}</span>
                </div>
                <div className="flex gap-px h-7 rounded-sm overflow-hidden">
                  {plan.acts.map((a) => (
                    <div key={a.phase} className="grid place-items-center" style={{ width: `${a.pct}%`, background: PHASE_COLOR[a.phase] }}>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-white/90">{PHASE_TAG[a.phase]} · {a.startS}–{a.endS}s</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 分镜表 — v8.3 P3: 交错入场 */}
              <div className="flex flex-col gap-3 stagger">
                {plan.shots.map((s) => {
                  const pv = previews[s.index];
                  return (
                    <div key={s.index} className="cinema-card !p-3">
                      <div className="grid grid-cols-[44px_1fr] gap-3">
                        {/* 镜号 + 幕色 */}
                        <div className="flex flex-col items-center gap-1">
                          <span className="cinema-mono text-lg font-medium">{String(s.index).padStart(2, '0')}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm text-white/90" style={{ background: PHASE_COLOR[s.phase] }}>{PHASE_TAG[s.phase]}</span>
                          <span className="cinema-mono text-[9px] opacity-60">{s.timeStartS}–{s.timeEndS}s</span>
                        </div>

                        <div className="min-w-0">
                          {/* 行 1:景别 + 运镜 + Motion */}
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <div className="flex gap-0.5">
                              {SHOT_SIZES.map((sz) => (
                                <button key={sz} onClick={() => patchShot(s.index, { shotSize: sz })}
                                  className={`cinema-mono text-[10px] px-1.5 py-0.5 rounded border transition ${s.shotSize === sz ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)] hover:border-[var(--cinema-border-hi)]'}`}
                                  title={SHOT_SIZE_LABEL_ZH[sz]}>{sz}</button>
                              ))}
                            </div>
                            <select value={s.cameraMoveId} onChange={(e) => patchShot(s.index, { cameraMoveId: e.target.value })}
                              className="cinema-input !py-1 !text-[11px] !w-auto">
                              {cameraMovesByPhase(s.phase).map((m) => <option key={m.id} value={m.id}>{m.labelZh} · {m.label}</option>)}
                            </select>
                            <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/25 rounded-sm px-1.5 py-0.5">Motion {s.motion}</span>
                            <span className="cinema-chip !text-[10px]">Camera: {s.cameraType}</span>
                          </div>

                          {/* 行 2:画面内容 */}
                          <p className="text-xs text-[var(--text)] mb-2 leading-relaxed">{s.frameContent}</p>

                          {/* 行 3:AI prompt(默认折叠,展开可上下滑)+ 预览图 */}
                          <div className="flex gap-2">
                            <details className="flex-1 min-w-0">
                              <summary className="cursor-pointer select-none text-[9px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300 py-0.5">展开 AI Prompt</summary>
                              <code className="mt-1.5 block cinema-mono text-[10px] leading-relaxed text-zinc-400 bg-[var(--cinema-surface)] rounded-sm p-2 max-h-40 overflow-auto custom-scrollbar">{s.aiPrompt}</code>
                            </details>
                            {pv?.url && <img loading="lazy" decoding="async" src={pv.url} alt="" className="w-16 h-28 object-cover rounded-sm border border-zinc-700" />}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <button onClick={() => previewShot(s)} disabled={pv?.loading} className="cinema-btn-ghost !text-[11px] !py-1">
                              {pv?.loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} 预览
                            </button>
                            <button onClick={() => copyPrompt(s)} className="cinema-btn-ghost !text-[11px] !py-1">
                              {copied === s.index ? <Check size={12} className="text-[var(--cinema-green)]" /> : <Copy size={12} />} 复制 Prompt
                            </button>
                            {pv?.err && <span className="text-[10px] text-[var(--secondary)]">{pv.err}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>

        {/* 右:短视频参数面板 */}
        <aside className="cinema-card !p-3 h-fit">
          <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><Gauge size={13} /> 短视频参数</div>
          {!plan && <div className="cinema-mono text-[11px] opacity-50">生成后可调参</div>}
          {plan && (
            <div className="flex flex-col gap-4">
              {/* 运动控制 */}
              <div>
                <div className="text-[11px] font-medium mb-1.5">运动控制</div>
                <label className="cinema-mono text-[10px] opacity-60 flex justify-between">Motion Intensity <span className="text-blue-400">{plan.params.motionIntensity}%</span></label>
                <input type="range" min={0} max={100} value={plan.params.motionIntensity}
                  onChange={(e) => patchParams({ motionIntensity: Number(e.target.value) })} className="w-full accent-blue-500" />
                <div className="flex gap-1 mt-1.5">
                  {(['slow', 'normal', 'fast'] as CameraSpeed[]).map((sp) => (
                    <button key={sp} onClick={() => patchParams({ cameraSpeed: sp })}
                      className={`flex-1 text-[10px] py-1 rounded border transition ${plan.params.cameraSpeed === sp ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)]'}`}>
                      {sp === 'slow' ? '慢' : sp === 'normal' ? '正常' : '快'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 视觉增强 */}
              <div>
                <div className="text-[11px] font-medium mb-1.5">视觉增强</div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="cinema-mono text-[10px] opacity-60">插帧 Interpolation</span>
                  <button onClick={() => patchParams({ interpolation: !plan.params.interpolation })}
                    className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${plan.params.interpolation ? 'border-[var(--cinema-green)] text-[var(--cinema-green)]' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)]'}`}>
                    {plan.params.interpolation ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="cinema-mono text-[10px] opacity-60">放大 Upscale</span>
                  <div className="flex gap-1">
                    {([1, 2, 4] as UpscaleFactor[]).map((u) => (
                      <button key={u} onClick={() => patchParams({ upscale: u })}
                        className={`cinema-mono text-[10px] px-2 py-0.5 rounded border ${plan.params.upscale === u ? 'border-blue-500 text-blue-400 bg-blue-500/10' : 'border-[var(--cinema-border)] text-[var(--cinema-text-3)]'}`}>{u}x</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 输出设置 */}
              <div>
                <div className="text-[11px] font-medium mb-1.5">输出设置</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select value={plan.params.resolution} onChange={(e) => patchParams({ resolution: e.target.value })} className="cinema-input !py-1 !text-[11px]">
                    {['1080P', '4K', '8K'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={plan.params.aspectRatio} onChange={(e) => patchParams({ aspectRatio: e.target.value as any })} className="cinema-input !py-1 !text-[11px]">
                    {['9:16', '16:9', '1:1', '2.39:1'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={plan.params.fps} onChange={(e) => patchParams({ fps: Number(e.target.value) })} className="cinema-input !py-1 !text-[11px] col-span-2">
                    {[24, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
                  </select>
                </div>
              </div>

              {/* 节奏分布 — 细条 + 数值行(替掉环形图,更专业) */}
              <div>
                <div className="text-[11px] font-medium mb-2 text-zinc-400">节奏分布</div>
                <div className="flex h-1.5 rounded-sm overflow-hidden mb-2">
                  {plan.acts.map((a) => (
                    <div key={a.phase} style={{ width: `${a.pct}%`, background: PHASE_COLOR[a.phase] }} />
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  {plan.acts.map((a) => (
                    <div key={a.phase} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-zinc-500">
                        <span className="w-1.5 h-1.5 rounded-sm" style={{ background: PHASE_COLOR[a.phase] }} />
                        {PHASE_TAG[a.phase]}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-300">{a.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={sendToCreate} className="w-full inline-flex items-center justify-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 font-medium text-sm rounded-sm py-2.5 transition">
                <Sparkles size={15} /> 用此方案去创作 <ArrowRight size={14} />
              </button>
              <div className="flex gap-1.5">
                <button onClick={exportMarkdown} className="cinema-btn-ghost flex-1 justify-center !text-[11px]"><Download size={12} /> 导出分镜表</button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* 底部状态条 */}
      {plan && (
        <div className="cinema-statusbar mt-4 flex-wrap">
          <span className="cinema-statusbar-item"><span className="cinema-statusbar-dot" /> 总时长 {plan.durationS}.0s</span>
          <span className="cinema-statusbar-item">{plan.shots.length} 镜</span>
          <span className="cinema-statusbar-item">{plan.params.resolution} · {plan.params.aspectRatio} · {plan.params.fps}fps</span>
          <span className="cinema-statusbar-item">节奏 {getRhythmTemplate(plan.rhythmTemplateId).label}</span>
          <span className="cinema-statusbar-item ml-auto cinema-mono opacity-60">CineSpark v7.6</span>
        </div>
      )}
    </div>
  );
}
