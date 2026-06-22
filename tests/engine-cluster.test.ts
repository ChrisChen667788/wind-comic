/**
 * 阶段二十七 P0b+P0c — 引擎前沿对齐:Seedance 映射 + LTX 适配纯函数单测。
 * 不打网络;无 key 也能跑(BYO,失败由 registry fallback)。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSeedanceOptionsFromInput,
  nearestSeedanceDuration,
} from '@/services/seedance.service';
import {
  buildLtxRequestBody,
  parseLtxResult,
  ltxModelFor,
  hasLtx,
} from '@/services/ltx.service';

describe('nearestSeedanceDuration', () => {
  it('夹到最近合法档(4/5/8/10/15)', () => {
    expect(nearestSeedanceDuration(undefined)).toBe(5);
    expect(nearestSeedanceDuration(6)).toBe(5);
    expect(nearestSeedanceDuration(7)).toBe(8);
    expect(nearestSeedanceDuration(99)).toBe(15);
    expect(nearestSeedanceDuration(1)).toBe(4);
  });
});

describe('buildSeedanceOptionsFromInput', () => {
  it('参考图优先级:角色 → 首帧 → 通用,去重限 9', () => {
    const o = buildSeedanceOptionsFromInput({
      prompt: 'p',
      firstFrameUrl: 'https://ff',
      subjectReferences: [{ imageUrl: 'https://char1' }, { imageUrl: 'https://char1' }, { imageUrl: 'data:bad' } as any],
      referenceImages: ['https://scene', 'https://ff'],
    });
    expect(o.referenceImages).toEqual(['https://char1', 'https://ff', 'https://scene']);
    expect(o.prompt).toBe('p');
    expect(o.resolution).toBe('720p');
  });

  it('纯 T2V:无任何参考图 → 不带 referenceImages', () => {
    const o = buildSeedanceOptionsFromInput({ prompt: 'p' });
    expect(o.referenceImages).toBeUndefined();
  });

  it('aspectRatio 仅取 Seedance 支持枚举', () => {
    expect(buildSeedanceOptionsFromInput({ prompt: 'p', aspectRatio: '9:16' }).aspectRatio).toBe('9:16');
    expect(buildSeedanceOptionsFromInput({ prompt: 'p', aspectRatio: '21:9' as any }).aspectRatio).toBeUndefined();
  });

  it('nativeAudio 默认不开(P0b 避免双音轨)', () => {
    expect(buildSeedanceOptionsFromInput({ prompt: 'p' }).nativeAudio).toBeUndefined();
  });
});

describe('ltxModelFor', () => {
  it('有 http 首帧 → i2v 模型,否则 t2v', () => {
    expect(ltxModelFor('https://x.jpg')).toMatch(/image-to-video/);
    expect(ltxModelFor(undefined)).toMatch(/text-to-video/);
    expect(ltxModelFor('data:bad')).toMatch(/text-to-video/);
  });
});

describe('buildLtxRequestBody', () => {
  it('I2V 带 image_url;duration 夹 [1,20];aspect 校验;默认 1080p + enhance', () => {
    const b = buildLtxRequestBody('https://x.jpg', 'p', { duration: 99, aspectRatio: '9:16' });
    expect(b.image_url).toBe('https://x.jpg');
    expect(b.duration).toBe(20);
    expect(b.aspect_ratio).toBe('9:16');
    expect(b.resolution).toBe('1080p');
    expect(b.enhance_prompt).toBe(true);
  });
  it('T2V 无 image_url;非法 aspect 省略', () => {
    const b = buildLtxRequestBody(undefined, 'p', { aspectRatio: '7:1' });
    expect(b.image_url).toBeUndefined();
    expect(b.aspect_ratio).toBeUndefined();
  });
});

describe('parseLtxResult', () => {
  it('多种字段位置都能取到 url', () => {
    expect(parseLtxResult({ video: { url: 'https://a.mp4' } }).url).toBe('https://a.mp4');
    expect(parseLtxResult({ output: { video: { url: 'https://b.mp4' } } }).url).toBe('https://b.mp4');
    expect(parseLtxResult({ videos: [{ url: 'https://c.mp4' }] }).url).toBe('https://c.mp4');
  });
  it('缺 url → throw', () => {
    expect(() => parseLtxResult({})).toThrow(/no video url/);
  });
});

describe('hasLtx', () => {
  it('无 LTX_API_KEY / FAL_KEY → false(零回归)', () => {
    const saved = { l: process.env.LTX_API_KEY, f: process.env.FAL_KEY };
    delete process.env.LTX_API_KEY;
    delete process.env.FAL_KEY;
    expect(hasLtx()).toBe(false);
    if (saved.l) process.env.LTX_API_KEY = saved.l;
    if (saved.f) process.env.FAL_KEY = saved.f;
  });
});
