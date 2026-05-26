/**
 * lib/scopes (v8.0) — 视频示波器纯计算 (对标 CineFlow 波形/直方图/RGB Parade)
 *
 * 纯函数, 吃 RGBA 像素扁平数组 (canvas getImageData().data), 算直方图 / 逐列亮度,
 * 供 scopes-panel 在 canvas 上绘制。把"算"和"画"分开 → 算的部分可单测。
 */

export interface Histogram {
  r: number[];    // 256 bins
  g: number[];
  b: number[];
  luma: number[];
}

export function lumaOf(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

/** RGBA 扁平数组 → 直方图 (每 step 个像素采一次, step=1 全采) */
export function computeHistogram(data: ArrayLike<number>, step = 1): Histogram {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const luma = new Array(256).fill(0);
  const stride = 4 * Math.max(1, Math.floor(step));
  for (let i = 0; i + 2 < data.length; i += stride) {
    const R = data[i] | 0, G = data[i + 1] | 0, B = data[i + 2] | 0;
    r[Math.min(255, Math.max(0, R))]++;
    g[Math.min(255, Math.max(0, G))]++;
    b[Math.min(255, Math.max(0, B))]++;
    luma[Math.min(255, Math.max(0, lumaOf(R, G, B)))]++;
  }
  return { r, g, b, luma };
}

export type ScopeChannel = 'luma' | 'r' | 'g' | 'b';

/**
 * 逐列平均值 (0-255), 给波形/Parade 用。
 * 把图像宽 width 压成 cols 列, 每列取该列范围内所选通道的平均。
 */
export function computeColumns(
  data: ArrayLike<number>,
  width: number,
  height: number,
  cols: number,
  channel: ScopeChannel = 'luma',
): number[] {
  const n = Math.max(1, Math.floor(cols));
  if (!width || !height || data.length < 4) return new Array(n).fill(0);
  const sum = new Array(n).fill(0);
  const cnt = new Array(n).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (idx + 2 >= data.length) continue;
      const R = data[idx] | 0, G = data[idx + 1] | 0, B = data[idx + 2] | 0;
      const v = channel === 'luma' ? lumaOf(R, G, B) : channel === 'r' ? R : channel === 'g' ? G : B;
      const col = Math.min(n - 1, Math.floor((x / width) * n));
      sum[col] += v;
      cnt[col]++;
    }
  }
  return sum.map((s, i) => (cnt[i] ? Math.round(s / cnt[i]) : 0));
}

export interface ScopeStats {
  avgLuma: number;
  minLuma: number;
  maxLuma: number;
  clippedHighlights: number; // luma>=250 占比 0-1
  clippedShadows: number;    // luma<=5 占比 0-1
}

export function scopeStats(hist: Histogram): ScopeStats {
  const total = hist.luma.reduce((a, n) => a + n, 0) || 1;
  let sum = 0, min = 255, max = 0;
  for (let v = 0; v < 256; v++) {
    const c = hist.luma[v];
    if (!c) continue;
    sum += v * c;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const highs = hist.luma.slice(250).reduce((a, n) => a + n, 0);
  const shadows = hist.luma.slice(0, 6).reduce((a, n) => a + n, 0);
  return {
    avgLuma: Math.round(sum / total),
    minLuma: min === 255 && max === 0 ? 0 : min,
    maxLuma: max,
    clippedHighlights: Math.round((highs / total) * 1000) / 1000,
    clippedShadows: Math.round((shadows / total) * 1000) / 1000,
  };
}
