import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_CONFIG } from '@/lib/config';
import { imageStageTimeout } from '@/lib/minimax-h3-image';
import { listImageProviders, selectProviders } from '@/lib/image-providers/registry';
import { withImagePlugin } from '@/lib/plugin-chain-router';
import '@/lib/image-providers/builtins';

vi.mock('@/lib/plugin-chain-telemetry', () => ({ recordPluginEvent: vi.fn() }));

const provider = listImageProviders().find(p => p.id === 'minimax-h3')!;
const originalBase = API_CONFIG.minimax.baseURL;
const originalKey = API_CONFIG.minimax.apiKey;
const input = { prompt: 'A mountain at dawn', aspectRatio: '2.35:1' as const };
const fetchMock = vi.fn<typeof fetch>();

describe('MiniMax H3 storyboard image generation', () => {
  beforeEach(() => {
    vi.stubEnv('MINIMAX_IMAGE_MODEL', 'MiniMax-H3-Image');
    vi.stubEnv('PLUGIN_CHAIN_MODE', '');
    API_CONFIG.minimax.apiKey = 'fixture';
    API_CONFIG.minimax.baseURL = 'https://api.minimax.io';
    vi.stubGlobal('fetch', fetchMock.mockReset());
  });
  afterEach(() => {
    API_CONFIG.minimax.baseURL = originalBase;
    API_CONFIG.minimax.apiKey = originalKey;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['MiniMax-H3-Image', 'https://api.minimax.io', 'https://api.minimax.io'],
    ['MiniMax-H3-Image-Highspeed', 'https://api.minimax.cn', 'https://api.minimax.cn'],
    ['MiniMax-H3-Image', 'https://api.minimaxi.com', 'https://api.minimax.cn'],
  ])('routes %s using %s', async (model, baseURL, base) => {
    vi.stubEnv('MINIMAX_IMAGE_MODEL', model);
    API_CONFIG.minimax.baseURL = baseURL;
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const imageUrl = 'https://images.example/storyboard.png';
    fetchMock.mockResolvedValue(Response.json({ data: [{ url: imageUrl }], request_id: 'request' }));
    const fallback = vi.fn();
    expect(await withImagePlugin(input, fallback)).toBe(imageUrl);
    expect(fallback).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledWith(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(base + '/v1/images/generations');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture');
    expect(JSON.parse(String(init?.body))).toEqual({
      model, prompt: input.prompt, n: 1, response_format: 'url', aspect_ratio: '47:20',
    });
    expect(imageStageTimeout(90_000)).toBeGreaterThan(600_000);
  });

  it.each([
    [200, { data: [{ error: { code: '1027', message: 'Image rejected' } }] }, 'Image rejected'],
    [429, { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }, 'Rate limit exceeded'],
    [200, { data: [] }, 'no image URL'],
  ] as const)('propagates generation failure (HTTP %i) without resubmitting', async (status, body, message) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    await expect(provider.generate(input)).rejects.toThrow(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves reference routing and opts out for unknown hosts or models', () => {
    expect(selectProviders({ refCount: 1 })).not.toContain(provider);
    API_CONFIG.minimax.baseURL = 'https://gateway.example';
    expect(provider.available()).toBe(false);
    API_CONFIG.minimax.baseURL = originalBase;
    vi.stubEnv('MINIMAX_IMAGE_MODEL', '');
    expect(provider.available()).toBe(false);
    expect(imageStageTimeout(90_000)).toBe(90_000);
  });
});
