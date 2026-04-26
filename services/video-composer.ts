/**
 * Video Composer Service
 * FFmpeg-based video concatenation with crossfade transitions + music overlay
 *
 * 使用 fluent-ffmpeg + ffmpeg-static 在 Node.js 端完成：
 * 1. 下载远程视频片段到临时目录
 * 2. 使用 xfade 滤镜做交叉淡入淡出转场
 * 3. 叠加背景配乐（音量可调）
 * 4. 输出最终成片 mp4
 */

import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

// ═══ 设置 ffmpeg 可执行文件路径 ═══
// Turbopack 在 server bundle 时会把 ffmpeg-static 的路径重写为
// "/ROOT/node_modules/ffmpeg-static/ffmpeg"（虚拟路径），导致 ENOENT。
// 这里通过多种策略找到真实的 ffmpeg 二进制路径。
function resolveFFmpegPath(): string {
  // 1. ffmpeg-static 默认导出（非 Turbopack 时正常工作）
  if (ffmpegPath && typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) {
    return ffmpegPath;
  }
  // 2. 基于 process.cwd() 推断（开发环境）
  const cwdGuess = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (fs.existsSync(cwdGuess)) {
    return cwdGuess;
  }
  // 3. 用 require.resolve 定位 ffmpeg-static 包目录
  try {
    const pkgJson = require.resolve('ffmpeg-static/package.json');
    const guess = path.join(path.dirname(pkgJson), 'ffmpeg');
    if (fs.existsSync(guess)) return guess;
  } catch {}
  // 4. 系统 PATH 上的 ffmpeg
  try {
    const sysPath = execSync('which ffmpeg 2>/dev/null || where ffmpeg 2>nul', { encoding: 'utf-8' }).trim();
    if (sysPath && fs.existsSync(sysPath)) return sysPath;
  } catch {}
  // 5. 返回原始值（可能会 ENOENT，但不会 crash）
  console.warn('[FFmpeg] Could not resolve ffmpeg binary path, using fallback:', ffmpegPath);
  return (ffmpegPath as string) || 'ffmpeg';
}

const resolvedFFmpegPath = resolveFFmpegPath();
ffmpeg.setFfmpegPath(resolvedFFmpegPath);
console.log(`[FFmpeg] Using binary: ${resolvedFFmpegPath}`);

export interface ComposerClip {
  shotNumber: number;
  videoUrl: string;       // 远程 URL 或本地路径
  duration: number;       // 秒
  transition: string;     // crossfade 类型: 'fade' | 'dissolve' | 'wipeleft' | 'circleopen' | 'cut'
  effect?: string;        // 可选后处理效果
  // ═══ 高光检测元数据 ═══
  emotionTemperature?: number;  // 情感温度 -10 ~ +10
  tensionLevel?: number;        // 张力等级 0-10
  isHighlight?: boolean;        // 是否为高光镜头
  dialogue?: string;            // 该镜头台词（用于配音叠加）
  voiceoverUrl?: string;        // AI 配音音频 URL
  speedMultiplier?: number;     // 变速倍率（<1 慢动作, >1 加速）
}

export interface ComposeOptions {
  clips: ComposerClip[];
  musicUrl?: string;           // 背景配乐 URL
  voiceoverClips?: Array<{     // AI 配音片段
    shotNumber: number;
    audioUrl: string;
    startOffset?: number;       // 配音在该镜头中的起始偏移秒数
  }>;
  outputDir?: string;          // 输出目录
  transitionDuration?: number; // 转场时长（秒），默认 0.5
  musicVolume?: number;        // 配乐音量 0~1，默认 0.3
  voiceoverVolume?: number;    // 配音音量 0~1，默认 0.9
  onProgress?: (percent: number, stage: string) => void;
}

export interface ComposeResult {
  outputPath: string;        // 本地成片路径
  totalDuration: number;     // 总时长
  clipCount: number;
  hasMusic: boolean;
  hasVoiceover: boolean;
  highlights: number[];      // 高光镜头编号列表
}

// ═══════════════════════════════════════════
// 高光时刻检测引擎
// 基于剧本元数据分析（情感温度曲线 + 张力等级 + 情绪关键词）
// ═══════════════════════════════════════════

export interface HighlightAnalysis {
  shotNumber: number;
  score: number;          // 0-100 高光评分
  isHighlight: boolean;   // 是否判定为高光
  reason: string;         // 判定原因
  editStrategy: {
    speedMultiplier: number;  // 变速倍率
    transition: string;       // 推荐转场
    transitionDuration: number; // 转场时长
  };
}

