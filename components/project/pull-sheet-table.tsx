'use client';

/**
 * PullSheetTable (v11.1.0) — 拉片表(项目页「拉片」tab)。
 *
 * 五栏逐镜:叙事要素 / 时间 / 镜头语言 / 影像处理 / 声音(+ 叙事功能)。
 * 数据 = 流水线出厂真值(ScriptShot v2.8 摄影字段),不是 AI 看图猜;
 * 缺的字段如实显示 —。CSV 导出走同一 API(?format=csv)。
 */
import { useCallback, useEffect, useState } from 'react';
import { DownloadSimple, FilmSlate, CircleNotch, LinkSimple } from '@phosphor-icons/react';
import type { PullSheet, PullSheetShot } from '@/lib/pull-sheet';
import { getToken } from '@/lib/auth';
import { ReplicateWorkbench } from './replicate-workbench';

interface ExternalSheetRow { id: string; name: string; createdAt: string; sheet: PullSheet & { labeledShots?: number; truncated?: boolean } }

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  factory: { label: '出厂真值', cls: 'text-emerald-300 border-emerald-500/30' },
  vision: { label: 'Vision 打标', cls: 'text-sky-300 border-sky-500/30' },
  skeleton: { label: '骨架(配 Vision key 可逐镜打标)', cls: 'text-white/50 border-white/15' },
};

const GROUPS: Array<{ title: string; rows: Array<{ key: keyof PullSheetShot; label: string }> }> = [
  {
    title: '叙事要素',
    rows: [
      { key: 'scene', label: '场景' },
      { key: 'characters', label: '角色' },
      { key: 'dialogue', label: '台词对白' },
    ],
  },
  {
    title: '时间',
    rows: [
      { key: 'durationSec', label: '时长' },
      { key: 'startSec', label: '开始' },
      { key: 'endSec', label: '结束' },
    ],
  },
  {
    title: '镜头语言',
    rows: [
      { key: 'shotSize', label: '景别' },
      { key: 'composition', label: '构图' },
      { key: 'cameraMovement', label: '运镜方法' },
      { key: 'lens', label: '焦距与景深' },
    ],
  },
  {
    title: '影像处理',
    rows: [
      { key: 'lightingIntent', label: '光影与色调' },
      { key: 'editPattern', label: '剪辑' },
    ],
  },
  {
    title: '声音',
    rows: [
      { key: 'scoreMood', label: '音乐情绪' },
      { key: 'soundDesign', label: '音效设计' },
      { key: 'storyBeat', label: '分镜功能' },
      { key: 'whyThisChoice', label: '镜头叙事功能' },
    ],
  },
];

function cell(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.join('、') : '—';
  if (typeof v === 'number') {
    // 时间列:秒,保留到毫秒级可读(对齐拉片惯例)
    return `${v}s`;
  }
  const s = typeof v === 'string' ? v.trim() : '';
  return s || '—';
}

