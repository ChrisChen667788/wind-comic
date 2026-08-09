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
import { audioBitrateForPlatform } from '@/lib/audio-encode';
import { buildColorGradeFilter, detectGradeGenre } from '@/lib/color-grade';
// v12.205:成片质量参数(env 可调)。CRF 23→20 减双重编码损耗(暗部/边缘细节);unsharp 轻锐化补 AI 视频糊边。
const crfValue = (): string => process.env.CRF_QUALITY || '20';
const unsharpFilter = (): string => process.env.UNSHARP_DISABLE === '1' ? '' : 'unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=0.3';
// v12.222 合规:env 门控的「AI 生成」角标(默认关;出海/合规场景 AI_WATERMARK=1 开)。
// 右上角半透明标签,drawtext 用 ASCII 文本(默认 AI-GENERATED,可 AI_WATERMARK_TEXT 覆盖)——
// 免 CJK 字体路径依赖,跨平台(darwin/Linux)稳。清理引号/冒号/反斜杠防 filtergraph 注入。
const aiWatermarkFilter = (): string => {
  if (process.env.AI_WATERMARK !== '1') return '';
  const txt = (process.env.AI_WATERMARK_TEXT || 'AI-GENERATED').replace(/[\\:'%]/g, '').slice(0, 32);
  return `drawtext=text='${txt}':fontcolor=white@0.75:fontsize=h/32:x=w-tw-14:y=14:box=1:boxcolor=black@0.35:boxborderw=6`;
};
import fs from 'fs';
import { audioUrlLoadKind } from '@/lib/audio-url';
import { impactSfxNode } from '@/lib/impact-sfx'; // v12.13.1 打击音效程序化合成
import os from 'os';
import https from 'https';
import http from 'http';
import { execSync, exec as _execCb } from 'child_process';
import { promisify } from 'util';

/**
 * v12.282:async shell 执行器 —— 替代 async 函数体内的 `execSync`。
 *
 * 病根实测:`execSync` 会**冻住整个 Node 事件循环**。用 10ms 心跳定时器量过 ——
 * 一次仅 2 秒黑屏视频的 ffmpeg 调用期间,**心跳触发次数为 0**(定时器一次都没跑),
 * 改 `execFile + await` 后同样的活儿有 9 次心跳、最大停顿 12ms。
 * 真实文字卡(1080p + 模糊背景 + CJK drawtext)要好几秒 —— 自托管多人实例上,
 * 一个人合成会让**所有人的请求与 SSE 全部卡死**,而自托管正是本项目的卖点之一。
 *
 * 保留 shell 形式(而非 execFile 数组参数):这些命令带 `2>"…"` 重定向与已转义的引号,
 * 换成参数数组要重写全部拼接逻辑,风险大于收益。shell 下依然是子进程异步执行,
 * 事件循环不再被占住 —— 这才是本版要解决的问题。
 */
const execAsync = promisify(_execCb);
async function sh$(cmd: string): Promise<void> {
  await execAsync(cmd, { maxBuffer: 32 * 1024 * 1024 });
}

// ═══ 设置 ffmpeg 可执行文件路径 ═══
// Turbopack 在 server bundle 时会把 ffmpeg-static 的路径重写为
// "/ROOT/node_modules/ffmpeg-static/ffmpeg"（虚拟路径），导致 ENOENT。
// 这里通过多种策略找到真实的 ffmpeg 二进制路径。
export function resolveFFmpegPath(): string {
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
if (process.env.NODE_ENV !== 'test') console.log(`[FFmpeg] Using binary: ${resolvedFFmpegPath}`);

// ═══ 设置 ffprobe 可执行文件路径(v12.129)═══
// 病根:probeVideoIntegrity 走 fluent-ffmpeg 的 .ffprobe(),它需要**独立的 ffprobe 二进制**。
// ffmpeg-static 只装 ffmpeg,不含 ffprobe。本机有系统 ffprobe(Homebrew)故一直没暴露,
// 但 CI(ubuntu / npm-only)与无系统 ffprobe 的部署环境里 .ffprobe() 找不到二进制 → probe 全 fail。
// → 依赖 ffprobe-static(按平台内置 ffprobe),显式 setFfprobePath;多策略兜底,最后回落系统 PATH。
export function resolveFFprobePath(): string {
  // 1. ffprobe-static 导出的 path(非 Turbopack 时正常)
  try {
    const ffprobeStatic = require('ffprobe-static');
    const p = ffprobeStatic?.path || ffprobeStatic?.default?.path;
    if (p && typeof p === 'string' && fs.existsSync(p)) return p;
  } catch { /* 包缺失 → 走系统 PATH */ }
  // 2. 用 require.resolve 定位包目录 + 按平台重建 bin 路径
  try {
    const pkgJson = require.resolve('ffprobe-static/package.json');
    const bin = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const guess = path.join(path.dirname(pkgJson), 'bin', process.platform, process.arch, bin);
    if (fs.existsSync(guess)) return guess;
  } catch { /* ignore */ }
  // 3. 系统 PATH 上的 ffprobe(本机 Homebrew 等)
  try {
    const sysPath = execSync('which ffprobe 2>/dev/null || where ffprobe 2>nul', { encoding: 'utf-8' }).trim();
    if (sysPath && fs.existsSync(sysPath)) return sysPath;
  } catch { /* ignore */ }
  console.warn('[FFprobe] Could not resolve ffprobe binary path, relying on PATH fallback');
  return 'ffprobe';
}

const resolvedFFprobePath = resolveFFprobePath();
ffmpeg.setFfprobePath(resolvedFFprobePath);
if (process.env.NODE_ENV !== 'test') console.log(`[FFprobe] Using binary: ${resolvedFFprobePath}`);

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
  aspect?: string;             // v12.49.0 成片画幅('16:9'|'9:16'|'1:1'...) — 决定合成画布分辨率;缺省 16:9(旧行为)
  captionStyle?: import('@/lib/caption-style').CaptionPreset; // v12.52.0 字幕风格预设;缺省 clean(零回归)
  voiceoverDurations?: Record<number, number>; // v12.68.0 镜号→TTS 真实时长(karaoke 扫光对齐音频)
  platform?: import('@/lib/caption-style').CaptionPlatform; // v12.79.0 平台安全区(抖音/小红书字幕避让)
  editStyle?: string;          // v12.0.4 一句指令调剪辑风格(快节奏燃向/慢叙抒情...)
  actionMode?: boolean;        // v12.13.0 动作片节奏:高光不整段慢放、硬切替淡入、保快节奏
  // v12.13.1 打击音效层:冲击点(镜号 + 镜内秒 + 强度)→ 程序化合成闷响打击音并末端混入
  impactCues?: Array<{ shotNumber: number; atSec: number; intensity: number }>;
  // v12.13.1 选择性 impact 慢镜:这些镜号的「短冲击镜」给一记强调慢镜(其余动作镜仍 1x)
  impactShots?: number[];
  // v12.29.0(P1 原生音画一体):这些镜号用**成片自带音轨**(原生音频引擎出片),不铺静音。
  // 默认空 → 行为与旧版逐字节一致(全镜静音轨 + voiceover 叠加)。ffprobe 兜底:真没音轨仍补静音。
  nativeAudioShots?: number[];
  onProgress?: (percent: number, stage: string) => void;
}

/**
 * v12.289 成片**实际**用的转场(不是 timeline 里设计的那份)。
 * 合成时 `selectTransitions` 会按张力/关键镜重挑,时长还被 `min(相邻时长)/2` 夹过 ——
 * 这份回传给 editor-agent 写回 timeline,导出的剪辑线(EDL/AAF)才与成片一致。
 * `shotNumber` 对齐(不用下标:validClips 是过滤后的子集)。首镜无入场转场,故不含首镜。
 */
export interface RenderedTransition {
  shotNumber: number;
  transition: string;        // 语义名(dissolve/cut/fadeblack/...),非 ffmpeg xfade 名
  transitionDurationS: number;
}

/**
 * v12.291(复核补强):算「每次转场的类型 + 实际时长」的**纯函数**。
 *
 * 原本这段是 composeVideo 里的一段内联循环 —— 只能靠「在源码里 grep 有没有这几行」来测,
 * 而对抗式复核当场给出了破法:把首镜那个 `if` 改成 `if (false)`,源码文本纹丝不动、测试照绿,
 * 功能却已经坏了。抽成纯函数后这些都能测真行为。
 *
 * 语义(与 v12.265「单一真源」一致):
 *  - `effectiveTds[0]` 恒 0、`renderedTransitions[0].transition` 恒 `''` —— **首镜没有入场转场**;
 *  - 硬切(cut/flash-cut)固定 0.1s;关键镜的柔转场加长 1.3×;
 *  - 一律被 `min(前后镜时长)/2` 夹住(否则 xfade 会吃掉整镜);
 *  - `renderedTransitions` 按 **shotNumber** 记录,供 editor-agent 回写 timeline(见 v12.289)。
 */
export function computeTransitionPlan(args: {
  clips: Array<{ shotNumber?: number; transition?: string } | undefined>;
  transitionNames: string[];
  keyShots: Set<number>;
  highlights: Array<{ shotNumber: number; editStrategy: { transitionDuration?: number } }>;
  durations: number[];
  td: number;
}): { effectiveTds: number[]; transitionOf: string[]; renderedTransitions: RenderedTransition[] } {
  const { clips, transitionNames, keyShots, highlights, durations, td } = args;
  const n = clips.length;
  const effectiveTds: number[] = new Array(n).fill(0); // [0] 恒 0(首镜无转场)
  const transitionOf: string[] = new Array(n).fill('');
  const renderedTransitions: RenderedTransition[] = [];

  // 首镜如实回传「无入场转场」:成片 effectiveTds[0] 恒 0,而 timeline 里的设计值会让
  // EDL 给第一镜写一条「溶解入场」—— 无物可溶,剪辑软件里是条假事件。
  if (typeof clips[0]?.shotNumber === 'number') {
    renderedTransitions.push({ shotNumber: clips[0].shotNumber as number, transition: '', transitionDurationS: 0 });
  }
  for (let i = 1; i < n; i++) {
    const clipAnalysis = highlights.find((h) => h.shotNumber === clips[i]?.shotNumber);
    const pick = transitionNames[i] || clips[i]?.transition || 'dissolve';
    const isLastCut = pick === 'cut' || pick === 'flash-cut';
    transitionOf[i] = mapTransition(pick);
    // 关键镜 fade 略长(郑重入场);其余用高光分析推荐时长
    const enteringKey = !isLastCut && keyShots.has(clips[i]?.shotNumber as number);
    const baseTd = enteringKey
      ? Math.max(td, clipAnalysis?.editStrategy.transitionDuration || td) * 1.3
      : (clipAnalysis?.editStrategy.transitionDuration || td);
    effectiveTds[i] = isLastCut ? 0.1 : Math.min(
      baseTd,
      Math.min(durations[i - 1], durations[i]) / 2,
    );
    const sn = clips[i]?.shotNumber;
    if (typeof sn === 'number') {
      renderedTransitions.push({ shotNumber: sn, transition: pick, transitionDurationS: effectiveTds[i] });
    }
  }
  return { effectiveTds, transitionOf, renderedTransitions };
}

export interface ComposeResult {
  outputPath: string;        // 本地成片路径
  totalDuration: number;     // 总时长
  clipCount: number;
  hasMusic: boolean;
  hasVoiceover: boolean;
  highlights: number[];      // 高光镜头编号列表
  beatEdit?: string;         // v12.0.0 卡点剪辑摘要(如 "120 拍, 5/8 镜切点对齐"),无则空
  emotionPacing?: string;    // v12.0.1 情绪节奏摘要(如 "3/8 镜情绪调速"),无则空
  // v12.289 成片实际转场(见上)。v12.291 复核补强:**必填**——
  // 设成可选时,把某个 resolve 出口的这一行删掉,类型检查与测试都发现不了
  // (旧测试只数了 `renderedTransitions` 在文件里出现几次,删一处仍达标),
  // 而运行时回写会静默 no-op,导出又退回设计值。必填 → 删掉即 tsc 报错。
  renderedTransitions: RenderedTransition[];
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

export function detectHighlights(clips: ComposerClip[], opts: { actionMode?: boolean; impactShots?: number[] } = {}): HighlightAnalysis[] {
  if (clips.length === 0) return [];
  const actionMode = !!opts.actionMode;
  const impactShots = new Set(opts.impactShots || []);

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

    if (isHighlight && actionMode) {
      // v12.13.0/.1(打斗劲爆度):动作片高光=冲击瞬间,要「快、脆、硬」——默认禁止整段慢放
      // (那会泄气,还把 8s 源放成 11s 拖垮节奏),改硬切 + 极短转场。
      transition = 'cut';
      transitionDuration = 0.08;
      // v12.13.1 选择性 impact 慢镜:仅「短冲击镜」(≤2s 且含冲击点)给一记强调慢镜,
      // 既保冲击力又不拖整段(长镜仍 1x)。
      const isShortImpact = impactShots.has(clip.shotNumber) && (clip.duration ?? 8) <= 2.0;
      speedMultiplier = isShortImpact ? 0.55 : 1.0;
    } else if (isHighlight) {
      // 非动作高光:稍微降速（慢动作强调），转场更激烈
      if (score >= 70) {
        speedMultiplier = 0.7; // 强高光：30% 慢动作(EMOTION_RAMP_DISABLE=1 时的旧线性行为)
        // v12.185:S 形速度曲线 —— 正常进→中段慢放强调→回速收尾,比整段线性慢更有「呼吸感」
        if (process.env.EMOTION_RAMP_DISABLE !== '1') {
          (clip as any).speedCurve = undefined; // 由下方统一计算(需 clip 实际时长)
          (clip as any)._wantClimaxRamp = true;
        }
        transition = 'fade';
        transitionDuration = 0.3;
      } else {
        speedMultiplier = 0.85; // 一般高光：15% 慢动作
        transitionDuration = 0.4;
      }
    } else if (actionMode && position >= 0.2) {
      // v12.13.0:动作片非高光段(开场后)也保持快节奏 —— 硬切 + 略加速,绝不淡入拖沓
      speedMultiplier = score < 25 ? 1.1 : 1.0;
      transition = 'cut';
      transitionDuration = 0.1;
    } else if (position < 0.2) {
      // 开场：标准或略慢
      speedMultiplier = 1.0;
      transitionDuration = actionMode ? 0.3 : 0.8;
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
 * v12.71.0 视频完整性校验:文件存在 + 非空 + 有视频流 + 时长 ≥0.3s。
 * 引擎偶发返回坏 mp4(截断/HTML 错误页当 mp4 存了)→ 提前拦下,别让 filter_complex 全片崩。
 */
export async function probeVideoIntegrity(filePath: string): Promise<{
  ok: boolean; reason?: string; durationSec?: number;
  width?: number; height?: number; hasAudio?: boolean; sizeBytes?: number; // v12.73 发布预检用
}> {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
    const size = fs.statSync(filePath).size;
    if (size < 1024) return { ok: false, reason: `too-small(${size}B)` };
    const md: any = await new Promise((res, rej) => ffmpeg.ffprobe(filePath, (e, m) => (e ? rej(e) : res(m))));
    const vStream = Array.isArray(md?.streams) ? md.streams.find((s: any) => s.codec_type === 'video') : null;
    if (!vStream) return { ok: false, reason: 'no-video-stream' };
    const hasAudio = Array.isArray(md?.streams) && md.streams.some((s: any) => s.codec_type === 'audio');
    const dur = Number(md?.format?.duration) || 0;
    if (dur < 0.3) return { ok: false, reason: `too-short(${dur}s)` };
    return { ok: true, durationSec: dur, width: Number(vStream.width) || 0, height: Number(vStream.height) || 0, hasAudio, sizeBytes: size };
  } catch (e) {
    return { ok: false, reason: `probe-failed(${e instanceof Error ? e.message.slice(0, 40) : e})` };
  }
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
 * v12.16.0(Phase 3 双版本):把成片重构图成另一比例(不重生,省 2x)。
 * 输入可为 http(s) URL / /api/serve-file / 本地路径;输出本地 mp4 路径。音轨原样拷贝。
 */
export async function reframeVideo(
  inputUrlOrPath: string,
  targetAspect: string,
  mode: import('@/lib/video-reframe').ReframeMode = 'blur-pad',
  outputDir?: string,
): Promise<{ outputPath: string; w: number; h: number }> {
  const { buildReframeFilterComplex } = await import('@/lib/video-reframe');
  const tmpDir = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-'));
  fs.mkdirSync(tmpDir, { recursive: true });
  // 取本地源
  let localInput = inputUrlOrPath;
  if (inputUrlOrPath.startsWith('http') || inputUrlOrPath.startsWith('/api/serve-file')) {
    localInput = path.join(tmpDir, 'src.mp4');
    await downloadFile(inputUrlOrPath, localInput);
  } else if (!fs.existsSync(inputUrlOrPath)) {
    throw new Error(`reframeVideo: 源不存在: ${inputUrlOrPath.slice(0, 80)}`);
  }
  const { filter, w, h } = buildReframeFilterComplex(targetAspect, mode);
  const outputPath = path.join(tmpDir, `reframed-${w}x${h}.mp4`);
  return new Promise((resolve, reject) => {
    ffmpeg(localInput)
      .complexFilter(filter)
      .outputOptions([
        '-map', '[vout]',
        '-map', '0:a?',          // 有音轨就拷贝,没有也不报错
        '-c:v', 'libx264', '-preset', 'fast', '-crf', crfValue(),
        '-c:a', 'copy',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve({ outputPath, w, h }))
      .on('error', reject)
      .run();
  });
}

/**
 * v12.25.0(整季导出):把多集成片拼成一条「整季合集」。每集归一到目标画幅(scale+pad)+ 24fps,
 * 音轨重采样到 44.1k 立体声,filter_complex `concat` 串接(重编码,容忍各集编码参数差异)。
 * 输入可为 http/serve-file/本地路径。前提:各集成片均含音轨(composer 产物恒有)。
 */
export async function concatVideos(
  urls: string[],
  targetAspect: string,
  outputDir?: string,
): Promise<{ outputPath: string; count: number }> {
  if (!urls || urls.length === 0) throw new Error('concatVideos: 无输入');
  const { dimsForAspect } = await import('@/lib/video-reframe');
  const { w, h } = dimsForAspect(targetAspect);
  const tmpDir = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), 'season-'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const locals: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (!u) continue;
    if (u.startsWith('http') || u.startsWith('/api/serve-file')) {
      const p = path.join(tmpDir, `ep-${i}.mp4`);
      try { await downloadFile(u, p); locals.push(p); } catch (e) { console.warn(`[concatVideos] 下载第 ${i} 集失败,跳过:`, e instanceof Error ? e.message : e); }
    } else if (fs.existsSync(u)) {
      locals.push(u);
    }
  }
  if (locals.length === 0) throw new Error('concatVideos: 无可用片段');

  // v12.26.0(评审):逐片探测音轨/时长 —— 某集成片无音轨时,`[i:a]` 会让整条 concat 崩。
  // 无音轨的片用 anullsrc 补一路静音(按视频时长 atrim),保证 concat a=1 始终有效。
  const meta: Array<{ hasAudio: boolean; dur: number }> = [];
  for (const p of locals) {
    let hasAudio = false; let dur = 0;
    try {
      const md: any = await new Promise((res, rej) => ffmpeg.ffprobe(p, (e, m) => (e ? rej(e) : res(m))));
      hasAudio = Array.isArray(md?.streams) && md.streams.some((s: any) => s.codec_type === 'audio');
      dur = Number(md?.format?.duration) || 0;
    } catch { /* 探测失败按无音轨 + 兜底时长处理 */ }
    meta.push({ hasAudio, dur });
  }

  const outputPath = path.join(tmpDir, 'season.mp4');
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg();
    for (const p of locals) cmd = cmd.input(p);
    const filters: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < locals.length; i++) {
      filters.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v${i}]`);
      if (meta[i].hasAudio) {
        filters.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
      } else {
        const d = (meta[i].dur > 0 ? meta[i].dur : 8).toFixed(2);
        filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${d}[a${i}]`); // 无音轨 → 静音占位
      }
      labels.push(`[v${i}][a${i}]`);
    }
    filters.push(`${labels.join('')}concat=n=${locals.length}:v=1:a=1[vout][aout]`);
    cmd.complexFilter(filters)
      .outputOptions(['-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'fast', '-crf', crfValue(), '-c:a', 'aac', '-b:a', audioBitrateForPlatform(undefined), '-movflags', '+faststart'])
      .output(outputPath)
      .on('end', () => resolve({ outputPath, count: locals.length }))
      .on('error', reject)
      .run();
  });
}

