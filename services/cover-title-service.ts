/**
 * services/cover-title-service (v12.3.2) — 封面标题烧入(阶段二十二)。
 * 把标题用 ffmpeg drawtext 烧进封面图,输出新图。无可用 CJK 字体 → 跳过(burned:false,
 * 调用方保留原图,诚实降级,中文不烧成方块)。远端图先下载到临时文件。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { resolveFFmpegPath } from './video-composer';
import { buildCoverDrawtext, coverFontCandidates } from '@/lib/cover-title-burn';
import { getTitleSafeArea } from '@/lib/cover-candidates';

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`))));
  });
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) { file.close(); fs.unlink(dest, () => {}); return reject(new Error(`download ${res.statusCode}`)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { file.close(); fs.unlink(dest, () => {}); reject(e); });
  });
}

export interface BurnCoverResult { outputPath: string; burned: boolean; reason?: string }

/**
 * 把 title 烧进封面图。inputPathOrUrl 可本地或 http(s)。outputDir 默认临时目录。
 * 无字体 → burned:false(复制原图);无标题 → burned:false(原图)。
 */
export async function burnCoverTitle(inputPathOrUrl: string, title: string, opts?: { outputDir?: string; height?: number }): Promise<BurnCoverResult> {
  const outDir = opts?.outputDir || path.join(os.tmpdir(), 'qfmj-covers');
  fs.mkdirSync(outDir, { recursive: true });

  // 取本地输入(远端先下载)
  let inputPath = inputPathOrUrl;
  let tmpIn: string | null = null;
  if (/^https?:\/\//.test(inputPathOrUrl)) {
    tmpIn = path.join(outDir, `src-${Date.now()}.img`);
    await download(inputPathOrUrl, tmpIn);
    inputPath = tmpIn;
  }
  if (!fs.existsSync(inputPath)) throw new Error(`cover input not found: ${inputPath}`);

  const outputPath = path.join(outDir, `cover-titled-${Date.now()}.jpg`);
  const cleanText = (title || '').trim();
  const font = coverFontCandidates().find((f) => fs.existsSync(f)) || null;

  // 无标题 或 无字体 → 不烧,复制原图(诚实降级)
  if (!cleanText || !font) {
    fs.copyFileSync(inputPath, outputPath);
    if (tmpIn) fs.unlink(tmpIn, () => {});
    return { outputPath, burned: false, reason: !cleanText ? 'no-title' : 'no-cjk-font' };
  }

  const textfile = path.join(outDir, `title-${Date.now()}.txt`);
  fs.writeFileSync(textfile, cleanText, 'utf-8');
  const filter = buildCoverDrawtext({ width: 1080, height: opts?.height || 1920, safeArea: getTitleSafeArea(), fontFile: font, textfile });

  try {
    await runFfmpeg(resolveFFmpegPath(), ['-y', '-i', inputPath, '-vf', filter, '-frames:v', '1', outputPath]);
    return { outputPath, burned: true };
  } finally {
    fs.unlink(textfile, () => {});
    if (tmpIn) fs.unlink(tmpIn, () => {});
  }
}