export function PullSheetTable({ projectId }: { projectId: string }) {
  const [sheet, setSheet] = useState<PullSheet | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pull-sheet`);
        if (alive && res.ok) setSheet(await res.json());
      } catch { /* 非关键路径 */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  if (loading) {
    return <div className="cinema-card-hi p-6 text-center cinema-mono text-[11px] opacity-50">拉片表生成中…</div>;
  }
  if (!sheet || sheet.shots.length === 0) {
    return (
      <div className="cinema-card-hi p-6 text-center cinema-mono text-[11px] opacity-50">
        暂无镜头数据 — 项目生成剧本后这里会出现逐镜拉片表
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pull-sheet">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="cinema-eyebrow flex items-center gap-1.5"><FilmSlate className="w-3.5 h-3.5" />拉片分析</div>
          <p className="cinema-mono text-[10px] opacity-50 mt-0.5">
            {sheet.shotCount} 镜 · 全片 {sheet.totalDurationSec}s · 出厂参数真值(流水线生成时的真实摄影语言,非 AI 看图反推)
          </p>
        </div>
        <a
          href={`/api/projects/${encodeURIComponent(projectId)}/pull-sheet?format=csv`}
          className="cinema-btn !px-2.5 !py-1.5 !text-[11px] inline-flex items-center gap-1.5"
          download
        >
          <DownloadSimple className="w-3.5 h-3.5" />导出 CSV
        </a>
      </div>

      <SheetView sheet={sheet} />

      {/* v11.1.2 — 复刻 · 替换工作台(本项目出厂表) */}
      <ReplicateWorkbench projectId={projectId} sheetSource="factory" />

      {/* v11.1.1 — 外部参考片拆条 + 拉片 */}
      <ExternalPullSection projectId={projectId} />
    </div>
  );
}

function SheetView({ sheet }: { sheet: PullSheet }) {
  return (
    <div className="space-y-4">
      {sheet.shots.map((s) => (
        <div key={s.shotNumber} className="cinema-card-hi p-4">
          <div className="flex gap-4">
            {/* 左:缩略图 + 镜号 + 画面内容 */}
            <div className="w-44 shrink-0">
              {s.videoUrl ? (
                <video src={s.videoUrl} poster={s.thumbnail || undefined} controls preload="metadata"
                  className="w-full aspect-video object-cover rounded-md border border-[var(--cinema-border)] bg-black" />
              ) : s.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumbnail} alt={`镜 ${s.shotNumber} 分镜图`}
                  className="w-full aspect-video object-cover rounded-md border border-[var(--cinema-border)]" loading="lazy" />
              ) : (
                <div className="w-full aspect-video rounded-md border border-[var(--cinema-border)] bg-black/30 flex items-center justify-center cinema-mono text-[10px] opacity-40">无画面</div>
              )}
              <div className="cinema-headline text-sm mt-2">镜头 {s.shotNumber}</div>
              <p className="text-[11px] text-[var(--cinema-text-3)] mt-1 leading-relaxed">{cell(s.description)}</p>
            </div>

            {/* 右:五栏 */}
            <div className="flex-1 grid grid-cols-2 lg:grid-cols-5 gap-x-5 gap-y-3 min-w-0">
              {GROUPS.map((g) => (
                <div key={g.title} className="min-w-0">
                  <div className="cinema-eyebrow !text-[9px] mb-1.5 border-b border-[var(--cinema-border)] pb-1">{g.title}</div>
                  <dl className="space-y-1.5">
                    {g.rows.map((r) => (
                      <div key={String(r.key)}>
                        <dt className="cinema-mono text-[9px] opacity-45">{r.label}</dt>
                        <dd className="text-[11px] text-[var(--cinema-text-2)] leading-snug break-words">{cell(s[r.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExternalPullSection({ projectId }: { projectId: string }) {
  const [sheets, setSheets] = useState<ExternalSheetRow[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pull-sheet?external=1`);
      if (res.ok) setSheets((await res.json()).sheets || []);
    } catch { /* 非关键路径 */ }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const submit = async () => {
    const videoUrl = url.trim();
    if (!videoUrl) return;
    setBusy(true); setNotice('');
    try {
      const t = getToken();
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pull-sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ videoUrl }),
      });
      const b = await res.json();
      if (res.ok) {
        setNotice(b.queued ? `已入队拆条(任务 ${b.jobId})— 完成后自动出现在下方` : `拆条完成:${b.done?.shots ?? 0} 镜${b.done?.labeled ? `,Vision 打标 ${b.done.labeled} 镜` : '(骨架表)'}`);
        setUrl('');
        await refresh();
      } else setNotice(b.message || '拆条失败');
    } catch { setNotice('拆条失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="cinema-card-hi p-4 mt-6" data-testid="external-pull">
      <div className="cinema-eyebrow mb-1">参考片拉片(外部视频)</div>
      <p className="cinema-mono text-[10px] opacity-50 mb-3">
        贴视频 URL → ffmpeg 场景切分出骨架表(切点/时长/缩略图全真);配 Vision key 后逐镜打标镜头语言。
        请确认你对参考素材的使用权 —— 拉片用于结构学习与二次创作,不复制原片内容。
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <LinkSimple className="w-3.5 h-3.5 opacity-50 shrink-0" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="https://… 或 /api/serve-file?key=…"
          aria-label="参考片视频 URL"
          className="cinema-input flex-1 min-w-[240px] !text-[12px]"
        />
        <button onClick={submit} disabled={busy || !url.trim()} className="cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <CircleNotch className="w-3.5 h-3.5 animate-spin" /> : <FilmSlate className="w-3.5 h-3.5" />}拉片
        </button>
        <button onClick={refresh} className="cinema-btn !px-2.5 !py-1.5 !text-[11px]">刷新</button>
      </div>
      {notice && <p className="mt-2 text-[11px] text-[var(--cinema-amber)]" role="status">{notice}</p>}

      {sheets.length > 0 && (
        <div className="mt-4 space-y-3">
          {sheets.map((row) => {
            const badge = SOURCE_BADGE[row.sheet.source] || SOURCE_BADGE.skeleton;
            const isOpen = expanded === row.id;
            return (
              <div key={row.id}>
                <button onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="w-full flex items-center gap-2 text-left text-[12px] text-white/80 py-1.5">
                  <span className="font-medium">{row.name}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] border ${badge.cls}`}>{badge.label}</span>
                  <span className="cinema-mono text-[10px] opacity-45">
                    {row.sheet.shotCount} 镜 · {row.sheet.totalDurationSec}s{row.sheet.truncated ? ' · 超长截断' : ''}
                  </span>
                  <span className="ml-auto text-[10px] text-white/40">{isOpen ? '收起 ▲' : '展开 ▼'}</span>
                </button>
                {isOpen && <><SheetView sheet={row.sheet} /><ReplicateWorkbench projectId={projectId} sheetSource={row.id} /></>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
