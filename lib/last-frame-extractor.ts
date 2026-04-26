/**
 * Last Frame Extractor (v2.9 P1 Keyframes)
 *
 * 从已生成的视频片段抽取末帧作为"衔接锚点",给下一个 shot 当参考图用。
 *
 * 为什么 storyboard 图不够:
 *   storyboard 是规划时画的"大概样子",跟 video 模型实际生成的每一帧
 *   (光影 / 角色微表情 / 手势) 对不上。下一个 shot 只能从 storyboard 开始
 *   就会有个"换场"的跳变感。
 *
 * 用上一 shot 末帧:
 *   T: ~0.5s/shot (fluent-ffmpeg 一个 seek+single frame 命令)
 *   Gain: 跨 shot 角色姿态/表情连续,大幅减少"每句话换张脸"的廉价感
 *
 * 失败不抛错 —— 衔接是锦上添花,任何一环失败都回退到普通生成。
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { persistAsset } from './asset-storage';

// 复用 video-composer 里的 ffmpeg 路径解析(避免循环 import,复制一份足够)
let ffmpegReady = false;
function ensureFFmpeg() {
  if (ffmpegReady) return;
  const p = (typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) ? ffmpegPath : 'ffmpeg';
  ffmpeg.setFfmpegPath(p);
  ffmpegReady = true;
}

/**
 * 从本地或远程视频 URL 抽取最后一帧,持久化到 asset storage,返回稳定 URL。
 *
 * @param videoUrl http(s):// 或 /api/serve-file?key=xxx 或 /api/serve-file?path=tmp
 * @returns 持久化后的 URL,失败时 null
 */
export async function extractLastFrame(videoUrl: string): Promise<string | null> {
  return extractFrameAtRatio(videoUrl, 'end');
}

/**
 * v2.11 #3 智能插帧:抽中间帧作为"全局风格锚点",防止链式漂移。
 *
 * 问题:
 *   P1 Keyframes 把 shot N 末帧喂给 shot N+1 可以做短程衔接,但 10+ shots
 *   链式传递会像"复印件复印件"那样累积误差 —— shot 10 已经跟 shot 1 脱像。
 *
 * 解决:
 *   中间帧(t=duration/2)最能代表一个 shot 的"成熟画面"(首帧可能还在展开,
 *   末帧可能已在过渡)。把它作为全片的"风格基准参考"始终挂在 referenceImages,
 *   相当于给每个 shot 都额外喂一张"故事的基调 look"。
 *
 * @param videoUrl 视频地址
 * @returns 中间帧持久化 URL,失败返回 null
 */
export async function extractMiddleFrame(videoUrl: string): Promise<string | null> {
  return extractFrameAtRatio(videoUrl, 'middle');
}

/**
 * 通用抽帧函数,支持 'end' / 'middle' 两种位置。
 * 不导出;通过 extractLastFrame / extractMiddleFrame 对外暴露固定语义。
 */
async function extractFrameAtRatio(videoUrl: string, position: 'end' | 'middle'): Promise<string | null> {
  if (!videoUrl) return null;
  ensureFFmpeg();

  const label = position === 'middle' ? 'midframe' : 'lastframe';
  const tmpIn = path.join(os.tmpdir(), `${label}-${crypto.randomBytes(6).toString('hex')}.mp4`);
  const tmpOut = path.join(os.tmpdir(), `${label}-${crypto.randomBytes(6).toString('hex')}.jpg`);

  try {
    // 1) 下载或拷贝视频到本地
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const resp = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        console.warn(`[LastFrame] fetch failed ${resp.status}: ${videoUrl.slice(0, 80)}`);
        return null;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(tmpIn, buf);
    } else if (videoUrl.startsWith('/api/serve-file')) {
      // 本地 serve-file 转成绝对路径
      const u = new URL(videoUrl, 'http://localhost');
      const key = u.searchParams.get('key');
      const p = u.searchParams.get('path');
      if (key) {
        // 持久化仓库 -> 直接读(通过 resolveByKey 会更准,这里走 import 避免循环)
        const { resolveByKey } = await import('./asset-storage');
        const resolved = resolveByKey(key);
        if (!resolved) return null;
        fs.copyFileSync(resolved.absPath, tmpIn);
      } else if (p && fs.existsSync(p)) {
        fs.copyFileSync(p, tmpIn);
      } else {
        return null;
      }
    } else if (fs.existsSync(videoUrl)) {
      fs.copyFileSync(videoUrl, tmpIn);
    } else {
      return null;
    }

    // 2) ffprobe 拿 duration,然后 seek 到对应位置抽一帧
    // (直接 -sseof -0.1 在某些 MP4 container 上有问题,用绝对 seek 更稳)
    const duration = await getDurationSeconds(tmpIn);
    const seekTo = position === 'middle'
      ? Math.max(0, duration / 2)
      : Math.max(0, duration - 0.1);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        .seekInput(seekTo)
        .frames(1)
        .outputOptions(['-q:v 3'])
        .output(tmpOut)
        .on('end', () => resolve())
        .on('error', (e) => reject(e))
        .run();
    });

    if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) {
      return null;
    }

    // 3) v2.10 B: 质量守卫 —— 拦截黑屏/纯色/破损帧
    // 烂帧当参考比不用参考更糟 —— 会把下一 shot 也往"黑一片"的方向带
    const qualityOk = await isFrameUsable(tmpOut);
    if (!qualityOk) {
      console.warn(`[LastFrame] frame rejected by quality guard: ${tmpOut}`);
      return null;
    }

    // 4) 持久化,返回稳定 URL
    const persisted = await persistAsset(tmpOut, { contentType: 'image/jpeg', ext: '.jpg' });
    return persisted?.url || null;
  } catch (e) {
    console.warn('[LastFrame] extract failed:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    // 清理 tmp
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch {}
  }
}

