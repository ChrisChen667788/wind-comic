/**
 * v3.1 F.1 — Cinema timeline multi-track segments.
 *
 * 派生 + 覆盖模型:
 *   1. 默认 BGM 段 = script 里按 act 分段 (v2.16 P1.1 per-act BGM 算法的简化版)
 *      - script.shots[].act 字段决定段边界 (从 1 → 2 切, 从 2 → 3 切)
 *      - 没 act 字段 → 整片 1 段
 *   2. 默认字幕段 = 每个 shot.dialogue 一段, 起止 = shot 累计时长
 *   3. 用户编辑覆盖 (project_track_edits) — muted/移位/改写
 *
 * 输出统一 TrackSegment 形状, UI 直接渲染:
 *   { id, type, startSec, durationSec, label, muted, isEdited }
 */
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';
import type { Script, ScriptShot } from '@/types/agents';

export type TrackType = 'bgm' | 'subtitle';

export interface TrackSegment {
  id: string;              // 稳定 id (segment_key) — 供 UI dedupe + 写 override 用
  type: TrackType;
  startSec: number;        // 相对全片起始秒 (含 override)
  durationSec: number;     // 当前生效时长 (含 override)
  label: string;           // BGM: "Act 1" / 字幕: 原对白文本 (含 override)
  muted: boolean;
  /** 是否已被用户 override (UI 高亮显示) */
  isEdited: boolean;
  /**
   * v3.1.2: 派生默认起始秒 (不含任何 override).
   * Client 用这个算正确的 startOffsetSec:
   *   下一次拖动后 → server-side offset = newAbsoluteStart - derivedStartSec
   * 避免老 UI 多次拖动累加导致 offset 错位.
   */
  derivedStartSec: number;
  /** v3.1.2: 派生默认时长 — 同上, 给 duration override 计算用 */
  derivedDurationSec: number;
  /**
   * v3.1.3 P1: 真音频 URL — 主要给 BGM 段, 让前端用 Web Audio API decode
   * + 切片渲染真波形. 字幕段不挂.
   * 多 BGM 段共用同一个 mp3 (整片合并的最终配乐), 切片靠 derivedStartSec/derivedDurationSec.
   */
  audioUrl?: string;
}

interface TrackEditRow {
  id: string;
  project_id: string;
  track_type: string;
  segment_key: string;
  muted: number;
  start_offset_sec: number | null;
  duration_override_sec: number | null;
  custom_text: string | null;
  updated_at: string;
}

function readEdits(projectId: string): Map<string, TrackEditRow> {
  const rows = db.prepare(
    `SELECT * FROM project_track_edits WHERE project_id = ?`,
  ).all(projectId) as TrackEditRow[];
  const out = new Map<string, TrackEditRow>();
  for (const r of rows) {
    out.set(`${r.track_type}:${r.segment_key}`, r);
  }
  return out;
}

/**
 * 派生 BGM 段 — 按 shot.act 分组. 没 act 字段时整片 1 段.
 * 标签: "Act 1" / "Act 2" / "Act 3".
 */
function deriveBgmSegments(shots: ScriptShot[]): Array<{ key: string; start: number; duration: number; label: string }> {
  const out: Array<{ key: string; start: number; duration: number; label: string }> = [];
  if (shots.length === 0) return out;
  let currentAct = (shots[0] as any).act || 1;
  let segStart = 0;
  let segDuration = 0;
  let cursor = 0;
  for (let i = 0; i <= shots.length; i++) {
    const s = i < shots.length ? shots[i] : null;
    const act = s ? ((s as any).act || currentAct) : -1;
    if (s === null || act !== currentAct) {
      // close current segment
      out.push({
        key: `bgm-act-${currentAct}-${segStart}`,
        start: segStart,
        duration: segDuration,
        label: `Act ${currentAct}`,
      });
      if (s) {
        currentAct = act;
        segStart = cursor;
        segDuration = s.duration || 5;
        cursor += s.duration || 5;
      }
    } else if (s) {
      const d = s.duration || 5;
      segDuration += d;
      cursor += d;
    }
  }
  return out;
}

/**
 * 派生字幕段 — 每个 shot.dialogue 一段, 起始 = 累计时长.
 * 无 dialogue 的 shot 跳过 (不产生静默字幕).
 */
function deriveSubtitleSegments(shots: ScriptShot[]): Array<{ key: string; start: number; duration: number; label: string }> {
  const out: Array<{ key: string; start: number; duration: number; label: string }> = [];
  let cursor = 0;
  for (const s of shots) {
    const dialogue = (s.dialogue || '').trim();
    const dur = s.duration || 5;
    if (dialogue) {
      out.push({
        key: `subtitle-shot-${s.shotNumber}`,
        start: cursor,
        duration: dur,
        label: dialogue,
      });
    }
    cursor += dur;
  }
  return out;
}

/**
 * 把派生段 + 用户 override 合并成最终 TrackSegment[].
 */
