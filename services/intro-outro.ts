/**
 * services/intro-outro — Sprint B.4 片头 / 片尾自动生成
 *
 * 职责:
 *   · 给一个项目元数据(标题 / cover / 角色 roster), 拼出
 *     - intro.mp4: 1.5s 封面图 + 标题 + "by Wind Comic" 淡入
 *     - outro.mp4: 2.0s "Made by Wind Comic" + 角色 roster 平移
 *   · 用 ffmpeg drawtext + scale + 静音音轨, 不用预设动画文件
 *
 * 不做的事:
 *   · 不直接调用 composeVideo —— 上层(orchestrator / export 路由) 拿到 intro/outro 路径后,
 *     在 concat 列表里前后塞两段, 让 composer 把它们和正片一起 concat
 *   · 不烧入字体文件依赖 —— 缺 fontFile 时让 ffmpeg 用系统默认字体
 *
 * 决策:
 *   · 时长固定 (1.5s intro / 2.0s outro) — 太长用户会跳过, 太短读不清字
 *   · 片头封面 = 项目第一张分镜图 (orchestrator 已经持久化, 路径直接传进来)
 *   · 片尾文案统一 "Made by Wind Comic" + 项目标题, 不让用户自定义(开源项目宣发)
 *
 * 字段全用 export, 给单测和 export 路由直接消费。
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const INTRO_DURATION_S = 1.5;
export const OUTRO_DURATION_S = 2.0;
export const INTRO_OUTRO_RESOLUTION = { width: 1920, height: 1080 };
export const INTRO_OUTRO_FPS = 24;

export interface IntroOutroOptions {
  /** 项目标题 */
  title: string;
  /** 用作 intro 背景的封面图本地路径(必须 ffmpeg 能直接读) */
  coverImagePath?: string;
  /** 角色 roster — outro 平移列表 */
  characters?: Array<{ name: string; role?: string }>;
  /** 字体文件路径 (ttf/otf), 缺省让 ffmpeg 用 fallback */
  fontFile?: string;
  /** 输出目录, 默认 os.tmpdir() */
  outputDir?: string;
  /** 自定义 brand 名, 默认 "Wind Comic" */
  brand?: string;
}

export interface IntroOutroResult {
  introPath: string;
  outroPath: string;
  introDuration: number;
  outroDuration: number;
}

/** 用 drawtext escape:转义 : ' \\ % */
export function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * 构建 intro 段的 ffmpeg complexFilter 字符串数组.
 * 输入:[0:v] = 封面图(或纯黑 color 源)
 * 输出:[vout][aout]
 */
export function buildIntroFilters(opts: {
  title: string;
  brand: string;
  fontFile?: string;
  duration?: number;
  hasCover: boolean;
}): string[] {
  const { title, brand, fontFile, hasCover } = opts;
  const dur = opts.duration ?? INTRO_DURATION_S;
  const safeTitle = escapeDrawtextText(title);
  const safeBrand = escapeDrawtextText(`by ${brand}`);
  const fontPart = fontFile ? `:fontfile='${fontFile}'` : '';

  // 标题: 中央, 0~0.6s 淡入, 0.6~dur 全显, 全程 white
  const titleFade =
    `if(lt(t\\,0.6)\\,t/0.6\\,1)`;

  // brand: 标题下方, 0.4s 后出来, 淡入到 1
  const brandFade =
    `if(lt(t\\,0.4)\\,0\\,if(lt(t\\,1.0)\\,(t-0.4)/0.6\\,1))`;

  const filters: string[] = [];
  if (hasCover) {
    // 把封面 scale 填满 1920x1080, 加暗化遮罩, 再叠 drawtext
    filters.push(
      `[0:v]scale=${INTRO_OUTRO_RESOLUTION.width}:${INTRO_OUTRO_RESOLUTION.height}:force_original_aspect_ratio=increase,crop=${INTRO_OUTRO_RESOLUTION.width}:${INTRO_OUTRO_RESOLUTION.height},setsar=1,fps=${INTRO_OUTRO_FPS},trim=duration=${dur},setpts=PTS-STARTPTS[bg]`,
    );
    filters.push(
      `[bg]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill[bgdim]`,
    );
  } else {
    // 没 cover → 用纯黑 color 源
    filters.push(
      `color=c=black:s=${INTRO_OUTRO_RESOLUTION.width}x${INTRO_OUTRO_RESOLUTION.height}:r=${INTRO_OUTRO_FPS}:d=${dur}[bgdim]`,
    );
  }
  filters.push(
    `[bgdim]drawtext=text='${safeTitle}':fontsize=72:fontcolor=white${fontPart}:x=(w-text_w)/2:y=(h-text_h)/2-30:alpha='${titleFade}'[t1]`,
  );
  filters.push(
    `[t1]drawtext=text='${safeBrand}':fontsize=28:fontcolor=#E8C547${fontPart}:x=(w-text_w)/2:y=(h-text_h)/2+60:alpha='${brandFade}'[vout]`,
  );
  // 静音音轨
  filters.push(
    `anullsrc=r=44100:cl=stereo,atrim=0:${dur}[aout]`,
  );
  return filters;
}

