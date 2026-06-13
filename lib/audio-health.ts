/**
 * lib/audio-health (v12.1.1) — 成片音频体检 + 自愈(阶段二十 B)。
 *
 * 两层:
 *   - 体检:ffprobe 成片是否含音频流;`audibilityLabel` 据 hasBgm/hasVoiceover 判「可听性」
 *     (有音频流 ≠ 听得到声 —— 缺 BGM/配音时只有静音轨)。
 *   - 自愈:成片若**完全缺音频流**(极端:anullsrc 也没生成)→ remux 补一条静音 aac,
 *     保证 mp4 在所有播放器可播(部分播放器对无音轨 mp4 行为异常)。
 *
 * 纯判定部分(audibilityLabel)可单测;ffprobe/remux 部分失败一律安全返回,不抛。
 */
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let ffReady = false;
function ensureFF(): void {
  if (ffReady) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static');
    if (typeof p === 'string' && fs.existsSync(p)) ffmpeg.setFfmpegPath(p);
  } catch { /* 系统 PATH 兜底 */ }
  ffReady = true;
}

export interface AudibilityInput { hasBgm?: boolean; hasVoiceover?: boolean }

/** 可听性标签(纯函数):有 BGM/配音才「有声」,否则「静音(缺配乐/配音)」。 */
export function audibilityLabel(input: AudibilityInput): { audible: boolean; label: string; sources: string[] } {
  const sources: string[] = [];
  if (input.hasVoiceover) sources.push('配音');
  if (input.hasBgm) sources.push('配乐');
  const audible = sources.length > 0;
  return {
    audible,
    sources,
    label: audible ? `有声 · ${sources.join('+')}` : '静音(成片缺配乐/配音)',
  };
}

/** ffprobe 成片是否含音频流;失败/文件缺失 → null(未知)。 */
export async function probeAudioStream(videoPath: string): Promise<boolean | null> {
  if (!videoPath || !fs.existsSync(videoPath)) return null;
  ensureFF();
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err || !data?.streams) return resolve(null);
      resolve(data.streams.some((s: any) => s.codec_type === 'audio'));
    });
  });
}

/**
 * 自愈:成片完全无音频流 → remux 补一条静音 aac(时长跟随视频)。返回新文件路径;
 * 已有音频流 / 失败 → 返回原路径(不动)。
 */
export async function ensureAudioStream(videoPath: string): Promise<{ path: string; healed: boolean }> {
  const has = await probeAudioStream(videoPath);
  if (has !== false) return { path: videoPath, healed: false }; // 有音轨或未知 → 不动
  ensureFF();
  const out = path.join(os.tmpdir(), `audiofix-${crypto.randomBytes(6).toString('hex')}.mp4`);
  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .input('anullsrc=channel_layout=stereo:sample_rate=44100')
      .inputFormat('lavfi')
      .outputOptions(['-c:v', 'copy', '-c:a', 'aac', '-shortest', '-map', '0:v:0', '-map', '1:a:0'])
      .output(out)
      .on('end', () => resolve(fs.existsSync(out) ? { path: out, healed: true } : { path: videoPath, healed: false }))
      .on('error', () => resolve({ path: videoPath, healed: false }))
      .run();
  });
}
