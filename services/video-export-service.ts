/**
 * v3.5.1 — 平台导出服务.
 *
 * 把已合成的成片再处理成"目标平台版本": 横竖屏转换 (buildAspectFilter) + 平台风格
 * 字幕烧录 (buildSubtitlesFilter). 不动 composeVideo 主流程 — 这是 additive 后处理,
 * 用户点"导出抖音竖屏版"才跑.
 *
 * 真正 spawn ffmpeg, 失败 throw. 调用方 (API route) catch.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolveFFmpegPath } from './video-composer';
import { buildAspectFilter, type ExportAspect, type FitMode } from '@/lib/video-export';
import { buildSubtitlesFilter, escapeSubtitlePath, type SubtitlePlatform } from '@/lib/subtitle-burn';

export interface PlatformExportOptions {
  /** 输入成片绝对路径. */
  inputPath: string;
  /** 输出目录, 默认与输入同目录. */
  outputDir?: string;
  /** 目标比例. */
  aspect: ExportAspect;
  /** 适配方式. 默认 blur-pad (短视频标配). */
  fit?: FitMode;
  /** 字幕平台风格预设. 不传 = 不烧字幕. */
  subtitlePlatform?: SubtitlePlatform;
  /** SRT/ASS 字幕路径. subtitlePlatform 给了才用. */
  subtitlePath?: string;
  /** 输出文件名 (不含扩展名). 默认 input 名 + 平台后缀. */
  outName?: string;
}

export interface PlatformExportResult {
  outputPath: string;
  aspect: ExportAspect;
  width: number;
  height: number;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`));
    });
  });
}

/**
 * 导出平台版本. 横竖屏转换 (+可选字幕烧录), 输出 mp4.
 */
export async function exportForPlatform(opts: PlatformExportOptions): Promise<PlatformExportResult> {
  if (!opts.inputPath || !fs.existsSync(opts.inputPath)) {
    throw new Error(`exportForPlatform: input not found: ${opts.inputPath}`);
  }
  const bin = resolveFFmpegPath();
  const fit = opts.fit ?? 'blur-pad';
  const outDir = opts.outputDir || path.dirname(opts.inputPath);
  fs.mkdirSync(outDir, { recursive: true });

  const aspectFilter = buildAspectFilter({ targetAspect: opts.aspect, fit });

  const baseName = opts.outName
    || `${path.basename(opts.inputPath, path.extname(opts.inputPath))}-${opts.aspect.replace(':', 'x')}`;
  const outputPath = path.join(outDir, `${baseName}.mp4`);

  // 拼 filter:
  //   - aspect.vf (contain/cover) 是单链, 可直接拼字幕
  //   - aspect.filterComplex (blur-pad) 已是 complex, 字幕需接在最后一个输出上
  const args: string[] = ['-y', '-i', opts.inputPath];

  let subFilter = '';
  if (opts.subtitlePlatform && opts.subtitlePath && fs.existsSync(opts.subtitlePath)) {
    subFilter = buildSubtitlesFilter(opts.subtitlePath, opts.subtitlePlatform);
  }

  if (aspectFilter.filterComplex) {
    // blur-pad: 复杂链. 末尾 overlay 输出后接字幕 (若有)
    const fc = subFilter
      ? `${aspectFilter.filterComplex}[v];[v]${subFilter}`
      : aspectFilter.filterComplex;
    args.push('-filter_complex', fc);
  } else {
    // contain/cover: 简单 vf, 字幕用逗号续接
    const vf = subFilter ? `${aspectFilter.vf},${subFilter}` : aspectFilter.vf!;
    args.push('-vf', vf);
  }

  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath,
  );

  await runFfmpeg(bin, args);
  if (!fs.existsSync(outputPath)) {
    throw new Error('exportForPlatform: ffmpeg finished but output missing');
  }
  return { outputPath, aspect: opts.aspect, width: aspectFilter.width, height: aspectFilter.height };
}

/** 给 escapeSubtitlePath 暴露一个稳定入口 (API 校验路径用). */
export { escapeSubtitlePath };
