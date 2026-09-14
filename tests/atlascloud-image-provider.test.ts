import { describe, expect, it, vi } from 'vitest';
import {
  atlasCloudImageSize,
  buildAtlasCloudImageRequest,
  generateAtlasCloudImage,
  hasAtlasCloudImage,
} from '@/lib/image-providers/atlascloud-image';

const env = {
  ATLASCLOUD_API_KEY: 'test-key',
  ATLASCLOUD_IMAGE_ENABLED: '1',
  ATLASCLOUD_IMAGE_MODEL: 'bytedance/seedream-v5.0-lite',
} as NodeJS.ProcessEnv;

describe('Atlas Cloud image provider', () => {
  it('is opt-in and requires a key', () => {
    expect(hasAtlasCloudImage({ ATLASCLOUD_API_KEY: 'key' })).toBe(false);
    expect(hasAtlasCloudImage({ ATLASCLOUD_IMAGE_ENABLED: '1' })).toBe(false);
    expect(hasAtlasCloudImage(env)).toBe(true);
  });

  it('maps supported aspect ratios to live Seedream sizes', () => {
    expect(atlasCloudImageSize('16:9')).toBe('2848*1600');
    expect(atlasCloudImageSize('9:16')).toBe('1600*2848');
    expect(atlasCloudImageSize('1:1')).toBe('2048*2048');
    expect(buildAtlasCloudImageRequest({ prompt: 'shot', aspectRatio: '4:3' }, env)).toEqual({
      model: 'bytedance/seedream-v5.0-lite',
      prompt: 'shot',
      size: '2496*1664',
      output_format: 'jpeg',
    });
  });

  it('submits once, polls the same prediction, and returns its output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { id: 'pred-1' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: { status: 'processing' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { status: 'completed', outputs: ['https://cdn.example/result.jpeg'] },
      }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await generateAtlasCloudImage(
      { prompt: 'cinematic shot', aspectRatio: '16:9' },
      env,
      { fetch: fetchMock as typeof fetch, sleep, pollIntervalMs: 1, pollTimeoutMs: 10_000 },
    );

    expect(result).toEqual({ imageUrl: 'https://cdn.example/result.jpeg', predictionId: 'pred-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toContain('/prediction/pred-1');
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it('never retries a failed submit', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ambiguous timeout'));
    await expect(generateAtlasCloudImage(
      { prompt: 'shot' },
      env,
      { fetch: fetchMock as typeof fetch, sleep: vi.fn(), pollTimeoutMs: 100 },
    )).rejects.toThrow('ambiguous timeout');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
