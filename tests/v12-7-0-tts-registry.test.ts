/**
 * v12.7.0 — TTS 注册表统一:ttsEngineConfigured + dispatch 按 priority 选 vectorengine 优先。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerTTSProvider, clearTTSProviders, ttsEngineConfigured, dispatchTTSGenerate } from '@/lib/tts-providers/registry';
import type { TTSProvider } from '@/lib/tts-providers/types';

function fakeProvider(id: string, priority: number, opts: { available?: boolean; audioUrl?: string | null } = {}): TTSProvider {
  return {
    id, name: id, priority,
    supportsEmotion: true, supportsCloning: false, supportsStreaming: false,
    maxTextLen: 5000, supportedLanguages: ['zh-CN', 'en-US'],
    available: () => opts.available ?? true,
    generate: async () => ({ audioUrl: opts.audioUrl ?? `https://cdn/${id}.mp3`, duration: 1, subtitle: [], provider: id }),
  } as TTSProvider;
}

describe('v12.7.0 · ttsEngineConfigured', () => {
  beforeEach(() => clearTTSProviders());

  it('无 provider → false', () => {
    expect(ttsEngineConfigured()).toBe(false);
  });
  it('有可用 provider → true;全不可用 → false', () => {
    registerTTSProvider(fakeProvider('vec', 50, { available: true }));
    expect(ttsEngineConfigured()).toBe(true);
    clearTTSProviders();
    registerTTSProvider(fakeProvider('down', 50, { available: false }));
    expect(ttsEngineConfigured()).toBe(false);
  });
  it('available() 抛错也算不可用(不崩)', () => {
    const bad = { ...fakeProvider('bad', 50), available: () => { throw new Error('x'); } } as TTSProvider;
    registerTTSProvider(bad);
    expect(ttsEngineConfigured()).toBe(false);
  });
});

describe('v12.7.0 · dispatch 优先 vectorengine(priority 低=先选)', () => {
  beforeEach(() => clearTTSProviders());

  it('vectorengine(50) 先于 minimax(100) 被选中', async () => {
    registerTTSProvider(fakeProvider('minimax-tts', 100, { audioUrl: 'https://cdn/minimax.mp3' }));
    registerTTSProvider(fakeProvider('vectorengine-tts', 50, { audioUrl: 'https://cdn/vec.mp3' }));
    const d = await dispatchTTSGenerate({ text: '你好', voiceId: 'female-zh' });
    expect(d.result?.provider).toBe('vectorengine-tts');
    expect(d.result?.audioUrl).toBe('https://cdn/vec.mp3');
  });

  it('首选返回无效 audioUrl → 落下一个;全失败 result=null', async () => {
    registerTTSProvider(fakeProvider('a', 50, { audioUrl: 'not-a-url' }));
    registerTTSProvider(fakeProvider('b', 60, { audioUrl: 'https://cdn/b.mp3' }));
    const ok = await dispatchTTSGenerate({ text: 'x', voiceId: 'v' });
    expect(ok.result?.provider).toBe('b');

    clearTTSProviders();
    registerTTSProvider(fakeProvider('only', 50, { audioUrl: 'bad' }));
    const fail = await dispatchTTSGenerate({ text: 'x', voiceId: 'v' });
    expect(fail.result).toBeNull();
    expect(fail.tried.length).toBe(1);
  });
});