function applyOverrides(
  type: TrackType,
  derived: Array<{ key: string; start: number; duration: number; label: string }>,
  editsByKey: Map<string, TrackEditRow>,
): TrackSegment[] {
  return derived.map((seg) => {
    const edit = editsByKey.get(`${type}:${seg.key}`);
    if (!edit) {
      return {
        id: seg.key, type, startSec: seg.start, durationSec: seg.duration,
        label: seg.label, muted: false, isEdited: false,
        derivedStartSec: seg.start, derivedDurationSec: seg.duration,
      };
    }
    const startSec = Math.max(0, seg.start + (edit.start_offset_sec || 0));
    const durationSec = edit.duration_override_sec && edit.duration_override_sec > 0
      ? edit.duration_override_sec
      : seg.duration;
    const label = edit.custom_text || seg.label;
    return {
      id: seg.key, type,
      startSec, durationSec,
      label,
      muted: edit.muted === 1,
      isEdited: true,
      derivedStartSec: seg.start,
      derivedDurationSec: seg.duration,
    };
  });
}

/**
 * v3.1.3 P1: 查项目的 BGM 音频 URL (saveAsset(_, 'music', ...) 存在 media_urls[0]).
 * 没有 → null, 前端走 procedural waveform fallback.
 */
function findProjectMusicUrl(projectId: string): string | null {
  try {
    const row = db.prepare(
      `SELECT media_urls FROM project_assets
       WHERE project_id = ? AND type = 'music'
       ORDER BY created_at DESC LIMIT 1`,
    ).get(projectId) as { media_urls: string } | undefined;
    if (!row?.media_urls) return null;
    const arr = JSON.parse(row.media_urls);
    if (Array.isArray(arr) && typeof arr[0] === 'string') return arr[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * 给项目算出 BGM + subtitle 完整轨道. UI 直接消费.
 * v3.1.3 P1: BGM 段挂 audioUrl, 前端切片画真波形.
 */
export function computeTracks(projectId: string, script: Script): { bgm: TrackSegment[]; subtitle: TrackSegment[] } {
  const shots = Array.isArray(script.shots) ? script.shots : [];
  const edits = readEdits(projectId);
  const bgmDerived = deriveBgmSegments(shots);
  const subDerived = deriveSubtitleSegments(shots);
  const bgmSegments = applyOverrides('bgm', bgmDerived, edits);
  const musicUrl = findProjectMusicUrl(projectId);
  if (musicUrl) {
    for (const seg of bgmSegments) seg.audioUrl = musicUrl;
  }
  return {
    bgm: bgmSegments,
    subtitle: applyOverrides('subtitle', subDerived, edits),
  };
}

export interface SegmentOverride {
  trackType: TrackType;
  segmentKey: string;
  muted?: boolean;
  startOffsetSec?: number;
  durationOverrideSec?: number;
  customText?: string;
}

/**
 * UPSERT 一组用户编辑. 透传所有提供的字段, undefined 字段不动 (合并语义).
 */
export function applyTrackEdits(projectId: string, edits: SegmentOverride[]): void {
  if (!Array.isArray(edits) || edits.length === 0) return;
  const txn = db.transaction(() => {
    for (const e of edits) {
      if (e.trackType !== 'bgm' && e.trackType !== 'subtitle') continue;
      if (!e.segmentKey || typeof e.segmentKey !== 'string') continue;
      // 取现有 row (如有), 合并语义
      const existing = db.prepare(
        `SELECT * FROM project_track_edits WHERE project_id = ? AND track_type = ? AND segment_key = ?`,
      ).get(projectId, e.trackType, e.segmentKey) as TrackEditRow | undefined;
      const muted = e.muted !== undefined ? (e.muted ? 1 : 0) : (existing?.muted ?? 0);
      const startOffset = e.startOffsetSec !== undefined ? e.startOffsetSec : existing?.start_offset_sec ?? null;
      const durationOverride = e.durationOverrideSec !== undefined ? e.durationOverrideSec : existing?.duration_override_sec ?? null;
      const customText = e.customText !== undefined ? e.customText : existing?.custom_text ?? null;
      if (existing) {
        db.prepare(`
          UPDATE project_track_edits
          SET muted = ?, start_offset_sec = ?, duration_override_sec = ?, custom_text = ?, updated_at = ?
          WHERE id = ?
        `).run(muted, startOffset, durationOverride, customText, now(), existing.id);
      } else {
        db.prepare(`
          INSERT INTO project_track_edits
          (id, project_id, track_type, segment_key, muted, start_offset_sec, duration_override_sec, custom_text, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nanoid(), projectId, e.trackType, e.segmentKey, muted, startOffset, durationOverride, customText, now());
      }
    }
  });
  txn();
}

/** 重置某段 (删 override 行, 回退到默认派生). */
export function resetTrackEdit(projectId: string, trackType: TrackType, segmentKey: string): boolean {
  const r = db.prepare(
    `DELETE FROM project_track_edits WHERE project_id = ? AND track_type = ? AND segment_key = ?`,
  ).run(projectId, trackType, segmentKey);
  return r.changes > 0;
}

/** 清空整个 project 的所有 track edits. */
export function clearAllTrackEdits(projectId: string): number {
  const r = db.prepare(`DELETE FROM project_track_edits WHERE project_id = ?`).run(projectId);
  return r.changes;
}
