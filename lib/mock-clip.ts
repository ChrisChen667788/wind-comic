/**
 * lib/mock-clip — MOCK_ENGINES 下的确定性假视频(ffmpeg lavfi 纯色 + 正弦音轨)。v12.459 从 mock-assets 路由抽出。
 *
 * 原先只在 `app/api/mock-assets/[...path]/route.ts` 里有一份;v12.459 单镜重生的全封闭分支也要生成同样的
 * 假片,而且要**直接拿本地文件**(经 HTTP 取 localhost 会被 safeFetch 的 SSRF 防护拦下)。两处共用这一份。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ffmpegBin } from '@/lib/lipsync-providers/local-2d';

const execFileP = promisify(execFile);

export const MOCK_AR_SIZE: Record<string, [number, number]> = {
  '16:9': [1024, 576],
  '9:16': [576, 1024],
  '1:1': [768, 768],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '2.35:1': [1128, 480],
};

/** 生成(或命中缓存)一段假片,返回本地文件路径。同 seed / 画幅 / 时长 → 同一个文件。 */
export async function ensureMockClipFile(seed: string, ar: string, dur: number): Promise<string> {
  const [w, h] = MOCK_AR_SIZE[ar] || MOCK_AR_SIZE['16:9'];
  const cacheDir = path.join(os.tmpdir(), 'qfmj-mock-assets');
  const file = path.join(cacheDir, `${seed}-${w}x${h}-${dur}.mp4`);
  if (fs.existsSync(file)) return file;

  const bin = ffmpegBin();
  if (!bin) throw new Error('ffmpeg unavailable');
  fs.mkdirSync(cacheDir, { recursive: true });
  const color = seed.slice(0, 6);
  const freq = 220 + (parseInt(seed.slice(4, 8), 16) % 440);
  const tmp = `${file}.part-${process.pid}.mp4`;
  await execFileP(
    bin,
    [
      '-y',
      '-f', 'lavfi', '-i', `color=c=0x${color}:s=${w}x${h}:d=${dur}:r=24`,
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', tmp,
    ],
    { timeout: 20_000 },
  );
  fs.renameSync(tmp, file); // 原子落位,避免并发读到半截文件
  return file;
}
