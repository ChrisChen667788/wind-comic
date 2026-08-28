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

/**
 * v12.0.0 卡点剪辑用 —— snap 后 clamp 到源片真实时长。
 *
 * composer 的 xfade 用 [v{i}] 全长素材 + offset 定切点:若 snap 把某镜拉长超过
 * 源片实长,xfade 在素材结束后还要 fade → ffmpeg 缺素材报错/卡帧。所以卡点剪辑
 * **只收紧不拉长**:snap 想延后切点超过源片 → 保持源片长(没有更多画面可放)。
 * 「收紧到拍点」也正是行业「trim to the beat」手法。返回新时长 + 实际改动镜数。
 */
export function snapDurationsToBeatsClamped(
  durations: number[],
  beats: number[],
  opts?: SnapOptions,
): { durations: number[]; changed: number } {
  const snapped = snapDurationsToBeats(durations, beats, opts);
  const out: number[] = [];
  let changed = 0;
  for (let i = 0; i < durations.length; i++) {
    const v = Math.min(snapped[i], durations[i]); // 不越界源片
    if (Math.abs(v - durations[i]) > 0.04) changed++;
    out.push(v);
  }
  return { durations: out, changed };
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

/**
 * v12.184:BPM 数学网格 —— AI 生成 BGM 连续无静音段,silencedetect 检出 0 拍点
 * (live 实测卡点对齐率 0%)。已知/假设 BPM 生成等间隔拍点网格,snap 永远有的吸。
 */
export function beatGridFromBpm(bpm: number, durationSec: number, phaseSec = 0): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(durationSec) || durationSec <= 0) return [];
  const step = 60 / bpm;
  const out: number[] = [];
  for (let t = phaseSec; t <= durationSec + 1e-6; t += step) {
    if (t > 0) out.push(Number(t.toFixed(3)));
  }
  return out;
}

/** 真检测优先;拍点稀疏(<4)→ BPM 网格兜底(相位取首个真拍点,没有则 0)。 */
export async function detectBeatsWithFallback(
  bgmPath: string,
  opts: { bpmHint?: number; durationSec?: number } = {},
): Promise<{ beats: number[]; source: 'detected' | 'bpm-grid' | 'none' }> {
  const real = await detectBeats(bgmPath);
  if (real.length >= 4) return { beats: real, source: 'detected' };
  const bpm = opts.bpmHint && opts.bpmHint > 0 ? opts.bpmHint : Number(process.env.BGM_BPM_HINT) || 96;
  const dur = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 120;
  const grid = beatGridFromBpm(bpm, dur, real[0] ?? 0);
  return grid.length ? { beats: grid, source: 'bpm-grid' } : { beats: [], source: 'none' };
}

/**
 * v12.351:拍点序列 → BPM。**纯函数**,便于单测。
 *
 * 背景:`detectBeats` 从 v12.246 就在,MV 页却仍是 `useState(120)` + 手填数字框 ——
 * 检测造好了没接线,用户得自己数拍子。
 *
 * 做法上有两个坑,都不是「取平均」能绕过的:
 *
 * ① **必须取中位数,不能取平均。** silencedetect 会漏拍(弱拍被噪声底吞掉),
 *    漏一拍就产生一个双倍长的间隔;平均值被这类离群值拉偏,中位数不受影响。
 *
 * ② **半速/倍速歧义。** 每小节只在重拍触发时,测出来是真实 BPM 的一半;
 *    鼓点密时又可能测成两倍。所以把结果折算进一个常用区间(默认 70–170),
 *    反复 ×2 / ÷2 直到落进去 —— 这是音乐软件的通用做法,不是我拍脑袋定的。
 *
 * 拍点不足 4 个时返回 null(**不猜** —— 与本仓「判不出就说判不出」的既有约定一致)。
 */
export function bpmFromBeats(
  beats: number[] | null | undefined,
  opts: { minBpm?: number; maxBpm?: number } = {},
): { bpm: number; confidence: number; intervals: number } | null {
  const b = (beats || []).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (b.length < 4) return null;

  const gaps: number[] = [];
  for (let i = 1; i < b.length; i++) {
    const g = b[i] - b[i - 1];
    if (g > 0.05 && g < 4) gaps.push(g);   // 掐掉抖动与超长静音
  }
  if (gaps.length < 3) return null;

  const sorted = [...gaps].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;

  const minBpm = opts.minBpm ?? 70;
  const maxBpm = opts.maxBpm ?? 170;
  let bpm = 60 / median;
  // 折算进常用区间(每次只动一倍,避免在极端值上震荡)
  for (let i = 0; i < 6 && bpm < minBpm; i++) bpm *= 2;
  for (let i = 0; i < 6 && bpm > maxBpm; i++) bpm /= 2;

  // 置信度 = 间隔有多齐整(离中位数 ±15% 内的占比)。齐整=检测可信,散=多半漏拍。
  const near = gaps.filter((g) => Math.abs(g - median) <= median * 0.15).length;
  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round((near / gaps.length) * 100) / 100,
    intervals: gaps.length,
  };
}

