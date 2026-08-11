/**
 * services/segment-retake — 镜内片段重拍的**执行层**(v12.315)。
 *
 * v12.314 落的是纯逻辑 `planSegmentRetake`(缝合计划);这里按计划真的去切、去缝。
 * 分层的理由:所有边界判断(引擎下限、帧对齐、总时长不变)都在纯函数里可测,
 * 这一层只剩「照计划执行 ffmpeg」,不再做任何算术 —— 一旦这里也开始算时长,
 * 就又会出现两套口径(本仓已经在转场/音色/时间轴上栽过五次)。
 *
 * 缝合方式刻意用 **concat demuxer(-c copy)** 而非重编码:
 *   ① 保留段是原片的字节拷贝,画质零损失 —— 用户只改了 2 秒,不该让另外 6 秒也劣化一代;
 *   ② 快,不占 CPU;
 *   ③ 代价是三段必须编码参数一致,所以补丁段先按原片参数重编码对齐(`normalizePatch`)。
 * 直接对三段做 filter concat 会把整镜重编码,那正是这个功能要避免的浪费。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { planSegmentRetake, type SegmentRetakePlan } from '@/lib/segment-retake';

export interface SegmentRetakeExecInput {
  /** 原镜本地文件路径 */
  sourcePath: string;
  /** 引擎生成出来的补丁素材(时长 = plan.generateDurationS) */
  patchPath: string;
  plan: SegmentRetakePlan;
  /** 输出目录;不传则自建临时目录(自建的会在失败时清掉,见 v12.313) */
  outputDir?: string;
}

export interface SegmentRetakeExecResult {
  outputPath: string;
  /** 缝合后实测时长 —— 由调用方与 plan.totalAfterS 核对 */
  measuredDurationS: number;
}

/** 探测视频时长(复用 composer 的 ffprobe 口径,不另起一套) */
async function probeDuration(file: string): Promise<number> {
  const { probeVideoIntegrity } = await import('@/services/video-composer');
  const r = await probeVideoIntegrity(file);
  return r?.durationSec ?? 0;
}

/**
 * 按计划缝合:head + patch + tail。
 *
 * **不做任何时长算术** —— 切点全部取自 plan(已帧对齐)。
 * 这是本模块与 v12.314 的分工边界,测试会锁住它。
 */
export async function executeSegmentRetake(
  input: SegmentRetakeExecInput,
): Promise<SegmentRetakeExecResult> {
  const { sourcePath, patchPath, plan } = input;
  if (!plan?.ok) throw new Error(`片段重拍计划无效:${plan?.reason || '未知原因'}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`原镜文件不存在:${sourcePath}`);
  if (!fs.existsSync(patchPath)) throw new Error(`补丁素材不存在:${patchPath}`);

  const ownsTmp = !input.outputDir;
  const tmpDir = input.outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'seg-retake-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const cleanup = () => {
    if (!ownsTmp) return;   // v12.313:调用方传进来的目录归调用方,无权删
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 清理失败不阻塞 */ }
  };

  try {
    const parts: string[] = [];

    if (plan.head) {
      const p = path.join(tmpDir, 'head.mp4');
      await cutSegment(sourcePath, plan.head.fromS, plan.head.toS, p);
      parts.push(p);
    }

    // 补丁:从生成物里裁出 plan 指定的区间(引擎下限导致生成物可能比缺口长)
    const patchCut = path.join(tmpDir, 'patch.mp4');
    await cutSegment(patchPath, plan.trimFromS, plan.trimToS, patchCut);
    // 与原片编码参数对齐,否则 concat demuxer 会拒绝或产出坏流
    const patchNorm = path.join(tmpDir, 'patch-norm.mp4');
    await normalizePatch(patchCut, sourcePath, patchNorm);
    parts.push(patchNorm);

    if (plan.tail) {
      const p = path.join(tmpDir, 'tail.mp4');
      await cutSegment(sourcePath, plan.tail.fromS, plan.tail.toS, p);
      parts.push(p);
    }

    const outputPath = path.join(tmpDir, `retaken-${plan.patchFromS.toFixed(2)}-${plan.patchToS.toFixed(2)}.mp4`);
    await concatCopy(parts, tmpDir, outputPath);

    const measuredDurationS = await probeDuration(outputPath);
    return { outputPath, measuredDurationS };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** 精确切片。`-ss` 放在 `-i` 之前是快速定位,之后是精确定位 —— 这里要精确。 */
async function cutSegment(src: string, fromS: number, toS: number, out: string): Promise<void> {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  await new Promise<void>((resolve, reject) => {
    ffmpeg(src)
      .setStartTime(fromS)
      .setDuration(Math.max(0, toS - fromS))
      .outputOptions(['-avoid_negative_ts', 'make_zero'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** 把补丁段编码参数对齐到原片(分辨率/帧率/像素格式/音频),否则 concat 拒绝拼。 */
async function normalizePatch(patch: string, reference: string, out: string): Promise<void> {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const meta = await new Promise<any>((resolve, reject) => {
    (ffmpeg as any).ffprobe(reference, (err: unknown, data: unknown) => (err ? reject(err) : resolve(data)));
  });
  const v = (meta?.streams || []).find((s: any) => s.codec_type === 'video');
  const w = Number(v?.width) || 1920;
  const h = Number(v?.height) || 1080;
  const fpsRaw = String(v?.r_frame_rate || '24/1');
  const [fn, fd] = fpsRaw.split('/').map(Number);
  const fps = Number.isFinite(fn) && Number.isFinite(fd) && fd > 0 ? Math.round(fn / fd) : 24;

  await new Promise<void>((resolve, reject) => {
    ffmpeg(patch)
      .videoFilters([`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, `fps=${fps}`, 'setsar=1'])
      .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** concat demuxer + `-c copy`:保留段零损失、零重编码。 */
async function concatCopy(parts: string[], tmpDir: string, out: string): Promise<void> {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const listPath = path.join(tmpDir, 'seg-list.txt');
  fs.writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .output(out)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

/** 便捷入口:先算计划再执行(计划不通过时直接把人话原因抛出去)。 */
export async function planAndExecute(
  args: Parameters<typeof planSegmentRetake>[0] & Omit<SegmentRetakeExecInput, 'plan'>,
): Promise<SegmentRetakeExecResult & { plan: SegmentRetakePlan }> {
  const plan = planSegmentRetake(args);
  if (!plan.ok) throw new Error(plan.reason || '片段重拍计划无效');
  const r = await executeSegmentRetake({ ...args, plan });
  return { ...r, plan };
}
