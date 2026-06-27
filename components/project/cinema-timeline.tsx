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
import { CircleNotch as Loader2, DotsSixVertical as GripVertical, Clock, FloppyDisk as Save, FilmStrip as Film, Chat as MessageSquare, MusicNotes as Music, SpeakerHigh as Volume2, SpeakerSlash as VolumeX, Pencil, ArrowCounterClockwise as RotateCcw, ArrowUUpLeft as Undo2, ArrowUUpRight as Redo2, Magnet, Microphone, Play } from '@phosphor-icons/react';
import { visibleRange, shouldVirtualize } from '@/lib/timeline-virtual';
import { useYjs } from '@/hooks/use-yjs';
import { useAudioWaveform, sliceWaveform } from '@/hooks/use-audio-waveform';
import { computeSnap } from '@/lib/timeline-snap';
import { computeRipple } from '@/lib/timeline-ripple';
import { bestAlignHint } from '@/lib/timeline-align';
import { TimelineHistory } from '@/lib/timeline-history';
import { useSegmentLocks, type LockEntry } from '@/hooks/use-segment-locks';

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
  type: 'bgm' | 'subtitle' | 'narration';
  startSec: number;
  durationSec: number;
  label: string;
  muted: boolean;
  isEdited: boolean;
  /** v3.1.2 server 返的派生默认值, client 算 offset 用 */
  derivedStartSec: number;
  derivedDurationSec: number;
  /** v3.1.3 P1: BGM 段挂全片 mp3 URL, 切片画真波形 */
  audioUrl?: string;
}

interface TimelineData {
  shots: TimelineShot[];
  totalDuration: number;
  tracks: { bgm: TrackSegment[]; subtitle: TrackSegment[]; narration?: TrackSegment[] };
}

interface PendingTrackEdit {
  trackType: 'bgm' | 'subtitle';
  segmentKey: string;
  muted?: boolean;
  startOffsetSec?: number;
  /** v3.1.2 拖右边沿改时长 — 用绝对值, 服务端按 override 存 */
  durationOverrideSec?: number;
  customText?: string;
}

export interface CinemaTimelineProps {
  projectId: string;
  /** v3.1.2 P4: 当前用户信息 — Yjs cursor 标签 + skip 自身 cursor */
  currentUser?: { id: string; name: string; avatarUrl: string | null };
}

interface RemoteCursor {
  userId: string;
  userName: string;
  timeSec: number;
  color: string;
  /** 上次更新时间 — 老的不渲染 */
  updatedAt: number;
}

const CURSOR_COLORS = [
  '#E8C547', '#4DE0C2', '#F472B6', '#A78BFA',
  '#FB7185', '#34D399', '#60A5FA', '#FBBF24',
];
function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

const DURATION_OPTIONS = [3, 5, 6, 8, 10, 15, 20, 30];
const SHOT_CARD_WIDTH = 160;
const SHOT_CARD_GAP = 8;
const VIRTUAL_THRESHOLD = 12;

