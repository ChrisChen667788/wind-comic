/**
 * v3.2 P3.2 — Multi-mp3 segment waveform slice.
 *
 * 不测 React hook (那要 jsdom + Web Audio mock, 太复杂), 只测纯函数 sliceMultiWaveform.
 * 用合成 decoded 数据验证切片逻辑.
 */

import { describe, it, expect } from 'vitest';
import { sliceMultiWaveform, type DecodedMultiAudio, type MultiSegment } from '@/hooks/use-multi-audio-waveform';

function mkDecoded(id: string, fillValue: number, length = 100, durationSec = 30): { id: string; decoded: any } {
  const w = new Float32Array(length);
  for (let i = 0; i < length; i++) w[i] = fillValue;
  return { id, decoded: { waveform: w, durationSec } };
}

describe('v3.2 P3.2 · sliceMultiWaveform', () => {
  const segments: MultiSegment[] = [
    { id: 'act1', audioUrl: 'a1.mp3', startSec: 0,  durationSec: 30 },
    { id: 'act2', audioUrl: 'a2.mp3', startSec: 30, durationSec: 35 },
    { id: 'act3', audioUrl: 'a3.mp3', startSec: 65, durationSec: 35 },
  ];

  it('returns zero-filled array when durationSec=0', () => {
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('act1', 0.5), mkDecoded('act2', 0.5), mkDecoded('act3', 0.5)],
    };
    const out = sliceMultiWaveform(decoded, segments, 10, 0, 16);
    expect(out).toHaveLength(16);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('slices fully within one segment (act1, 5-15s)', () => {
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('act1', 0.7, 100, 30), mkDecoded('act2', 0.3, 100, 35), mkDecoded('act3', 0.5, 100, 35)],
    };
    const out = sliceMultiWaveform(decoded, segments, 5, 10, 16);
    // 全部 bars 都从 act1 拿, 期望 ≈ 0.7
    expect(out).toHaveLength(16);
    for (const v of out) expect(v).toBeCloseTo(0.7, 1);
  });

  it('slices across two segments (act1/act2 boundary 30)', () => {
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('act1', 0.2, 100, 30), mkDecoded('act2', 0.8, 100, 35), mkDecoded('act3', 0.5, 100, 35)],
    };
    // 25-35s → 前 5s 来自 act1 (0.2), 后 5s 来自 act2 (0.8)
    const out = sliceMultiWaveform(decoded, segments, 25, 10, 20);
    expect(out).toHaveLength(20);
    // 前半应该接近 0.2, 后半应该接近 0.8
    const firstHalf = Array.from(out.slice(0, 10));
    const secondHalf = Array.from(out.slice(10, 20));
    expect(firstHalf.every((v) => v < 0.5)).toBe(true);
    expect(secondHalf.every((v) => v > 0.5)).toBe(true);
  });

  it('treats undecoded segments as silence', () => {
    const decoded: DecodedMultiAudio = {
      segments: [
        { id: 'act1', decoded: null },
        mkDecoded('act2', 0.9, 100, 35),
        { id: 'act3', decoded: null },
      ],
    };
    const out = sliceMultiWaveform(decoded, segments, 0, 30, 16);
    // 整段在 act1, 但 act1 没 decoded → 全 0
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('treats empty waveform Float32Array as silence', () => {
    const decoded: DecodedMultiAudio = {
      segments: [
        { id: 'act1', decoded: { waveform: new Float32Array(0), durationSec: 30 } },
        mkDecoded('act2', 0.6, 100, 35),
        mkDecoded('act3', 0.4, 100, 35),
      ],
    };
    const out = sliceMultiWaveform(decoded, segments, 0, 30, 16);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('handles gap region (between segments) as silence', () => {
    const gappedSegments: MultiSegment[] = [
      { id: 'a', audioUrl: 'a.mp3', startSec: 0,  durationSec: 10 },
      { id: 'b', audioUrl: 'b.mp3', startSec: 20, durationSec: 10 },   // 10-20s 是 gap
    ];
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('a', 0.5, 100, 10), mkDecoded('b', 0.5, 100, 10)],
    };
    // 切 8-22s, 中间 10-20 是 gap → 期望前 2s ≈ 0.5, 后 2s ≈ 0.5, 中间 10s ≈ 0
    const out = sliceMultiWaveform(decoded, gappedSegments, 8, 14, 14);
    // bar 0-1: from a (0.5); bar 2-11: gap (0); bar 12-13: from b (0.5)
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[7]).toBe(0);   // middle bar in the gap
    expect(out[13]).toBeGreaterThan(0.3);
  });

  it('outputBars param sizes output array', () => {
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('act1', 0.5, 100, 30), mkDecoded('act2', 0.5, 100, 35), mkDecoded('act3', 0.5, 100, 35)],
    };
    expect(sliceMultiWaveform(decoded, segments, 0, 60, 48)).toHaveLength(48);
    expect(sliceMultiWaveform(decoded, segments, 0, 60, 8)).toHaveLength(8);
    expect(sliceMultiWaveform(decoded, segments, 0, 60, 1)).toHaveLength(1);
  });

  it('slice fully outside all segments → all zeros', () => {
    const decoded: DecodedMultiAudio = {
      segments: [mkDecoded('act1', 0.7, 100, 30), mkDecoded('act2', 0.8, 100, 35), mkDecoded('act3', 0.9, 100, 35)],
    };
    // 100s onward 无 segment 覆盖
    const out = sliceMultiWaveform(decoded, segments, 100, 10, 16);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });
});
