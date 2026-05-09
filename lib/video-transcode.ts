/**
 * lib/video-transcode (v2.16 P0.2)
 *
 * 把已有 mp4 转码到指定分辨率, 用于 /api/projects/[id]/export?resolution=...
 *
 * 设计:
 *   - 复用 services/video-composer.ts 已经初始化好的 ffmpeg 路径(同一进程不重复 setFfmpegPath)
 *   - lanczos 上采样 (高质量, 适合从 720p/1080p → 1080p/2160p)
 *   - 缓存到 data/exports/<basename>-<resolution>.mp4, 已存在就跳过 (省时间省磁盘)
 *   - 不引新依赖 — fluent-ffmpeg + ffmpeg-static 已经是 video-composer 的依赖
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import ffmpeg from 'fluent-ffmpeg';

export type Resolution = '720p' | '1080p' | '2160p';

/** 分辨率 → ffmpeg scale 表达式 */
const RESOLUTION_SPECS: Record<Resolution, { width: number; height: number; label: string }> = {
  '720p': { width: 1280, height: 720, label: 'HD' },
  '1080p': { width: 1920, height: 1080, label: 'FHD' },
  '2160p': { width: 3840, height: 2160, label: '4K UHD' },
};

export interface TranscodeOptions {
  /** 源 mp4 绝对路径 */
  sourcePath: string;
  /** 目标分辨率 */
  resolution: Resolution;
  /** 输出目录, 默认 <cwd>/data/exports */
  outputDir?: string;
  /** 缓存命中时是否仍重转 (默认 false → 命中即返) */
  forceRetranscode?: boolean;
}

export interface TranscodeResult {
  outputPath: string;
  resolution: Resolution;
  /** 是否走的缓存 */
  cached: boolean;
  /** 转码耗时 ms (cached 时为 0) */
  elapsedMs: number;
  /** 输出文件大小 bytes */
  fileSize: number;
}

/**
 * 转码到目标分辨率。已缓存就直接返回路径。
 * 失败抛异常, 调用方 (route 层) 应该捕获并 500。
 */
export async function transcodeToResolution(
  opts: TranscodeOptions,
): Promise<TranscodeResult> {
  const { sourcePath, resolution, forceRetranscode = false } = opts;

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source video not found: ${sourcePath}`);
  }

  const spec = RESOLUTION_SPECS[resolution];
  if (!spec) {
    throw new Error(`Unsupported resolution: ${resolution}`);
  }

  const outputDir = opts.outputDir || path.join(process.cwd(), 'data', 'exports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 缓存 key: 源文件 basename + resolution
  // 同一个项目多次下载相同 resolution 不重转
  const sourceName = path.basename(sourcePath, path.extname(sourcePath));
  const outputPath = path.join(outputDir, `${sourceName}-${resolution}.mp4`);

  if (!forceRetranscode && fs.existsSync(outputPath)) {
    const stat = fs.statSync(outputPath);
    // 5MB 以下当作可疑, 强制重转 (上次可能转到一半进程被 kill)
    if (stat.size > 5 * 1024 * 1024) {
      return {
        outputPath,
        resolution,
        cached: true,
        elapsedMs: 0,
        fileSize: stat.size,
      };
    }
  }

  const t0 = Date.now();

  await new Promise<void>((resolve, reject) => {
    ffmpeg(sourcePath)
      .outputOptions([
        // lanczos 上采样: 从低分辨率源放大到 1080p / 2160p 时画质更好
        `-vf scale=${spec.width}:${spec.height}:flags=lanczos`,
        // H.264 + faststart, 浏览器兼容性最好
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '20',
        '-c:a', 'copy',  // 音频直接 copy, 不 re-encode 省时间
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  const stat = fs.statSync(outputPath);
  return {
    outputPath,
    resolution,
    cached: false,
    elapsedMs: Date.now() - t0,
    fileSize: stat.size,
  };
}

/** 校验字符串是不是合法 Resolution */
export function isValidResolution(s: string | null | undefined): s is Resolution {
  return s === '720p' || s === '1080p' || s === '2160p';
}
