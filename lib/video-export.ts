/**
 * v3.5 — 视频导出预设 (横竖屏转换 + 动图格式).
 *
 * 解决"成片出来是 16:9, 但抖音/小红书要 9:16 竖屏"的最后一公里. 纯函数生成
 * ffmpeg filter / arg, 真正 spawn 留在 services/video-composer.
 *
 * 单测: tests/v3-5-video-export.test.ts.
 */

export type ExportAspect = '16:9' | '9:16' | '1:1' | '4:5';
export type FitMode = 'contain' | 'cover' | 'blur-pad';

/** 各平台目标分辨率 (宽 × 高). 竖屏短视频默认 1080×1920. */
export const ASPECT_DIMENSIONS: Record<ExportAspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }, // 小红书 / IG 竖图
};

export interface AspectFilterInput {
  targetAspect: ExportAspect;
  /** contain: 留黑边; cover: 裁切充满; blur-pad: 模糊背景填充 (短视频最常用). */
  fit: FitMode;
  /** 覆盖默认分辨率 (可选). */
  width?: number;
  height?: number;
}

export interface AspectFilterResult {
  /** 简单 -vf 串 (contain / cover 用). */
  vf?: string;
  /** 复杂滤镜链 (blur-pad 用, 走 -filter_complex). */
  filterComplex?: string;
  /** 最终输出分辨率. */
  width: number;
  height: number;
}

/**
 * 生成横竖屏转换 filter.
 *   contain  → 等比缩放进框 + 黑边 pad (不裁画面, 但有黑边)
 *   cover    → 等比放大充满 + 居中裁切 (无黑边, 但裁掉边缘)
 *   blur-pad → 等比缩放进框 + 同源放大模糊垫底 (无黑边不裁画面, 短视频标配)
 */
export function buildAspectFilter(input: AspectFilterInput): AspectFilterResult {
  const dim = ASPECT_DIMENSIONS[input.targetAspect];
  const W = input.width ?? dim.width;
  const H = input.height ?? dim.height;

  if (input.fit === 'contain') {
    return {
      vf: `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,
      width: W,
      height: H,
    };
  }
  if (input.fit === 'cover') {
    return {
      vf: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
      width: W,
      height: H,
    };
  }
  // blur-pad: 背景 = 同源放大充满 + 高斯模糊; 前景 = 等比缩放进框; overlay 居中
  const filterComplex =
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=20[bgblur];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgscaled];` +
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2`;
  return { filterComplex, width: W, height: H };
}

// ─── 动图格式 (gif / webp / avif) ───────────────────────────────────────────

export type AnimFormat = 'gif' | 'webp' | 'avif';

export interface AnimFormatInput {
  format: AnimFormat;
  fps?: number;
  width?: number;
  /** webp/avif 质量 0-100, 越大越清越大. 默认 75. */
  quality?: number;
}

export interface AnimFormatPlan {
  ext: string;
  /** 是否需要先 palette (只有 gif 需要 2-pass). */
  needsPalette: boolean;
  /** 单 pass 编码的 ffmpeg args 尾段 (输入 -i 之后的部分, 不含输入/输出文件). webp/avif 用. */
  encodeArgs: string[];
}

const clampInt = (n: number | undefined, lo: number, hi: number, dflt: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : dflt;
  return Math.max(lo, Math.min(hi, v));
};

/**
 * 给定动图格式, 返回扩展名 + 编码计划.
 *   gif  → 走 lib/gif-pipeline 的 palette 2-pass (这里只标 needsPalette)
 *   webp → libwebp_anim, 体积比 gif 小很多, 现代浏览器都支持
 *   avif → libaom-av1 序列, 最小体积, 支持度次于 webp
 */
export function animFormatPlan(input: AnimFormatInput): AnimFormatPlan {
  const fps = clampInt(input.fps, 1, 60, 10);
  const width = clampInt(input.width, 64, 4096, 960);
  const quality = clampInt(input.quality, 0, 100, 75);

  if (input.format === 'gif') {
    return { ext: '.gif', needsPalette: true, encodeArgs: [] };
  }
  if (input.format === 'webp') {
    return {
      ext: '.webp',
      needsPalette: false,
      encodeArgs: [
        '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
        '-c:v', 'libwebp_anim',
        '-lossless', '0',
        '-q:v', String(quality),
        '-loop', '0',
        '-an',
      ],
    };
  }
  // avif
  return {
    ext: '.avif',
    needsPalette: false,
    encodeArgs: [
      '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos`,
      '-c:v', 'libaom-av1',
      // avif 的 crf 越小越清; 把 quality(0-100) 反映射到 crf(63-0)
      '-crf', String(Math.round((100 - quality) * 0.63)),
      '-b:v', '0',
      '-loop', '0',
      '-an',
    ],
  };
}