/**
 * v12.50.0/v12.53.0 结构化文字卡:把一张「文字全走 ffmpeg drawtext」的干净卡片拼到成片首/尾。
 * 解决广告 hook/CTA 被视频模型烤乱码英文的根因 —— 文字永远后期渲染(系统 CJK 字体),确定性、零乱码。
 *  - bg='blur'(默认):取成片首帧(hook)/末帧(CTA)放大裁满 + 高斯模糊压暗作背景(承接画面氛围)
 *  - bg='solid':纯色卡
 *  - position='end'(默认,片尾 CTA)/ 'start'(片头 hook,提留存)
 * 文案一律写入 textfile 再喂 drawtext(绝不内联中文 → 无转义/乱码风险)。无 title/slogan → 原样返回不加卡。
 */
export async function attachTextCard(
  mainVideoPath: string,
  opts: { title?: string; slogan?: string; w: number; h: number; durationSec?: number; bg?: 'blur' | 'solid'; solidColor?: string; accentColor?: string; outputDir?: string; position?: 'start' | 'end' },
): Promise<{ outputPath: string; appended: boolean }> {
  const title = (opts.title || '').trim();
  const slogan = (opts.slogan || '').trim();
  if (!title && !slogan) return { outputPath: mainVideoPath, appended: false }; // 无文案 → 不加卡

  const { buildEndCardVf } = await import('@/lib/end-card');
  const { findCjkFont } = await import('@/lib/text-control');
  const position = opts.position ?? 'end';
  const dur = Math.max(1.2, Math.min(opts.durationSec ?? (position === 'start' ? 2.2 : 3.2), 6));
  // v12.234(对抗复检二轮自查):此前硬编码兜底 '/System/Library/Fonts/STHeiti Light.ttc' ——
  // v12.233 只改了 findCjkFont 的**解析顺序**,却漏了**消费方**:解析返回 null 时这里照样
  // 指名要 macOS 系统字体,等于绕过刚建立的开源优先策略,字形照旧烧进商用成片。
  //
  // 但也不能简单「不指定 fontfile 让 ffmpeg 走默认」—— 实测截帧:默认字体**无 CJK 字形**,
  // 中文全渲染成豆腐块 □□□□,ffmpeg 还 exit=0,等于静默产出废片(比报错更糟)。
  // 所以:没有可用 CJK 字体时**明确失败**,让运营者去装字体,而不是拿废片糊弄。
  const fontFile = findCjkFont();
  if (!fontFile) {
    throw new Error(
      '[end-card] 找不到可用的 CJK 字体,拒绝生成文字卡(否则中文会渲染成豆腐块)。' +
      '请安装 Noto Sans CJK / 思源黑体,或放 data/fonts/NotoSansCJK-Regular.otf,亦可用 CJK_FONT_FILE 指定。',
    );
  }
  const bg = opts.bg ?? 'blur';
  const ff = resolvedFFmpegPath;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txtcard-'));
  const sh = sh$; // v12.282:async 化 —— 原为 execSync,会冻住事件循环

  try {
    let titleFile: string | undefined;
    let sloganFile: string | undefined;
    if (title) { titleFile = path.join(tmpDir, 'title.txt'); fs.writeFileSync(titleFile, title, 'utf-8'); }
    if (slogan) { sloganFile = path.join(tmpDir, 'slogan.txt'); fs.writeFileSync(sloganFile, slogan, 'utf-8'); }

    const vf = buildEndCardVf({ w: opts.w, h: opts.h, fontFile, titleFile, sloganFile, bg, solidColor: opts.solidColor, accentColor: opts.accentColor });

    // 1) 卡片背景输入(hook 取首帧、CTA 取末帧)
    let cardInputArgs: string;
    if (bg === 'blur') {
      const bgPng = path.join(tmpDir, 'bg.png');
      const seek = position === 'start' ? '-ss 0.2' : '-sseof -0.3';
      await sh(`"${ff}" -y -v error ${seek} -i "${mainVideoPath}" -frames:v 1 "${bgPng}"`);
      cardInputArgs = `-loop 1 -t ${dur} -i "${bgPng}"`;
    } else {
      cardInputArgs = `-f lavfi -t ${dur} -i "color=c=${opts.solidColor || '0x1A1015'}:s=${opts.w}x${opts.h}"`;
    }
    // 2) 渲染卡片(静音轨,便于与成片 concat a=1)
    const cardPath = path.join(tmpDir, 'card.mp4');
    await sh(`"${ff}" -y -v error ${cardInputArgs} -f lavfi -i anullsrc=r=44100:cl=stereo -vf "${vf}" -shortest -r 24 -c:v libx264 -crf 20 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k "${cardPath}"`);

    // 3) concat(重编码归一);position 决定卡在前(hook)还是在后(CTA)
    const outputDir = opts.outputDir || path.join(process.cwd(), 'data', 'composed');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `final-${position === 'start' ? 'hook' : 'endcard'}-${Date.now()}.mp4`);
    const [first, second] = position === 'start' ? [cardPath, mainVideoPath] : [mainVideoPath, cardPath];
    // v12.123:concat 重编码会破坏主片响度归一(e2e 实测双卡拼完漂到 -12.7 LUFS/-0.68 dBTP)
    // → 卡后音频补一遍 loudnorm(同 AUDIO_LOUDNORM_DISABLE 开关;目标值幂等,双卡串行拼两遍无害)
    const { shouldLoudnorm, buildLoudnormFilter } = await import('@/lib/audio-ducking');
    const renorm = shouldLoudnorm();
    const fc =
      `[0:v]fps=24,scale=${opts.w}:${opts.h},setsar=1[v0];[1:v]fps=24,scale=${opts.w}:${opts.h},setsar=1[v1];` +
      `[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[1:a]aresample=44100,aformat=channel_layouts=stereo[a1];` +
      `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]` +
      (renorm ? `;${buildLoudnormFilter('[a]', '[anorm]')}` : '');
    await sh(`"${ff}" -y -v error -i "${first}" -i "${second}" -filter_complex "${fc}" -map "[v]" -map "${renorm ? '[anorm]' : '[a]'}" -c:v libx264 -crf 20 -preset fast -pix_fmt yuv420p -c:a aac -b:a ${audioBitrateForPlatform(undefined)} -movflags +faststart "${outputPath}"`);
    console.log(`[Card] ${position === 'start' ? 'Hook 片头卡' : '片尾卡'}已拼接 → ${outputPath}`);
    return { outputPath, appended: true };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/** 片尾 CTA 卡(末帧背景)。 */
export async function appendEndCard(
  mainVideoPath: string,
  opts: { title?: string; slogan?: string; w: number; h: number; durationSec?: number; bg?: 'blur' | 'solid'; solidColor?: string; accentColor?: string; outputDir?: string },
): Promise<{ outputPath: string; appended: boolean }> {
  return attachTextCard(mainVideoPath, { ...opts, position: 'end' });
}

/** v12.53.0 开场 Hook 卡(首帧背景,提短视频留存)。 */
export async function prependHookCard(
  mainVideoPath: string,
  opts: { title?: string; slogan?: string; w: number; h: number; durationSec?: number; bg?: 'blur' | 'solid'; solidColor?: string; accentColor?: string; outputDir?: string },
): Promise<{ outputPath: string; appended: boolean }> {
  return attachTextCard(mainVideoPath, { ...opts, position: 'start' });
}

/**
 * v2.12 Sprint B.1 — j-cut/l-cut 音轨偏移决策
 *
 * 设计:
 *   - clip[i].transition 字段描述的是 clip[i] → clip[i+1] 的转场
 *   - 'j-cut' 在转场上意味着"声音先入":下一镜的对白要在画面切前 LEAD_MS 出来
 *   - 'l-cut' 反之意味着"画面先切但声音延续":本镜对白超出本镜视长不被截断
 *
 * 实现:
 *   - j-cut: 当 prev clip 的 transition='j-cut' 时,本镜配音 adelay 减 LEAD_MS,clamp 不能 < 0
 *   - l-cut: 现有 adelay 链路本来就不截断 voiceover(audio 自然播完),无需特殊参数,
 *           但我们在调用方做计数 + 日志,显式记录设计意图,避免被未来误改
 *
 * 这两个常数和 computeJCutAdelay 都从模块导出, 给 tests/composer-jcut.test.ts 单测锁住决策值。
 */
export const COMPOSER_LEAD_MS = 400;
export const COMPOSER_LAG_MS = 400;

export function computeJCutAdelay(input: {
  clips: Array<{ transition?: string }>;
  shotIndex: number;
  baseStartMs: number;
}): number {
  const { clips, shotIndex, baseStartMs } = input;
  if (shotIndex <= 0) return baseStartMs; // 第一个镜头永远没 prev,不可能 j-cut
  const prev = clips[shotIndex - 1];
  if (!prev || prev.transition !== 'j-cut') return baseStartMs;
  // 提前 LEAD_MS,但 clamp 到 >= 0 避免负 adelay 让 ffmpeg 报错
  return Math.max(0, baseStartMs - COMPOSER_LEAD_MS);
}

/**
 * v12.264 音画同步单一真源 —— xfade 压缩后每镜在**输出时间轴**上的真实画面起点。
 *
 * 根因:链式 xfade 每次转场把画面时间轴压缩 effectiveTd(offset = 累计时长 − effectiveTd),
 *       而旧版配音 adelay 却按 durations[] **纯累加**(不减转场重叠)定位 → 配音相对画面
 *       逐镜滞后 Σ effectiveTd(默认转场 0.5s × 转场数 ≈ 真机实测 0.5~1s 延迟)。
 * 修复:画面 xfade offset 与配音起点都由本函数产出 → 同源对齐,累计漂移归零。口型不脱节。
 *
 * @param durations   各镜**终值**时长(秒),已含情绪调速/卡点/逐镜变速。
 * @param effectiveTds effectiveTds[i] = 进入第 i 镜那次转场的实际 xfade 时长(秒);[0] 恒 0(首镜无转场)。
 * @returns clipStartSec 各镜画面起点(秒,首镜=0);totalSec 压缩后总时长(= BGM 尾淡出基准)。
 * 导出供 tests 单测锁住「配音起点 == 画面 xfade offset」不再回归。
 */
export function computeXfadeTimeline(
  durations: number[],
  effectiveTds: number[],
): { clipStartSec: number[]; totalSec: number } {
  const n = durations.length;
  const clipStartSec: number[] = new Array(n).fill(0); // clipStartSec[0] = 0(首镜从 0 起)
  if (n === 0) return { clipStartSec, totalSec: 0 };
  let cumulativeDuration = durations[0] || 0;
  for (let i = 1; i < n; i++) {
    const offset = Math.max(0, cumulativeDuration - (effectiveTds[i] || 0));
    clipStartSec[i] = offset;
    cumulativeDuration = offset + (durations[i] || 0);
  }
  return { clipStartSec, totalSec: cumulativeDuration };
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
    // v12.200:转场多样性扩池(ffmpeg xfade 原生),告别全片三连 dissolve
    'pixelize': 'pixelize',
    'radial': 'radial',
    'slideleft': 'slideleft',
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

  const { voiceoverClips, voiceoverVolume = 0.9, actionMode = false, nativeAudioShots = [] } = options;
  const nativeShotSet = new Set(nativeAudioShots); // v12.29.0(P1):这些镜用成片真音轨

  if (clips.length === 0) {
    throw new Error('No clips provided');
  }

  // ═══ v12.49.0 成片画布按项目画幅 ═══
  // 病根:此前每镜预处理硬编码 `scale=1280:720,pad=1280:720` → 无视项目比例,竖屏(9:16)项目
  // 成片仍出 16:9 横屏。改为按 aspect 取画布尺寸 + 适配滤镜(横屏缩入补边=旧行为零回归;竖屏放大裁满)。
  const { buildCanvasFit } = await import('@/lib/video-reframe');
  const { fit: canvasFit, w: canvasW, h: canvasH } = buildCanvasFit(options.aspect || '16:9');
  console.log(`[Composer] 画布 ${canvasW}x${canvasH} (aspect=${options.aspect || '16:9'})`);

  // ═══ 高光检测 ═══
  const highlights = detectHighlights(clips, { actionMode, impactShots: options.impactShots });
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

  // 1. 创建临时工作目录 (中间文件) + 持久化输出目录 (最终成片)
  // v2.18.1 修复: 此前 outputPath 也写在 /tmp/qf-compose-* 里, dev 重启 / macOS
  // 周期清理 /var/folders 后, DB 里 finalVideoUrl 指向的文件就消失了, UI 显示
  // "本地合成视频文件已失效". 现在: 工作中间产物仍 /tmp (无所谓), 最终 mp4 写到
  // 项目根 data/composed/ (持久化, 跟 SQLite db 同生命周期).
  const tmpDir = outputDir || path.join(os.tmpdir(), `qf-compose-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const persistentOutputDir = path.join(process.cwd(), 'data', 'composed');
  if (!fs.existsSync(persistentOutputDir)) {
    fs.mkdirSync(persistentOutputDir, { recursive: true });
  }
  const outputPath = path.join(persistentOutputDir, `final-${Date.now()}.mp4`);

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
      // v12.71.0 完整性校验:引擎偶发返回坏 mp4(0 字节/截断/无视频流)会让 filter_complex 全片崩。
      // ffprobe 验「有视频流 + 时长 ≥0.3s」,坏片按下载失败处理(跳过,交给上游兜底链)。
      const integ = await probeVideoIntegrity(localPath);
      if (!integ.ok) {
        console.warn(`[Composer] v12.71 镜 ${clip.shotNumber} 视频损坏(${integ.reason}),跳过`);
        try { fs.unlinkSync(localPath); } catch {}
        continue;
      }
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

  // v12.13.0(打斗劲爆度修复 · 核心):用「设计时长」(ComposerClip.duration)裁切源片。
  // 病根:视频引擎出片固定 8s/5s,之前 composer 用 ffprobe 源时长整段拼,无视分镜设计的 3-5s,
  // 把本应快切的打斗泡成慢镜(实测 6 镜 58s,ASL≈9.7s)。这里把每镜「目标时长」seed 成设计时长
  // (不超过源、最少 1.5s);情绪节奏/卡点只会在此基础上更短;真正裁切由下方 per-clip `trim` 滤镜落地。
  const sourceDurations = [...durations];
  for (let i = 0; i < durations.length; i++) {
    const designed = validClips[i]?.duration;
    if (designed && designed > 0) durations[i] = Math.max(1.5, Math.min(designed, sourceDurations[i]));
  }

  // v12.29.0(P1 原生音画一体):原生音频镜逐片 ffprobe,在 Promise 外算好(sync 滤镜段不能 await)。
  // 仅 nativeAudioShots 非空才探测 → 默认空 = 零探测、零回归。
  const clipHasNativeAudio: boolean[] = new Array(localClips.length).fill(false);
  if (nativeShotSet.size > 0) {
    for (let i = 0; i < localClips.length; i++) {
      if (!nativeShotSet.has(validClips[i]?.shotNumber as number)) continue;
      try {
        const md: any = await new Promise((res, rej) => ffmpeg.ffprobe(localClips[i], (e, m) => (e ? rej(e) : res(m))));
        clipHasNativeAudio[i] = Array.isArray(md?.streams) && md.streams.some((s: any) => s.codec_type === 'audio');
      } catch { clipHasNativeAudio[i] = false; }
      if (!clipHasNativeAudio[i]) console.warn(`[Composer] 镜 ${validClips[i]?.shotNumber} 标记原生音频但成片无音轨 → 兜底静音`);
    }
  }

  onProgress?.(40, '构建合成滤镜...');

  // 4. 下载配乐（如果有）
  // v2.16 P1.1: 同时支持 http URL 和内部 /api/serve-file?path=... (后者来自 BGM 三幕拼接产物);
  // downloadFile 函数自身已支持这两种 URL 形态 (见 line 208-216)
  let localMusicPath = '';
  if (musicUrl && (musicUrl.startsWith('http') || musicUrl.startsWith('/api/serve-file'))) {
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
      if (!vo.audioUrl) continue;
      const voPath = path.join(tmpDir, `voiceover-${vo.shotNumber}.mp3`);
      try {
        // v12.x(#4 修复):TTS 返回的不是 http URL —— vectorengine-tts 返 data:audio、
        // minimax 返 /api/serve-file?path= —— 此前只认 startsWith('http') → 配音全被丢 → 成片没人声。
        const kind = audioUrlLoadKind(vo.audioUrl);
        if (kind === 'data') {
          const b64 = vo.audioUrl.split(',')[1] || '';
          fs.writeFileSync(voPath, Buffer.from(b64, 'base64'));
          localVoiceovers.set(vo.shotNumber, voPath);
        } else if (kind === 'download') {
          await downloadFile(vo.audioUrl, voPath); // 已支持 http + /api/serve-file
          localVoiceovers.set(vo.shotNumber, voPath);
        } else {
          console.warn(`[Composer] 跳过未知形态的配音 URL (shot ${vo.shotNumber}): ${vo.audioUrl.slice(0, 40)}`);
        }
      } catch (e) {
        console.error(`[Composer] Failed to load voiceover for shot ${vo.shotNumber}:`, e);
      }
    }
    if (localVoiceovers.size > 0) {
      onProgress?.(48, `${localVoiceovers.size} 段配音就绪`);
    }
  }

  // ═══ v2.22 fix #2: 烧 CJK 字幕 ═══
  // 视频模型不能正确渲染 CJK 文字, 之前 prompt 里塞 dialogue 出来一片乱码.
  // 业界做法: 让模型只画"角色在说话"的动作, 真字幕走 ffmpeg subtitles filter
  // (libass + .srt + 系统 CJK 字体).
  let subtitlesFilterFragment = '';
  // v12.195:标准 SRT 在情绪调速/卡点/变速之前生成,时间轴用的是 ORIGINAL 时长 ——
  // durations[] 定稿后必须按终值重写此文件,否则慢放镜字幕提前消失(偏移可达 30%)。
  let srtResyncPath: string | null = null;
  // v12.269:karaoke ASS 同样要在 durations 定稿 + xfade 时间轴算完后重写 —— 它此前**双重漂移**:
  // ① 用 c.duration(ORIGINAL,未含情绪调速/卡点/变速);② cursor 纯累加(未减 xfade 转场重叠)。
  // 存下路径与渲染参数,循环后按 clipStartSec 重建(与 SRT/配音/画面/打击音效同源)。
  let assResync: { path: string; opts: { w: number; h: number; fontName: string; vertical: boolean; marginVRatio: number } } | null = null;
  try {
    const hasAnyDialogue = validClips.some((c) => (c?.dialogue || '').trim().length > 0);
    const cjkFontForSub = (await import('@/lib/text-control')).findCjkFont();
    // v12.234(对抗复检二轮自查):FontName 兜底此前写死 'PingFang SC' —— 本机没有该字体也照样
    // 在 ASS 里指名要它,既绕过开源优先策略,又在字体缺失时渲染成豆腐块。
    // 实测截帧证实:无 CJK 字体时 ffmpeg 仍 exit=0,但中文全是 □□□□(静默产废片,比报错更糟)。
    // 所以:没有可用 CJK 字体 → **跳过字幕烧录并告警**(无字幕的成片可用;满屏豆腐块的不可用)。
    if (hasAnyDialogue && !cjkFontForSub) {
      console.warn(
        '[subtitles] ⚠️ 找不到可用 CJK 字体,已跳过字幕烧录 —— 否则中文会渲染成豆腐块。' +
        '请安装 Noto Sans CJK / 思源黑体,或用 CJK_FONT_FILE 指定。',
      );
    }
    if (hasAnyDialogue && cjkFontForSub) {
      const { buildSrt } = await import('@/lib/text-control');
      const cjkFont = cjkFontForSub;
      const fontName = path.basename(cjkFont, path.extname(cjkFont));
      const fontDirFrag = `:fontsdir='${path.dirname(cjkFont).replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
      const vertical = canvasH > canvasW;
      const captionStyle = options.captionStyle || 'clean';

      if (captionStyle === 'karaoke') {
        // v12.54.0 词级动效字幕(ASS karaoke 扫光)—— 行级时长均摊到字合成 \kf,libass 渲染。
        const { buildKaraokeAss } = await import('@/lib/ass-karaoke');
        const lines: Array<{ text: string; startSec: number; durSec: number; sweepSec?: number }> = [];
        let cursor = 0;
        for (const c of validClips) {
          const d = c.duration || 4;
          if ((c.dialogue || '').trim()) {
            const voDur = options.voiceoverDurations?.[c.shotNumber]; // v12.68 扫光对齐 TTS 真实时长
            lines.push({ text: c.dialogue || '', startSec: cursor, durSec: d, sweepSec: voDur && voDur > 0 ? voDur : undefined });
          }
          cursor += d;
        }
        if (lines.length > 0) {
          const { captionSafeBottomRatio } = await import('@/lib/caption-style');
          const assOpts = { w: canvasW, h: canvasH, fontName, vertical, marginVRatio: captionSafeBottomRatio(options.platform, vertical) };
          const ass = buildKaraokeAss(lines, assOpts);
          const assPath = path.join(tmpDir, 'subtitles.ass');
          fs.writeFileSync(assPath, ass, 'utf-8');
          assResync = { path: assPath, opts: assOpts }; // v12.269:时间轴定稿后按压缩起点重写
          const escAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          subtitlesFilterFragment = `,subtitles='${escAss}'${fontDirFrag}`;
          console.log(`[Composer] 词级动效字幕(ASS karaoke)烧入: ${assPath} (font: ${cjkFont || 'system default'})`);
        }
      } else {
        // 注意: srt 时间轴按"成片播放时间"算 —— 按 ComposerClip.duration(ORIGINAL 时长)拼,和成片对齐。
        const srtContent = buildSrt(validClips.map((c) => ({ dialogue: c.dialogue || '', duration: c.duration })));
        if (srtContent.trim().length > 0) {
          const srtPath = path.join(tmpDir, 'subtitles.srt');
          fs.writeFileSync(srtPath, srtContent, 'utf-8');
          srtResyncPath = srtPath; // v12.195:durations 定稿后重写
          // libass subtitles filter — 必须 escape colon (Windows path 兼容) + 内部单引号
          const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
          // v12.52.0 字幕风格预设(clean 与旧硬编码逐字符一致;social 给电商/广告大字抬高)
          const { buildCaptionForceStyle } = await import('@/lib/caption-style');
          const forceStyle = buildCaptionForceStyle(captionStyle, fontName, { vertical });
          subtitlesFilterFragment = `,subtitles='${escapedPath}'${fontDirFrag}:force_style='${forceStyle}'`;
          console.log(`[Composer] 字幕烧入: ${srtPath} (font: ${cjkFont || 'system default'})`);
        }
      }
    }
  } catch (e) {
    console.warn('[Composer] subtitle setup failed (non-blocking):', e instanceof Error ? e.message : e);
  }

  // ─── v12.0.1 情绪节奏曲线(阶段二十 A)─────────────────────────────────────
  // 动作/高张力镜快切压缩、情感峰值镜 breathe、对白镜保配音满长(只压不拉,用现有素材)。
  // 先于卡点剪辑:情绪 pacing 定宏观节奏,卡点再把切点微对齐到拍。durations[] 共用链路
  // 自动带动配音 adelay(对白镜不压 → 配音不断)。EMOTION_PACING_DISABLE=1 关闭。
  // v12.0.4 一句指令调风格:解析 editStyle → 压缩力度 + 转场软硬偏置(BYO,无 key/MOCK 走规则)
  let editStyle = { pace: 'medium' as const, compressionBias: 1.0, cutBias: 0, label: '默认(中速)', source: 'default' as const };
  if (options.editStyle && options.editStyle.trim()) {
    try { const { resolveEditStyle } = await import('@/lib/edit-style'); editStyle = await resolveEditStyle(options.editStyle) as any; } catch { /* 规则兜底 */ }
  }

  // v12.0.2 侧重强调:先标关键镜(开场/集尾/反转/峰值)—— 关键镜不压(注意力倾斜)+ 转场更沉稳
  // v12.0.3 转场审美:按镜头关系 + 变化性统一选转场(在 async 体内预算,Promise executor 引用)
  let keyShots = new Set<number>();
  let transitionNames: string[] = [];
  try {
    const { detectKeyShots, selectTransitions } = await import('@/lib/edit-rhythm');
    keyShots = detectKeyShots(validClips.map((c) => ({ shotNumber: c?.shotNumber, emotionTemperature: c?.emotionTemperature })));
    transitionNames = selectTransitions(
      validClips.map((c) => ({
        shotNumber: c?.shotNumber, emotionTemperature: c?.emotionTemperature,
        tensionLevel: c?.tensionLevel, hasDialogue: !!(c?.dialogue || '').trim(), explicit: c?.transition,
      })),
      keyShots,
      editStyle.cutBias,
    );
  } catch { /* 降级:逐镜 explicit/dissolve */ }

  let pacingInfo = '';
  if (localClips.length > 1 && process.env.EMOTION_PACING_DISABLE !== '1') {
    try {
      const { applyEmotionPacing } = await import('@/lib/edit-rhythm');
      const { durations: paced, changed } = applyEmotionPacing(
        validClips.map((c, i) => ({
          durationS: durations[i],
          emotionTemperature: c?.emotionTemperature,
          tensionLevel: c?.tensionLevel,
          hasDialogue: !!(c?.dialogue || '').trim(),
          shotNumber: c?.shotNumber,
        })),
        { keyShots, compressionBias: editStyle.compressionBias },
      );
      if (changed > 0) {
        for (let i = 0; i < durations.length; i++) durations[i] = Math.min(durations[i], paced[i]);
        pacingInfo = `${changed}/${durations.length} 镜情绪调速${keyShots.size ? `,${keyShots.size} 关键镜侧重` : ''}${editStyle.source !== 'default' ? `,风格:${editStyle.label}` : ''}`;
        console.log(`[Composer] v12.0.1/.2/.4 情绪节奏+侧重+风格: ${pacingInfo}`);
      }
    } catch (e) {
      console.warn('[Composer] 情绪节奏失败(非阻塞):', e instanceof Error ? e.message : e);
    }
  }

  // ─── v12.0.0 卡点剪辑(阶段二十 A)──────────────────────────────────────────
  // 多镜 + 有 BGM 时,把每镜切点吸附到音乐拍点(detectBeats → snap,只收紧不越界源片)。
  // durations[] 被 xfade offset / 配音 adelay / 静音轨 共用 → 改它即同步全链对齐,口型不脱节。
  // 诚实降级:无 BGM / 析不出拍 → 原样拼接(现状)。BEAT_EDIT_DISABLE=1 关闭。
  let beatEditInfo = '';
  if (localClips.length > 1 && localMusicPath && process.env.BEAT_EDIT_DISABLE !== '1') {
    try {
      const { detectBeatsWithFallback, snapDurationsToBeatsClamped } = await import('@/lib/beat-detect');
      // v12.184:AI BGM 无静音段致真检测 0 拍点(对齐率恒 0%)→ BPM 网格兜底,切点永远有的吸
      const totalSec = durations.reduce((a: number, b: number) => a + b, 0);
      const { beats, source: beatSource } = await detectBeatsWithFallback(localMusicPath, { durationSec: totalSec + 5 });
      if (beatSource === 'bpm-grid') console.log('[Beat] 真拍点稀疏,启用 BPM 网格兜底(BGM_BPM_HINT 可调)');
      if (beats.length > 0) {
        const { durations: snapped, changed } = snapDurationsToBeatsClamped(durations, beats);
        for (let i = 0; i < durations.length; i++) durations[i] = snapped[i];
        beatEditInfo = `${beats.length} 拍, ${changed}/${durations.length} 镜切点对齐`;
        console.log(`[Composer] v12.0.0 卡点剪辑: ${beatEditInfo}`);
      } else {
        console.log('[Composer] v12.0.0 卡点剪辑: BGM 析不出拍点 → 原样拼接');
      }
    } catch (e) {
      console.warn('[Composer] 卡点剪辑失败(非阻塞):', e instanceof Error ? e.message : e);
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

      // 构建视频滤镜：裁切到设计时长 + 统一分辨率 + 变速 + 淡入淡出
      const speed = validClips[0]?.speedMultiplier || 1.0;
      const isHL = validClips[0]?.isHighlight || false;
      // v12.13.0:单镜也按设计时长裁切(designed 未给则 = 源时长,无裁切)
      const trimTo0 = Math.min(durations[0], sourceDurations[0]);
      const _grade1 = buildColorGradeFilter(detectGradeGenre(options.editStyle));
      const _us1 = unsharpFilter();
      const _aiwm1 = aiWatermarkFilter();
      let videoFilter = `[0:v]trim=0:${trimTo0.toFixed(2)},setpts=PTS-STARTPTS,${canvasFit},fps=24,setsar=1${_us1 ? ',' + _us1 : ''}${_grade1 ? ',' + _grade1 : ''}${_aiwm1 ? ',' + _aiwm1 : ''}`;
      if (speed !== 1.0 && speed > 0) {
        const pts = 1.0 / speed;
        {
        // v12.185:速度曲线 —— 高潮 S 形 ramp 重塑视频内部节奏(正常进→中段慢放→回速);
        // 音频/时长仍按线性 speed 口径(ramp 平均速与线性差 <8%,尾部由 trim 兜底),不动全链对齐。
        const { speedCurveToSetpts, climaxRamp } = require('@/lib/speed-curve') as typeof import('@/lib/speed-curve');
        const _c: any = validClips[0];
        const _dur = Number(_c?.duration) || 0;
        const _curve = _c?.speedCurve || (_c?._wantClimaxRamp && _dur >= 2.4 ? climaxRamp(_dur) : null);
        const _expr = _curve ? speedCurveToSetpts(_curve, _dur) : null;
        videoFilter += _expr ? `,setpts=${_expr}` : `,setpts=${pts.toFixed(3)}*PTS`;
      }
        durations[0] = durations[0] / speed;
        console.log(`[Composer] Single clip speed=${speed}x → duration=${durations[0].toFixed(1)}s${isHL ? ' [HIGHLIGHT]' : ''}`);
      }
      if (srtResyncPath) {
        try {
          const { buildSrt: srtF } = require('@/lib/text-control') as typeof import('@/lib/text-control');
          fs.writeFileSync(srtResyncPath, srtF([{ dialogue: validClips[0]?.dialogue || '', duration: durations[0] }]), 'utf-8');
        } catch { /* 重写失败保留原字幕,不阻塞合成 */ }
      }
      // 添加淡入淡出效果
      videoFilter += `,fade=t=in:st=0:d=0.8,fade=t=out:st=${Math.max(0, durations[0] - 1)}:d=1`;
      // v2.22 fix #2: 烧 CJK 字幕 (在 fade 之后, 避免字幕被淡出)
      videoFilter += subtitlesFilterFragment;
      videoFilter += `[vout]`;

      const filters: string[] = [videoFilter];

      // 音频处理
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${(durations[0] || 8).toFixed(2)}[va]`);
      let mixInputs = '[va]';
      let mixCount = 1;

      // v2.14 P1.2: BGM 循环 — Minimax music 上限 ~120s, 但用户挑 10/15s 时长 + 6 镜可能跑到 90s。
      // 之前没循环, 60s BGM 后剩下时间静音; 而且 amix=shortest 还会把整段视频截短到 BGM 长度。
      // 修法: aloop=-1 让 BGM 无限循环, amix=duration=first 用第一个输入(视频原音 [va]) 作 master length。
      if (localMusicPath) {
        // v12.195:BGM 被 amix=duration=first 硬截 → 结尾"刹车感",按成片终点提前 2.5s 淡出
        const bgmFadeSt = Math.max(0, (durations[0] || 8) - 2.5).toFixed(2);
        filters.push(`[1:a]aloop=loop=-1:size=2e+09,volume=${musicVolume},afade=t=out:st=${bgmFadeSt}:d=2.5[ma]`);
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
        filters.push(`${mixInputs}amix=inputs=${mixCount}:duration=first:dropout_transition=2[outa]`);
      } else {
        filters.push(`[va]anull[outa]`);
      }

      cmd
        .complexFilter(filters)
        .outputOptions(['-map', '[vout]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'fast', '-crf', crfValue(), '-c:a', 'aac', '-b:a', audioBitrateForPlatform(options.platform), '-movflags', '+faststart'])
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
            renderedTransitions: [], // v12.289 单镜成片无转场
          });
        })
        .on('error', reject)
        .run();
    });
  }

  // v12.67.0:ducking 模块在 Promise 外加载(sync 滤镜段不能 await)
  const { shouldDuck, buildDuckingFilters, shouldLoudnorm, buildLoudnormFilter } = await import('@/lib/audio-ducking');

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

    // v12.200:多引擎拼接色调统一 —— 全片挂同一层基础调色(题材从 editStyle 推),抹平 Kling暖/MiniMax冷跳变
    const _gradeGenre = detectGradeGenre(options.editStyle);
    const _grade = buildColorGradeFilter(_gradeGenre);
    if (_grade) console.log(`[Composer] v12.200 基础调色: ${_gradeGenre}`);
    // 视频预处理链：统一分辨率 + 高光变速
    for (let i = 0; i < n; i++) {
      const speed = validClips[i]?.speedMultiplier || 1.0;
      const isHighlightClip = validClips[i]?.isHighlight || false;
      // v12.13.0:按设计时长真裁切源片(trim=0:T + 重置时间戳)—— 杜绝 8s 源整段流出,快切节奏落地。
      const trimTo = Math.min(durations[i], sourceDurations[i]);
      const _us = unsharpFilter();
      const _aiwm = aiWatermarkFilter();
      let videoFilter = `[${i}:v]trim=0:${trimTo.toFixed(2)},setpts=PTS-STARTPTS,${canvasFit},fps=24,setsar=1${_us ? ',' + _us : ''}${_grade ? ',' + _grade : ''}${_aiwm ? ',' + _aiwm : ''}`;

      // 高光变速：setpts 调整视频播放速度（<1 = 加速, >1 = 减速）
      if (speed !== 1.0 && speed > 0) {
        const pts = 1.0 / speed; // speed=0.7 → pts=1.43 (慢动作)
        {
        // v12.185:速度曲线 —— 高潮 S 形 ramp 重塑视频内部节奏(正常进→中段慢放→回速);
        // 音频/时长仍按线性 speed 口径(ramp 平均速与线性差 <8%,尾部由 trim 兜底),不动全链对齐。
        const { speedCurveToSetpts, climaxRamp } = require('@/lib/speed-curve') as typeof import('@/lib/speed-curve');
        const _c: any = validClips[i];
        const _dur = Number(_c?.duration) || 0;
        const _curve = _c?.speedCurve || (_c?._wantClimaxRamp && _dur >= 2.4 ? climaxRamp(_dur) : null);
        const _expr = _curve ? speedCurveToSetpts(_curve, _dur) : null;
        videoFilter += _expr ? `,setpts=${_expr}` : `,setpts=${pts.toFixed(3)}*PTS`;
      }
        // 调整该片段的有效时长
        durations[i] = durations[i] / speed;
        console.log(`[Composer] Shot ${validClips[i]?.shotNumber}: speed=${speed}x → duration=${durations[i].toFixed(1)}s${isHighlightClip ? ' [HIGHLIGHT]' : ''}`);
      }

      filters.push(`${videoFilter}[v${i}]`);
    }

    // v12.264:SRT 时间轴重写下移到 xfade 时间轴算完之后(见循环后)—— 需用压缩后画面起点定位字幕,
    // 否则字幕相对画面/配音逐镜滞后 Σ effectiveTd。此处仅保留 xfade 链构建。

    // ── v12.265 音画同步「单一真源」结构化 ──────────────────────────────────────
    // v12.264 修对了数值,但画面 offset 与配音/字幕的起点是**两处独立递推**(数值恰好相等)——
    // 将来任一处被改就会无声错位,正是本次 bug 的成因模式。这里彻底消除:
    //   ① 前置 pass 只算「每次转场的类型 + 实际时长」(纯数据,不产滤镜);
    //   ② computeXfadeTimeline 一次性给出压缩后时间轴;
    //   ③ 画面 xfade offset / 配音 adelay / 字幕起点 / 打击音效**四者共用同一份 clipStartSec**。
    const { effectiveTds, transitionOf, renderedTransitions } = computeTransitionPlan({
      clips: validClips, transitionNames, keyShots, highlights, durations, td,
    });

    // 压缩后时间轴:clipStartSec[i] = 第 i 镜画面真实起点(= 其 xfade offset),totalSec = 成片总时长
    const { clipStartSec, totalSec } = computeXfadeTimeline(durations, effectiveTds);
    const clipStartMs: number[] = clipStartSec.map((s) => Math.round(s * 1000));
    const cumulativeDuration = totalSec; // 供 BGM 尾淡出 / totalDuration(与旧版逐值相同)

    // 链式 xfade —— offset 直接取 clipStartSec[i],与音轨/字幕同源
    let prevLabel = 'v0';
    for (let i = 1; i < n; i++) {
      // v2.22 fix #2: 最后一段不再直接出 [vout] — 留出 [xvfinal] 给字幕 filter
      const outLabel = i === n - 1 ? 'xvfinal' : `xv${i}`;
      filters.push(`[${prevLabel}][v${i}]xfade=transition=${transitionOf[i]}:duration=${effectiveTds[i].toFixed(2)}:offset=${clipStartSec[i].toFixed(2)}[${outLabel}]`);
      prevLabel = outLabel;
    }

    // v12.264:SRT 字幕按压缩后画面起点重写(下移自 xfade 前)—— 起点与配音 adelay / 画面 xfade 同源,
    // 展示时长仍用各镜终值时长(变速/卡点已落账)。原 v12.195 只重写了「终值时长」,漏了 xfade 压缩位移。
    if (srtResyncPath) {
      try {
        const { buildSrtWithStarts } = require('@/lib/text-control') as typeof import('@/lib/text-control');
        // 展示时长 = 到下一镜画面起点为止(末镜用自身终值时长)—— 与旧版「首尾相接不重叠」一致,
        // 避免压缩后本镜字幕尾巴压到下一镜起点上出现两行字幕。
        fs.writeFileSync(
          srtResyncPath,
          buildSrtWithStarts(validClips.map((c, k) => {
            // v12.265:gap 退化保护 —— isLastCut 分支的 effectiveTd 硬写 0.1(绕过 /2 夹取),
            // 极短镜下 gap 可能算成 0/负数,落进 buildSrtWithStarts「非法→5s」兜底会显示 5 秒错字幕
            // 并压住下一条。gap 不为正时退回该镜自身时长(= 旧版行为,绝不放大成 5s)。
            const gap = k < n - 1 ? clipStartSec[k + 1] - clipStartSec[k] : durations[k];
            return { dialogue: c?.dialogue || '', startSec: clipStartSec[k], durSec: gap > 0 ? gap : durations[k] };
          })),
          'utf-8',
        );
        console.log('[Composer] v12.264 SRT 时间轴按 xfade 压缩后画面起点重写(字幕/配音/画面三轨齐平)');
      } catch { /* 重写失败保留原字幕,不阻塞合成 */ }
    }

    // v12.269:karaoke ASS 同法重写 —— 它此前是**双重漂移**(用 ORIGINAL 时长 + cursor 纯累加),
    // 比 SRT 那条更严重:变速/卡点偏移 与 xfade 压缩位移 叠加。扫光 sweepSec 仍用 TTS 真实时长(不动)。
    if (assResync) {
      try {
        const { buildKaraokeAss } = require('@/lib/ass-karaoke') as typeof import('@/lib/ass-karaoke');
        const lines: Array<{ text: string; startSec: number; durSec: number; sweepSec?: number }> = [];
        for (let k = 0; k < n; k++) {
          const c = validClips[k];
          if (!(c?.dialogue || '').trim()) continue;
          const voDur = options.voiceoverDurations?.[c.shotNumber as number];
          const gap = k < n - 1 ? clipStartSec[k + 1] - clipStartSec[k] : durations[k];
          lines.push({
            text: c.dialogue || '',
            startSec: clipStartSec[k],
            durSec: gap > 0 ? gap : durations[k], // 同 SRT 的 gap 退化保护
            sweepSec: voDur && voDur > 0 ? voDur : undefined,
          });
        }
        if (lines.length > 0) {
          fs.writeFileSync(assResync.path, buildKaraokeAss(lines, assResync.opts), 'utf-8');
          console.log('[Composer] v12.269 karaoke ASS 时间轴按 xfade 压缩后画面起点重写(消除双重漂移)');
        }
      } catch { /* 重写失败保留原字幕,不阻塞合成 */ }
    }

    // v2.22 fix #2: 烧 CJK 字幕作 last step — 字幕在转场之后, 让所有片段 dialogue 都显示
    if (subtitlesFilterFragment) {
      // strip 开头的逗号 — subtitles filter 在 filter chain 里独立用 = 而不是 ,
      const filterBody = subtitlesFilterFragment.replace(/^,/, '');
      filters.push(`[xvfinal]fade=t=in:st=0:d=0.5,${filterBody}[vout]`);
    } else {
      // 无字幕 — pass-through, 保持 [vout] label 名一致
      filters.push(`[xvfinal]fade=t=in:st=0:d=0.5[vout]`); // v12.205 开头淡入(fade out 因与片尾卡拼接冲突不加)
    }

    // 音频处理：生成的视频通常没有音频流，统一生成静音替代
    // 使用 anullsrc 为每个视频片段生成匹配时长的静音音频
    // v12.29.0(P1 原生音画一体):nativeAudioShots 且真有音轨的镜用「成片自带音轨」,其余补静音。
    // clipHasNativeAudio[] 已在 Promise 外 ffprobe 算好(默认空集合 → 全 false → 与旧版逐字节一致)。
    // v12.269 音画同步:concat 是首尾硬拼(段 i 落在 durations 纯累加位),**天然表达不了 xfade 重叠** ——
    // 原生音轨若留在 concat 里,其声音比压缩后的画面晚 Σ effectiveTd(与配音同根同量)。
    // 改法:concat 只当**静音床**(仍作 amix master 定总长),原生音轨改走 adelay 定位到 clipStartMs[i],
    // 末端以 normalize=0 叠加 —— 既与画面/字幕/配音/打击音效同源,又不动既有电平。
    // 默认 nativeAudioShots 为空 → clipHasNativeAudio 全 false → 与旧版逐字节一致(零回归)。
    for (let i = 0; i < n; i++) {
      const dur = durations[i] || 8;
      filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(2)}[a${i}]`);
    }

    // 音频 concat(静音床)
    const audioInputLabels = Array.from({ length: n }, (_, i) => `[a${i}]`).join('');
    filters.push(`${audioInputLabels}concat=n=${n}:v=0:a=1[aconcat]`);

    // v12.269:原生音轨镜按压缩后画面起点 adelay 定位(clipHasNativeAudio 已 ffprobe 证实确有音轨)
    const nativeLabels: string[] = [];
    for (let i = 0; i < n; i++) {
      if (!clipHasNativeAudio[i]) continue;
      const dur = durations[i] || 8;
      const nd = clipStartMs[i] || 0;
      const lbl = `na${nativeLabels.length}`;
      filters.push(`[${i}:a]atrim=0:${dur.toFixed(2)},aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${nd}|${nd}[${lbl}]`);
      nativeLabels.push(`[${lbl}]`);
    }
    let nativeLabel = '';
    if (nativeLabels.length === 1) {
      nativeLabel = nativeLabels[0];
    } else if (nativeLabels.length > 1) {
      // 各镜原生音轨时间上互不重叠 → normalize=0 合并,避免被均摊压低
      filters.push(`${nativeLabels.join('')}amix=inputs=${nativeLabels.length}:normalize=0:duration=longest:dropout_transition=0[namix]`);
      nativeLabel = '[namix]';
    }
    if (nativeLabel) console.log(`[Composer] v12.269 原生音轨 ${nativeLabels.length} 镜按压缩后画面起点对齐(adelay)`);

    // 混合音频轨道：原始音频 + 配乐 + 配音
    let nextInputIdx = n;
    const audioMixParts: string[] = ['[aconcat]'];
    let audioMixCount = 1;

    if (localMusicPath) {
      const musicIdx = nextInputIdx;
      nextInputIdx++;
      // v2.14 P1.2: BGM 必须 aloop, 否则 60s 之后整段视频静音
      // v12.195:+尾淡出,免 amix=duration=first 硬截的"刹车感"
      const bgmFadeSt = Math.max(0, cumulativeDuration - 2.5).toFixed(2);
      filters.push(`[${musicIdx}:a]aloop=loop=-1:size=2e+09,volume=${musicVolume},afade=t=out:st=${bgmFadeSt}:d=2.5[musicvol]`);
      audioMixParts.push('[musicvol]');
      audioMixCount++;
    }

    // 配音混入 — 逐镜头偏移 (adelay)
    // 每段配音按其所在 shot 的累计起始时间对齐；支持任意镜头数
    if (localVoiceovers.size > 0) {
      // 预计算每个 shot 的起始偏移（ms）
      // v12.264 音画同步:起点直接取 clipStartMs[k](= 该镜在 xfade 压缩后输出时间轴上的真实画面起点),
      // 不再用 durations[] 纯累加 —— 后者忽略每次转场的 effectiveTd 重叠,导致配音逐镜滞后 Σ effectiveTd。
      const shotStartMs: Map<number, number> = new Map();
      for (let k = 0; k < n; k++) {
        const sn = validClips[k]?.shotNumber;
        if (typeof sn === 'number') shotStartMs.set(sn, clipStartMs[k] || 0);
      }

      // v12.41 口型/配音同步:变速镜(高光慢放 setpts)画面被拉伸,配音也要同比 atempo
      // (atempo 变速不变调),否则慢放镜口型变慢、配音却原速播完 = "配音没跟上口型"。
      // atempo 单次范围 [0.5,2.0],超出区间链式分解(总因子 = 各段相乘 = speed)。
      const buildAtempoChain = (speed: number): string => {
        if (!speed || speed === 1.0 || speed <= 0) return '';
        let s = speed;
        const parts: string[] = [];
        while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
        while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
        parts.push(`atempo=${s.toFixed(3)}`);
        return parts.join(',');
      };

      const voSubInputs: string[] = [];
      let voCount = 0;
      let jCutCount = 0;
      let lCutCount = 0;
      for (const [shotNumber, voPath] of localVoiceovers.entries()) {
        const startMs = shotStartMs.get(shotNumber);
        if (startMs === undefined) continue; // 找不到对应 shot,跳过

        // ── v2.12 Sprint B.1 · j-cut/l-cut 真音轨偏移 ──
        // j-cut: 上一镜 transition='j-cut' → 本镜配音提前 LEAD_MS 入,声音先到画面后切
        // l-cut: 本镜 transition='l-cut'   → 本镜配音不截断,自然延续到下一镜起始
        //         (现有代码不截断 voiceover,这里只算计数显式记日志)
        const myIdx = validClips.findIndex(c => c.shotNumber === shotNumber);
        const adjustedStartMs = computeJCutAdelay({
          clips: validClips,
          shotIndex: myIdx,
          baseStartMs: startMs,
        });
        if (adjustedStartMs < startMs) jCutCount++;
        if (myIdx >= 0 && validClips[myIdx]?.transition === 'l-cut') lCutCount++;

        cmd.input(voPath);
        const voIdx = nextInputIdx;
        nextInputIdx++;
        // adelay 需要每声道的 ms,立体声用 `startMs|startMs`
        const delay = `${adjustedStartMs}|${adjustedStartMs}`;
        const lbl = `vo${voCount}`;
        // 变速镜配音同比 atempo(在 adelay 之前),让台词跟随被拉伸/压缩的画面与口型
        const voSpeed = validClips[myIdx]?.speedMultiplier || 1.0;
        const atempoChain = buildAtempoChain(voSpeed);
        // v12.195:TTS 常见 <80Hz 底噪轰鸣 + >12kHz 数字齿音 → 带通清理(人声频段不动)
        const voEq = process.env.VOICE_EQ_DISABLE === '1' ? '' : 'highpass=f=80,lowpass=f=12000,';
        const voChain = atempoChain ? `${atempoChain},${voEq}adelay=${delay}` : `${voEq}adelay=${delay}`;
        // v12.206:句末补 120ms 静音气口,消除多角色对话「连读没换气/末字被截」的廉价感(VOICE_APAD_DISABLE=1 关)
        const voPad = process.env.VOICE_APAD_DISABLE === '1' ? '' : ',apad=pad_dur=0.12';
        filters.push(`[${voIdx}:a]${voChain},volume=${voiceoverVolume}${voPad}[${lbl}]`);
        voSubInputs.push(`[${lbl}]`);
        voCount++;
      }
      if (jCutCount > 0 || lCutCount > 0) {
        console.log(`[Composer] B.1 audio offsets applied: j-cut=${jCutCount}, l-cut=${lCutCount}`);
      }

      if (voCount > 0) {
        let voLabel: string;
        if (voCount === 1) {
          voLabel = voSubInputs[0];
        } else {
          // 多段配音先 mix 成一条
          filters.push(`${voSubInputs.join('')}amix=inputs=${voCount}:duration=longest:dropout_transition=0[vomix]`);
          voLabel = '[vomix]';
        }
        // v12.67.0 BGM 自动闪避:旁白响起 sidechain 压低 BGM,人声更清晰(BGM_DUCK_DISABLE=1 关)
        if (shouldDuck(!!localMusicPath, voCount)) {
          const duck = buildDuckingFilters('[musicvol]', voLabel);
          filters.push(...duck.filters);
          const mi = audioMixParts.indexOf('[musicvol]');
          if (mi >= 0) audioMixParts[mi] = duck.musicOut;
          audioMixParts.push(duck.voOut);
          console.log('[Composer] v12.67 BGM ducking 启用(sidechaincompress)');
        } else {
          audioMixParts.push(voLabel);
        }
        audioMixCount++;
        console.log(`[Composer] TTS: ${voCount} 段配音逐镜头对齐,偏移范围 ${Array.from(shotStartMs.values()).join('ms, ')}ms`);
      }
    }

    // v12.269:有原生音轨时先出中间标签,再以 normalize=0 叠加 → 既有电平分毫不动;
    // 无原生音轨(默认)时直接出 [outa],滤镜串与旧版逐字节一致。
    const mixOut = nativeLabel ? '[amixed]' : '[outa]';
    if (audioMixCount > 1) {
      // v2.14 P1.2: 用 [aconcat] (concat 后的视频原音, 长度 = 总视频长度) 作 master, 而不是 shortest;
      // 否则 BGM 短于视频时整段视频会被截断 — 这是用户报"成片只到一半"的根因之一
      filters.push(`${audioMixParts.join('')}amix=inputs=${audioMixCount}:duration=first:dropout_transition=2${mixOut}`);
    } else {
      filters.push(`[aconcat]anull${mixOut}`);
    }
    if (nativeLabel) {
      filters.push(`[amixed]${nativeLabel}amix=inputs=2:duration=first:normalize=0:dropout_transition=0[outa]`);
    }

    // ─── v12.13.1 打击音效层(拳拳到肉)──────────────────────────────────────────
    // 仅动作模式 + 有冲击点时:程序化合成闷响打击音(零素材),末端独立 amix(normalize=0)
    // 叠到 [outa] 上 —— 不动既有 BGM/配音平衡。任一步异常即跳过,绝不连累成片。
    // IMPACT_SFX_DISABLE=1 关闭。
    let audioOut = '[outa]';
    let sfxCount = 0;
    if (actionMode && options.impactCues?.length && process.env.IMPACT_SFX_DISABLE !== '1') {
      try {
        // v12.265:打击音效起点同样取 clipStartMs(xfade 压缩后画面起点)—— v12.264 修了配音/字幕
        // 却漏了这里:本块原是**独立的第二处** durations 纯累加,拳拳到肉的闷响会比画面上的拳头
        // 晚 Σ effectiveTd(与配音同根同量),动作片越往后越"打完才响"。
        const startMs2: Map<number, number> = new Map();
        for (let k = 0; k < n; k++) {
          const sn = validClips[k]?.shotNumber;
          if (typeof sn === 'number') startMs2.set(sn, clipStartMs[k] || 0);
        }
        const sfxLabels: string[] = [];
        for (const cue of options.impactCues) {
          const base = startMs2.get(cue.shotNumber);
          if (base === undefined) continue;
          const ci = validClips.findIndex((c) => c?.shotNumber === cue.shotNumber);
          const clipDur = ci >= 0 ? (durations[ci] || 0) : 0;
          const within = Math.max(0, Math.min(cue.atSec, Math.max(0, clipDur - 0.1)));
          const lbl = `sfx${sfxLabels.length}`;
          filters.push(impactSfxNode(base + within * 1000, cue.intensity, lbl));
          sfxLabels.push(`[${lbl}]`);
          if (sfxLabels.length >= 24) break; // 上限,防 filtergraph 过大
        }
        if (sfxLabels.length > 0) {
          let bed = sfxLabels[0];
          if (sfxLabels.length > 1) {
            filters.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:normalize=0:duration=longest[sfxbed]`);
            bed = '[sfxbed]';
          }
          // 末端独立叠加:normalize=0 → [outa] 原音量不变,打击音叠在上面
          filters.push(`[outa]${bed}amix=inputs=2:duration=first:normalize=0:dropout_transition=0[outfinal]`);
          audioOut = '[outfinal]';
          sfxCount = sfxLabels.length;
          console.log(`[Composer] v12.13.1 打击音效:${sfxCount} 记冲击音叠入`);
        }
      } catch (e) {
        console.warn('[Composer] 打击音效失败(非阻塞,跳过):', e instanceof Error ? e.message : e);
        audioOut = '[outa]';
      }
    }

    const totalDuration = cumulativeDuration;

    // v12.110.0 响度归一:最终音频过 loudnorm(-14 LUFS/-1.5 dBTP,平台标准),
    // 防成片忽大忽小被平台二压。AUDIO_LOUDNORM_DISABLE=1 关。
    if (shouldLoudnorm()) {
      filters.push(buildLoudnormFilter(audioOut, '[anorm]'));
      audioOut = '[anorm]';
      console.log('[Composer] v12.110 响度归一 -14 LUFS 启用');
    }

    cmd
      .complexFilter(filters)
      .outputOptions([
        '-map', '[vout]',
        '-map', audioOut,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', crfValue(),
        '-c:a', 'aac',
        '-b:a', audioBitrateForPlatform(options.platform),
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

        // v12.206:EBU R128 双遍精确归一(opt-in,AUDIO_LOUDNORM_2PASS=1)——就地替换成片音频
        void (async () => {
          try {
            const { shouldTwoPassLoudnorm } = await import('@/lib/audio-ducking');
            if (shouldTwoPassLoudnorm()) await applyTwoPassLoudnorm(outputPath);
          } catch (e) { console.warn('[Composer] 双遍响度归一跳过:', e instanceof Error ? e.message : e); }
        })().finally(() => resolve({
          outputPath,
          totalDuration,
          clipCount: n,
          hasMusic: !!localMusicPath,
          hasVoiceover: localVoiceovers.size > 0,
          highlights: highlightShots,
          beatEdit: beatEditInfo || undefined,
          emotionPacing: pacingInfo || undefined,
          renderedTransitions, // v12.289 成片实际转场 → 回写 timeline
        }));
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
/**
 * v12.62.0 Ken Burns 滤镜(纯函数,可测)。画幅感知:上采样画布 = 目标 4x 同比例(此前写死
 * 5120x2880+s=1280x720 → 竖屏项目兜底片会被 v12.49 画布 crop 掉 ~70% 宽,构图全毁)。
 */
export function kenBurnsFilter(
  zoomDir: 'in' | 'out' | 'pan',
  totalFrames: number,
  w: number = 1280,
  h: number = 720,
  fps: number = 24,
): string {
  let zoomExpr: string;
  let xExpr = "'iw/2-(iw/zoom/2)'";
  let yExpr = "'ih/2-(ih/zoom/2)'";
  if (zoomDir === 'in') {
    zoomExpr = `'min(zoom+0.0008,1.3)'`;
  } else if (zoomDir === 'out') {
    zoomExpr = `'if(eq(on,1),1.3,max(zoom-0.0008,1.0))'`;
  } else {
    zoomExpr = `'1.2'`;
    xExpr = `'iw*0.1+(iw*0.3)*on/${totalFrames}'`;
    yExpr = `'ih/2-(ih/zoom/2)'`;
  }
  // ── v12.283:上采样倍数按**像素预算**封顶,不再无脑 ×4 ──────────────────────
  // 为什么要上采样:zoompan 按**整数像素**步进,慢速缩放会出现肉眼可见的阶梯抖动;
  // 先放大再 zoompan,整数步长相对输出就成了亚像素,画面才顺滑。所以**不能删**。
  // 为什么要封顶:×4 是对分辨率的平方级放大。实测峰值 RSS ——
  //   竖屏 720p (→2880×5120)  180 MB
  //   竖屏 1080p(→4320×7680)  391 MB
  // 按像素外推竖屏 4K(→8640×15360)约 1.5 GB,小内存容器上是真 OOM 风险。
  // 折中:以「当前 720p 档的上采样像素数」为预算,倍数 = clamp(sqrt(预算/原像素), 2, 4)。
  //   720p  → 4(与旧版**逐字节一致**,最常用档零回归)
  //   1080p → 2(内存约降到原来的 1/4)
  //   4K    → 2(仍高于预算但保底 2× 以维持亚像素平滑,不为省内存牺牲画质下限)
  const UPSCALE_PIXEL_BUDGET = 2880 * 5120; // ≈14.7 MPix,即现行 720p 档的上采样规模
  const srcPixels = Math.max(1, w * h);
  const factor = Math.max(2, Math.min(4, Math.floor(Math.sqrt(UPSCALE_PIXEL_BUDGET / srcPixels))));
  const uw = w * factor;
  const uh = h * factor;
  return [
    `scale=${uw}:${uh}:force_original_aspect_ratio=increase`,
    `crop=${uw}:${uh}`,
    `zoompan=z=${zoomExpr}:x=${xExpr}:y=${yExpr}:d=${totalFrames}:s=${w}x${h}:fps=${fps}`,
    `format=yuv420p`,
  ].join(',');
}

/**
 * v12.206:成片 EBU R128 双遍精确归一(就地替换)。第一遍测 measured 值,第二遍 linear 应用。
 * 拿不到测量值或第二遍失败 → 保留原文件(单遍已归过一次,不倒退)。返回是否真做了二遍。
 */
export async function applyTwoPassLoudnorm(inputPath: string): Promise<boolean> {
  const ff = resolvedFFmpegPath;
  const { buildLoudnormMeasureFilter, parseLoudnormJson, buildLoudnormApplyFilter } = await import('@/lib/audio-ducking');
  // 第一遍:测量(-f null,读 stderr JSON)
  let stderr = '';
  try {
    await sh$(`"${ff}" -hide_banner -i "${inputPath}" -af "${buildLoudnormMeasureFilter()}" -f null - 2>"${inputPath}.ln.log"`);
  } catch { /* -f null 正常退出码非 0 也无妨,日志已落 */ }
  try { stderr = fs.readFileSync(`${inputPath}.ln.log`, 'utf-8'); } catch { /* ignore */ }
  try { fs.unlinkSync(`${inputPath}.ln.log`); } catch { /* ignore */ }
  const measured = parseLoudnormJson(stderr);
  if (!measured) { console.warn('[Loudnorm-2pass] 测量值解析失败,保留单遍结果'); return false; }
  // 第二遍:linear 应用(视频流 copy,只重编码音频)
  const tmp = `${inputPath}.2pass.mp4`;
  try {
    await sh$(`"${ff}" -y -hide_banner -v error -i "${inputPath}" -af "${buildLoudnormApplyFilter(measured)}" -c:v copy -c:a aac -movflags +faststart "${tmp}"`);
    fs.renameSync(tmp, inputPath);
    console.log(`[Loudnorm-2pass] EBU R128 双遍归一完成(measured_I=${measured.input_i})`);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    console.warn('[Loudnorm-2pass] 第二遍失败,保留单遍结果:', e instanceof Error ? e.message.slice(0, 80) : e);
    return false;
  }
}

export async function stillFrameToVideo(
  imageUrl: string,
  duration: number = 8,
  outputDir?: string,
  zoomDir: 'in' | 'out' | 'pan' = 'in',
  dims?: { w: number; h: number },
): Promise<string> {
  if (!imageUrl) throw new Error('stillFrameToVideo: empty imageUrl');

  const tmpDir = outputDir || path.join(os.tmpdir(), `qf-animatic-${Date.now()}`);
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. 下载/解码图片到本地
  let localImage: string;
  if (imageUrl.startsWith('/api/serve-file')) {
    // 从 /api/serve-file 提取本地路径:?path= 直解;?key= 走 storage 注册表(v12.154:
    // persistAsset 洗过的 URL 只有 key,此前这里直接 throw → Ken Burns 末档也失败)
    try {
      const u = new URL(imageUrl, 'http://localhost');
      let lp = decodeURIComponent(u.searchParams.get('path') || '');
      if (!lp) {
        const key = u.searchParams.get('key');
        if (key) {
          const { resolveByKey } = require('@/lib/asset-storage') as typeof import('@/lib/asset-storage');
          lp = resolveByKey(key)?.absPath || '';
        }
      }
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
  // v12.62.0:画幅感知 Ken Burns(纯函数 kenBurnsFilter;dims 缺省 1280x720 = 旧行为)
  const vf = kenBurnsFilter(zoomDir, totalFrames, dims?.w ?? 1280, dims?.h ?? 720, fps);

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
        '-crf', crfValue(),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', audioBitrateForPlatform(undefined),
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

  // v2.18.1: 持久化输出 (同 composeVideo 修复) — concat fallback 输出也写持久 dir
  const persistentOutputDir = path.join(process.cwd(), 'data', 'composed');
  if (!fs.existsSync(persistentOutputDir)) {
    fs.mkdirSync(persistentOutputDir, { recursive: true });
  }
  const outputPath = path.join(persistentOutputDir, `concat-${Date.now()}.mp4`);

  // 先下载 BGM (如提供)
  // v2.16 P1.1: 同时支持 http URL 和内部 /api/serve-file 路径 (BGM 三幕拼接产物)
  let localMusicPath = '';
  if (musicUrl && (/^https?:/.test(musicUrl) || musicUrl.startsWith('/api/serve-file'))) {
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
