/**
 * lib/beat-detect — BGM beat detection + cut alignment (Sprint B.3)
 *
 * 设计思路:
 *   1. 用 ffmpeg 的 `silencedetect` 找 BGM 里"非静音段的起点", 那些通常对应鼓点 / downbeat
 *   2. astats 给 RMS 包络变化, 单独跑 transient 检测来增强(本版本先只用 silencedetect, 简单可靠)
 *   3. composer 拿到 beats[] 后, 把每个镜头的 in/out 时间 snap 到最近 beat (±SNAP_WINDOW_S)
 *      防止"切镜跟拍点错半拍"的低级感
 *
 * 决策值 (ROADMAP §7 #3):
 *   · BGM beat 对齐 默认开 — 节奏感是"专业感"的最大杠杆, 不开浪费 BGM
 *   · SNAP_WINDOW_S = 0.15 — 镜头时长 ±150ms 对齐到最近 beat 都是肉眼可接受的
 *   · 没 BGM / 没检测到 beat → 完全跳过, 不动镜头时长
 *
 * 不做的事:
 *   · 不解码音频自己做 FFT (太重, ffmpeg 已经能给信号)
 *   · 不动 video 的剪辑点 (snap 镜头时长就够了, 镜头之间的 xfade 自动跟着移)
 */

import ffmpeg from 'fluent-ffmpeg';

/** 镜头时长 ±SNAP_WINDOW_S 内才尝试对齐, 超出就保持原值不漂太远 */
export const BEAT_SNAP_WINDOW_S = 0.15;
/** silencedetect 把 -30dB 以下视为静音 (默认值, 经验上对中等音量 BGM 通用) */
export const BEAT_NOISE_FLOOR_DB = -30;
/** 静音段最短多长才计数 (ms) — 太短的会把同一个鼓点的衰减误判成新拍 */
export const BEAT_MIN_SILENCE_MS = 100;

/**
 * 跑一次 ffmpeg silencedetect 拿 BGM 的"非静音起点"序列.
 *
 * 返回值是按时间升序的秒数数组. ffprobe / silencedetect 失败 / 文件不存在 → 返回 [].
 *
 * 静音 → 非静音的转折点(silence_end)就是 onset, 我们当成 beat 用. 简单可靠, 比自己做 FFT 省心.
 *
 * 因为 fluent-ffmpeg 没暴露 silencedetect 的事件, 我们手动起一个 ffmpeg 进程读 stderr 抓 silence_end.
 */
export async function detectBeats(bgmPath: string): Promise<number[]> {
  if (!bgmPath) return [];
  return new Promise<number[]>((resolve) => {
    const beats: number[] = [];
    const cmd = ffmpeg(bgmPath)
      .audioFilters(`silencedetect=noise=${BEAT_NOISE_FLOOR_DB}dB:d=${BEAT_MIN_SILENCE_MS / 1000}`)
      .format('null')
      .output('-')
      .on('stderr', (line: string) => {
        const m = line.match(/silence_end:\s*([\d.]+)/);
        if (m) beats.push(parseFloat(m[1]));
      })
      .on('end', () => resolve(dedupAndSort(beats)))
      .on('error', () => resolve([])); // 任何失败 — 跳过 beat 对齐, 用原始时长
    try {
      cmd.run();
    } catch {
      resolve([]);
    }
  });
}

function dedupAndSort(xs: number[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const x of xs) {
    const k = x.toFixed(3);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out.sort((a, b) => a - b);
}

/**
 * 把镜头时长序列 snap 到 BGM beats —— 调整每段时长的"out 时刻"对齐到最近的 beat.
 *
 * 算法:
 *   1. 累计每个镜头的结束时间(out 时刻)
 *   2. 每个 out 找最近 beat, 距离 ≤ SNAP_WINDOW_S 才 snap; 否则保持原值
 *   3. 时长用相邻 out 之差计算, 第一段用 outs[0]
 *   4. 不允许时长变成 < 0 或 < MIN(0.5s, 原时长 * 0.6) — 防止 snap 把镜头压到几乎不存在
 *
 * 返回新时长数组, 长度跟入参一致. 没 beat / 没启用 → 原样回传.
 */
export interface SnapOptions {
  /** ±窗口外的 beat 不对齐, 默认 BEAT_SNAP_WINDOW_S */
  snapWindowS?: number;
  /** 镜头最短保留时长(秒), 防止 snap 把镜头压成 0. 默认 0.5s */
  minDurationS?: number;
  /** 默认开;false 则原样返回(给用户开关) */
  enabled?: boolean;
}

export function snapDurationsToBeats(
  durations: number[],
  beats: number[],
  opts: SnapOptions = {},
): number[] {
  const enabled = opts.enabled !== false;
  if (!enabled || durations.length === 0 || beats.length === 0) return durations.slice();

  const snapWindow = opts.snapWindowS ?? BEAT_SNAP_WINDOW_S;
  const minDur = opts.minDurationS ?? 0.5;

  // 累计 out 时刻
  const outs: number[] = [];
  let cum = 0;
  for (const d of durations) {
    cum += d;
    outs.push(cum);
  }

  // 每个 out 找最近 beat
  for (let i = 0; i < outs.length; i++) {
    const out = outs[i];
    const nearest = findNearestBeat(out, beats);
    if (nearest === null) continue;
    if (Math.abs(nearest - out) <= snapWindow) {
      outs[i] = nearest;
    }
  }

  // out 必须严格递增 — sort 保护
  for (let i = 1; i < outs.length; i++) {
    if (outs[i] <= outs[i - 1]) outs[i] = outs[i - 1] + minDur;
  }

  // 反推时长
  const adjusted: number[] = [];
  for (let i = 0; i < outs.length; i++) {
    const prevOut = i === 0 ? 0 : outs[i - 1];
    const newDur = outs[i] - prevOut;
    const orig = durations[i];
    const lowerBound = Math.max(minDur, orig * 0.6);
    adjusted.push(Math.max(lowerBound, newDur));
  }
  return adjusted;
}

/** 在已排序 beats 数组里找离 t 最近的, 没 beat 返回 null */
export function findNearestBeat(t: number, beats: number[]): number | null {
  if (beats.length === 0) return null;
  // 二分到第一个 >= t 的位置
  let lo = 0, hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates: number[] = [];
  if (lo < beats.length) candidates.push(beats[lo]);
  if (lo > 0) candidates.push(beats[lo - 1]);
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - t) < Math.abs(best - t)) best = c;
  }
  return best;
}
