/**
 * v3.2 P3.1 — Plugin-chain router wrappers (image / video / tts).
 *
 * 验证三种 mode 下 wrapper 的语义:
 *   off     → 直接 fallback, plugin 不被调
 *   primary → plugin 优先, 失败 fallback
 *   shadow  → fallback 出结果, plugin 后台跑收集 telemetry
 *
 * 用真 registry + mock provider (类似 P1/P2 测试方式).
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { withImagePlugin, withVideoPlugin, withTTSPlugin } from '@/lib/plugin-chain-router';
import { pluginChainStats } from '@/lib/plugin-chain-mode';
import {
  registerImageProvider,
  clearImageProviders,
} from '@/lib/image-providers/registry';
import {
  registerVideoProvider,
  clearVideoProviders,
} from '@/lib/video-providers/registry';
import {
  registerTTSProvider,
  clearTTSProviders,
} from '@/lib/tts-providers/registry';

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.PLUGIN_CHAIN_MODE;
  delete process.env.PLUGIN_CHAIN_SHADOW_RATE;
  clearImageProviders();
  clearVideoProviders();
  clearTTSProviders();
  pluginChainStats.reset();
});

afterEach(() => {
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, savedEnv);
});

// ─── Image ─────────────────────────────────────────────────────────────────

describe('v3.2 P3.1 · withImagePlugin (off mode)', () => {
  it('off: never touches plugin, just runs fallback', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'off';
    let pluginCalled = false;
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => { pluginCalled = true; return { imageUrl: 'https://x/plugin.png', provider: 'mock' }; },
    });
    const r = await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    expect(r).toBe('https://x/fallback.png');
    expect(pluginCalled).toBe(false);
    expect(pluginChainStats.snapshot().primaryHits).toBe(0);
  });
});

describe('v3.2 P3.1 · withImagePlugin (primary mode)', () => {
  it('primary: plugin succeeds → returns plugin url', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    let fallbackCalled = false;
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => ({ imageUrl: 'https://x/plugin.png', provider: 'mock' }),
    });
    const r = await withImagePlugin(
      { prompt: 'p' },
      async () => { fallbackCalled = true; return 'https://x/fallback.png'; },
    );
    expect(r).toBe('https://x/plugin.png');
    expect(fallbackCalled).toBe(false);
    expect(pluginChainStats.snapshot().primaryHits).toBe(1);
  });

  it('primary: plugin chain empty → falls back', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    // 不注册任何 provider
    const r = await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    expect(r).toBe('https://x/fallback.png');
    const s = pluginChainStats.snapshot();
    expect(s.primaryFallbacks).toBe(1);
    expect(s.primaryHits).toBe(0);
  });

  it('primary: plugin throws → falls back', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => { throw new Error('upstream-5xx'); },
    });
    const r = await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    expect(r).toBe('https://x/fallback.png');
    expect(pluginChainStats.snapshot().primaryFallbacks).toBe(1);
  });
});

describe('v3.2 P3.1 · withImagePlugin (shadow mode)', () => {
  it('shadow: always returns fallback result regardless of plugin', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'shadow';
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '1';  // sample 100%
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => ({ imageUrl: 'https://x/plugin.png', provider: 'mock' }),
    });
    const r = await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    expect(r).toBe('https://x/fallback.png');
    // shadow 异步, 等一拍让 it 跑完
    await new Promise((r) => setTimeout(r, 50));
    const s = pluginChainStats.snapshot();
    expect(s.shadowSampled).toBe(1);
    expect(s.shadowAgreed).toBe(1);
  });

  it('shadow: rate=0 → plugin not even sampled', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'shadow';
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '0';
    let pluginCalled = false;
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => { pluginCalled = true; return { imageUrl: 'https://x/plugin.png', provider: 'mock' }; },
    });
    await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    await new Promise((r) => setTimeout(r, 30));
    expect(pluginCalled).toBe(false);
    expect(pluginChainStats.snapshot().shadowSampled).toBe(0);
  });

  it('shadow: plugin throws → recordShadowDisagreed, fallback unaffected', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'shadow';
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '1';
    registerImageProvider({
      id: 'mock', name: 'm', supportsRefs: false, maxRefImages: 0, priority: 50,
      available: () => true,
      generate: async () => { throw new Error('bad upstream'); },
    });
    const r = await withImagePlugin({ prompt: 'p' }, async () => 'https://x/fallback.png');
    expect(r).toBe('https://x/fallback.png');
    await new Promise((r) => setTimeout(r, 50));
    const s = pluginChainStats.snapshot();
    expect(s.shadowDisagreed).toBe(1);
  });
});

// ─── Video ─────────────────────────────────────────────────────────────────

describe('v3.2 P3.1 · withVideoPlugin', () => {
  it('off: skips plugin', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'off';
    const r = await withVideoPlugin({ prompt: 'p' }, async () => 'https://x/fb.mp4');
    expect(r).toBe('https://x/fb.mp4');
  });

  it('primary success', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    registerVideoProvider({
      id: 'mock', name: 'm', priority: 50,
      supportsImage2Video: true, supportsText2Video: true,
      supportsLastFrame: false, supportsSubjectReference: false,
      maxDurationSec: 10, available: () => true,
      generate: async () => ({ videoUrl: 'https://x/plugin.mp4', provider: 'mock' }),
    });
    const r = await withVideoPlugin({ prompt: 'p' }, async () => 'https://x/fb.mp4');
    expect(r).toBe('https://x/plugin.mp4');
    expect(pluginChainStats.snapshot().primaryHits).toBe(1);
  });

  it('primary plugin empty → fallback', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    const r = await withVideoPlugin({ prompt: 'p' }, async () => 'https://x/fb.mp4');
    expect(r).toBe('https://x/fb.mp4');
    expect(pluginChainStats.snapshot().primaryFallbacks).toBe(1);
  });
});

// ─── TTS ──────────────────────────────────────────────────────────────────

describe('v3.2 P3.1 · withTTSPlugin', () => {
  const fallbackResult = {
    audioUrl: 'https://x/fb.mp3', duration: 2, subtitle: [], provider: 'legacy',
  };
  const fallback = async () => fallbackResult;

  it('off: skips plugin', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'off';
    const r = await withTTSPlugin({ text: 't', voiceId: 'v' }, fallback);
    expect(r).toBe(fallbackResult);
  });

  it('primary success', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    registerTTSProvider({
      id: 'mock', name: 'm', priority: 50,
      supportsEmotion: false, supportsCloning: false, supportsStreaming: false,
      maxTextLen: 1000, supportedLanguages: [], available: () => true,
      generate: async () => ({
        audioUrl: 'https://x/plugin.mp3', duration: 3, subtitle: [], provider: 'mock',
      }),
    });
    const r = await withTTSPlugin({ text: 't', voiceId: 'v' }, fallback);
    expect(r.provider).toBe('mock');
    expect(pluginChainStats.snapshot().primaryHits).toBe(1);
  });

  it('primary plugin empty → fallback', async () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    const r = await withTTSPlugin({ text: 't', voiceId: 'v' }, fallback);
    expect(r).toBe(fallbackResult);
    expect(pluginChainStats.snapshot().primaryFallbacks).toBe(1);
  });
});
