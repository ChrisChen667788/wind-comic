/**
 * 音频兜底 — 当 Minimax TTS 返回 status_code:0 但 audio 字段为空,
 * 或 Edge-TTS / 其他 TTS 服务也失败时, 用这里的工具生成一段对应时长的"静音 mp3"。
 *
 * 为什么要这么做:
 *   · 成片管线里每一镜头的 timeline 里都会注入 TTS 音轨, 如果某镜 TTS 失败直接 skip,
 *     下游的 concat 时序会错位: 画面比预期短, 或者配乐 adelay 计算错。
 *   · 静音 mp3 = 声音是"空的"但时长对得上, 成片依然能合, 用户只是听不到那一句配音。
 *   · 比"整段无声片"好: 其他镜的 TTS 都正常, 只有问题镜静默, 问题定位也容易。
 *
 * 不依赖新包 —— 复用已有的 ffmpeg-static + fluent-ffmpeg。
 *
 * 使用:
 *   const path = await createSilenceMp3(2.5);
 *   // → 返回本地文件绝对路径, 例如 /tmp/ai-comic-silence-1761234567890-abc.mp3
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';

/** 与 video-composer 保持一致的 ffmpeg 路径解析逻辑 */
function resolveFfmpegPath(): string | null {
  if (ffmpegPath && typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) return ffmpegPath;
  const cwdGuess = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(cwdGuess)) return cwdGuess;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkgJson = require.resolve('ffmpeg-static/package.json');
    const guess = path.join(path.dirname(pkgJson), 'ffmpeg');
    if (fs.existsSync(guess)) return guess;
  } catch { /* ignore */ }
  return 'ffmpeg'; // 最后退回系统 PATH 的 ffmpeg
}

let _ffmpegReady = false;
function ensureFfmpegConfigured() {
  if (_ffmpegReady) return;
  const p = resolveFfmpegPath();
  if (p) ffmpeg.setFfmpegPath(p);
  _ffmpegReady = true;
}

/**
 * 生成指定时长的静音 mp3, 返回本地文件绝对路径。
 *
 * @param durationSec  静音时长 (秒), 最小 0.3s, 最大 120s。外部传入过小/过大会被夹到合法范围。
 * @param outDir       输出目录, 默认放到 OS temp
 * @returns 生成的文件绝对路径
 */
export async function createSilenceMp3(
  durationSec: number,
  outDir?: string,
): Promise<string> {
  ensureFfmpegConfigured();
  const dur = Math.max(0.3, Math.min(120, durationSec || 1));
  const dir = outDir || os.tmpdir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = `ai-comic-silence-${Date.now()}-${randomBytes(3).toString('hex')}.mp3`;
  const fullPath = path.join(dir, name);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      // anullsrc 是 ffmpeg 自带的"无声源" (ANull source), 可以指定时长, 生成零信号
      .input('anullsrc=channel_layout=mono:sample_rate=32000')
      .inputFormat('lavfi')
      .duration(dur)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .format('mp3')
      .on('error', (e) => reject(new Error(`silence mp3 ffmpeg error: ${e.message}`)))
      .on('end', () => resolve())
      .save(fullPath);
  });

  return fullPath;
}

/**
 * 根据文本长度估算一个合理的 TTS 时长 (秒), 用在 TTS 失败时生成相应长度的静音兜底。
 * 跟 tts.service.ts 的 estimateDuration 保持一致: 中文 ~4 字/秒, 其他 ~10 字/秒。
 */
export function estimateSpeechDuration(text: string): number {
  if (!text) return 1;
  const zh = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const other = text.length - zh;
  return Math.max(1.0, zh / 4 + other / 10);
}