export function CinemaTimeline({ projectId, currentUser }: CinemaTimelineProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [narrating, setNarrating] = useState(false); // v6.2.4 解说音轨生成中
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  /** v3.1 F.1: 待保存的 track edits (合并 client-side 多次操作) */
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingTrackEdit>>(new Map());
  const [pendingResets, setPendingResets] = useState<Set<string>>(new Set());
  /**
   * Sub-track drag state — 拖 BGM/subtitle 段.
   * v3.1.2 三种模式: 整段移位 / 左边沿改 startOffset 同时保 endSec / 右边沿改 durationOverride.
   * derivedStartSec 是 server 给的派生默认值, 用它算最终 absoluteStart - derived = offset 写回.
   */
  const [trackDrag, setTrackDrag] = useState<{
    trackType: 'bgm' | 'subtitle';
    segmentKey: string;
    startX: number;
    /** 拖动起点的 segment startSec (绝对) */
    initialStartSec: number;
    /** 拖动起点的 segment durationSec (绝对) */
    initialDurationSec: number;
    /** 派生 startSec (server-side derived) */
    derivedStartSec: number;
    /** 派生 durationSec (server-side derived) */
    derivedDurationSec: number;
    /** 操作类型 */
    mode: 'move' | 'resize-left' | 'resize-right';
  } | null>(null);
  /** Subtitle 文本编辑 modal — 简单内联编辑 */
  const [editingSub, setEditingSub] = useState<{ segmentKey: string; text: string } | null>(null);

  /** v3.2 F.2: virtual scroll state */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  /** v3.1.2 P4: 多人协作时间线光标 — 走 Yjs awareness */
  const yjs = useYjs(currentUser ? `project-${projectId}` : null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  /** v3.1.3 P2: snap 命中 — 当前正闪光的 segmentKey, 200ms 后清 */
  const [snapFlash, setSnapFlash] = useState<string | null>(null);
  /** v3.1.3 P4: 协作段锁 — 检测被别人锁的段, drag start 时也要 acquire */
  const segLocks = useSegmentLocks(
    currentUser ? projectId : null,
    currentUser ? { id: currentUser.id, name: currentUser.name, color: pickColor(currentUser.id) } : null,
  );
  /** 试图拿锁失败时的提示 toast (3s 自动清) */
  const [lockToast, setLockToast] = useState<{ segmentKey: string; lockedBy: string } | null>(null);
  /** 容器 ref — 计算 mouseX 相对位置, 反推 timeSec 写到 awareness */
  const tracksContainerRef = useRef<HTMLDivElement | null>(null);
  const cursorBroadcastThrottleRef = useRef<number>(0);
  const [viewportWidth, setViewportWidth] = useState(800);

  // ─── v3.3.1: undo/redo + ripple + 对齐参考线 ───────────────────────────────
  /** 编辑历史栈 (data + pendingEdits + pendingResets 快照). */
  const historyRef = useRef(new TimelineHistory<TimelineSnapshot>(50));
  /** 强制重渲染 undo/redo 按钮可用态 (栈深变了 UI 要更新). */
  const [historyTick, setHistoryTick] = useState(0);
  /** ripple mode: 拖/改一段时, 后段连动. */
  const [rippleMode, setRippleMode] = useState(false);
  /** 拖动中的对齐参考线全局位置 (秒), null = 不画. */
  const [alignGuideSec, setAlignGuideSec] = useState<number | null>(null);

  type TimelineSnapshot = {
    data: TimelineData | null;
    pendingEdits: Map<string, PendingTrackEdit>;
    pendingResets: Set<string>;
  };

  /** 抓当前可编辑状态的深拷贝快照. */
  const snapshotNow = useCallback((): TimelineSnapshot => ({
    data: data ? (typeof structuredClone === 'function'
      ? structuredClone(data)
      : JSON.parse(JSON.stringify(data))) : null,
    pendingEdits: new Map(pendingEdits),
    pendingResets: new Set(pendingResets),
  }), [data, pendingEdits, pendingResets]);

  /** 一次编辑前调: 把当前状态压入 undo 栈. */
  const pushHistory = useCallback(() => {
    historyRef.current.push(snapshotNow());
    setHistoryTick((t) => t + 1);
  }, [snapshotNow]);

  const applySnapshot = useCallback((s: TimelineSnapshot) => {
    setData(s.data);
    setPendingEdits(new Map(s.pendingEdits));
    setPendingResets(new Set(s.pendingResets));
    setDirty(true);
  }, []);

  const doUndo = useCallback(() => {
    const prev = historyRef.current.undo(snapshotNow());
    if (prev) { applySnapshot(prev); setHistoryTick((t) => t + 1); }
  }, [snapshotNow, applySnapshot]);

  const doRedo = useCallback(() => {
    const next = historyRef.current.redo(snapshotNow());
    if (next) { applySnapshot(next); setHistoryTick((t) => t + 1); }
  }, [snapshotNow, applySnapshot]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      // tracks 兼容老版本 (没 tracks 字段时空)
      const tracks = body.tracks || { bgm: [], subtitle: [], narration: [] };
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

  // v6.2.4: 由分镜旁白文本真出解说音轨 → 落盘 + 串进时间线, 然后刷新
  const genNarration = useCallback(async () => {
    if (!data) return;
    const text = data.shots
      .map((s) => s.sceneDescription || s.action || s.dialogue || '')
      .filter(Boolean)
      .join('\n');
    setNarrating(true);
    try {
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/narration`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text || '本集旁白。', mode: 'narrator' }),
      });
      await refresh();
    } catch { /* ignore */ }
    finally { setNarrating(false); }
  }, [data, projectId, refresh]);

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
    pushHistory();
    const next = [...data.shots];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dragOverIndex, 0, moved);
    setData({ ...data, shots: next });
    setDirty(true);
    setDragIndex(null); setDragOverIndex(null);
  };

  const updateDuration = (shotNumber: number, duration: number) => {
    if (!data) return;
    pushHistory();
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
    pushHistory();
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
    pushHistory();
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
    pushHistory();
    stagePendingEdit('subtitle', editingSub.segmentKey, { customText: editingSub.text });
    const tracks = { ...data.tracks };
    tracks.subtitle = tracks.subtitle.map((s) =>
      s.id === editingSub.segmentKey ? { ...s, label: editingSub.text, isEdited: true } : s,
    );
    setData({ ...data, tracks });
    setEditingSub(null);
  };

  // 拖 segment — 三种模式: move (整段平移) / resize-left / resize-right
  const handleTrackDragStart = (
    e: React.MouseEvent,
    trackType: 'bgm' | 'subtitle',
    segment: TrackSegment,
    mode: 'move' | 'resize-left' | 'resize-right' = 'move',
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // v3.1.3 P4: 尝试 acquire 协作锁; 失败 → 别人在改, 弹 toast 不让本端拖
    const acquired = segLocks.tryAcquire(segment.id);
    if (!acquired) {
      const lock = segLocks.locks[segment.id];
      setLockToast({ segmentKey: segment.id, lockedBy: lock?.userName || '另一位用户' });
      setTimeout(() => setLockToast(null), 3000);
      return;
    }
    // v3.3.1: 一次拖动手势压一个 undo 快照 (不是每个 mousemove)
    pushHistory();
    setTrackDrag({
      trackType,
      segmentKey: segment.id,
      startX: e.clientX,
      initialStartSec: segment.startSec,
      initialDurationSec: segment.durationSec,
      derivedStartSec: segment.derivedStartSec,
      derivedDurationSec: segment.derivedDurationSec,
      mode,
    });
  };
  useEffect(() => {
    if (!trackDrag || !data) return;
    const pxPerSec = (viewportWidth || 800) / Math.max(1, data.totalDuration);

    const handleMove = (e: MouseEvent) => {
      const deltaSec = (e.clientX - trackDrag.startX) / pxPerSec;
      setData((d) => {
        if (!d) return d;
        const tracks = { ...d.tracks };
        const siblings = tracks[trackDrag.trackType];

        // 1) 算 proposed (无 snap)
        let proposedStart: number;
        let proposedDuration: number;
        if (trackDrag.mode === 'move') {
          proposedStart = Math.max(0, trackDrag.initialStartSec + deltaSec);
          proposedDuration = trackDrag.initialDurationSec;
        } else if (trackDrag.mode === 'resize-right') {
          proposedStart = trackDrag.initialStartSec;
          proposedDuration = Math.max(0.5, trackDrag.initialDurationSec + deltaSec);
        } else {
          // resize-left
          const initialEnd = trackDrag.initialStartSec + trackDrag.initialDurationSec;
          const clampedStart = Math.max(0, Math.min(initialEnd - 0.5, trackDrag.initialStartSec + deltaSec));
          proposedStart = clampedStart;
          proposedDuration = initialEnd - clampedStart;
        }

        // 2) v3.1.3 P2: snap to neighbors + 硬 clamp 防重叠
        const snapInput = {
          selfId: trackDrag.segmentKey,
          allSegments: siblings.map((s) => ({ id: s.id, startSec: s.startSec, durationSec: s.durationSec })),
          proposedStart,
          proposedDuration,
          totalDuration: d.totalDuration,
        };
        const snap = computeSnap(snapInput);
        if (snap.snapped) {
          setSnapFlash(trackDrag.segmentKey);
          setTimeout(() => setSnapFlash((cur) => cur === trackDrag.segmentKey ? null : cur), 200);
        }

        // v3.3.1: 对齐参考线 — 找最近的 left/right/center 对齐候选, 画竖线
        const align = bestAlignHint({
          selfId: trackDrag.segmentKey,
          allSegments: siblings.map((s) => ({ id: s.id, startSec: s.startSec, durationSec: s.durationSec })),
          proposedStart: snap.startSec,
          durationSec: snap.durationSec,
        });
        setAlignGuideSec(align ? align.guideSec : null);

        tracks[trackDrag.trackType] = siblings.map((s) => {
          if (s.id !== trackDrag.segmentKey) return s;
          if (trackDrag.mode === 'resize-right') {
            return { ...s, durationSec: snap.durationSec, isEdited: true };
          }
          return { ...s, startSec: snap.startSec, durationSec: snap.durationSec, isEdited: true };
        });
        return { ...d, tracks };
      });
    };

    const handleUp = () => {
      if (!data || !trackDrag) return;
      const trackArr = data.tracks[trackDrag.trackType];
      const seg = trackArr.find((s) => s.id === trackDrag.segmentKey);
      if (seg) {
        // v3.1.2 修复: 用 derivedStartSec 算绝对 offset, 多次拖动也对.
        const patch: Partial<PendingTrackEdit> = {};
        if (trackDrag.mode === 'move' || trackDrag.mode === 'resize-left') {
          patch.startOffsetSec = seg.startSec - trackDrag.derivedStartSec;
        }
        if (trackDrag.mode === 'resize-left' || trackDrag.mode === 'resize-right') {
          patch.durationOverrideSec = seg.durationSec;
        }
        if (Object.keys(patch).length > 0) {
          stagePendingEdit(trackDrag.trackType, trackDrag.segmentKey, patch);
        }

        // v3.3.1: ripple — 后段连动 (move / resize-right 才推下游)
        if (rippleMode && (trackDrag.mode === 'move' || trackDrag.mode === 'resize-right')) {
          const deltaSec = trackDrag.mode === 'resize-right'
            ? seg.durationSec - trackDrag.initialDurationSec
            : seg.startSec - trackDrag.initialStartSec;
          const anchorSec = trackDrag.initialStartSec + trackDrag.initialDurationSec;
          if (Math.abs(deltaSec) > 0.01) {
            const ripple = computeRipple({
              editedId: trackDrag.segmentKey,
              allSegments: trackArr.map((s) => ({ id: s.id, startSec: s.startSec, durationSec: s.durationSec })),
              deltaSec, anchorSec, totalDuration: data.totalDuration,
            });
            if (ripple.shiftedIds.length > 0) {
              const shiftMap = new Map(ripple.segments.map((s) => [s.id, s]));
              setData((d) => {
                if (!d) return d;
                const tracks = { ...d.tracks };
                tracks[trackDrag.trackType] = d.tracks[trackDrag.trackType].map((s) => {
                  const r = shiftMap.get(s.id);
                  return r && ripple.shiftedIds.includes(s.id)
                    ? { ...s, startSec: r.startSec, isEdited: true } : s;
                });
                return { ...d, tracks };
              });
              for (const id of ripple.shiftedIds) {
                const shifted = shiftMap.get(id);
                const orig = trackArr.find((s) => s.id === id);
                if (shifted && orig) {
                  stagePendingEdit(trackDrag.trackType, id, { startOffsetSec: shifted.startSec - orig.derivedStartSec });
                }
              }
            }
          }
        }
      }
      // v3.1.3 P4: 释放协作锁
      if (trackDrag) segLocks.release(trackDrag.segmentKey);
      setTrackDrag(null);
      setAlignGuideSec(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [trackDrag, data, viewportWidth, rippleMode]);

  // ─── v3.3.1: undo/redo 键盘快捷键 (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z / Ctrl+Y) ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  // ─── v3.1.2 P4: Yjs awareness 时间线光标 ───────────────────────────────────
  // 本地: setLocalStateField('timelineCursor', { timeSec, color }) — 50ms 节流
  // 远端: awareness.on('change') → 渲染 RemoteCursor[]
  useEffect(() => {
    if (!yjs || !currentUser) return;
    const aw = yjs.provider.awareness;
    const onChange = () => {
      const states = Array.from(aw.getStates().entries());
      const now = Date.now();
      const remote: RemoteCursor[] = [];
      for (const [clientId, state] of states) {
        const u = (state as any)?.user;
        const cur = (state as any)?.timelineCursor;
        if (!u || !u.id || !cur || typeof cur.timeSec !== 'number') continue;
        if (u.id === currentUser.id) continue; // skip self
        void clientId;
        remote.push({
          userId: String(u.id),
          userName: String(u.name || '匿名'),
          timeSec: cur.timeSec,
          color: typeof cur.color === 'string' ? cur.color : pickColor(String(u.id)),
          updatedAt: now,
        });
      }
      setRemoteCursors(remote);
    };
    aw.on('change', onChange);
    onChange();
    return () => aw.off('change', onChange);
  }, [yjs, currentUser]);

  // 本地 mousemove → 写 awareness (50ms 节流)
  const handleTracksMouseMove = useCallback((e: React.MouseEvent) => {
    if (!yjs || !currentUser || !data) return;
    const now = performance.now();
    if (now - cursorBroadcastThrottleRef.current < 50) return;
    cursorBroadcastThrottleRef.current = now;
    const container = tracksContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relX = e.clientX - rect.left + container.scrollLeft;
    const totalWidth = data.shots.length * (SHOT_CARD_WIDTH + SHOT_CARD_GAP);
    const pxPerSecLocal = data.totalDuration > 0 ? totalWidth / data.totalDuration : 0;
    if (pxPerSecLocal <= 0) return;
    const timeSec = Math.max(0, Math.min(data.totalDuration, relX / pxPerSecLocal));
    try {
      yjs.provider.awareness.setLocalStateField('timelineCursor', {
        timeSec,
        color: pickColor(currentUser.id),
      });
    } catch { /* ignore */ }
  }, [yjs, currentUser, data]);

  // 鼠标离开 timeline 容器 → 清自己的 cursor (别人就看不到我的"幽灵光标")
  const handleTracksMouseLeave = useCallback(() => {
    if (!yjs || !currentUser) return;
    try {
      yjs.provider.awareness.setLocalStateField('timelineCursor', null);
    } catch { /* ignore */ }
  }, [yjs, currentUser]);

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
          {/* v3.3.1: undo / redo / ripple toggle */}
          <button
            onClick={doUndo}
            disabled={!historyRef.current.canUndo()}
            title="撤销 (Ctrl/Cmd+Z)"
            className="cinema-btn !px-2 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-30"
          >
            <Undo2 className="w-3 h-3" />
          </button>
          <button
            onClick={doRedo}
            disabled={!historyRef.current.canRedo()}
            title="重做 (Ctrl/Cmd+Shift+Z)"
            className="cinema-btn !px-2 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-30"
          >
            <Redo2 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setRippleMode((v) => !v)}
            title="联动模式: 拖/改一段时后段一起移动"
            className={`cinema-btn !px-2 !py-1 !text-[11px] inline-flex items-center gap-1 ${rippleMode ? 'cinema-btn-primary' : ''}`}
          >
            <Magnet className="w-3 h-3" />
            联动{rippleMode ? '开' : '关'}
          </button>
          {/* historyTick 触发按钮可用态重渲染 */}
          <span className="hidden">{historyTick}</span>
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
                      <img loading="lazy" decoding="async" src={shot.thumbnailUrl} alt={`shot ${shot.shotNumber}`} className="w-full h-full object-cover" draggable={false} />
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

      {/* v3.1.2 P4: BGM + Subtitle 轨道 + 实时光标 overlay 包成一个 ref 容器 */}
      <div
        ref={tracksContainerRef}
        className="relative space-y-3"
        onMouseMove={handleTracksMouseMove}
        onMouseLeave={handleTracksMouseLeave}
      >
        {/* BGM Track — v3.1.2 加波形 + 双边沿 resize */}
        <TrackRow
          title="BGM · 按幕段 · 拖中间平移 / 拖边沿改时长 / 点轨首图标静音"
          icon={<Music className="w-3 h-3" />}
          segments={data.tracks.bgm}
          totalDuration={data.totalDuration}
          pxPerSec={pxPerSec}
          trackType="bgm"
          onMuteToggle={toggleMute}
          onReset={resetSegment}
          onDragStart={handleTrackDragStart}
          showWaveform
          snapFlashId={snapFlash}
          remoteLocks={segLocks.locks}
          currentUserId={currentUser?.id}
          accentColor="amber"
        />

        {/* Subtitle Track — v3.1.2 加双边沿 resize 改时长 */}
        <TrackRow
          title="SUBTITLE · 字幕段 · 拖边沿改时长 / 双击改文字 / 点轨首图标静音"
          icon={<MessageSquare className="w-3 h-3" />}
          segments={data.tracks.subtitle}
          totalDuration={data.totalDuration}
          pxPerSec={pxPerSec}
          trackType="subtitle"
          onMuteToggle={toggleMute}
          onReset={resetSegment}
          onDragStart={handleTrackDragStart}
          onEditText={(seg) => setEditingSub({ segmentKey: seg.id, text: seg.label })}
          snapFlashId={snapFlash}
          remoteLocks={segLocks.locks}
          currentUserId={currentUser?.id}
          accentColor="cyan"
        />

        {/* v6.2.4: 生成 / 重生解说音轨 (由分镜旁白真出 TTS + 落盘 + 串进时间线) */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={genNarration}
            disabled={narrating}
            className="px-2.5 py-1 rounded text-[10px] font-medium border transition-all hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-1"
            style={{ background: 'color-mix(in srgb, var(--cinema-violet) 14%, transparent)', color: 'var(--cinema-violet)', borderColor: 'color-mix(in srgb, var(--cinema-violet) 32%, transparent)' }}
          >
            <Microphone size={11} weight="fill" /> {narrating ? '生成中…' : (data.tracks.narration && data.tracks.narration.length > 0 ? '重生解说音轨' : '生成解说音轨')}
          </button>
          <span className="text-[10px] text-[var(--soft)]">由分镜旁白真出 TTS + 落盘 + 串进时间线 (字幕并入 SUBTITLE)</span>
        </div>

        {/* v6.2.4: 解说音轨 (只读) — 真出落盘音频; 字幕已并入 SUBTITLE 轨可烧录 */}
        {data.tracks.narration && data.tracks.narration.length > 0 && (() => {
          const narr = data.tracks.narration;
          const narrEnd = narr.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);
          const laneWidth = Math.max(data.totalDuration, narrEnd) * pxPerSec;
          return (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5 text-[10px] mb-1 px-1" style={{ color: 'color-mix(in srgb, var(--cinema-violet) 88%, var(--cinema-text-2))' }}>
                <Microphone size={11} weight="fill" /><span>NARRATION · 解说音轨 (只读) · 字幕已并入 SUBTITLE 轨</span>
              </div>
              <div className="relative h-9 rounded-md border" style={{ width: laneWidth, background: 'color-mix(in srgb, var(--cinema-violet) 5%, transparent)', borderColor: 'color-mix(in srgb, var(--cinema-violet) 18%, transparent)' }}>
                {narr.map((seg) => (
                  <div
                    key={seg.id}
                    className="absolute top-1 bottom-1 rounded px-1.5 flex items-center gap-1 overflow-hidden border"
                    style={{ left: seg.startSec * pxPerSec, width: Math.max(10, seg.durationSec * pxPerSec), background: 'color-mix(in srgb, var(--cinema-violet) 22%, transparent)', borderColor: 'color-mix(in srgb, var(--cinema-violet) 34%, transparent)' }}
                    title={seg.label}
                  >
                    {seg.audioUrl && (
                      <a href={seg.audioUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 hover:brightness-125 inline-flex" style={{ color: 'var(--cinema-violet)' }} title="播放 / 下载"><Play size={10} weight="fill" /></a>
                    )}
                    <span className="text-[10px] truncate" style={{ color: 'color-mix(in srgb, var(--cinema-violet) 70%, var(--cinema-text))' }}>{seg.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* v3.3.1: 对齐参考线 — 拖动中显示左/右/中对齐到的位置 */}
        {alignGuideSec != null && trackDrag && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none z-10"
            style={{ left: alignGuideSec * pxPerSec, transform: 'translateX(-1px)' }}
            aria-hidden="true"
          >
            <div className="w-px h-full bg-[var(--cinema-magenta,#e879f9)] opacity-80"
              style={{ backgroundImage: 'repeating-linear-gradient(to bottom, currentColor 0 4px, transparent 4px 8px)', color: '#e879f9' }} />
          </div>
        )}

        {/* v3.1.2 P4: 远端协作者光标 — 跨两条轨道画垂直线 + 名字标 */}
        {remoteCursors.length > 0 && (
          <div className="absolute inset-0 pointer-events-none z-20" aria-hidden="true">
            {remoteCursors.map((c) => {
              const left = c.timeSec * pxPerSec;
              return (
                <div
                  key={c.userId}
                  className="absolute top-0 bottom-0 flex flex-col items-start"
                  style={{ left, transform: 'translateX(-1px)' }}
                >
                  <div
                    className="w-0.5 h-full opacity-80"
                    style={{ background: c.color, boxShadow: `0 0 4px ${c.color}` }}
                  />
                  <div
                    className="absolute -top-1 left-1 px-1 py-0.5 rounded cinema-mono text-[9px] whitespace-nowrap"
                    style={{ background: c.color, color: '#000' }}
                  >
                    {c.userName}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* v3.1.3 P4: 锁冲突 toast — 用户试图拖被别人锁的段时弹出 */}
      {lockToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 cinema-card-hi px-4 py-2 flex items-center gap-2 shadow-2xl border-[var(--cinema-amber)]/50">
          <span className="cinema-mono text-[11px]">
            🔒 <span className="text-[var(--cinema-amber)]">{lockToast.lockedBy}</span> 正在编辑这一段, 你需要等他/她改完
          </span>
        </div>
      )}

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
        拖 shot 重排 · 时长下拉改单镜时长 · BGM / 字幕段拖移位 · 双击字幕段改文字 · 轨首图标静音 / 重置.
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
  onDragStart: (
    e: React.MouseEvent,
    trackType: 'bgm' | 'subtitle',
    segment: TrackSegment,
    mode?: 'move' | 'resize-left' | 'resize-right',
  ) => void;
  onEditText?: (segment: TrackSegment) => void;
  /** v3.1.2 BGM 段下面画 procedural waveform */
  showWaveform?: boolean;
  /** v3.1.3 P2: 刚 snap 命中的 segmentKey, 闪光提示 */
  snapFlashId?: string | null;
  /** v3.1.3 P4: 远端协作锁 — segmentKey → 锁主 */
  remoteLocks?: Record<string, LockEntry>;
  /** 当前用户 id, 用来过滤掉自己的锁 */
  currentUserId?: string;
  accentColor: 'amber' | 'cyan';
}

/**
 * v3.1.3 P1: BGM 段波形渲染.
 * 有 audioUrl + decode 成功 → 真波形 (Web Audio API decode + slice 段时间范围)
 * 否则 → procedural fallback (segmentKey 做 hash 输出 SVG path)
 *
 * 注意: 必须放在循环外做 component, 不然 hook 顺序变.
 */
function SegmentWaveform({
  seg, width, height, color,
}: {
  seg: TrackSegment;
  width: number;
  height: number;
  color: string;
}) {
  const decoded = useAudioWaveform(seg.audioUrl);
  const bars = Math.min(64, Math.max(12, Math.floor(width / 8)));
  if (decoded) {
    // 真波形: 切片 derivedStartSec..derivedDurationSec
    const slice = sliceWaveform(decoded, seg.derivedStartSec, seg.derivedDurationSec, bars);
    if (slice.length > 0) {
      return (
        <svg
          className="absolute inset-0 pointer-events-none"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          {Array.from(slice).map((amp, i) => {
            const x = (i + 0.5) * (width / slice.length);
            const a = amp * (height * 0.4); // 振幅 0..1 → 0..h*0.4
            const cy = height / 2;
            return (
              <line
                key={i}
                x1={x} y1={cy - a}
                x2={x} y2={cy + a}
                stroke={color}
                strokeWidth={1}
              />
            );
          })}
        </svg>
      );
    }
  }
  // Fallback: procedural
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <path
        d={buildWaveformPath(seg.id, width, height, bars)}
        stroke={color}
        strokeWidth={1}
        fill="none"
      />
    </svg>
  );
}

/**
 * v3.1.2 procedural BGM 波形 — 用 segmentKey 做确定性 hash 出 SVG path.
 * 不真去 decode mp3, 但视觉上跟 BGM 关联稳定 (同一段一直长同样).
 * 用作 fallback (audioUrl 缺失 / decode 失败).
 */
function buildWaveformPath(seed: string, width: number, height: number, bars = 48): string {
  // 简易 hash: char-code sum
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cy = height / 2;
  const barWidth = width / bars;
  const path: string[] = [];
  for (let i = 0; i < bars; i++) {
    // 伪随机数 — Park-Miller LCG variant
    h = (h * 16807) % 2147483647;
    const norm = (h / 2147483647); // 0..1
    // 越靠近段中部能量越强 (像真 BGM 的"高潮段")
    const distFromMid = Math.abs(i - bars / 2) / (bars / 2);
    const envelope = 1 - distFromMid * 0.5;
    const amplitude = (0.2 + norm * 0.8) * envelope * (height * 0.4);
    const x = i * barWidth + barWidth / 2;
    path.push(`M${x.toFixed(1)},${(cy - amplitude).toFixed(1)} L${x.toFixed(1)},${(cy + amplitude).toFixed(1)}`);
  }
  return path.join(' ');
}

function TrackRow({
  title, icon, segments, totalDuration, pxPerSec,
  trackType, onMuteToggle, onReset, onDragStart, onEditText,
  showWaveform, snapFlashId, remoteLocks, currentUserId, accentColor,
}: TrackRowProps) {
  const colorBg = accentColor === 'amber' ? 'rgba(212, 175, 55, 0.25)' : 'rgba(77, 224, 194, 0.22)';
  const colorBorder = accentColor === 'amber' ? 'rgba(212, 175, 55, 0.55)' : 'rgba(77, 224, 194, 0.50)';
  const waveformColor = accentColor === 'amber' ? 'rgba(212, 175, 55, 0.6)' : 'rgba(77, 224, 194, 0.6)';
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
            // v3.1.3 P4: 检测是否被远端用户锁住 — 锁主不是自己时禁用拖动 + 显示锁标
            const lockEntry = remoteLocks?.[seg.id];
            const isLockedByOther = !!lockEntry && lockEntry.userId !== currentUserId;
            const tooltip = isLockedByOther
              ? `🔒 ${lockEntry.userName} 正在编辑这段, 等一下`
              : `${seg.label} · ${seg.durationSec.toFixed(1)}s${seg.muted ? ' · 静音' : ''}${seg.isEdited ? ' · 已编辑' : ''}`;
            return (
              <div
                key={seg.id}
                title={tooltip}
                className={`absolute top-1 bottom-1 rounded border group/seg ${
                  seg.muted ? 'opacity-40' : ''
                } ${seg.isEdited ? 'ring-1 ring-[var(--cinema-amber)]/40' : ''} ${
                  snapFlashId === seg.id ? 'ring-2 ring-white/80 transition-shadow' : ''
                } ${isLockedByOther ? 'pointer-events-none' : ''}`}
                style={{
                  left, width,
                  background: isLockedByOther ? `rgba(150, 150, 150, 0.2)` : colorBg,
                  borderColor: isLockedByOther ? lockEntry.color : colorBorder,
                  borderStyle: isLockedByOther ? 'dashed' : 'solid',
                  cursor: isLockedByOther ? 'not-allowed' : 'grab',
                }}
                onMouseDown={(e) => !isLockedByOther && onDragStart(e, trackType, seg, 'move')}
                onDoubleClick={() => !isLockedByOther && onEditText?.(seg)}
              >
                {/* v3.1.3 P4: 远端锁标 — 角标显示谁在编辑 */}
                {isLockedByOther && (
                  <div
                    className="absolute -top-2 left-1 cinema-mono text-[8px] px-1 py-0.5 rounded whitespace-nowrap pointer-events-auto z-30"
                    style={{ background: lockEntry.color, color: '#000' }}
                  >
                    🔒 {lockEntry.userName} 编辑中
                  </div>
                )}
                {/* v3.1.3 P1: BGM 真波形 (有 audioUrl decode 成功) or procedural fallback */}
                {showWaveform && width > 20 && (
                  <SegmentWaveform seg={seg} width={width} height={48} color={waveformColor} />
                )}
                {/* v3.1.2 左边沿 resize 手柄 — 改 startOffset + 同步缩短 duration 让 endSec 不变 */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-white/30 transition-colors"
                  onMouseDown={(e) => onDragStart(e, trackType, seg, 'resize-left')}
                  title="拖左边沿改起点 (右端固定)"
                />
                {/* v3.1.2 右边沿 resize 手柄 — 改 duration, startSec 不变 */}
                <div
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-white/30 transition-colors"
                  onMouseDown={(e) => onDragStart(e, trackType, seg, 'resize-right')}
                  title="拖右边沿改时长 (起点固定)"
                />
                <div className="relative h-full flex items-center gap-1 px-2.5 overflow-hidden z-[1]">
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
