/**
 * lib/lipsync-segments (v10.1.0) — 把 viseme 关键帧轨转成「连续覆盖 [0,dur] 的口型分段」,
 * 供本地零配置口型引擎(ffmpeg overlay)使用。
 *
 * 设计:每个 viseme 一个 overlay,其 `enable` 表达式 = 该 viseme 全部时间窗口的并集,
 * 任意时刻恰好一个口型显示(分段连续、无缝隙、无重叠)。纯函数,可单测。
 */
import type { Viseme } from './lipsync-plan';

export const VISEME_IDS: Viseme[] = ['sil', 'MBP', 'FV', 'aa', 'E', 'I', 'O', 'U'];

export interface VisemeKeyframeLite {
  t: number;
  viseme: string;
  mouthOpen?: number;
}
export interface VisemeSegment {
  start: number;
  end: number;
  viseme: Viseme;
}

function asViseme(v: string): Viseme {
  return (VISEME_IDS as string[]).includes(v) ? (v as Viseme) : 'sil';
}

/**
 * 关键帧(每帧从其 t 持续到下一帧的 t)→ 连续分段,覆盖 [0, dur]:
 *   - dur 缺省 = 最后一帧 t + 0.2s 尾巴(并保证 ≥ 末帧 t)。
 *   - 首帧 t>0 → 开头补一段 sil(闭嘴)。
 *   - 合并相邻同 viseme 段。
 */
export function buildVisemeSegments(frames: VisemeKeyframeLite[], totalDur?: number): VisemeSegment[] {
  const fs = [...(frames || [])]
    .filter((f) => Number.isFinite(f.t) && f.t >= 0)
    .sort((a, b) => a.t - b.t);
  if (fs.length === 0) {
    const d = Math.max(0.1, totalDur ?? 0.5);
    return [{ start: 0, end: d, viseme: 'sil' }];
  }
  const lastT = fs[fs.length - 1].t;
  const dur = Math.max(totalDur ?? lastT + 0.2, lastT + 0.001);
  const segs: VisemeSegment[] = [];
  if (fs[0].t > 0) segs.push({ start: 0, end: fs[0].t, viseme: 'sil' });
  for (let i = 0; i < fs.length; i++) {
    const start = fs[i].t;
    const end = i + 1 < fs.length ? fs[i + 1].t : dur;
    if (end <= start) continue;
    segs.push({ start, end, viseme: asViseme(fs[i].viseme) });
  }
  // 合并相邻同 viseme 段(缩短 filtergraph)
  const merged: VisemeSegment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.viseme === s.viseme && Math.abs(last.end - s.start) < 1e-6) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

/** 某 viseme 的 ffmpeg `enable` 表达式 = 其所有窗口 between() 的并集;无窗口 → '0'(永不启用)。 */
export function enableExpr(segs: VisemeSegment[], viseme: Viseme): string {
  const mine = segs.filter((s) => s.viseme === viseme);
  if (mine.length === 0) return '0';
  return mine.map((s) => `between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})`).join('+');
}

/** 分段总时长(秒)。 */
export function segmentsDuration(segs: VisemeSegment[]): number {
  return segs.length ? segs[segs.length - 1].end : 0;
}
