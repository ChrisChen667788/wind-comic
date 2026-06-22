/**
 * 阶段二十七 P0a — Grok Imagine 适配纯函数单测(请求体构造 / 轮询解析)。
 * 不打网络:只验证契约映射,无 key 也能跑(BYO 失败由 registry fallback)。
 */
import { describe, expect, it } from 'vitest';
import {
  buildGrokRequestBody,
  parseGrokPollResponse,
  hasGrokImagine,
} from '@/services/grok-imagine.service';

describe('buildGrokRequestBody', () => {
  it('I2V: http 首帧 → image 字段', () => {
    const b = buildGrokRequestBody('https://x/y.jpg', 'a cat', {}, 'grok-imagine-video');
    expect(b.image).toBe('https://x/y.jpg');
    expect(b.model).toBe('grok-imagine-video');
    expect(b.prompt).toBe('a cat');
  });

  it('T2V: 无首帧(或非 http)→ 不带 image', () => {
    expect(buildGrokRequestBody(undefined, 'p').image).toBeUndefined();
    expect(buildGrokRequestBody('data:image/png;base64,xx', 'p').image).toBeUndefined();
  });

  it('duration 夹到 [1,15] 并取整', () => {
    expect(buildGrokRequestBody(undefined, 'p', { duration: 99 }).duration).toBe(15);
    expect(buildGrokRequestBody(undefined, 'p', { duration: 0 }).duration).toBe(1);
    expect(buildGrokRequestBody(undefined, 'p', { duration: 6.4 }).duration).toBe(6);
    expect(buildGrokRequestBody(undefined, 'p', {}).duration).toBe(5); // 默认
  });

  it('aspect_ratio 仅接受支持枚举,否则省略', () => {
    expect(buildGrokRequestBody(undefined, 'p', { aspectRatio: '9:16' }).aspect_ratio).toBe('9:16');
    expect(buildGrokRequestBody(undefined, 'p', { aspectRatio: '21:9' }).aspect_ratio).toBeUndefined();
  });

  it('reference_images 过滤非 http + 限 4 张', () => {
    const refs = ['https://a', 'data:bad', 'https://b', 'https://c', 'https://d', 'https://e'];
    const b = buildGrokRequestBody(undefined, 'p', { referenceImages: refs });
    expect(b.reference_images).toEqual(['https://a', 'https://b', 'https://c', 'https://d']);
  });

  it('resolution 默认 720p,可覆盖', () => {
    expect(buildGrokRequestBody(undefined, 'p').resolution).toBe('720p');
    expect(buildGrokRequestBody(undefined, 'p', { resolution: '480p' }).resolution).toBe('480p');
  });
});

describe('parseGrokPollResponse', () => {
  it('done → {done:true,url,durationSec}', () => {
    const o = parseGrokPollResponse({ status: 'done', video: { url: 'https://v/a.mp4', duration: 8 } });
    expect(o).toEqual({ done: true, url: 'https://v/a.mp4', durationSec: 8 });
  });

  it('pending → {done:false}', () => {
    expect(parseGrokPollResponse({ status: 'pending' })).toEqual({ done: false });
    expect(parseGrokPollResponse({})).toEqual({ done: false });
  });

  it('failed / expired → throw', () => {
    expect(() => parseGrokPollResponse({ status: 'failed', error: { message: 'nsfw' } })).toThrow(/nsfw/);
    expect(() => parseGrokPollResponse({ status: 'expired' })).toThrow(/expired/);
  });

  it('done 但缺 url → throw', () => {
    expect(() => parseGrokPollResponse({ status: 'done', video: {} })).toThrow(/no video\.url/);
  });
});

describe('hasGrokImagine', () => {
  it('无 key 时为 false(本环境零回归)', () => {
    const saved = { g: process.env.GROK_API_KEY, x: process.env.XAI_API_KEY };
    delete process.env.GROK_API_KEY;
    delete process.env.XAI_API_KEY;
    expect(hasGrokImagine()).toBe(false);
    if (saved.g) process.env.GROK_API_KEY = saved.g;
    if (saved.x) process.env.XAI_API_KEY = saved.x;
  });
});