/**
 * v2.10 B: 判断抽出来的帧是否可用作参考图。
 *
 * 两个便宜的拦截器:
 *   1) 文件体积 —— 1080p JPEG(q:v 3) 的黑屏/纯色通常 <3KB,真实画面 >10KB
 *   2) 亮度方差 —— 用 ffmpeg signalstats 读 YAVG + YDEV
 *      YAVG 接近 0(纯黑)或 255(纯白)→ 单色
 *      YDEV < 3 → 几乎无变化,像静态模糊
 *
 * 规则故意宽松:首选不误伤,只拦真正没救的帧。
 * 任何一步 parse 失败就认为帧 OK(宽容) —— 不阻断正常流程。
 */
async function isFrameUsable(framePath: string): Promise<boolean> {
  try {
    // 1) 文件体积检查(最便宜的守卫)
    const size = fs.statSync(framePath).size;
    if (size < 2048) {
      // 1080p 的 JPEG 即使 q=3 的压缩率也不会低到 2KB,这种多半是纯色或编码失败
      return false;
    }

    // 2) signalstats 读亮度均值 + 方差
    const stats = await readSignalStats(framePath).catch(() => null);
    if (!stats) {
      // ffmpeg 不吭声或 parse 失败 —— 宽松放过(假设 OK)
      return true;
    }
    if (stats.yavg >= 0 && stats.yavg < 6) return false;   // 全黑
    if (stats.yavg > 249) return false;                    // 全白
    if (stats.ydev >= 0 && stats.ydev < 2) return false;   // 方差过低 = 纯色/死机画面

    return true;
  } catch {
    // 异常一律放过 —— 让主流程继续
    return true;
  }
}

/**
 * 跑一次 `ffmpeg -i frame.jpg -vf signalstats -f null -` 解析 stderr,
 * 拿到本张帧的 YAVG(平均亮度 0-255)和 YDEV(亮度标准差)。
 *
 * fluent-ffmpeg 的事件里 'stderr' 能拿到 filter 输出。
 */
function readSignalStats(framePath: string): Promise<{ yavg: number; ydev: number }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const proc = ffmpeg(framePath)
      .outputOptions(['-vf', 'signalstats', '-f', 'null'])
      .output(devNull)
      .on('stderr', (line: string) => { buf += line + '\n'; })
      .on('end', () => {
        // signalstats 会打出类似:
        // [Parsed_signalstats_0 @ 0x...] YAVG:128.45 YMIN:12 YMAX:250 YDEV:45.12 ...
        const mAvg = buf.match(/YAVG[:\s]+([\d.]+)/);
        const mDev = buf.match(/YDEV[:\s]+([\d.]+)/);
        if (!mAvg && !mDev) return reject(new Error('no signalstats'));
        resolve({
          yavg: mAvg ? parseFloat(mAvg[1]) : -1,
          ydev: mDev ? parseFloat(mDev[1]) : -1,
        });
      })
      .on('error', (e: Error) => reject(e));
    proc.run();
  });
}

function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const d = Number(data?.format?.duration ?? 0);
      if (!isFinite(d) || d <= 0) return reject(new Error('invalid duration'));
      resolve(d);
    });
  });
}
