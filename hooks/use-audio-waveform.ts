'use client';

/**
 * v3.1.3 P1 — Real audio waveform via Web Audio API.
 *
 * 用法:
 *   const waveform = useAudioWaveform(audioUrl);
 *   // waveform = null (loading / no url / 失败) 或 Float32Array(N) — N 个 [0..1] 振幅采样
 *
 * 缓存:
 *   - 同一 URL 永远只 decode 1 次 (per session)
 *   - 模块内 Map<url, Promise<Float32Array>>, 多个调用并发等同一 promise
 *
 * 解码:
 *   - fetch(url) → arrayBuffer → AudioContext.decodeAudioData
 *   - 降采样到 N=600 个点 (足够 timeline 段宽渲染)
 *   - 取每个 bucket 的 max abs(sample) 作振幅 → 跟波形图视觉对齐
 *
 * 注意:
 *   - decode 是 CPU 任务, 大 mp3 (>5MB) 可能阻塞主线程 100ms+
 *   - 失败 (404 / CORS / unsupported codec) → 缓存空 array, 不重试
 *   - SSR safe — typeof window === 'undefined' 时返 null
 */

import { useEffect, useState } from 'react';

const SAMPLES_PER_TRACK = 600;

export interface DecodedAudio {
  /** 归一化波形采样 0..1, 长度 = SAMPLES_PER_TRACK (600) */
  waveform: Float32Array;
  /** mp3 总时长 (秒) — 切片用 */
  durationSec: number;
}

/** url → DecodedAudio (resolved) | Promise<DecodedAudio> (in-flight) */
const cache = new Map<string, DecodedAudio | Promise<DecodedAudio>>();

const EMPTY: DecodedAudio = { waveform: new Float32Array(0), durationSec: 0 };

async function decodeOnce(url: string): Promise<DecodedAudio> {
  if (typeof window === 'undefined') return EMPTY;
  const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  if (!AudioCtx) return EMPTY;

  let response: Response;
  try {
    response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (e) {
    console.warn('[useAudioWaveform] fetch failed:', e);
    return EMPTY;
  }

  let buf: ArrayBuffer;
  try {
    buf = await response.arrayBuffer();
  } catch (e) {
    console.warn('[useAudioWaveform] arrayBuffer failed:', e);
    return EMPTY;
  }

  const ctx = new AudioCtx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(buf);
  } catch (e) {
    console.warn('[useAudioWaveform] decodeAudioData failed:', e);
    try { void ctx.close(); } catch { /* ignore */ }
    return EMPTY;
  }

  // 取第 0 channel mono. 多 channel mp3 我们简化只用 left/mono.
  const channelData = audioBuffer.getChannelData(0);
  const total = channelData.length;
  const bucketSize = Math.max(1, Math.floor(total / SAMPLES_PER_TRACK));
  const out = new Float32Array(SAMPLES_PER_TRACK);
  for (let i = 0; i < SAMPLES_PER_TRACK; i++) {
    const start = i * bucketSize;
    const end = Math.min(total, start + bucketSize);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  const durationSec = audioBuffer.duration;
  try { void ctx.close(); } catch { /* ignore */ }
  return { waveform: out, durationSec };
}

function getOrFetch(url: string): Promise<DecodedAudio> {
  const cached = cache.get(url);
  if (cached instanceof Promise) return cached;
  if (cached) return Promise.resolve(cached);
  const p = decodeOnce(url).then((d) => {
    cache.set(url, d);
    return d;
  });
  cache.set(url, p);
  return p;
}

/**
 * React hook — 给一个 audio URL 返 decoded 波形 + 时长.
 * URL 为空或正在加载时返 null. SSR 阶段始终返 null.
 */
export function useAudioWaveform(audioUrl: string | undefined | null): DecodedAudio | null {
  const [decoded, setDecoded] = useState<DecodedAudio | null>(() => {
    if (!audioUrl) return null;
    const cached = cache.get(audioUrl);
    if (cached && !(cached instanceof Promise)) return cached;
    return null;
  });
  useEffect(() => {
    if (!audioUrl) {
      setDecoded(null);
      return;
    }
    let cancelled = false;
    getOrFetch(audioUrl).then((d) => {
      if (!cancelled) setDecoded(d.waveform.length > 0 ? d : null);
    });
    return () => { cancelled = true; };
  }, [audioUrl]);
  return decoded;
}

/**
 * 切片波形 — 整段 mp3 是 fullDurationSec, segment 从 startSec 持续 durationSec.
 * 返回切片范围内的 N 个采样 (从 full waveform 里按比例取).
 *
 * fullDurationSec 不传时按 segment 占据的归一化范围估算 (0-1).
 * 实际使用时建议传 full mp3 时长 (从 AudioBuffer.duration 取).
 */
export function sliceWaveform(
  decoded: DecodedAudio,
  startSec: number,
  durationSec: number,
  outputBars = 48,
): Float32Array {
  const full = decoded.waveform;
  const fullDurationSec = decoded.durationSec;
  if (full.length === 0 || fullDurationSec <= 0 || durationSec <= 0) {
    return new Float32Array(0);
  }
  const totalSamples = full.length;
  const startIdx = Math.max(0, Math.floor((startSec / fullDurationSec) * totalSamples));
  const endIdx = Math.min(totalSamples, Math.ceil(((startSec + durationSec) / fullDurationSec) * totalSamples));
  const segmentSize = Math.max(1, endIdx - startIdx);
  const bucketSize = Math.max(1, Math.floor(segmentSize / outputBars));
  const out = new Float32Array(outputBars);
  for (let i = 0; i < outputBars; i++) {
    const a = startIdx + i * bucketSize;
    const b = Math.min(endIdx, a + bucketSize);
    let peak = 0;
    for (let j = a; j < b; j++) {
      const v = full[j];
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}
