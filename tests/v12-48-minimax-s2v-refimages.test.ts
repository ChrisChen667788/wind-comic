/**
 * v12.48 — minimax 原生视频 S2V-01 参数 bug 修复回归。
 * S2V-01 与 first_frame_image 互斥(API 报 "model S2V-01 and param 'first_frame_image'
 * are mutually exclusive"),此前 generateVideoS2V 给 body 传了 first_frame_image → 每次报错、
 * Veo 503 后的 minimax 原生兜底链断掉。修:首帧图改进 reference_images(buildS2VRefImages)。
 */
import { describe, it, expect } from 'vitest';
import { buildS2VRefImages } from '@/services/minimax.service';

describe('v12.48 · buildS2VRefImages — 首帧改进 reference_images(与 first_frame_image 互斥)', () => {
  it('首帧图作为参考图首位带上(不丢)', () => {
    expect(buildS2VRefImages('https://x/ff.jpg', [])).toEqual(['https://x/ff.jpg']);
  });

  it('与额外参考图合并,首帧在前', () => {
    expect(buildS2VRefImages('https://x/ff.jpg', ['https://x/r1.jpg', 'https://x/r2.jpg']))
      .toEqual(['https://x/ff.jpg', 'https://x/r1.jpg', 'https://x/r2.jpg']);
  });

  it('去重(首帧与某参考图相同不重复)', () => {
    expect(buildS2VRefImages('https://x/a.jpg', ['https://x/a.jpg', 'https://x/b.jpg']))
      .toEqual(['https://x/a.jpg', 'https://x/b.jpg']);
  });

  it('过滤非 http(data:/相对/空)', () => {
    expect(buildS2VRefImages('data:image/png;base64,xxx', ['/api/serve-file?k=1', '', 'https://x/ok.jpg']))
      .toEqual(['https://x/ok.jpg']);
  });

  it('上限 3 张', () => {
    expect(buildS2VRefImages('https://x/0.jpg', ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg']).length).toBe(3);
  });

  it('无任何 http 图 → 空数组(body 不带 reference_images,且绝不带 first_frame_image)', () => {
    expect(buildS2VRefImages(undefined, undefined)).toEqual([]);
    expect(buildS2VRefImages('', ['data:x'])).toEqual([]);
  });
});
