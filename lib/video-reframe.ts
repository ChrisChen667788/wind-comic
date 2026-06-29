/**
 * 双版本重构图(Phase 3 · v12.16.0)。
 *
 * 一次生成 → 两版出片:把成片从主比例(如 9:16 竖屏)重构图成另一比例(16:9 横屏),
 * 无需把每镜重生一遍(省 2x 成本/时间)。两种模式:
 *   - blur-pad(默认,无内容损失):内容居中 + 模糊放大副本填边(短剧/竖屏转横屏常用)
 *   - crop(填满,损边):放大裁切到目标框(横屏转竖屏放大冲击力时用)
 *
 * 纯函数只产 ffmpeg filter_complex 字符串 + 目标尺寸;真正跑 ffmpeg 在 video-composer.reframeVideo。
 */

import { normalizeVideoAspect, type VideoAspect } from '@/lib/video-aspect';

export type ReframeMode = 'blur-pad' | 'crop';

/** 目标比例 → 输出像素尺寸(与 veoSizeFromAspect 同口径)。 */
export function dimsForAspect(a: string): { w: number; h: number } {
  switch (normalizeVideoAspect(a)) {
    case '9:16': return { w: 720, h: 1280 };
    case '1:1': return { w: 1024, h: 1024 };
    default: return { w: 1280, h: 720 };
  }
}

/**
 * 重构图 filter_complex(输出标签 [vout])。
 * blur-pad:背景 = 放大裁满 + 高斯模糊;前景 = 等比缩入;居中叠加。
 * crop:放大到「increase」再中心裁到目标框。
 */
export function buildReframeFilterComplex(target: VideoAspect | string, mode: ReframeMode = 'blur-pad'): {
  filter: string; w: number; h: number;
} {
  const { w, h } = dimsForAspect(target);
  if (mode === 'crop') {
    const filter = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[vout]`;
    return { filter, w, h };
  }
  // blur-pad
  const bg = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=20[bg]`;
  const fg = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`;
  const out = `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vout]`;
  return { filter: `${bg};${fg};${out}`, w, h };
}

/**
 * v12.49.0 合成画布适配片段(无输入/输出标签,内联拼在 `[i:v]trim=...,setpts=...,` 与
 * `,fps=24,setsar=1` 之间)。修 composer 此前硬编码 `scale=1280:720,pad=1280:720` 致**任何比例
 * 的成片都被合成成 16:9**(竖屏项目 9:16 出片仍 1280×720 横屏)的根因。
 *
 *  - 横屏/方(w>=h):`decrease + pad` —— 等比缩入 + 居中补边,零内容损失。
 *    当 aspect='16:9' → `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2`,
 *    与旧硬编码逐字符一致 → 横屏链路零回归。
 *  - 竖屏(h>w):`increase + crop` —— 放大裁满竖框(源片多为引擎出的 16:9,裁两侧填满竖屏,
 *    主体居中的广告/短剧更显专业,优于黑边 letterbox)。
 */
export function buildCanvasFit(aspect: string): { fit: string; w: number; h: number } {
  const { w, h } = dimsForAspect(aspect);
  const fit = h > w
    ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
    : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
  return { fit, w, h };
}
