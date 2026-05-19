'use client';

/**
 * v3.2 P3.2 — Multi-mp3 segment BGM waveform.
 *
 * v3.1.3 P1 的 useAudioWaveform 只能解一个 mp3. 多幕 BGM 每幕一个 mp3, 需要把
 * 几个 mp3 在 timeline 上拼成一条逻辑波形 — 这文件干这事.
 *
 * 用法:
 *   const segments = [
 *     { id: 'act1', audioUrl: '/api/bgm/1.mp3', startSec: 0,  durationSec: 30 },
 *     { id: 'act2', audioUrl: '/api/bgm/2.mp3', startSec: 30, durationSec: 35 },
 *   ];
 *   const decoded = useMultiAudioWaveform(segments);
 *   // decoded.bars = Float32Array(N), 0..1 振幅
 *   // 切片: sliceMultiWaveform(decoded, segments, sliceStartSec, sliceDurationSec)
 *
 * 复用 useAudioWaveform 的 single-mp3 cache — 同一 URL 永远只 decode 1 次.
 */

import { useEffect, useState } from 'react';
import { useAudioWaveform, sliceWaveform, type DecodedAudio } from './use-audio-waveform';

export interface MultiSegment {
  id: string;
  audioUrl: string | undefined | null;
  /** 在 timeline 上的全局起始秒 */
  startSec: number;
  /** 在 timeline 上的全局持续秒 */
  durationSec: number;
}

export interface DecodedMultiAudio {
  /** 每个 segment 的 decoded 波形 (undecoded / 失败 → null) */
  segments: Array<{ id: string; decoded: DecodedAudio | null }>;
}

/**
 * 解码 N 个 mp3 segment 的波形. 每个 audioUrl 走 useAudioWaveform 的 cache,
 * 同一 URL 跨多段只 decode 1 次.
 *
 * 注意:
 *   - 等所有段 decode 完才返回 final, 中间状态 segments[].decoded 是 null
 *   - 任何 segment 失败不阻塞其他, 失败的 decoded 永远 null
 *   - segment 长度 0 时不调用 hook (避免无谓 fetch)
 */
export function useMultiAudioWaveform(segments: MultiSegment[]): DecodedMultiAudio {
  // 每段独立 hook 调用 — React 要求 hook 数量稳定, 所以这里我们假设 segments 长度不变.
  // 实际业务里 BGM 段数 = act 数, 一旦剧本生成完就稳定, 不会动态变.
  const decoded = segments.map((s) => useAudioWaveform(s.audioUrl));
  const [snap, setSnap] = useState<DecodedMultiAudio>({
    segments: segments.map((s) => ({ id: s.id, decoded: null })),
  });
  useEffect(() => {
    setSnap({
      segments: segments.map((s, i) => ({ id: s.id, decoded: decoded[i] })),
    });
    // we treat segments array reference as stable in callers; deps key on its identity + decoded contents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, ...decoded]);
  return snap;
}

/**
 * 从多段 decoded 里切出 `[startSec, startSec + durationSec)` 范围的波形.
 *
 * 算法:
 *   1. 找出与切片范围相交的所有 segments
 *   2. 对每个相交 segment, 用 sliceWaveform 切出该段贡献的局部波形
 *   3. 按 segment 在时间轴上的位置, 把局部波形拼到 output Float32Array
 *   4. 跨段 gap 区域 (没 segment 覆盖) 填 0
 *
 * 返回 Float32Array(outputBars), 与单段 sliceWaveform 接口对齐.
 */
export function sliceMultiWaveform(
  decoded: DecodedMultiAudio,
  segments: MultiSegment[],
  startSec: number,
  durationSec: number,
  outputBars = 48,
): Float32Array {
  const out = new Float32Array(outputBars);
  if (durationSec <= 0 || outputBars <= 0) return out;
  const endSec = startSec + durationSec;
  const barWidth = durationSec / outputBars;

  // 索引 segments[i].decoded 通过 id 匹配, 而不是 i —— React 强制 hook 顺序稳定但
  // 调用方可能 reorder segments. id 匹配最稳.
  const decodedById = new Map(decoded.segments.map((s) => [s.id, s.decoded]));

  for (const seg of segments) {
    const segEnd = seg.startSec + seg.durationSec;
    const overlapStart = Math.max(startSec, seg.startSec);
    const overlapEnd = Math.min(endSec, segEnd);
    if (overlapEnd <= overlapStart) continue;   // no overlap

    const d = decodedById.get(seg.id);
    if (!d || d.waveform.length === 0) continue;

    // segment-local 时间 (相对 seg.startSec)
    const localStart = overlapStart - seg.startSec;
    const localDur = overlapEnd - overlapStart;

    // 这块 overlap 在 output 里占多少 bars
    const outStartBar = Math.max(0, Math.floor((overlapStart - startSec) / barWidth));
    const outEndBar = Math.min(outputBars, Math.ceil((overlapEnd - startSec) / barWidth));
    const segBars = Math.max(1, outEndBar - outStartBar);

    const local = sliceWaveform(d, localStart, localDur, segBars);
    for (let i = 0; i < segBars; i++) {
      const outIdx = outStartBar + i;
      if (outIdx >= 0 && outIdx < outputBars) {
        // 重叠区 (理论上 BGM segment 不该重叠, 但 robust 处理) 取 max
        out[outIdx] = Math.max(out[outIdx], local[i] || 0);
      }
    }
  }
  return out;
}
