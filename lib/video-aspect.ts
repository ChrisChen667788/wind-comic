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

/**
 * v12.468:项目画幅能选的只有视频引擎真出得了的这三种。创建页、故事模板、分镜整张重生 / 九宫格候选
 * 两个弹窗的画幅选项都从这里取,不再各写一份。修前它们各自多给了一个 2.35:1:编排器 `setAspect`
 * 只认整数比,把它拒掉、按默认 16:9 出(漫剧题材还会再被翻成 9:16),项目行却记着 2.35:1。
 */
export const PROJECT_ASPECTS: readonly VideoAspect[] = ['9:16', '16:9', '1:1'];

export function isProjectAspect(a: unknown): a is VideoAspect {
  return typeof a === 'string' && (PROJECT_ASPECTS as readonly string[]).includes(a);
}

/**
 * v12.468:请求里带来的画幅 → 实际出片画幅。没给 / 不是 `W:H` 形式 → null(调用方按「没指定」处理)。
 * 给了引擎出不了的比例(2.35:1、21:9、4:3…)→ 按横竖就近归到三种之一,**仍算用户指定**:
 * 要宽银幕的人拿到 16:9,比被题材默认翻成 9:16 更接近本意。
 */
export function parseRequestedAspect(a: unknown): VideoAspect | null {
  if (typeof a !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(a);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0)) return null;
  if (w === h) return '1:1';
  return w > h ? '16:9' : '9:16';
}