export function detectHighlights(clips: ComposerClip[]): HighlightAnalysis[] {
  if (clips.length === 0) return [];

  const analyses: HighlightAnalysis[] = clips.map((clip, i) => {
    let score = 0;
    const reasons: string[] = [];

    // 1. 情感温度分析（绝对值越大 = 情感越强烈）
    const emotionTemp = clip.emotionTemperature ?? 0;
    const emotionIntensity = Math.abs(emotionTemp);
    if (emotionIntensity >= 8) {
      score += 35;
      reasons.push(`极端情感(${emotionTemp})`);
    } else if (emotionIntensity >= 5) {
      score += 20;
      reasons.push(`强烈情感(${emotionTemp})`);
    } else if (emotionIntensity >= 3) {
      score += 10;
    }

    // 2. 张力等级分析
    const tension = clip.tensionLevel ?? 5;
    if (tension >= 8) {
      score += 30;
      reasons.push(`高张力(${tension}/10)`);
    } else if (tension >= 6) {
      score += 15;
    }

    // 3. 情感温度变化率（与前一个镜头的差值）
    if (i > 0) {
      const prevTemp = clips[i - 1].emotionTemperature ?? 0;
      const tempDelta = Math.abs(emotionTemp - prevTemp);
      if (tempDelta >= 6) {
        score += 20;
        reasons.push(`情感骤变(Δ${tempDelta})`);
      } else if (tempDelta >= 3) {
        score += 10;
      }
    }

    // 4. 位置权重（高潮位置 60%-80% 处加分）
    const position = clips.length > 1 ? i / (clips.length - 1) : 0.5;
    if (position >= 0.55 && position <= 0.85) {
      score += 10;
      if (score >= 30) reasons.push('高潮位置');
    }

    // 5. 转场类型暗示（flash-cut/cut 通常用于高潮）
    if (clip.transition === 'flash-cut' || clip.transition === 'cut') {
      score += 5;
    }

    const isHighlight = score >= 40;

    // 生成剪辑策略
    let speedMultiplier = 1.0;
    let transition = clip.transition;
    let transitionDuration = 0.5;

    if (isHighlight) {
      // 高光镜头：稍微降速（慢动作强调），转场更激烈
      if (score >= 70) {
        speedMultiplier = 0.7; // 强高光：30% 慢动作
        transition = 'fade';
        transitionDuration = 0.3;
      } else {
        speedMultiplier = 0.85; // 一般高光：15% 慢动作
        transitionDuration = 0.4;
      }
    } else if (position < 0.2) {
      // 开场：标准或略慢
      speedMultiplier = 1.0;
      transitionDuration = 0.8;
    } else if (score < 15 && position > 0.3 && position < 0.55) {
      // 低张力过渡段：适当加速
      speedMultiplier = 1.15;
      transitionDuration = 0.3;
    }

    return {
      shotNumber: clip.shotNumber,
      score,
      isHighlight,
      reason: reasons.length > 0 ? reasons.join(', ') : '正常叙事段',
      editStrategy: { speedMultiplier, transition, transitionDuration },
    };
  });

  return analyses;
}

/**
 * 下载远程文件到本地临时路径
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 处理 /api/serve-file?path=... 本地代理 URL —— 直接取出本地路径拷贝
    if (url.startsWith('/api/serve-file')) {
      try {
        const u = new URL(url, 'http://localhost');
        const localPath = decodeURIComponent(u.searchParams.get('path') || '');
        if (localPath && fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, destPath);
          console.log(`[Download] /api/serve-file → local copy: ${localPath}`);
          return resolve();
        }
      } catch {}
      return reject(new Error(`serve-file path not found: ${url}`));
    }

    if (!url.startsWith('http')) {
      // 本地文件或 data URI
      if (fs.existsSync(url)) {
        fs.copyFileSync(url, destPath);
        return resolve();
      }
      return reject(new Error(`Invalid URL: ${url}`));
    }

    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    const request = protocol.get(url, { timeout: 30000 }, (response) => {
      // 跟随重定向
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode && response.statusCode >= 400) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode} downloading ${url.slice(0, 80)}`));
      }

      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => { fs.unlinkSync(destPath); reject(e); });
    });

    request.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(e);
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(new Error(`Download timeout: ${url.slice(0, 80)}`));
    });
  });
}

/**
 * 获取视频时长（ffprobe）
 */
