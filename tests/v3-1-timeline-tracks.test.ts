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

beforeEach(async () => {
  await clearAllTrackEdits(PROJ);
  db.prepare(`DELETE FROM project_track_edits WHERE project_id LIKE 'test-v31-tracks-%'`).run();
});

describe('v3.1 F.1 · computeTracks BGM derivation', () => {
  it('groups shots by act → segment per act', async () => {
    const s = script([
      shot(1, { act: 1, duration: 5 }),
      shot(2, { act: 1, duration: 5 }),
      shot(3, { act: 2, duration: 5 }),
      shot(4, { act: 2, duration: 5 }),
      shot(5, { act: 3, duration: 5 }),
    ]);
    const { bgm } = await computeTracks(PROJ, s);
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

  it('no act field → 1 segment covering full duration', async () => {
    const s = script([shot(1, { duration: 5 }), shot(2, { duration: 7 })]);
    const { bgm } = await computeTracks(PROJ, s);
    expect(bgm.length).toBe(1);
    expect(bgm[0].durationSec).toBe(12);
  });

  it('empty shots → empty bgm', async () => {
    const { bgm } = await computeTracks(PROJ, script([]));
    expect(bgm).toEqual([]);
  });
});

describe('v3.1 F.1 · computeTracks Subtitle derivation', () => {
  it('one segment per shot with dialogue, skips silent', async () => {
    const s = script([
      shot(1, { duration: 5, dialogue: '你好' }),
      shot(2, { duration: 5, dialogue: '' }),
      shot(3, { duration: 5, dialogue: '再见' }),
    ]);
    const { subtitle } = await computeTracks(PROJ, s);
    expect(subtitle.length).toBe(2);
    expect(subtitle[0].label).toBe('你好');
    expect(subtitle[0].startSec).toBe(0);
    expect(subtitle[1].label).toBe('再见');
    expect(subtitle[1].startSec).toBe(10); // 0 + 5 + 5
  });

  it('all silent → empty subtitle track', async () => {
    const s = script([shot(1, { dialogue: '' }), shot(2, { dialogue: '' })]);
    const { subtitle } = await computeTracks(PROJ, s);
    expect(subtitle).toEqual([]);
  });
});

describe('v3.1 F.1 · applyTrackEdits + override merge', () => {
  it('mute override flips segment.muted', async () => {
    const s = script([
      shot(1, { act: 1, duration: 5, dialogue: 'A' }),
      shot(2, { act: 2, duration: 5 }),
    ]);
    const before = await computeTracks(PROJ, s);
    expect(before.subtitle[0].muted).toBe(false);

    await applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      muted: true,
    }]);
    const after = await computeTracks(PROJ, s);
    expect(after.subtitle[0].muted).toBe(true);
    expect(after.subtitle[0].isEdited).toBe(true);
  });

  it('startOffsetSec shifts segment forward', async () => {
    const s = script([shot(1, { act: 1, duration: 10 }), shot(2, { act: 2, duration: 10 })]);
    const before = await computeTracks(PROJ, s);
    await applyTrackEdits(PROJ, [{
      trackType: 'bgm',
      segmentKey: before.bgm[0].id,
      startOffsetSec: 3,
    }]);
    const after = await computeTracks(PROJ, s);
    expect(after.bgm[0].startSec).toBe(3); // 0 + 3
  });

  it('durationOverrideSec replaces default duration', async () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = await computeTracks(PROJ, s);
    await applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      durationOverrideSec: 12,
    }]);
    const after = await computeTracks(PROJ, s);
    expect(after.subtitle[0].durationSec).toBe(12);
  });

  it('customText replaces subtitle label', async () => {
    const s = script([shot(1, { duration: 5, dialogue: '原对白' })]);
    const before = await computeTracks(PROJ, s);
    await applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      customText: '改后字幕',
    }]);
    const after = await computeTracks(PROJ, s);
    expect(after.subtitle[0].label).toBe('改后字幕');
  });

  it('multiple edits on same segment merge (UPSERT semantics)', async () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = await computeTracks(PROJ, s);
    const key = before.subtitle[0].id;
    await applyTrackEdits(PROJ, [{ trackType: 'subtitle', segmentKey: key, muted: true }]);
    await applyTrackEdits(PROJ, [{ trackType: 'subtitle', segmentKey: key, customText: 'B' }]);
    const after = await computeTracks(PROJ, s);
    expect(after.subtitle[0].muted).toBe(true);
    expect(after.subtitle[0].label).toBe('B');
  });

  it('startOffsetSec cannot push startSec below 0', async () => {
    const s = script([shot(1, { act: 1, duration: 5 })]);
    const before = await computeTracks(PROJ, s);
    await applyTrackEdits(PROJ, [{
      trackType: 'bgm',
      segmentKey: before.bgm[0].id,
      startOffsetSec: -1000,
    }]);
    const after = await computeTracks(PROJ, s);
    expect(after.bgm[0].startSec).toBe(0);
  });

  it('invalid trackType / missing segmentKey silently ignored', async () => {
    await expect(applyTrackEdits(PROJ, [
      { trackType: 'invalid' as any, segmentKey: 'x', muted: true },
      { trackType: 'subtitle', segmentKey: '', muted: true },
    ])).resolves.not.toThrow();
  });

  it('empty edits array is no-op', async () => {
    await expect(applyTrackEdits(PROJ, [])).resolves.not.toThrow();
  });
});

