/**
 * lib/scene-split (v11.1.1) — 外部视频场景切分(拉片复刻 · 拆条层)。
 *
 * ffmpeg `select='gt(scene,THRESHOLD)'` + showinfo:相邻帧画面差异超阈值的
 * 时间点 = 切镜点(与 beat-detect 同款"用 ffmpeg 信号,不自己做 CV"哲学)。
 * 柔和转场(叠化/甩镜)会漏切/过切 —— 这是已知限位,拉片工作台支持人工
 * 合并/拆分兜底(阶段十九计划 §四)。
 *
 * 纯函数部分(parseShowinfoTimes / splitToShots)零 IO 可单测;
 * ffmpeg 部分失败一律返回空/null,调用方降级。
 */
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

/** 场景差异阈值:0.4 是短剧/快剪内容的经验值(硬切灵敏,叠化偏钝) */
export const SCENE_THRESHOLD = 0.4;
/** 碎镜合并下限:短于此的段并入前段(showinfo 在快闪画面上会过切) */
export const MIN_SHOT_SEC = 1;
/** 镜数护栏:Vision 打标按镜计费,超长片截断并如实告知 */
export const MAX_SHOTS = 60;

let ffmpegReady = false;
function ensureFFmpeg(): void {
  if (ffmpegReady) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegPath = require('ffmpeg-static');
    if (typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) ffmpeg.setFfmpegPath(ffmpegPath);
  } catch { /* 系统 PATH 兜底 */ }
  ffmpegReady = true;
}

/** showinfo stderr → 帧时间点(升序去重秒)。导出供单测。 */
export function parseShowinfoTimes(stderrText: string): number[] {
  const out: number[] = [];
  const seen = new Set<string>();
  for (const m of stderrText.matchAll(/pts_time:\s*([\d.]+)/g)) {
    const t = parseFloat(m[1]);
    if (!Number.isFinite(t)) continue;
    const k = t.toFixed(3);
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out.sort((a, b) => a - b);
}

export interface ShotSegment {
  shotNumber: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

/**
 * 切点 → 镜头段(纯函数):[0, ...cuts, duration] 相邻成段;
 * 短于 minShotSec 的并入前段;超 maxShots 截断(truncated 标记给 UI 如实展示)。
 */
export function splitToShots(
  durationSec: number,
  cuts: number[],
  opts?: { minShotSec?: number; maxShots?: number },
): { shots: ShotSegment[]; truncated: boolean } {
  const minSec = opts?.minShotSec ?? MIN_SHOT_SEC;
  const maxShots = opts?.maxShots ?? MAX_SHOTS;
  if (!(durationSec > 0)) return { shots: [], truncated: false };

  const bounds = [0, ...cuts.filter((c) => c > 0 && c < durationSec).sort((a, b) => a - b), durationSec];
  const segs: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < bounds.length; i++) {
    const start = bounds[i - 1];
    const end = bounds[i];
    if (end - start < 0.001) continue; // 重复切点
    if (segs.length > 0 && end - start < minSec) {
      segs[segs.length - 1].end = end;  // 碎镜并入前段
    } else {
      segs.push({ start, end });
    }
  }
  // 首段也可能过短(片头黑场):并入后段
  if (segs.length >= 2 && segs[0].end - segs[0].start < minSec) {
    segs[1].start = segs[0].start;
    segs.shift();
  }

  const truncated = segs.length > maxShots;
  const kept = truncated ? segs.slice(0, maxShots) : segs;
  return {
    truncated,
    shots: kept.map((s, i) => ({
      shotNumber: i + 1,
      startSec: round3(s.start),
      endSec: round3(s.end),
      durationSec: round3(s.end - s.start),
    })),
  };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }

/** 视频时长(秒);失败 null。 */
export async function probeDurationSec(videoPath: string): Promise<number | null> {
  if (!videoPath || !fs.existsSync(videoPath)) return null;
  ensureFFmpeg();
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      const d = data?.format?.duration;
      resolve(!err && typeof d === 'number' && d > 0 ? round3(d) : null);
    });
  });
}

/** 场景切点检测(秒,升序)。无切点/失败 → [](单镜处理)。 */
export async function detectSceneCuts(videoPath: string, threshold: number = SCENE_THRESHOLD): Promise<number[]> {
  if (!videoPath || !fs.existsSync(videoPath)) return [];
  ensureFFmpeg();
  return new Promise((resolve) => {
    let stderrBuf = '';
    const cmd = ffmpeg(videoPath)
      .videoFilters(`select='gt(scene,${threshold})',showinfo`)
      .format('null')
      .output('-')
      .on('stderr', (line: string) => { stderrBuf += line + '\n'; })
      .on('end', () => resolve(parseShowinfoTimes(stderrBuf)))
      .on('error', () => resolve([]));
    try { cmd.run(); } catch { resolve([]); }
  });
}

/** 抽取指定时刻的一帧 JPEG → 临时文件路径;失败 null。调用方负责清理。 */
export async function extractFrameAt(videoPath: string, atSec: number): Promise<string | null> {
  if (!videoPath || !fs.existsSync(videoPath)) return null;
  ensureFFmpeg();
  const out = path.join(os.tmpdir(), `pullframe-${crypto.randomBytes(6).toString('hex')}.jpg`);
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, atSec))
      .frames(1)
      .outputOptions(['-q:v', '4'])
      .output(out)
      .on('end', () => resolve(fs.existsSync(out) ? out : null))
      .on('error', () => resolve(null))
      .run();
  });
}