/**
 * 构建 outro 段的 filters.
 * 输入: 无视频源(纯黑 color 源)
 * 输出: [vout][aout]
 */
export function buildOutroFilters(opts: {
  title: string;
  brand: string;
  characters: Array<{ name: string; role?: string }>;
  fontFile?: string;
  duration?: number;
}): string[] {
  const { title, brand, characters, fontFile } = opts;
  const dur = opts.duration ?? OUTRO_DURATION_S;
  const safeBrand = escapeDrawtextText(`Made by ${brand}`);
  const safeTitle = escapeDrawtextText(`「${title}」`);
  const fontPart = fontFile ? `:fontfile='${fontFile}'` : '';

  const filters: string[] = [];
  filters.push(
    `color=c=black:s=${INTRO_OUTRO_RESOLUTION.width}x${INTRO_OUTRO_RESOLUTION.height}:r=${INTRO_OUTRO_FPS}:d=${dur}[bg]`,
  );

  // brand 居中, 全程显示
  filters.push(
    `[bg]drawtext=text='${safeBrand}':fontsize=64:fontcolor=#E8C547${fontPart}:x=(w-text_w)/2:y=(h-text_h)/2-60[t1]`,
  );
  // title 在 brand 下方, 0.3s 后淡入
  const titleFade = `if(lt(t\\,0.3)\\,0\\,if(lt(t\\,0.9)\\,(t-0.3)/0.6\\,1))`;
  filters.push(
    `[t1]drawtext=text='${safeTitle}':fontsize=36:fontcolor=white${fontPart}:x=(w-text_w)/2:y=(h-text_h)/2+20:alpha='${titleFade}'[t2]`,
  );

  // 角色 roster — 逗号拼成单行, 距底 80px
  let prevLabel = 't2';
  if (characters.length > 0) {
    const rosterLine = escapeDrawtextText(
      characters.slice(0, 6).map(c => c.name).join('  ·  '),
    );
    const rosterFade = `if(lt(t\\,0.8)\\,0\\,if(lt(t\\,1.4)\\,(t-0.8)/0.6\\,1))`;
    filters.push(
      `[${prevLabel}]drawtext=text='${rosterLine}':fontsize=28:fontcolor=white@0.85${fontPart}:x=(w-text_w)/2:y=h-th-80:alpha='${rosterFade}'[t3]`,
    );
    prevLabel = 't3';
  }
  filters.push(`[${prevLabel}]copy[vout]`);
  filters.push(
    `anullsrc=r=44100:cl=stereo,atrim=0:${dur}[aout]`,
  );
  return filters;
}

/**
 * 主入口:并行生成 intro.mp4 + outro.mp4. 返回两个路径.
 *
 * 失败 -> reject. 调用方可以选择"intro/outro 失败就跳过"(不影响正片合成).
 */
export async function generateIntroOutro(opts: IntroOutroOptions): Promise<IntroOutroResult> {
  const brand = opts.brand || 'Wind Comic';
  const outDir = opts.outputDir || path.join(os.tmpdir(), `wc-intro-outro-${Date.now()}`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const introPath = path.join(outDir, 'intro.mp4');
  const outroPath = path.join(outDir, 'outro.mp4');

  await Promise.all([
    runFfmpeg({
      input: opts.coverImagePath,
      filters: buildIntroFilters({
        title: opts.title,
        brand,
        fontFile: opts.fontFile,
        duration: INTRO_DURATION_S,
        hasCover: !!opts.coverImagePath,
      }),
      output: introPath,
    }),
    runFfmpeg({
      input: undefined,
      filters: buildOutroFilters({
        title: opts.title,
        brand,
        characters: opts.characters || [],
        fontFile: opts.fontFile,
        duration: OUTRO_DURATION_S,
      }),
      output: outroPath,
    }),
  ]);

  return {
    introPath,
    outroPath,
    introDuration: INTRO_DURATION_S,
    outroDuration: OUTRO_DURATION_S,
  };
}

function runFfmpeg(opts: {
  input?: string;
  filters: string[];
  output: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    if (opts.input) {
      cmd.input(opts.input).inputOptions(['-loop', '1']);
    }
    cmd
      .complexFilter(opts.filters)
      .outputOptions([
        '-map', '[vout]',
        '-map', '[aout]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
      ])
      .output(opts.output)
      .on('end', () => resolve())
      .on('error', (e) => reject(e))
      .run();
  });
}
