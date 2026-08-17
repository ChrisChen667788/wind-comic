/**
 * services/frame-strip.service — 按规划好的时间戳**精确**抽帧。v12.328。
 *
 * ── 唯一需要格外小心的一件事:seek 的位置 ──────────────────────────
 * `scene-split.extractFrameAt` 用 `seekInput()`,即 `-ss` 放在 `-i` **之前**:
 * 快,但只能定位到**关键帧**。做拉片中帧够用 —— 差个半秒无所谓。
 * 逐帧检视**绝对不行**:用户看到的画面与标注的时间戳不是同一帧,他据此选出的
 * 重拍区间就是错的,而这种错**看不出来**,只体现为成片在那处抖一下。
 *
 * 所以这里 `-ss` 放在 `-i` **之后**(精确 seek)—— 与 v12.315 `cutSegment` 同一口径。
 * 代价是要解码到该时刻,慢一些;逐帧检视本就不是热路径,这个代价该付。
 *
 * ── 分工 ──────────────────────────────────────────────────────────
 * **本文件不做任何时间计算**:时间戳全部来自 `lib/frame-strip.planFrameStrip`,
 * 那边与片段重拍共用同一个 `snapToFrame`。执行层一旦自己算,两边就会漂。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import { storagePut } from '@/lib/storage';

export interface ExtractedFrame {
  /** 帧序号(相对整镜起点) */
  frameIndex: number;
  /** 精确时间戳(秒),与重拍切点同一口径 */
  atSec: number;
  /** 可访问的图片 URL */
  url: string;
}

/** 单帧抽取。`-ss` 在 `-i` 之后 = 精确 seek(见文件头)。 */
async function grabFrame(videoPath: string, atSec: number, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .setStartTime(Math.max(0, atSec))   // ← 放在 input 之后 → 精确
      .frames(1)
      .outputOptions(['-q:v', '3'])
      .output(outPath)
      .on('end', () => resolve(fs.existsSync(outPath)))
      .on('error', () => resolve(false))
      .run();
  });
}

export interface ExtractFramesInput {
  videoPath: string;
  /** 来自 planFrameStrip 的时间戳与帧号,一一对应 */
  timestamps: number[];
  frameIndexes: number[];
  /** 并发度:抽帧是解码密集型,默认 3(与 TTS 的 v12.29x 取值同理) */
  concurrency?: number;
}

/**
 * 批量抽帧。**逐帧失败只丢那一帧**,不整批失败 —— 一条 8 秒的镜头抽 100 帧,
 * 因为其中一帧解码失败就整个不给看,是把小问题放大成不可用。
 */
export async function extractFrames(input: ExtractFramesInput): Promise<{
  frames: ExtractedFrame[];
  failed: number[];
}> {
  const { videoPath, timestamps, frameIndexes } = input;
  if (!fs.existsSync(videoPath)) return { frames: [], failed: frameIndexes.slice() };

  const conc = Math.max(1, Math.min(6, input.concurrency ?? 3));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framestrip-'));
  const out: (ExtractedFrame | null)[] = new Array(timestamps.length).fill(null);
  const failed: number[] = [];

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= timestamps.length) return;
      const tmp = path.join(dir, `f-${i}-${crypto.randomBytes(3).toString('hex')}.jpg`);
      const ok = await grabFrame(videoPath, timestamps[i], tmp);
      if (!ok) { failed.push(frameIndexes[i]); continue; }
      try {
        const put = await storagePut(fs.readFileSync(tmp), 'image/jpeg', 'jpg');
        // 按下标落位,保证**帧序与时间戳严格对应**(并发下不能靠 push 的先后)
        out[i] = { frameIndex: frameIndexes[i], atSec: timestamps[i], url: put.url };
      } catch {
        failed.push(frameIndexes[i]);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(conc, timestamps.length) }, worker));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 尽力而为 */ }
  }

  return { frames: out.filter((f): f is ExtractedFrame => f !== null), failed: failed.sort((a, b) => a - b) };
}
