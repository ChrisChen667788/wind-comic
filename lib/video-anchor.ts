/**
 * 视频角色锚抽帧(v12.183.0)—— 2-3s 已过审片段 → 均匀抽 N 关键帧,作多姿态参考图。
 *
 * 背景:真「参考视频」通道(Kling Elements 3.0 收 8s 视频 / Seedance 混合输入)在当前
 * 账号不可用(v1-6 multi-image 只收图;Seedance 被额度挡)—— 抽帧多图是可用通道下的
 * 最优近似:把步态/表情习惯等动态特征以多姿态帧喂进 Elements image_list / cref refs。
 * ffmpeg 均匀抽帧落持久目录;任一步失败返回 [](调用方按无参考处理)。
 */
import { execFile } from 'child_process';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { persistentMediaDir } from './media-persist';
import { serveFileToLocalPath } from './first-frame';
import { resolveFFmpegPath, resolveFFprobePath } from './ffmpeg-bin';

const execFileAsync = promisify(execFile);

export async function extractAnchorFrames(videoUrlOrPath: string, n = 3): Promise<string[]> {
  const src = serveFileToLocalPath(videoUrlOrPath) || videoUrlOrPath;
  if (!src) return [];
  try {
    // 时长探测 → 均匀取样时间点(掐头去尾 10%)
    const { stdout } = await execFileAsync(resolveFFprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { timeout: 30_000 });
    const dur = Number(stdout.trim());
    if (!Number.isFinite(dur) || dur <= 0) return [];
    const pad = dur * 0.1;
    const usable = Math.max(0.1, dur - pad * 2);
    const outDir = persistentMediaDir('images');
    const urls: string[] = [];
    for (let i = 0; i < Math.max(1, n); i++) {
      const t = pad + (usable * (i + 0.5)) / Math.max(1, n);
      const out = path.join(outDir, `vanchor-${Date.now()}-${i}.jpg`);
      await execFileAsync(resolveFFmpegPath(), ['-y', '-ss', String(t.toFixed(2)), '-i', src, '-frames:v', '1', '-q:v', '2', out], { timeout: 60_000 });
      if (fs.existsSync(out)) urls.push(`${serveFilePathUrl(out)}`);
    }
    return urls;
  } catch { return []; }
}