describe('v3.1.2 · derivedStartSec / derivedDurationSec exposure', () => {
  it('un-edited segment derivedStartSec = startSec, derivedDurationSec = durationSec', async () => {
    const s = script([shot(1, { act: 1, duration: 10 }), shot(2, { act: 2, duration: 8 })]);
    const { bgm } = await computeTracks(PROJ, s);
    for (const seg of bgm) {
      expect(seg.derivedStartSec).toBe(seg.startSec);
      expect(seg.derivedDurationSec).toBe(seg.durationSec);
    }
  });

  it('edited segment keeps derived values for client-side offset computation', async () => {
    const s = script([shot(1, { act: 1, duration: 10 }), shot(2, { act: 2, duration: 5 })]);
    const before = await computeTracks(PROJ, s);
    const seg = before.bgm[1];
    expect(seg.derivedStartSec).toBe(10); // Act 2 派生 startSec
    await applyTrackEdits(PROJ, [{
      trackType: 'bgm', segmentKey: seg.id,
      startOffsetSec: 4,
      durationOverrideSec: 7,
    }]);
    const after = await computeTracks(PROJ, s);
    const edited = after.bgm[1];
    expect(edited.startSec).toBe(14);              // 当前 startSec = derived + offset
    expect(edited.derivedStartSec).toBe(10);       // derived 永远是 base, 没动
    expect(edited.durationSec).toBe(7);            // 当前时长 = override
    expect(edited.derivedDurationSec).toBe(5);     // derived 时长还在
  });

  it('multiple absolute drags via client (newStart - derivedStart) idempotent', async () => {
    // 模拟 client: 用户把段从 10s 拖到 15s, 再拖到 20s.
    // 旧 buggy 路径: 第 2 次 client 发 offset=5 (delta from 15), server 把 5 当 new offset, 实际只移到 15. 不直观.
    // 修复路径: client 用 derivedStartSec 算 absoluteStart - derivedStartSec 作 offset.
    const s = script([shot(1, { act: 1, duration: 10 }), shot(2, { act: 2, duration: 5 })]);
    const before = await computeTracks(PROJ, s);
    const seg = before.bgm[1];
    const derived = seg.derivedStartSec; // = 10

    // 第 1 次拖到 absoluteStart = 15
    const offset1 = 15 - derived; // 5
    await applyTrackEdits(PROJ, [{ trackType: 'bgm', segmentKey: seg.id, startOffsetSec: offset1 }]);
    expect((await computeTracks(PROJ, s)).bgm[1].startSec).toBe(15);

    // 第 2 次拖到 absoluteStart = 20 — client 仍然用 derived=10 算 offset
    const offset2 = 20 - derived; // 10
    await applyTrackEdits(PROJ, [{ trackType: 'bgm', segmentKey: seg.id, startOffsetSec: offset2 }]);
    expect((await computeTracks(PROJ, s)).bgm[1].startSec).toBe(20); // 真到 20 了, 不再错位
  });
});

describe('v3.1 F.1 · resetTrackEdit', () => {
  it('restores default after reset', async () => {
    const s = script([shot(1, { duration: 5, dialogue: 'X' })]);
    const before = await computeTracks(PROJ, s);
    await applyTrackEdits(PROJ, [{
      trackType: 'subtitle',
      segmentKey: before.subtitle[0].id,
      muted: true,
      customText: 'Y',
    }]);
    expect((await computeTracks(PROJ, s)).subtitle[0].label).toBe('Y');

    expect(await resetTrackEdit(PROJ, 'subtitle', before.subtitle[0].id)).toBe(true);
    const after = await computeTracks(PROJ, s);
    expect(after.subtitle[0].label).toBe('X');
    expect(after.subtitle[0].muted).toBe(false);
    expect(after.subtitle[0].isEdited).toBe(false);
  });

  it('reset non-existent edit returns false', async () => {
    expect(await resetTrackEdit(PROJ, 'bgm', 'no-such-key')).toBe(false);
  });
});
