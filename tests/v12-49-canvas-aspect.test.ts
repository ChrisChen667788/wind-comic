/**
 * v12.49 — 成片画布按项目画幅(修竖屏 bug)。
 * 病根:video-composer 每镜预处理硬编码 `scale=1280:720,pad=1280:720` → 任何比例成片都被合成成 16:9,
 * 竖屏(9:16)项目实测出片仍是 1280×720 横屏(实测精华水广告应竖屏却出横屏)。
 * 修:buildCanvasFit(aspect) 按画幅取尺寸 + 适配滤镜,composer 用它替换硬编码。
 *
 * 关键回归锁:16:9 必须与旧硬编码字符串逐字符一致 → 横屏链路零回归。
 */
import { describe, it, expect } from 'vitest';
import { buildCanvasFit, dimsForAspect } from '@/lib/video-reframe';

describe('v12.49 · buildCanvasFit — 成片画布按画幅', () => {
  it('16:9 与旧硬编码逐字符一致(横屏零回归)', () => {
    const { fit, w, h } = buildCanvasFit('16:9');
    expect(w).toBe(1280);
    expect(h).toBe(720);
    // 旧 composer 写死的就是这一串(去掉 trim/setpts/fps/setsar 外壳后的画布段)
    expect(fit).toBe('scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2');
  });

  it('缺省/未知画幅兜底 16:9(与旧行为一致)', () => {
    expect(buildCanvasFit('').fit).toBe(buildCanvasFit('16:9').fit);
    expect(buildCanvasFit('2.35:1').fit).toBe(buildCanvasFit('16:9').fit); // 非三种之一就近归 16:9
  });

  it('9:16 竖屏 → 720×1280 且放大裁满(crop,非黑边)', () => {
    const { fit, w, h } = buildCanvasFit('9:16');
    expect(w).toBe(720);
    expect(h).toBe(1280);
    expect(fit).toBe('scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280');
    expect(fit).not.toContain('pad='); // 竖屏不留黑边
  });

  it('1:1 方屏 → 1024×1024 缩入补边(w==h 不算竖屏,走 pad 零损失)', () => {
    const { fit, w, h } = buildCanvasFit('1:1');
    expect(w).toBe(1024);
    expect(h).toBe(1024);
    expect(fit).toContain('pad=1024:1024');
  });

  it('竖屏判定只认 h>w —— 与 dimsForAspect 同口径', () => {
    for (const a of ['16:9', '9:16', '1:1']) {
      const d = dimsForAspect(a);
      const isVertical = d.h > d.w;
      expect(buildCanvasFit(a).fit.includes('crop=')).toBe(isVertical);
    }
  });
});
