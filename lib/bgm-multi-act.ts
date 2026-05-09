/**
 * lib/bgm-multi-act (v2.16 P1.1)
 *
 * 把 3 段独立生成的 BGM (Act 1/2/3) 用 ffmpeg concat demuxer 拼成一段 mp3,
 * 让长视频 (>30s) 的配乐随剧情走 — Act 1 平静 → Act 2 紧张 → Act 3 释放。
 *
 * 不做的事:
 *   - 不混 crossfade (那要 acrossfade filter, 复杂度上一个数量级; 段间硬切其实在叙事
 *     上是合理的 act-transition 信号, 暂不打磨)
 *   - 不重 encode (用 -c copy, 段间格式必须一致 = 都从 Minimax music-2.6 出来 = 同 mp3 编码)
 *
 * 失败语义:
 *   - 任一段下载失败 → throw, 调用方应当 fall back 到原 single-BGM 路径
 *   - ffmpeg 失败 → throw 同上
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import ffmpeg from 'fluent-ffmpeg';

export interface ActBgmInput {
  /** Minimax 音乐 URL 或本地路径 */
  url: string;
  /** 这一幕的目标时长 (秒) — 仅用于日志, 不强制裁切 */
  durationSec: number;
  /** Act 标号 (1/2/3) — 仅用于日志 */
  act: number;
}

/**
 * 把 N 段 BGM (按顺序) 拼成一段。返回本地 mp3 绝对路径。
 * URL 既支持 http(s) 也支持本地文件 (file:// 协议或绝对路径都行)。
 */
export async function concatActBgms(
  segments: ActBgmInput[],
  outputDir?: string,
): Promise<string> {
  if (!Array.isArray(segments) || segments.length < 2) {
    throw new Error('concatActBgms: 至少需要 2 段 BGM');
  }
  const tmpDir = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-acts-'));
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  // 1) 下载 / 复制每段到本地, 顺序确保 act 升序
  const localPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const localPath = path.join(tmpDir, `act-${seg.act ?? i + 1}.mp3`);
    if (/^https?:/i.test(seg.url)) {
      await downloadFile(seg.url, localPath);
    } else if (seg.url.startsWith('/api/serve-file')) {
      // 内部 serve-file 路径 — 提取 path query
      const u = new URL(seg.url, 'http://localhost');
      const internalPath = decodeURIComponent(u.searchParams.get('path') || '');
      if (!fs.existsSync(internalPath)) {
        throw new Error(`Act ${seg.act} BGM not found at ${internalPath}`);
      }
      fs.copyFileSync(internalPath, localPath);
    } else if (fs.existsSync(seg.url)) {
      fs.copyFileSync(seg.url, localPath);
    } else {
      throw new Error(`Act ${seg.act} BGM has unsupported URL: ${seg.url.slice(0, 80)}`);
    }
    localPaths.push(localPath);
    console.log(`[BGM-Acts] Downloaded act ${seg.act}: ${seg.durationSec}s`);
  }

  // 2) 写 concat list.txt
  const listPath = path.join(tmpDir, 'concat-list.txt');
  // 注意: concat demuxer 要求 'file' 字面量, 路径用单引号包裹
  // 路径不能含换行 / 单引号, Linux 上 absolute path 都安全
  const listContent = localPaths.map((p) => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  const outputPath = path.join(tmpDir, `bgm-${segments.length}-acts-${Date.now()}.mp3`);

  // 3) ffmpeg concat — c copy 不重编码, 假设所有段都是 Minimax music-2.6 出的同 codec mp3
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });

  console.log(`[BGM-Acts] Concat done: ${segments.length} acts → ${outputPath}`);
  return outputPath;
}

/**
 * 算每幕的预期时长 — 给 Minimax music duration 参数用。
 * 输入 timeline 的每个 clip 带 act (Writer 写的) 或 nullable; 没标 act 的不算。
 * 返回 [act1Sec, act2Sec, act3Sec], 单位秒 (按 Math.max(15, x) 兜底, 避免太短).
 */
export function computeActDurations(
  timeline: Array<{ duration: number; act?: number | null }>,
): { act1: number; act2: number; act3: number; canSplit: boolean } {
  const buckets: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  let withAct = 0;
  for (const t of timeline) {
    const a = t.act === 1 || t.act === 2 || t.act === 3 ? t.act : null;
    if (!a) continue;
    buckets[a] += t.duration || 0;
    withAct++;
  }
  // 不足 50% shots 标了 act → 不切分 (Writer 没好好填 act 字段)
  const canSplit = withAct >= Math.ceil(timeline.length * 0.5)
    && buckets[1] > 0 && buckets[2] > 0 && buckets[3] > 0;
  return {
    act1: Math.max(15, Math.round(buckets[1])),
    act2: Math.max(15, Math.round(buckets[2])),
    act3: Math.max(15, Math.round(buckets[3])),
    canSplit,
  };
}

/**
 * 每幕的 BGM 情绪 prompt — 给 Minimax 用的 hint。
 * 麦基三幕结构的"声音对应":
 *   Act 1: 进入世界, 平静铺垫
 *   Act 2: 冲突升级, 紧张推进
 *   Act 3: 高潮 → 释放, 情绪宣泄
 */
export function moodPromptForAct(act: 1 | 2 | 3, dominantEmotion: string, genre: string): string {
  const baseGenre = `${genre || '现代剧情'}风格背景音乐`;
  if (act === 1) {
    return `${baseGenre}, 第一幕 (开篇/铺垫): 平静且氛围感, 主题旋律建立, 情绪基调: ${dominantEmotion || '平静'}, 适合人物登场和世界观展开`;
  }
  if (act === 2) {
    return `${baseGenre}, 第二幕 (冲突升级): 节奏推进, 张力上升, 弦乐与打击乐交织, 情绪基调: ${dominantEmotion || '紧张'}, 适合矛盾激化和角色挣扎`;
  }
  return `${baseGenre}, 第三幕 (高潮+释放): 先达到情感顶点然后释放收束, 情绪基调: ${dominantEmotion || '宣泄'}, 适合最终对决和余韵留白`;
}

// ─── private: 复制 video-composer.ts 里的 downloadFile 实现 (避免循环依赖) ───
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirected = response.headers.location;
          if (!redirected) return reject(new Error('redirect without location'));
          return downloadFile(redirected, destPath).then(resolve, reject);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`download ${response.statusCode}: ${url.slice(0, 60)}`));
        }
        response.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
  });
}
