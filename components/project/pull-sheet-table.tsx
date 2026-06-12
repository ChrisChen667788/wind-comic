'use client';

/**
 * PullSheetTable (v11.1.0) — 拉片表(项目页「拉片」tab)。
 *
 * 五栏逐镜:叙事要素 / 时间 / 镜头语言 / 影像处理 / 声音(+ 叙事功能)。
 * 数据 = 流水线出厂真值(ScriptShot v2.8 摄影字段),不是 AI 看图猜;
 * 缺的字段如实显示 —。CSV 导出走同一 API(?format=csv)。
 */
import { useEffect, useState } from 'react';
import { DownloadSimple, FilmSlate } from '@phosphor-icons/react';
import type { PullSheet, PullSheetShot } from '@/lib/pull-sheet';

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
