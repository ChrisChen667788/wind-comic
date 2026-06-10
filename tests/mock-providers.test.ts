/**
 * v10.4.0 — mock 引擎三件套单测:
 *   - MOCK_ENGINES 未开 → available()=false,不进 chain(零行为变化)
 *   - 开了 → dispatch 走 mock,URL 确定性(同输入同产物)+ 指向 /api/mock-assets/*
 *   - 时长钳制 / TTS 时长按字数估算 + 字幕条目
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import '@/lib/mock-providers'; // 副作用注册
import { mockSeed, mockAssetBase } from '@/lib/mock-providers';
import { dispatchImageGenerate, listImageProviders } from '@/lib/image-providers/registry';
import { dispatchVideoGenerate } from '@/lib/video-providers/registry';
import { dispatchTTSGenerate } from '@/lib/tts-providers/registry';

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.MOCK_ENGINES;
  delete process.env.APP_URL;
});

afterEach(() => {
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, savedEnv);
});

describe('v10.4.0 · mockSeed / mockAssetBase', () => {
  it('mockSeed 确定性 + 8 位 hex', () => {
    expect(mockSeed('hello')).toBe(mockSeed('hello'));
    expect(mockSeed('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(mockSeed('hello')).not.toBe(mockSeed('world'));
  });
  it('mockAssetBase 默认 localhost,APP_URL 覆盖且去尾斜杠', () => {
    expect(mockAssetBase()).toMatch(/^http:\/\/localhost:\d+$/);
    process.env.APP_URL = 'https://qfmj.example.com/';
    expect(mockAssetBase()).toBe('https://qfmj.example.com');
  });
});

describe('v10.4.0 · 未开 MOCK_ENGINES', () => {
  it('mock-image 注册了但 available()=false,不进 chain', () => {
    const mock = listImageProviders().find((p) => p.id === 'mock-image');
    expect(mock).toBeTruthy();
    expect(mock!.available()).toBe(false);
  });
});

describe('v10.4.0 · MOCK_ENGINES=1', () => {
  beforeEach(() => {
    process.env.MOCK_ENGINES = '1';
  });

  it('image dispatch 走 mock,URL 指向 /api/mock-assets/image 且确定性', async () => {
    const input = { prompt: '暮色城市霓虹雨夜', aspectRatio: '16:9' as const };
    const a = await dispatchImageGenerate(input, { refCount: 0 });
    const b = await dispatchImageGenerate(input, { refCount: 0 });
    expect(a.result?.provider).toBe('mock-image');
    expect(a.result?.imageUrl).toContain('/api/mock-assets/image/');
    expect(a.result?.imageUrl).toMatch(/^http/);
    expect(a.result?.imageUrl).toBe(b.result?.imageUrl); // 同输入同产物
    expect(a.result?.estCostCny).toBe(0);
  });

  it('image: 多参考图也吃得下(maxRefImages=8)', async () => {
    const r = await dispatchImageGenerate(
      { prompt: 'x', referenceImages: ['http://a/1.png', 'http://a/2.png', 'http://a/3.png'] },
      { refCount: 3 },
    );
    expect(r.result?.provider).toBe('mock-image');
  });

  it('video dispatch 走 mock,时长钳到 1..4s', async () => {
    const r = await dispatchVideoGenerate({ prompt: '镜头', durationSec: 10, aspectRatio: '9:16' });
    expect(r.result?.provider).toBe('mock-video');
    expect(r.result?.videoUrl).toContain('/api/mock-assets/clip/');
    expect(r.result?.durationSec).toBeLessThanOrEqual(4);
    expect(r.result?.durationSec).toBeGreaterThanOrEqual(1);
  });

  it('tts dispatch 走 mock,时长按字数估算 + 单条字幕', async () => {
    const text = '这是一句十二个字的台词呀'; // 12 字 → ~3s
    const r = await dispatchTTSGenerate({ text, voiceId: 'v1', character: '李长安' });
    expect(r.result?.provider).toBe('mock-tts');
    expect(r.result?.audioUrl).toContain('/api/mock-assets/voice/');
    expect(r.result?.duration).toBeCloseTo(text.length / 4, 1);
    expect(r.result?.subtitle).toEqual([
      { start: 0, end: r.result!.duration, text, character: '李长安' },
    ]);
  });
});
