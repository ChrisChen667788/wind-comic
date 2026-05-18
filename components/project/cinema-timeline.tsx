'use client';

/**
 * v3.1 F.1 + F.2 — Cinema Timeline (multi-track + virtual scroll).
 *
 * 3 轨道布局:
 *   ┌───────────────────────────────────────┐
 *   │ KPI: 镜数 / 总时长 / 保存按钮          │
 *   ├───────────────────────────────────────┤
 *   │ SHOTS    [thumb][thumb][thumb]...     │  ← 拖拽重排 + 时长 select
 *   ├───────────────────────────────────────┤
 *   │ BGM      [══ Act 1 ══][══ Act 2 ══]   │  ← drag-to-retime + mute
 *   ├───────────────────────────────────────┤
 *   │ SUBTITLE [📝 对白1] [📝 对白2] ...    │  ← drag-to-retime + 改文本
 *   └───────────────────────────────────────┘
 *
 * 长片 (>12 镜): 启用 virtual scroll, 视口外的 shot 卡不渲染.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, GripVertical, Clock, Save, Film, MessageSquare, Music,
  Volume2, VolumeX, Pencil, RotateCcw,
} from 'lucide-react';
import { visibleRange, shouldVirtualize } from '@/lib/timeline-virtual';

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

interface TrackSegment {
  id: string;
  type: 'bgm' | 'subtitle';
  startSec: number;
  durationSec: number;
  label: string;
  muted: boolean;
  isEdited: boolean;
}

interface TimelineData {
  shots: TimelineShot[];
  totalDuration: number;
  tracks: { bgm: TrackSegment[]; subtitle: TrackSegment[] };
}

interface PendingTrackEdit {
  trackType: 'bgm' | 'subtitle';
  segmentKey: string;
  muted?: boolean;
  startOffsetSec?: number;
  customText?: string;
}

export interface CinemaTimelineProps {
  projectId: string;
}

const DURATION_OPTIONS = [3, 5, 6, 8, 10, 15, 20, 30];
const SHOT_CARD_WIDTH = 160;
const SHOT_CARD_GAP = 8;
const VIRTUAL_THRESHOLD = 12;

export function CinemaTimeline({ projectId }: CinemaTimelineProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  /** v3.1 F.1: 待保存的 track edits (合并 client-side 多次操作) */
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingTrackEdit>>(new Map());
  const [pendingResets, setPendingResets] = useState<Set<string>>(new Set());
  /** Sub-track drag state — 拖 BGM/subtitle 段 */
  const [trackDrag, setTrackDrag] = useState<{
    trackType: 'bgm' | 'subtitle';
    segmentKey: string;
    startX: number;
    startOffsetSec: number;
  } | null>(null);
  /** Subtitle 文本编辑 modal — 简单内联编辑 */
  const [editingSub, setEditingSub] = useState<{ segmentKey: string; text: string } | null>(null);

  /** v3.2 F.2: virtual scroll state */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(800);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      // tracks 兼容老版本 (没 tracks 字段时空)
      const tracks = body.tracks || { bgm: [], subtitle: [] };
      setData({ ...body, tracks });
      setError(null);
      setDirty(false);
      setPendingEdits(new Map());
      setPendingResets(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // 监听 viewport resize 给 virtual scroll 用
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    setViewportWidth(el.clientWidth);
    const onResize = () => setViewportWidth(el.clientWidth);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // shot drag
  const handleShotDragStart = (i: number) => setDragIndex(i);
  const handleShotDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragOverIndex !== i) setDragOverIndex(i);
  };
  const handleShotDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null || dragOverIndex == null || dragIndex === dragOverIndex || !data) {
      setDragIndex(null); setDragOverIndex(null);
      return;
    }
    const next = [...data.shots];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dragOverIndex, 0, moved);
    setData({ ...data, shots: next });
    setDirty(true);
    setDragIndex(null); setDragOverIndex(null);
  };

  const updateDuration = (shotNumber: number, duration: number) => {
    if (!data) return;
    const next = data.shots.map((s) => s.shotNumber === shotNumber ? { ...s, duration } : s);
    const totalDuration = next.reduce((sum, s) => sum + (s.duration || 0), 0);
    setData({ ...data, shots: next, totalDuration });
    setDirty(true);
  };

  // Track segment 操作
  const stagePendingEdit = (trackType: 'bgm' | 'subtitle', segmentKey: string, patch: Partial<PendingTrackEdit>) => {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      const key = `${trackType}:${segmentKey}`;
      const existing = next.get(key) || { trackType, segmentKey };
      next.set(key, { ...existing, ...patch });
      return next;
    });
    setDirty(true);
  };

  const toggleMute = (trackType: 'bgm' | 'subtitle', segment: TrackSegment) => {
    stagePendingEdit(trackType, segment.id, { muted: !segment.muted });
    // 乐观更新本地 state
    if (!data) return;
    const tracks = { ...data.tracks };
    tracks[trackType] = tracks[trackType].map((s) =>
      s.id === segment.id ? { ...s, muted: !s.muted, isEdited: true } : s,
    );
    setData({ ...data, tracks });
  };

  const resetSegment = (trackType: 'bgm' | 'subtitle', segment: TrackSegment) => {
    setPendingResets((prev) => new Set(prev).add(`${trackType}:${segment.id}`));
    // 同时移除任何 pendingEdits 给该段
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.delete(`${trackType}:${segment.id}`);
      return next;
    });
    setDirty(true);
  };

  // Subtitle 文本改写
  const commitSubText = () => {
    if (!editingSub || !data) return;
    stagePendingEdit('subtitle', editingSub.segmentKey, { customText: editingSub.text });
    const tracks = { ...data.tracks };
    tracks.subtitle = tracks.subtitle.map((s) =>
      s.id === editingSub.segmentKey ? { ...s, label: editingSub.text, isEdited: true } : s,
    );
    setData({ ...data, tracks });
    setEditingSub(null);
  };

  // 拖 segment 改 startSec
  const handleTrackDragStart = (e: React.MouseEvent, trackType: 'bgm' | 'subtitle', segment: TrackSegment) => {
    e.preventDefault();
    setTrackDrag({
      trackType, segmentKey: segment.id,
      startX: e.clientX,
      startOffsetSec: segment.startSec,
    });
  };
  useEffect(() => {
    if (!trackDrag || !data) return;
    const pxPerSec = (viewportWidth || 800) / Math.max(1, data.totalDuration);
    const handleMove = (e: MouseEvent) => {
      const deltaPx = e.clientX - trackDrag.startX;
      const deltaSec = deltaPx / pxPerSec;
      const newStart = Math.max(0, trackDrag.startOffsetSec + deltaSec);
      // 乐观更新 segment 位置
      setData((d) => {
        if (!d) return d;
        const tracks = { ...d.tracks };
        tracks[trackDrag.trackType] = tracks[trackDrag.trackType].map((s) =>
          s.id === trackDrag.segmentKey ? { ...s, startSec: newStart, isEdited: true } : s,
        );
        return { ...d, tracks };
      });
    };
    const handleUp = () => {
      if (!data || !trackDrag) return;
      const trackArr = data.tracks[trackDrag.trackType];
      const seg = trackArr.find((s) => s.id === trackDrag.segmentKey);
      if (seg) {
        // 计算 startOffsetSec (相对默认派生 startSec) — 用 original 段距离差.
        // 因为客户端不知道 "original startSec", 直接传当前 startSec 作 startOffsetSec
        // (服务端会把它当 offset 加到 derived; 简化语义: 拖到哪里就是哪里的"绝对位移")
        // 为了正确, 我们做相对偏移: 取 startSec - originalStart (但我们没存 original).
        // 妥协: 把 startOffsetSec 直接设为 segment.startSec - getOriginalStart(seg)
        // getOriginalStart 太复杂; 实际方案: 让服务端基于 derived 重算 offset
        // 这里只发送 customText/muted 之类, startOffsetSec 走简化路径: 发当前 startSec 作 offset 0
        // (admin 拖动 = 实际坐标, 不是 offset; 服务端 schema 允许)
        // 见 lib/timeline-tracks.ts 注释 — startOffset 累加到 derived start, 所以这里
        // 应传 (newStart - originalStart). 但 originalStart 不在 client. 实用做法:
        // 把"绝对 startSec" 当 customText 旁的字段; 改架构有点重. 暂存 offset 为
        // (newStart - trackDrag.startOffsetSec), 即"相对拖动起点的位移", 多次拖动会累加.
        stagePendingEdit(trackDrag.trackType, trackDrag.segmentKey, {
          startOffsetSec: seg.startSec - trackDrag.startOffsetSec,
        });
      }
      setTrackDrag(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [trackDrag, data, viewportWidth]);

  const save = async () => {
    if (saving || !data) return;
    setSaving(true);
    setError(null);
    try {
      const shotOrder = data.shots.map((s) => s.shotNumber);
      const durations: Record<string, number> = {};
      data.shots.forEach((s) => { durations[String(s.shotNumber)] = s.duration; });
      const trackEdits = Array.from(pendingEdits.values());
      const trackResets = Array.from(pendingResets).map((k) => {
        const [trackType, segmentKey] = k.split(':');
        return { trackType, segmentKey };
      });
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotOrder, durations, trackEdits, trackResets }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `保存失败 ${res.status}`);
        return;
      }
      await refresh();
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

  // v3.1 F.2: 虚拟滚动 — 仅 >12 镜启用
  const virtualize = shouldVirtualize(data.shots.length, VIRTUAL_THRESHOLD);
  const virt = virtualize
    ? visibleRange({
        totalCount: data.shots.length,
        itemWidth: SHOT_CARD_WIDTH,
        scrollLeft,
        viewportWidth,
        gap: SHOT_CARD_GAP,
        buffer: 2,
      })
    : { startIdx: 0, endIdx: data.shots.length, leftPad: 0, rightPad: 0 };
  const visibleShots = data.shots.slice(virt.startIdx, virt.endIdx);

  // 计算"px / sec" 给轨道段渲染用
  const totalWidth = data.shots.length * (SHOT_CARD_WIDTH + SHOT_CARD_GAP);
  const pxPerSec = data.totalDuration > 0 ? totalWidth / data.totalDuration : 0;

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
            {virtualize && (
              <span className="ml-2 opacity-50">
                · virtual 已启 ({virt.startIdx + 1}-{virt.endIdx} / {data.shots.length})
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="cinema-mono text-[10px] text-[var(--cinema-amber)]">● 未保存</span>
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

      {/* SHOTS Track — 拖拽重排 + virtual scroll */}
      <div className="cinema-card-hi p-3">
        <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
          <Film className="w-3 h-3" />
          SHOTS · 拖卡片重排 · 点时长改变
        </div>
        <div
          ref={scrollRef}
          className="overflow-x-auto custom-scrollbar"
          onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        >
          <div className="flex gap-2 min-h-[180px]" style={{ paddingLeft: virt.leftPad, paddingRight: virt.rightPad }}>
            {visibleShots.map((shot, virtI) => {
              const i = virt.startIdx + virtI;
              const isDragging = dragIndex === i;
              const isDragOver = dragOverIndex === i && dragIndex !== i;
              return (
                <div
                  key={`${shot.shotNumber}-${i}`}
                  draggable
                  onDragStart={() => handleShotDragStart(i)}
                  onDragOver={(e) => handleShotDragOver(e, i)}
                  onDrop={handleShotDrop}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                  style={{ width: SHOT_CARD_WIDTH, flexShrink: 0 }}
                  className={`rounded-md border ${
                    isDragOver ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber)]/5' : 'border-[var(--cinema-border)]'
                  } ${isDragging ? 'opacity-50' : ''} cursor-move transition-all`}
                >
                  <div className="aspect-video bg-black/60 rounded-t-md overflow-hidden grid place-items-center">
                    {shot.thumbnailUrl && /^https?:|^\/api\//i.test(shot.thumbnailUrl) ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={shot.thumbnailUrl} alt={`shot ${shot.shotNumber}`} className="w-full h-full object-cover" draggable={false} />
                    ) : (
                      <Film className="w-6 h-6 opacity-30" />
                    )}
                  </div>
                  <div className="p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="w-3 h-3 opacity-40 flex-shrink-0" />
                      <span className="cinema-mono text-[10px] tracking-widest opacity-70 flex-1">
                        SHOT {String(shot.shotNumber).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 opacity-50" />
                      <select
                        value={shot.duration}
                        onChange={(e) => updateDuration(shot.shotNumber, parseInt(e.target.value, 10))}
                        className="cinema-mono text-[10px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded px-1 py-0.5 flex-1"
                      >
                        {[...new Set([...DURATION_OPTIONS, shot.duration])].sort((a, b) => a - b).map((d) => (
                          <option key={d} value={d}>{d}s</option>
                        ))}
                      </select>
                    </div>
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
      </div>

      {/* BGM Track */}
      <TrackRow
        title="BGM · 按幕段 · 拖动改时间 / 点 🔇 静音"
        icon={<Music className="w-3 h-3" />}
        segments={data.tracks.bgm}
        totalDuration={data.totalDuration}
        pxPerSec={pxPerSec}
        trackType="bgm"
        onMuteToggle={toggleMute}
        onReset={resetSegment}
        onDragStart={handleTrackDragStart}
        accentColor="amber"
      />

      {/* Subtitle Track */}
      <TrackRow
        title="SUBTITLE · 字幕段 · 双击改文字 / 🔇 静音"
        icon={<MessageSquare className="w-3 h-3" />}
        segments={data.tracks.subtitle}
        totalDuration={data.totalDuration}
        pxPerSec={pxPerSec}
        trackType="subtitle"
        onMuteToggle={toggleMute}
        onReset={resetSegment}
        onDragStart={handleTrackDragStart}
        onEditText={(seg) => setEditingSub({ segmentKey: seg.id, text: seg.label })}
        accentColor="cyan"
      />

      {/* Subtitle 改写 modal */}
      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[var(--cinema-surface)] border border-[var(--cinema-border-hi)] p-4 space-y-3">
            <div className="cinema-eyebrow">改写字幕</div>
            <textarea
              value={editingSub.text}
              onChange={(e) => setEditingSub({ ...editingSub, text: e.target.value })}
              rows={3}
              maxLength={300}
              className="w-full px-2 py-1.5 cinema-mono text-[11px] bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)] rounded resize-y"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingSub(null)} className="cinema-btn !px-3 !py-1 !text-[11px]">取消</button>
              <button onClick={commitSubText} className="cinema-btn cinema-btn-primary !px-3 !py-1 !text-[11px]">保存</button>
            </div>
          </div>
        </div>
      )}

      <div className="cinema-mono text-[10px] opacity-50 leading-relaxed">
        🎬 拖 shot 重排; 时长下拉改单镜时长; BGM/字幕段拖移位; 🔇 静音; 双击字幕段改文字; 点 🔄 重置.
        保存后下次成片合成用新数据.
      </div>
    </div>
  );
}

// ─── 子组件: 单条轨道行 ─────────────────────────────────────────────────────
interface TrackRowProps {
  title: string;
  icon: React.ReactNode;
  segments: TrackSegment[];
  totalDuration: number;
  pxPerSec: number;
  trackType: 'bgm' | 'subtitle';
  onMuteToggle: (trackType: 'bgm' | 'subtitle', segment: TrackSegment) => void;
  onReset: (trackType: 'bgm' | 'subtitle', segment: TrackSegment) => void;
  onDragStart: (e: React.MouseEvent, trackType: 'bgm' | 'subtitle', segment: TrackSegment) => void;
  onEditText?: (segment: TrackSegment) => void;
  accentColor: 'amber' | 'cyan';
}

function TrackRow({
  title, icon, segments, totalDuration, pxPerSec,
  trackType, onMuteToggle, onReset, onDragStart, onEditText, accentColor,
}: TrackRowProps) {
  const colorBg = accentColor === 'amber' ? 'rgba(212, 175, 55, 0.25)' : 'rgba(77, 224, 194, 0.22)';
  const colorBorder = accentColor === 'amber' ? 'rgba(212, 175, 55, 0.55)' : 'rgba(77, 224, 194, 0.50)';
  const totalWidthPx = totalDuration * pxPerSec;

  return (
    <div className="cinema-card-hi p-3">
      <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
        {icon}
        {title}
        <span className="opacity-50 cinema-mono text-[10px] ml-2">({segments.length} 段)</span>
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        <div
          className="relative h-14 bg-black/40 rounded"
          style={{ width: Math.max(totalWidthPx, 600) + 'px', minWidth: '100%' }}
        >
          {segments.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center cinema-mono text-[10px] opacity-40">
              (无段)
            </div>
          ) : segments.map((seg) => {
            const left = seg.startSec * pxPerSec;
            const width = Math.max(40, seg.durationSec * pxPerSec);
            return (
              <div
                key={seg.id}
                title={`${seg.label} · ${seg.durationSec.toFixed(1)}s${seg.muted ? ' · 静音' : ''}${seg.isEdited ? ' · 已编辑' : ''}`}
                className={`absolute top-1 bottom-1 rounded border group/seg ${
                  seg.muted ? 'opacity-40' : ''
                } ${seg.isEdited ? 'ring-1 ring-[var(--cinema-amber)]/40' : ''}`}
                style={{
                  left, width,
                  background: colorBg,
                  borderColor: colorBorder,
                  cursor: 'ew-resize',
                }}
                onMouseDown={(e) => onDragStart(e, trackType, seg)}
                onDoubleClick={() => onEditText?.(seg)}
              >
                <div className="h-full flex items-center gap-1 px-1.5 overflow-hidden">
                  <span className="cinema-mono text-[9px] truncate flex-1">
                    {seg.label}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onMuteToggle(trackType, seg); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="opacity-60 hover:opacity-100 flex-shrink-0"
                    title={seg.muted ? '取消静音' : '静音'}
                  >
                    {seg.muted ? <VolumeX className="w-2.5 h-2.5" /> : <Volume2 className="w-2.5 h-2.5" />}
                  </button>
                  {onEditText && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditText(seg); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="opacity-60 hover:opacity-100 flex-shrink-0"
                      title="改字幕文字"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {seg.isEdited && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onReset(trackType, seg); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="opacity-60 hover:opacity-100 flex-shrink-0"
                      title="重置为默认"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