function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata?.format?.duration ?? 0);
    });
  });
}

/**
 * FFmpeg xfade 转场类型映射 (v2.11 #6 扩展)
 *
 * 设计:
 *   · LLM 剪辑提示里给了 14+ 种行业术语 (match-cut / j-cut / smash-cut / whip-pan ...),
 *     ffmpeg xfade 只内置一部分, 这里把"行业术语→最近邻 xfade"全部映射好,
 *     避免上层用了 LLM 推荐的转场后, composer 一句 fallback 全降级成 dissolve。
 *   · 不能直接做的 (j-cut / l-cut 涉及音轨提前/延后, 不是画面 xfade) → 在画面侧降级到合理近邻,
 *     真正的音轨 lead/lag 后续在 video-composer 的音轨阶段单独处理。
 */
function mapTransition(transition: string): string {
  const map: Record<string, string> = {
    // 老版本支持的
    'fade-in': 'fade',
    'fade-out': 'fade',
    'cross-dissolve': 'dissolve',
    'dissolve': 'dissolve',
    'cut': 'fade',           // cut 用极短 fade 模拟
    'flash-cut': 'fadewhite',
    'dip-to-black': 'fadeblack',
    'wipeleft': 'wipeleft',
    'wiperight': 'wiperight',
    'slideup': 'slideup',
    'slidedown': 'slidedown',
    'circleopen': 'circleopen',
    'circleclose': 'circleclose',
    // v2.11 #6 新增 — 行业术语 → 最近邻 ffmpeg xfade
    'match-cut': 'fade',          // 形状/动作匹配, 视觉延续 — 用极短 fade 接近 invisible cut
    'smash-cut': 'fade',          // 突切, 同 cut
    'invisible-cut': 'fade',      // 同动作连续 → 极短 fade
    'whip-pan': 'wipeleft',       // 快摇 → 左滑擦
    'whip-pan-left': 'wipeleft',
    'whip-pan-right': 'wiperight',
    'iris-in': 'circleopen',      // 圈入
    'iris-out': 'circleclose',    // 圈出
    'j-cut': 'fade',              // 音先入 (画面侧只能就近, 真正的 j-cut 由音轨阶段处理)
    'l-cut': 'fade',              // 音延续 (同上)
    'push': 'slideleft',
    'slide': 'slideleft',
  };
  return map[transition] || 'dissolve';
}

/**
 * 核心：合成多个视频片段（xfade 转场 + 配乐叠加）
 */
