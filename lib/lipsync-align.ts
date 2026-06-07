/**
 * lib/lipsync-align (v9.7.6) — 口型-音频对齐度专项评分(纯逻辑,client 可直引)。
 *
 * 通用 Vision 画面分管不了「嘴的开合跟没跟上声音」。这里加一个专项维度:把 viseme 轨的
 * **张口包络** 与音频的 **能量包络** 重采样到同一长度,算 Pearson 相关 + 最佳时延(检测音画漂移),
 * 映射成 0-100 对齐分。能量包络由调用方给(浏览器 Web Audio 解码 / 服务端 ffmpeg 抽),本 lib 只算。
 * 单测 tests/v9-7-6-lipsync-align.test.ts。
 */

export interface VisemeFrameLike { t: number; mouthOpen: number; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** PCM 样本 → 逐窗 RMS 能量包络(windowCount 个点)。供服务端/客户端解码后调用。 */
export function rmsEnvelope(samples: ArrayLike<number>, windowCount: number): number[] {
  const N = samples.length;
  const w = Math.max(1, Math.floor(windowCount));
  if (N === 0) return new Array(w).fill(0);
  const out: number[] = [];
  const size = N / w;
  for (let i = 0; i < w; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let sum = 0; let cnt = 0;
    for (let j = start; j < end && j < N; j++) { const v = samples[j]; sum += v * v; cnt++; }
    out.push(cnt ? Math.sqrt(sum / cnt) : 0);
  }
  return out;
}

/** 把数组线性重采样到 n 个点。 */
export function resample(values: number[], n: number): number[] {
  const src = Array.isArray(values) ? values : [];
  if (n <= 0) return [];
  if (src.length === 0) return new Array(n).fill(0);
  if (src.length === 1) return new Array(n).fill(src[0]);
  if (n === 1) return [src[0]];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i * (src.length - 1)) / (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, lo + 1);
    const frac = pos - lo;
    out.push(src[lo] * (1 - frac) + src[hi] * frac);
  }
  return out;
}

/** viseme 关键帧 → n 点张口包络(阶梯保持采样,与面板动画一致)。 */
export function visemeEnvelope(frames: VisemeFrameLike[], durationSec: number, n: number): number[] {
  const fs = Array.isArray(frames) ? frames : [];
  const dur = durationSec > 0 ? durationSec : 1;
  if (n <= 0) return [];
  if (fs.length === 0) return new Array(n).fill(0);
  const at = (t: number) => { let v = fs[0].mouthOpen; for (const f of fs) { if (f.t <= t) v = f.mouthOpen; else break; } return v; };
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(at(n === 1 ? 0 : (i / (n - 1)) * dur));
  return out;
}

/** Pearson 相关系数(任一序列方差为 0 → 0)。 */
export function pearson(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len < 2) return 0;
  let ma = 0; let mb = 0;
  for (let i = 0; i < len; i++) { ma += a[i]; mb += b[i]; }
  ma /= len; mb /= len;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] - ma; const y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** 在 ±maxLag 内平移 b,找与 a 相关最高的时延(检测音画漂移)。 */
export function bestLag(a: number[], b: number[], maxLag: number): { lag: number; corr: number } {
  let best = { lag: 0, corr: pearson(a, b) };
  const M = Math.max(0, Math.floor(maxLag));
  for (let lag = -M; lag <= M; lag++) {
    if (lag === 0) continue;
    const aa: number[] = []; const bb: number[] = [];
    for (let i = 0; i < a.length; i++) {
      const j = i + lag;
      if (j >= 0 && j < b.length) { aa.push(a[i]); bb.push(b[j]); }
    }
    const c = pearson(aa, bb);
    if (c > best.corr) best = { lag, corr: c };
  }
  return best;
}

export type AlignVerdict = 'good' | 'fair' | 'poor';

export interface LipAudioAlignment {
  /** 对齐分 0-100(取最佳时延处的正相关) */
  score: number;
  /** 最佳时延处的相关系数 (-1..1) */
  correlation: number;
  /** 最佳时延(秒,正 = 音频滞后于嘴) */
  lagSec: number;
  verdict: AlignVerdict;
}

/**
 * 口型-音频对齐评分:张口包络 vs 能量包络,重采样到 n 点 → 最佳时延处正相关 → 0-100。
 */
export function scoreLipAudioAlignment(input: {
  visemes: VisemeFrameLike[];
  audioEnergy: number[];
  durationSec: number;
  n?: number;
  maxLagFrac?: number;
}): LipAudioAlignment {
  const n = input.n && input.n > 1 ? Math.floor(input.n) : 64;
  const maxLagFrac = typeof input.maxLagFrac === 'number' ? clamp(input.maxLagFrac, 0, 0.5) : 0.15;
  const mouth = visemeEnvelope(input.visemes, input.durationSec, n);
  const energy = resample(input.audioEnergy || [], n);
  const { lag, corr } = bestLag(mouth, energy, Math.round(n * maxLagFrac));
  const score = Math.round(clamp(Math.max(0, corr) * 100, 0, 100));
  const lagSec = round2(((input.durationSec > 0 ? input.durationSec : 1) * lag) / n);
  const verdict: AlignVerdict = score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor';
  return { score, correlation: round2(corr), lagSec, verdict };
}

/** 把 viseme 轨整体平移 offsetSec(正=往后);负时刻的帧丢弃。保留其余字段(viseme 名等)。 */
export function shiftVisemeTrack<T extends { t: number }>(frames: T[], offsetSec: number): T[] {
  const off = Number.isFinite(offsetSec) ? offsetSec : 0;
  const list = Array.isArray(frames) ? frames : [];
  if (!off) return list.map((f) => ({ ...f }));
  return list
    .map((f) => ({ ...f, t: round3(f.t + off) }))
    .filter((f) => f.t >= 0);
}

export interface AutoAlignResult {
  /** 检出的漂移(秒,正=音频滞后→嘴往后移补偿) */
  offsetSec: number;
  /** 校正前(零时延裸对齐)分 */
  before: number;
  /** 校正后(零时延)分 */
  after: number;
  /** 平移补偿后的 viseme 轨(供重渲) */
  visemes: VisemeFrameLike[];
}

/**
 * 自动校正音画漂移:`bestLag` 测出时延 → 把 viseme 轨平移补偿 → 给出校正前后裸对齐分 + 校正后轨。
 * before/after 用**零时延**裸对齐衡量(maxLagFrac=0),才看得出补偿带来的提升。
 */
export function autoAlignVisemes(input: {
  visemes: VisemeFrameLike[];
  audioEnergy: number[];
  durationSec: number;
  n?: number;
  maxLagFrac?: number;
}): AutoAlignResult {
  const full = scoreLipAudioAlignment(input);          // 全搜 → 拿 lagSec
  const offsetSec = full.lagSec;
  const shifted = shiftVisemeTrack(input.visemes, offsetSec);
  const before = scoreLipAudioAlignment({ ...input, maxLagFrac: 0 }).score;          // 裸(零时延)
  const after = scoreLipAudioAlignment({ ...input, visemes: shifted, maxLagFrac: 0 }).score;
  return { offsetSec, before, after, visemes: shifted };
}
