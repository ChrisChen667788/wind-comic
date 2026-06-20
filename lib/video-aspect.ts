/**
 * 视频横竖屏规则(v12.14.0)。
 *
 * 病根:项目设 9:16(竖屏短剧)但成片出 16:9 —— 图像生成已吃 `this.aspect`(首帧是 9:16),
 * 但**视频引擎调用没传 aspectRatio**:Veo 默认 size=1280x720(16:9)、Kling/Minimax 也没收到比例,
 * 于是即便首帧竖屏,引擎仍按 16:9 出片(裁/补成横屏)。本模块统一比例规范化 + 引擎 size 映射。
 */

export type VideoAspect = '16:9' | '9:16' | '1:1';

/** 项目任意比例 → 视频引擎支持的三种之一(其它如 2.35:1 就近归 16:9)。 */
export function normalizeVideoAspect(a?: string | null): VideoAspect {
  const s = (a || '').trim();
  if (s === '9:16') return '9:16';
  if (s === '1:1') return '1:1';
  return '16:9';
}

/** Veo / Sora 的 `size` 串(WxH)。竖屏 720x1280、方 1024、横屏 1280x720。 */
export function veoSizeFromAspect(a?: string | null): string {
  switch (normalizeVideoAspect(a)) {
    case '9:16': return '720x1280';
    case '1:1': return '1024x1024';
    default: return '1280x720';
  }
}

/** 是否竖屏(便于日志/分支)。 */
export function isVerticalAspect(a?: string | null): boolean {
  return normalizeVideoAspect(a) === '9:16';
}