export async function composeVideo(options: ComposeOptions): Promise<ComposeResult> {
  const {
    clips,
    musicUrl,
    outputDir,
    transitionDuration = 0.5,
    musicVolume = 0.3,
    onProgress,
  } = options;

  const { voiceoverClips, voiceoverVolume = 0.9 } = options;

  if (clips.length === 0) {
    throw new Error('No clips provided');
  }

  // ═══ 高光检测 ═══
  const highlights = detectHighlights(clips);
  const highlightShots = highlights.filter(h => h.isHighlight).map(h => h.shotNumber);
  if (highlightShots.length > 0) {
    console.log(`[Composer] Highlights detected: shots ${highlightShots.join(', ')}`);
    onProgress?.(2, `检测到 ${highlightShots.length} 个高光时刻`);
  }

  // 将高光分析结果合并回 clips（更新转场和速度）
  for (const analysis of highlights) {
    const clip = clips.find(c => c.shotNumber === analysis.shotNumber);
    if (clip) {
      clip.transition = analysis.editStrategy.transition;
      clip.speedMultiplier = analysis.editStrategy.speedMultiplier;
      clip.isHighlight = analysis.isHighlight;
    }
  }

  // 1. 创建临时工作目录
  const tmpDir = outputDir || path.join(os.tmpdir(), `qf-compose-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const outputPath = path.join(tmpDir, `final-${Date.now()}.mp4`);

  onProgress?.(5, '下载视频片段...');

  // 2. 下载所有视频片段
  const localClips: string[] = [];
  const validClips: ComposerClip[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip.videoUrl || clip.videoUrl.startsWith('data:')) {
      console.log(`[Composer] Skip invalid clip ${clip.shotNumber}: no valid URL`);
      continue;
    }

    const ext = clip.videoUrl.match(/\.(mp4|webm|mov)/i)?.[1] || 'mp4';
    const localPath = path.join(tmpDir, `clip-${i}.${ext}`);

    try {
      await downloadFile(clip.videoUrl, localPath);
      localClips.push(localPath);
      validClips.push(clip);
      onProgress?.(5 + Math.round((i / clips.length) * 30), `下载片段 ${i + 1}/${clips.length}`);
    } catch (e) {
      console.error(`[Composer] Failed to download clip ${clip.shotNumber}:`, e);
    }
  }

  if (localClips.length === 0) {
    throw new Error('No valid video clips to compose');
  }

  // 3. 获取每个片段的实际时长
  const durations: number[] = [];
  for (const localPath of localClips) {
    try {
      const dur = await getVideoDuration(localPath);
      durations.push(dur > 0 ? dur : 8);
    } catch {
      durations.push(8);
    }
  }

  onProgress?.(40, '构建合成滤镜...');

  // 4. 下载配乐（如果有）
  let localMusicPath = '';
  if (musicUrl && musicUrl.startsWith('http')) {
    localMusicPath = path.join(tmpDir, 'music.mp3');
    try {
      await downloadFile(musicUrl, localMusicPath);
      onProgress?.(45, '配乐下载完成');
    } catch (e) {
      console.error('[Composer] Failed to download music:', e);
      localMusicPath = '';
    }
  }

  // 4b. 下载配音片段（如果有）
  const localVoiceovers: Map<number, string> = new Map();
  if (voiceoverClips && voiceoverClips.length > 0) {
    onProgress?.(46, '下载配音片段...');
    for (const vo of voiceoverClips) {
      if (vo.audioUrl && vo.audioUrl.startsWith('http')) {
        const voPath = path.join(tmpDir, `voiceover-${vo.shotNumber}.mp3`);
        try {
          await downloadFile(vo.audioUrl, voPath);
          localVoiceovers.set(vo.shotNumber, voPath);
        } catch (e) {
          console.error(`[Composer] Failed to download voiceover for shot ${vo.shotNumber}:`, e);
        }
      }
    }
    if (localVoiceovers.size > 0) {
      onProgress?.(48, `${localVoiceovers.size} 段配音就绪`);
    }
  }

  // 5. 如果只有一个片段：也应用变速 + 转场 + 配乐 + 配音
  if (localClips.length === 1) {
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg().input(localClips[0]);
      let audioInputCount = 1; // 0 is video

      if (localMusicPath) {
        cmd = cmd.input(localMusicPath);
        audioInputCount++;
      }

      const voPath = localVoiceovers.get(validClips[0]?.shotNumber || 0);
      if (voPath) {
        cmd = cmd.input(voPath);
        audioInputCount++;
      }

      // 构建视频滤镜：统一分辨率 + 变速 + 淡入淡出
      const speed = validClips[0]?.speedMultiplier || 1.0;
      const isHL = validClips[0]?.isHighlight || false;
      let videoFilter = `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1`;
      if (speed !== 1.0 && speed > 0) {
        const pts = 1.0 / speed;
        videoFilter += `,setpts=${pts.toFixed(3)}*PTS`;
        durations[0] = durations[0] / speed;
        console.log(`[Composer] Single clip speed=${speed}x → duration=${durations[0].toFixed(1)}s${isHL ? ' [HIGHLIGHT]' : ''}`);
      }
      // 添加淡入淡出效果
      videoFilter += `,fade=t=in:st=0:d=0.8,fade=t=out:st=${Math.max(0, durations[0] - 1)}:d=1`;
      videoFilter += `[vout]`;

      const filters: string[] = [videoFilter];

      // 音频处理
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${(durations[0] || 8).toFixed(2)}[va]`);
      let mixInputs = '[va]';
      let mixCount = 1;

      if (localMusicPath) {
        filters.push(`[1:a]volume=${musicVolume}[ma]`);
        mixInputs += '[ma]';
        mixCount++;
      }
      if (voPath) {
        const voIdx = localMusicPath ? 2 : 1;
        filters.push(`[${voIdx}:a]volume=${voiceoverVolume}[voa]`);
        mixInputs += '[voa]';
        mixCount++;
      }

      if (mixCount > 1) {
        filters.push(`${mixInputs}amix=inputs=${mixCount}:duration=shortest:dropout_transition=2[outa]`);
      } else {
        filters.push(`[va]anull[outa]`);
      }

      cmd
        .complexFilter(filters)
        .outputOptions(['-map', '[vout]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart'])
        .output(outputPath)
        .on('progress', (p) => onProgress?.(50 + Math.round((p.percent || 0) * 0.5), '合成中...'))
        .on('end', () => {
          resolve({
            outputPath,
            totalDuration: durations[0],
            clipCount: 1,
            hasMusic: !!localMusicPath,
            hasVoiceover: localVoiceovers.size > 0,
            highlights: highlightShots,
          });
        })
        .on('error', reject)
        .run();
    });
  }

  // 6. 多片段 xfade 合成
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    // 添加所有输入
    for (const localPath of localClips) {
      cmd.input(localPath);
    }
    if (localMusicPath) {
      cmd.input(localMusicPath);
    }

    // 构建 xfade 滤镜链
    const filters: string[] = [];
    const n = localClips.length;
    const td = Math.min(transitionDuration, Math.min(...durations) / 2); // 确保转场不超过最短片段的一半

    // 视频预处理链：统一分辨率 + 高光变速
    for (let i = 0; i < n; i++) {
      const speed = validClips[i]?.speedMultiplier || 1.0;
      const isHighlightClip = validClips[i]?.isHighlight || false;
      let videoFilter = `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1`;

      // 高光变速：setpts 调整视频播放速度（<1 = 加速, >1 = 减速）
      if (speed !== 1.0 && speed > 0) {
        const pts = 1.0 / speed; // speed=0.7 → pts=1.43 (慢动作)
        videoFilter += `,setpts=${pts.toFixed(3)}*PTS`;
        // 调整该片段的有效时长
        durations[i] = durations[i] / speed;
        console.log(`[Composer] Shot ${validClips[i]?.shotNumber}: speed=${speed}x → duration=${durations[i].toFixed(1)}s${isHighlightClip ? ' [HIGHLIGHT]' : ''}`);
      }

      filters.push(`${videoFilter}[v${i}]`);
    }

    // 链式 xfade
    let prevLabel = 'v0';
    let cumulativeDuration = durations[0];

    for (let i = 1; i < n; i++) {
      // 使用高光分析推荐的转场
      const clipAnalysis = highlights.find(h => h.shotNumber === validClips[i]?.shotNumber);
      const transition = mapTransition(clipAnalysis?.editStrategy.transition || validClips[i]?.transition || 'dissolve');
      const isLastCut = validClips[i]?.transition === 'cut' || validClips[i]?.transition === 'flash-cut';
      const effectiveTd = isLastCut ? 0.1 : Math.min(
        clipAnalysis?.editStrategy.transitionDuration || td,
        Math.min(durations[i - 1], durations[i]) / 2
      );

      const offset = Math.max(0, cumulativeDuration - effectiveTd);
      const outLabel = i === n - 1 ? 'vout' : `xv${i}`;

      filters.push(`[${prevLabel}][v${i}]xfade=transition=${transition}:duration=${effectiveTd.toFixed(2)}:offset=${offset.toFixed(2)}[${outLabel}]`);

      cumulativeDuration = offset + durations[i];
      prevLabel = outLabel;
    }

    // 音频处理：生成的视频通常没有音频流，统一生成静音替代
    // 使用 anullsrc 为每个视频片段生成匹配时长的静音音频
    for (let i = 0; i < n; i++) {
      const dur = durations[i] || 8;
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(2)}[a${i}]`);
    }

    // 音频 concat
    const audioInputLabels = Array.from({ length: n }, (_, i) => `[a${i}]`).join('');
    filters.push(`${audioInputLabels}concat=n=${n}:v=0:a=1[aconcat]`);

    // 混合音频轨道：原始音频 + 配乐 + 配音
    let nextInputIdx = n;
    const audioMixParts: string[] = ['[aconcat]'];
    let audioMixCount = 1;

    if (localMusicPath) {
      const musicIdx = nextInputIdx;
      nextInputIdx++;
      filters.push(`[${musicIdx}:a]volume=${musicVolume}[musicvol]`);
      audioMixParts.push('[musicvol]');
      audioMixCount++;
    }

    // 配音混入 — 逐镜头偏移 (adelay)
    // 每段配音按其所在 shot 的累计起始时间对齐；支持任意镜头数
    if (localVoiceovers.size > 0) {
      // 预计算每个 shot 的起始偏移（ms）
      const shotStartMs: Map<number, number> = new Map();
      let cumMs = 0;
      for (let k = 0; k < n; k++) {
        const sn = validClips[k]?.shotNumber;
        if (typeof sn === 'number') shotStartMs.set(sn, Math.round(cumMs));
        cumMs += (durations[k] || 0) * 1000;
      }

      const voSubInputs: string[] = [];
      let voCount = 0;
      for (const [shotNumber, voPath] of localVoiceovers.entries()) {
        const startMs = shotStartMs.get(shotNumber);
        if (startMs === undefined) continue; // 找不到对应 shot,跳过
        cmd.input(voPath);
        const voIdx = nextInputIdx;
        nextInputIdx++;
        // adelay 需要每声道的 ms,立体声用 `startMs|startMs`
        const delay = `${startMs}|${startMs}`;
        const lbl = `vo${voCount}`;
        filters.push(`[${voIdx}:a]adelay=${delay},volume=${voiceoverVolume}[${lbl}]`);
        voSubInputs.push(`[${lbl}]`);
        voCount++;
      }

      if (voCount > 0) {
        if (voCount === 1) {
          audioMixParts.push(voSubInputs[0]);
        } else {
          // 多段配音先 mix 成一条
          filters.push(`${voSubInputs.join('')}amix=inputs=${voCount}:duration=longest:dropout_transition=0[vomix]`);
          audioMixParts.push('[vomix]');
        }
        audioMixCount++;
        console.log(`[Composer] TTS: ${voCount} 段配音逐镜头对齐,偏移范围 ${Array.from(shotStartMs.values()).join('ms, ')}ms`);
      }
    }

    if (audioMixCount > 1) {
      filters.push(`${audioMixParts.join('')}amix=inputs=${audioMixCount}:duration=shortest:dropout_transition=2[outa]`);
    } else {
      filters.push(`[aconcat]anull[outa]`);
    }

    const totalDuration = cumulativeDuration;

    cmd
      .complexFilter(filters)
      .outputOptions([
        '-map', '[vout]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-shortest',
      ])
      .output(outputPath)
      .on('progress', (p) => {
        const pct = Math.round(50 + (p.percent || 0) * 0.45);
        onProgress?.(pct, '合成中...');
      })
      .on('end', () => {
        onProgress?.(100, '合成完成');
        // 清理临时片段文件（保留成片）
        for (const f of localClips) {
          try { fs.unlinkSync(f); } catch {}
        }
        if (localMusicPath) {
          try { fs.unlinkSync(localMusicPath); } catch {}
        }

        resolve({
          outputPath,
          totalDuration,
          clipCount: n,
          hasMusic: !!localMusicPath,
          hasVoiceover: localVoiceovers.size > 0,
          highlights: highlightShots,
        });
      })
      .on('error', (err) => {
        console.error('[Composer] FFmpeg error:', err.message);
        // 清理
        for (const f of localClips) {
          try { fs.unlinkSync(f); } catch {}
        }
        if (localMusicPath) {
          try { fs.unlinkSync(localMusicPath); } catch {}
        }
        reject(err);
      })
      .run();
  });
}

/**
 * 从视频中提取关键帧作为封面图
 * 使用 FFmpeg 的 thumbnail 滤镜（基于内容分析选取最具代表性的帧）
 * 并结合 scene 变化检测，选出视觉最丰富的一帧
 */
export async function extractKeyFrame(videoUrl: string, options?: {
  outputDir?: string;
  /** 输出图片宽度，默认 1280 */
  width?: number;
  /** 输出图片高度，默认 720 */
  height?: number;
}): Promise<string> {
  const tmpDir = options?.outputDir || path.join(os.tmpdir(), `qf-keyframe-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const width = options?.width || 1280;
  const height = options?.height || 720;

  // 下载视频到本地
  let localVideoPath: string;
  if (videoUrl.startsWith('/api/serve-file')) {
    // 从 /api/serve-file?path=... 提取本地路径
    try {
      const u = new URL(videoUrl, 'http://localhost');
      const lp = decodeURIComponent(u.searchParams.get('path') || '');
      if (lp && fs.existsSync(lp)) {
        localVideoPath = lp;
      } else {
        throw new Error(`serve-file path not found: ${lp}`);
      }
    } catch (e) {
      throw new Error(`Invalid serve-file URL: ${videoUrl}`);
    }
  } else if (videoUrl.startsWith('http')) {
    localVideoPath = path.join(tmpDir, `source-${Date.now()}.mp4`);
    await downloadFile(videoUrl, localVideoPath);
  } else if (fs.existsSync(videoUrl)) {
    localVideoPath = videoUrl;
  } else {
    throw new Error(`Invalid video source: ${videoUrl}`);
  }

  const outputPath = path.join(tmpDir, `keyframe-${Date.now()}.jpg`);

  return new Promise((resolve, reject) => {
    ffmpeg(localVideoPath)
      .outputOptions([
        '-vf', `thumbnail,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
        '-frames:v', '1',
        '-q:v', '2', // 高质量 JPEG
      ])
      .output(outputPath)
      .on('end', () => {
        // 清理下载的临时视频（不是用户提供的本地路径）
        if (videoUrl.startsWith('http') && localVideoPath !== videoUrl) {
          try { fs.unlinkSync(localVideoPath); } catch {}
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (videoUrl.startsWith('http') && localVideoPath !== videoUrl) {
          try { fs.unlinkSync(localVideoPath); } catch {}
        }
        reject(err);
      })
      .run();
  });
}

/**
 * 批量提取多个视频的关键帧
 */
export async function extractKeyFrames(
  clips: Array<{ shotNumber: number; videoUrl: string }>,
  onProgress?: (current: number, total: number) => void,
): Promise<Array<{ shotNumber: number; coverImagePath: string }>> {
  const results: Array<{ shotNumber: number; coverImagePath: string }> = [];
  const tmpDir = path.join(os.tmpdir(), `qf-keyframes-${Date.now()}`);

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip.videoUrl || clip.videoUrl.startsWith('data:')) {
      continue;
    }
    onProgress?.(i + 1, clips.length);
    try {
      const coverPath = await extractKeyFrame(clip.videoUrl, { outputDir: tmpDir });
      results.push({ shotNumber: clip.shotNumber, coverImagePath: coverPath });
    } catch (e) {
      console.error(`[KeyFrame] Failed to extract keyframe for shot ${clip.shotNumber}:`, e);
    }
  }

  return results;
}

/**
 * 静帧 → mp4 (Ken Burns 推拉)
 *
 * 当所有视频引擎都饱和/不可用时，把分镜图做成缓慢推拉的滞帧片段，
 * 让 pipeline 至少能产出一段 animatic 成片，而不是整体失败。
 *
 * @param imageUrl   分镜图 URL（http/https/本地路径）
 * @param duration   片段时长（秒），默认 8
 * @param outputDir  输出目录
 * @param zoomDir    'in' = 慢推, 'out' = 慢拉, 'pan' = 横移
 */
export async function stillFrameToVideo(
  imageUrl: string,
  duration: number = 8,
  outputDir?: string,
  zoomDir: 'in' | 'out' | 'pan' = 'in',
): Promise<string> {
  if (!imageUrl) throw new Error('stillFrameToVideo: empty imageUrl');

  const tmpDir = outputDir || path.join(os.tmpdir(), `qf-animatic-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. 下载/解码图片到本地
  let localImage: string;
  if (imageUrl.startsWith('/api/serve-file')) {
    // 从 /api/serve-file?path=... 提取本地路径
    try {
      const u = new URL(imageUrl, 'http://localhost');
      const lp = decodeURIComponent(u.searchParams.get('path') || '');
      if (lp && fs.existsSync(lp)) {
        localImage = lp;
      } else {
        throw new Error(`serve-file image path not found: ${lp}`);
      }
    } catch (e) {
      throw new Error(`Invalid serve-file image URL: ${imageUrl}`);
    }
  } else if (imageUrl.startsWith('http')) {
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
    localImage = path.join(tmpDir, `frame-${Date.now()}.${ext}`);
    await downloadFile(imageUrl, localImage);
  } else if (imageUrl.startsWith('data:')) {
    // 解码 data URI（支持 mockSvg 占位图和 base64 图片）
    const svgMatch = imageUrl.match(/^data:image\/svg\+xml,(.+)$/);
    const b64Match = imageUrl.match(/^data:image\/([\w]+);base64,(.+)$/);
    if (svgMatch) {
      // SVG data URI (URL-encoded) → 写入 .svg 文件
      // ffmpeg 通过 image2 demuxer 可读取 SVG（需 librsvg）
      localImage = path.join(tmpDir, `frame-${Date.now()}.svg`);
      fs.writeFileSync(localImage, decodeURIComponent(svgMatch[1]));
    } else if (b64Match) {
      localImage = path.join(tmpDir, `frame-${Date.now()}.${b64Match[1]}`);
      fs.writeFileSync(localImage, Buffer.from(b64Match[2], 'base64'));
    } else {
      throw new Error(`stillFrameToVideo: unsupported data URI format`);
    }
  } else if (fs.existsSync(imageUrl)) {
    localImage = imageUrl;
  } else {
    throw new Error(`stillFrameToVideo: invalid image source ${imageUrl}`);
  }

  const outputPath = path.join(tmpDir, `animatic-${Date.now()}.mp4`);
  const fps = 24;
  const totalFrames = Math.max(48, Math.round(duration * fps));

  // 2. 构建 Ken Burns 滤镜
  // zoompan 会基于上采样后的图做平滑推拉，避免锯齿
  // 先 scale 到 4x 大尺寸再 zoompan，最后 crop/scale 到 1280x720
  let zoomExpr: string;
  let xExpr = "'iw/2-(iw/zoom/2)'";
  let yExpr = "'ih/2-(ih/zoom/2)'";

  if (zoomDir === 'in') {
    // 1.0 → 1.3 缓推
    zoomExpr = `'min(zoom+0.0008,1.3)'`;
  } else if (zoomDir === 'out') {
    // 1.3 → 1.0 缓拉
    zoomExpr = `'if(eq(on,1),1.3,max(zoom-0.0008,1.0))'`;
  } else {
    // pan: 横移
    zoomExpr = `'1.2'`;
    xExpr = `'iw*0.1+(iw*0.3)*on/${totalFrames}'`;
    yExpr = `'ih/2-(ih/zoom/2)'`;
  }

  const vf = [
    `scale=5120:2880:force_original_aspect_ratio=increase`,
    `crop=5120:2880`,
    `zoompan=z=${zoomExpr}:x=${xExpr}:y=${yExpr}:d=${totalFrames}:s=1280x720:fps=${fps}`,
    `format=yuv420p`,
  ].join(',');

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(localImage)
      .inputOptions(['-loop', '1', '-t', String(duration)])
      // 同步生成静音音轨,避免下游 amix 缺失音频流
      .input('anullsrc=r=44100:cl=stereo')
      .inputOptions(['-f', 'lavfi', '-t', String(duration)])
      .outputOptions([
        '-vf', vf,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => {
        if (imageUrl.startsWith('http') && localImage !== imageUrl) {
          try { fs.unlinkSync(localImage); } catch {}
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (imageUrl.startsWith('http') && localImage !== imageUrl) {
          try { fs.unlinkSync(localImage); } catch {}
        }
        reject(err);
      })
      .run();
  });
}

/**
 * 简化版：只拼接视频不加转场（concat demuxer 方式，更快）
 */
export async function concatVideosSimple(
  videoUrls: string[],
  musicUrl?: string,
  outputDir?: string,
): Promise<string> {
  const tmpDir = outputDir || path.join(os.tmpdir(), `qf-concat-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 下载视频
  const localPaths: string[] = [];
  for (let i = 0; i < videoUrls.length; i++) {
    const url = videoUrls[i];
    if (!url || url.startsWith('data:')) continue;
    const localPath = path.join(tmpDir, `clip-${i}.mp4`);
    try {
      await downloadFile(url, localPath);
      localPaths.push(localPath);
    } catch (e) {
      console.error(`[Concat] Failed to download clip ${i}:`, e);
    }
  }

  if (localPaths.length === 0) throw new Error('No valid clips');

  // 生成 concat 列表文件
  const listPath = path.join(tmpDir, 'concat-list.txt');
  const listContent = localPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  const outputPath = path.join(tmpDir, `concat-${Date.now()}.mp4`);

  // 先下载 BGM (如提供)
  let localMusicPath = '';
  if (musicUrl && /^https?:/.test(musicUrl)) {
    localMusicPath = path.join(tmpDir, 'bgm.mp3');
    try { await downloadFile(musicUrl, localMusicPath); }
    catch (e) {
      console.warn('[Concat] BGM 下载失败,忽略:', e instanceof Error ? e.message : e);
      localMusicPath = '';
    }
  }

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0']);

    if (localMusicPath) {
      cmd.input(localMusicPath);
      // 混入 BGM:原音频 + BGM*0.35,以最短流为准(视频结束就停)
      cmd
        .complexFilter([
          '[0:a]volume=1.0[orig]',
          '[1:a]volume=0.35,aloop=loop=-1:size=2e+09[bgm]',
          '[orig][bgm]amix=inputs=2:duration=first:dropout_transition=2[outa]',
        ])
        .outputOptions([
          '-map', '0:v',
          '-map', '[outa]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-shortest',
          '-movflags', '+faststart',
        ]);
    } else {
      cmd.outputOptions(['-c', 'copy', '-movflags', '+faststart']);
    }

    cmd
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}
