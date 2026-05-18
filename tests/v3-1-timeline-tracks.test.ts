/**
 * v3.1 F.1 — Cinema timeline multi-track:
 *   BGM 段派生 (按 act 分组) + Subtitle 段派生 (按 dialogue) + 用户 override 合并.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  computeTracks,
  applyTrackEdits,
  resetTrackEdit,
  clearAllTrackEdits,
  type SegmentOverride,
} from '@/lib/timeline-tracks';
import type { Script, ScriptShot } from '@/types/agents';

function shot(n: number, partial: Partial<ScriptShot> = {}): ScriptShot {
  return {
    shotNumber: n,
    sceneDescription: '',
    action: '',
    emotion: '',
    characters: [],
    duration: 5,
    ...partial,
  };
}

function script(shots: ScriptShot[]): Script {
  return { title: 't', synopsis: '', shots };
}

const PROJ = 'test-v31-tracks-' + Math.random().toString(36).slice(2, 8);

beforeEach(() => {
  clearAllTrackEdits(PROJ);
  db.prepare(`DELETE FROM project_track_edits WHERE project_id LIKE 'test-v31-tracks-%'`).run();
});

describe('v3.1 F.1 · computeTracks BGM derivation', () => {
  it('groups shots by act → segment per act', () => {
    const s = script([
      shot(1, { act: 1, duration: 5 }),
      shot(2, { act: 1, duration: 5 }),
      shot(3, { act: 2, duration: 5 }),
      shot(4, { act: 2, duration: 5 }),
      shot(5, { act: 3, duration: 5 }),
    ]);
    const { bgm } = computeTracks(PROJ, s);
    expect(bgm.length).toBe(3);
    expect(bgm[0].label).toBe('Act 1');
    expect(bgm[0].startSec).toBe(0);
    expect(bgm[0].durationSec).toBe(10);
    expect(bgm[1].label).toBe('Act 2');
    expect(bgm[1].startSec).toBe(10);
    expect(bgm[1].durationSec).toBe(10);
    expect(bgm[2].label).toBe('Act 3');
    expect(bgm[2].startSec).toBe(20);
  });

  it('no act field → 1 segment covering full duration', () => {
    const s = script([shot(1, { duration: 5 }), shot(2, { duration: 7 })]);
    const { bgm } = computeTracks(PROJ, s);
    expect(bgm.length).toBe(1);
    expect(bgm[0].durationSec).toBe(12);
  });

  it('empty shots → empty bgm', () => {
    const { bgm } = computeTracks(PROJ, script([]));
    expect(bgm).toEqual([]);
  });
});

describe('v3.1 F.1 · computeTracks Subtitle derivation', () => {
  it('one segment per shot with dialogue, skips silent', () => {
    const s = script([
      shot(1, { duration: 5, dialogue: '你好' }),
      shot(2, { duration: 5, dialogue: '' }),
      shot(3, { duration: 5, dialogue: '再见' }),
    ]);
    const { subtitle } = computeTracks(PROJ, s);
    expect(subtitle.length).toBe(2);
    expect(subtitle[0].label).toBe('你好');
    expect(subtitle[0].startSec).toBe(0);
    expect(subtitle[1].label).toBe('再见');
    expect(subtitle[1].startSec).toBe(10); // 0 + 5 + 5
  });

  it('all silent → empty subtitle track', () => {
    const s = script([shot(1, { dialogue: '' }), shot(2, { dialogue: '' })]);
    const { subtitle } = computeTracks(PROJ, s);
    expect(subtitle).toEqual([]);
  });
});

describe('v3.1 F.1 · applyTrackEdits + override merge', () => {
  it('mute override flips segment.muted', () => {
    const s = script([
      shot(1, { act: 1, duration: 5, dialogue: 'A' }),
      shot(2, { act: 2, duration: 5 }),
    ]);
    const before = computeTracks(PROJ, s);
    expect(before.subtitle[0].muted).toBe(false);

    applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      muted: true,
    }]);
    const after = computeTracks(PROJ, s);
    expect(after.subtitle[0].muted).toBe(true);
    expect(after.subtitle[0].isEdited).toBe(true);
  });

  it('startOffsetSec shifts segment forward', () => {
    const s = script([shot(1, { act: 1, duration: 10 }), shot(2, { act: 2, duration: 10 })]);
    const before = computeTracks(PROJ, s);
    applyTrackEdits(PROJ, [{
      trackType: 'bgm',
      segmentKey: before.bgm[0].id,
      startOffsetSec: 3,
    }]);
    const after = computeTracks(PROJ, s);
    expect(after.bgm[0].startSec).toBe(3); // 0 + 3
  });

  it('durationOverrideSec replaces default duration', () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = computeTracks(PROJ, s);
    applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      durationOverrideSec: 12,
    }]);
    const after = computeTracks(PROJ, s);
    expect(after.subtitle[0].durationSec).toBe(12);
  });

  it('customText replaces subtitle label', () => {
    const s = script([shot(1, { duration: 5, dialogue: '原对白' })]);
    const before = computeTracks(PROJ, s);
    applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      customText: '改后字幕',
    }]);
    const after = computeTracks(PROJ, s);
    expect(after.subtitle[0].label).toBe('改后字幕');
  });

  it('multiple edits on same segment merge (UPSERT semantics)', () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = computeTracks(PROJ, s);
    const key = before.subtitle[0].id;
    applyTrackEdits(PROJ, [{ trackType: 'subtitle', segmentKey: key, muted: true }]);
    applyTrackEdits(PROJ, [{ trackType: 'subtitle', segmentKey: key, customText: 'B' }]);
    const after = computeTracks(PROJ, s);
    expect(after.subtitle[0].muted).toBe(true);
    expect(after.subtitle[0].label).toBe('B');
  });

  it('startOffsetSec cannot push startSec below 0', () => {
    const s = script([shot(1, { act: 1, duration: 5 })]);
    const before = computeTracks(PROJ, s);
    applyTrackEdits(PROJ, [{
      trackType: 'bgm',
      segmentKey: before.bgm[0].id,
      startOffsetSec: -1000,
    }]);
    const after = computeTracks(PROJ, s);
    expect(after.bgm[0].startSec).toBe(0);
  });

  it('invalid trackType / missing segmentKey silently ignored', () => {
    expect(() => applyTrackEdits(PROJ, [
      { trackType: 'invalid' as any, segmentKey: 'x', muted: true },
      { trackType: 'subtitle', segmentKey: '', muted: true },
    ])).not.toThrow();
  });

  it('empty edits array is no-op', () => {
    expect(() => applyTrackEdits(PROJ, [])).not.toThrow();
  });
});

describe('v3.1 F.1 · resetTrackEdit', () => {
  it('restores default after reset', () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = computeTracks(PROJ, s);
    applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      muted: true,
      customText: 'Y',
    }]);
    expect(computeTracks(PROJ, s).subtitle[0].label).toBe('Y');

    expect(resetTrackEdit(PROJ, 'subtitle', before.subtitle[0].id)).toBe(true);
    const after = computeTracks(PROJ, s);
    expect(after.subtitle[0].label).toBe('X');
    expect(after.subtitle[0].muted).toBe(false);
    expect(after.subtitle[0].isEdited).toBe(false);
  });

  it('reset non-existent edit returns false', () => {
    expect(resetTrackEdit(PROJ, 'bgm', 'no-such-key')).toBe(false);
  });
});
