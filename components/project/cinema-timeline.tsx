'use client';

/**
 * v3.1 F — Cinema Timeline MVP.
 *
 * 横向时间线: 每个 shot 一张缩略卡 + 时长 + 对白预览, 可拖拽重排, 可改时长.
 * 完整 Logic Pro 风格 (多轨道, BGM/字幕拖拽) 留 v3.1.x.
 *
 * UI:
 *   ┌─────────────────────────────────────────┐
 *   │ 📽️ TIMELINE · 6 shots, 30s 总时长     │
 *   ├─────────────────────────────────────────┤
 *   │ [thumb1] [thumb2] [thumb3] ...           │
 *   │  5s      6s      10s                     │
 *   │  "对白"  "对白"   "对白"                 │
 *   └─────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, GripVertical, Clock, Save, Film, MessageSquare } from 'lucide-react';

interface TimelineShot {
  shotNumber: number;
  duration: number;
  dialogue: string;
  action?: string;
  sceneDescription?: string;
  characters?: string[];
  thumbnailUrl: string | null;
  videoUrl: string | null;
}

interface TimelineData {
  shots: TimelineShot[];
  totalDuration: number;
}

export interface CinemaTimelineProps {
  projectId: string;
}

const DURATION_OPTIONS = [3, 5, 6, 8, 10, 15, 20, 30];

export function CinemaTimeline({ projectId }: CinemaTimelineProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
      setError(null);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 拖拽重排
  const handleDragStart = (i: number) => {
    setDragIndex(i);
  };
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragOverIndex !== i) setDragOverIndex(i);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null || dragOverIndex == null || dragIndex === dragOverIndex || !data) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...data.shots];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dragOverIndex, 0, moved);
    setData({ ...data, shots: next });
    setDirty(true);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const updateDuration = (shotNumber: number, duration: number) => {
    if (!data) return;
    const next = data.shots.map((s) => s.shotNumber === shotNumber ? { ...s, duration } : s);
    const totalDuration = next.reduce((sum, s) => sum + (s.duration || 0), 0);
    setData({ shots: next, totalDuration });
    setDirty(true);
  };

  const save = async () => {
    if (saving || !data) return;
    setSaving(true);
    setError(null);
    try {
      const shotOrder = data.shots.map((s) => s.shotNumber);
      // 把 duration map 按 *当前* shotNumber 提交 (shotNumber 在重排后会被服务端重分配)
      const durations: Record<string, number> = {};
      data.shots.forEach((s) => { durations[String(s.shotNumber)] = s.duration; });
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotOrder, durations }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `保存失败 ${res.status}`);
        return;
      }
      await refresh(); // 服务端可能重分配了 shotNumber, 拉回最新
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="cinema-card-hi p-6 text-center inline-flex items-center justify-center gap-2 w-full">
        <Loader2 className="w-4 h-4 animate-spin opacity-50" />
        <span className="cinema-mono text-[11px] opacity-50">加载时间线...</span>
      </div>
    );
  }

  if (!data || data.shots.length === 0) {
    return (
      <div className="cinema-card-hi p-6 text-center">
        <Film className="w-8 h-8 mx-auto opacity-30 mb-2" />
        <div className="cinema-mono text-[11px] opacity-50">
          暂无时间线 — 等编剧完成本项目后这里会显示镜头序列
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header KPI */}
      <div className="cinema-card-hi p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="cinema-eyebrow flex items-center gap-1.5">
            <Film className="w-3 h-3" />
            CINEMA TIMELINE
          </div>
          <span className="cinema-mono text-[11px] opacity-70">
            {data.shots.length} 镜 · {Math.round(data.totalDuration)}s 总时长
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="cinema-mono text-[10px] text-[var(--cinema-amber)]">
              ● 未保存
            </span>
          )}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="cinema-btn cinema-btn-primary !px-3 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            保存
          </button>
        </div>
      </div>

      {error && (
        <div className="cinema-card p-2 border-[var(--cinema-red)]/40">
          <span className="cinema-mono text-[10px] text-[var(--cinema-red)]">✗ {error}</span>
        </div>
      )}

      {/* Timeline track — 横向滚动 */}
      <div className="cinema-card-hi p-3 overflow-x-auto custom-scrollbar">
        <div className="flex gap-2 min-h-[180px]">
          {data.shots.map((shot, i) => {
            const isDragging = dragIndex === i;
            const isDragOver = dragOverIndex === i && dragIndex !== i;
            return (
              <div
                key={`${shot.shotNumber}-${i}`}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={handleDrop}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                className={`flex-shrink-0 w-40 rounded-md border ${
                  isDragOver ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber)]/5' : 'border-[var(--cinema-border)]'
                } ${
                  isDragging ? 'opacity-50' : ''
                } cursor-move transition-all`}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-black/60 rounded-t-md overflow-hidden grid place-items-center">
                  {shot.thumbnailUrl && /^https?:|^\/api\//i.test(shot.thumbnailUrl) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={shot.thumbnailUrl} alt={`shot ${shot.shotNumber}`} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <Film className="w-6 h-6 opacity-30" />
                  )}
                </div>
                {/* Meta */}
                <div className="p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <GripVertical className="w-3 h-3 opacity-40 flex-shrink-0" />
                    <span className="cinema-mono text-[10px] tracking-widest opacity-70 flex-1">
                      SHOT {String(shot.shotNumber).padStart(2, '0')}
                    </span>
                  </div>
                  {/* Duration selector */}
                  <div className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 opacity-50" />
                    <select
                      value={shot.duration}
                      onChange={(e) => updateDuration(shot.shotNumber, parseInt(e.target.value, 10))}
                      className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-1 py-0.5 flex-1"
                    >
                      {/* 当前 duration 如果不在标准选项里, 加上 */}
                      {[...new Set([...DURATION_OPTIONS, shot.duration])].sort((a, b) => a - b).map((d) => (
                        <option key={d} value={d}>{d}s</option>
                      ))}
                    </select>
                  </div>
                  {/* Dialogue preview */}
                  {shot.dialogue && (
                    <div className="cinema-mono text-[9px] opacity-60 line-clamp-2 inline-flex items-start gap-1">
                      <MessageSquare className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                      <span>{shot.dialogue}</span>
                    </div>
                  )}
                  {shot.characters && shot.characters.length > 0 && (
                    <div className="flex flex-wrap gap-0.5">
                      {shot.characters.slice(0, 2).map((c) => (
                        <span key={c} className="cinema-mono text-[8px] px-1 py-0.5 rounded bg-[var(--cinema-amber)]/10 text-[var(--cinema-amber)]">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audio track placeholder (v3.1.x 真正轨道) */}
      <div className="cinema-card p-3">
        <div className="cinema-eyebrow mb-2 opacity-50">AUDIO TRACK · 预留 (v3.1.x)</div>
        <div className="relative h-8 bg-black/40 rounded overflow-hidden">
          {data.shots.map((shot, i) => {
            const cumulativeBefore = data.shots.slice(0, i).reduce((sum, s) => sum + s.duration, 0);
            const widthPct = (shot.duration / data.totalDuration) * 100;
            const leftPct = (cumulativeBefore / data.totalDuration) * 100;
            return (
              <div
                key={i}
                title={`Shot ${shot.shotNumber} · ${shot.duration}s${shot.dialogue ? ' · ' + shot.dialogue.slice(0, 30) : ''}`}
                className={`absolute top-0 bottom-0 ${shot.dialogue ? 'bg-[var(--cinema-amber)]/30 border border-[var(--cinema-amber)]/50' : 'bg-white/5 border border-white/10'}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              >
                {shot.dialogue && (
                  <div className="px-1 cinema-mono text-[8px] opacity-80 line-clamp-1 leading-8">
                    🎙️
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="cinema-mono text-[9px] opacity-40 mt-1">
          琥珀色段 = 有 TTS 对白; 灰色段 = 静默. 拖拽编辑留 v3.1.x.
        </div>
      </div>

      <div className="cinema-mono text-[10px] opacity-50 leading-relaxed">
        拖拽 shot 卡片重排; 改时长直接选下拉. 保存后整片重新合成时会用新顺序/时长.
      </div>
    </div>
  );
}
