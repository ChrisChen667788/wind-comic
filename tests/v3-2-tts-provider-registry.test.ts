/**
 * v3.2 P2 — TTS provider registry unit tests.
 *
 * Mock provider 验证 register / select / dispatch 的 capability filter 与 fallback.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  registerTTSProvider,
  clearTTSProviders,
  listTTSProviders,
  selectProviders,
  dispatchTTSGenerate,
} from '@/lib/tts-providers/registry';
import type { TTSProvider } from '@/lib/tts-providers/types';

const mkProvider = (overrides: Partial<TTSProvider> = {}): TTSProvider => ({
  id: 'test-' + Math.random().toString(36).slice(2, 8),
  name: 'Test TTS Provider',
  priority: 100,
  supportsEmotion: false,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 5000,
  supportedLanguages: [],
  available: () => true,
  generate: async ({ text }) => ({
    audioUrl: 'https://example.com/' + encodeURIComponent(text).slice(0, 16) + '.mp3',
    duration: Math.max(1, text.length / 4),
    subtitle: [{ start: 0, end: 1, text }],
    provider: 'test',
  }),
  ...overrides,
});

beforeEach(() => clearTTSProviders());

describe('v3.2 P2 · registerTTSProvider', () => {
  it('registers + lists providers (sorted by priority asc)', () => {
    registerTTSProvider(mkProvider({ id: 'a', priority: 100 }));
    registerTTSProvider(mkProvider({ id: 'b', priority: 50 }));
    expect(listTTSProviders().map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('duplicate id overrides previous', () => {
    registerTTSProvider(mkProvider({ id: 'x', priority: 100, name: 'v1' }));
    registerTTSProvider(mkProvider({ id: 'x', priority: 50, name: 'v2' }));
    expect(listTTSProviders()).toHaveLength(1);
    expect(listTTSProviders()[0].name).toBe('v2');
  });

  it('throws on missing fields', () => {
    expect(() => registerTTSProvider({ ...mkProvider(), id: '' } as TTSProvider)).toThrow();
    expect(() => registerTTSProvider({ ...mkProvider(), maxTextLen: 0 } as TTSProvider)).toThrow();
    expect(() => registerTTSProvider({ ...mkProvider(), supportedLanguages: 'zh' as any } as TTSProvider)).toThrow();
  });
});

describe('v3.2 P2 · selectProviders TTS capability filtering', () => {
  it('respects available()', () => {
    registerTTSProvider(mkProvider({ id: 'on', available: () => true }));
    registerTTSProvider(mkProvider({ id: 'off', available: () => false }));
    expect(selectProviders({}).map((p) => p.id)).toEqual(['on']);
  });

  it('requiresEmotion filters out non-emotion providers', () => {
    registerTTSProvider(mkProvider({ id: 'flat', supportsEmotion: false }));
    registerTTSProvider(mkProvider({ id: 'emo', supportsEmotion: true }));
    expect(selectProviders({ requiresEmotion: true }).map((p) => p.id)).toEqual(['emo']);
  });

  it('requiresCloning filters', () => {
    registerTTSProvider(mkProvider({ id: 'no-clone', supportsCloning: false }));
    registerTTSProvider(mkProvider({ id: 'clone', supportsCloning: true }));
    expect(selectProviders({ requiresCloning: true }).map((p) => p.id)).toEqual(['clone']);
  });

  it('requiresStreaming filters', () => {
    registerTTSProvider(mkProvider({ id: 'batch', supportsStreaming: false }));
    registerTTSProvider(mkProvider({ id: 'stream', supportsStreaming: true }));
    expect(selectProviders({ requiresStreaming: true }).map((p) => p.id)).toEqual(['stream']);
  });

  it('filters by textLen vs maxTextLen', () => {
    registerTTSProvider(mkProvider({ id: 'short', maxTextLen: 100 }));
    registerTTSProvider(mkProvider({ id: 'long', maxTextLen: 5000 }));
    expect(selectProviders({ textLen: 1500 }).map((p) => p.id)).toEqual(['long']);
  });

  it('filters by language unless supportedLanguages is empty (= "any")', () => {
    registerTTSProvider(mkProvider({ id: 'zh-only', supportedLanguages: ['zh-CN'] }));
    registerTTSProvider(mkProvider({ id: 'en-only', supportedLanguages: ['en-US'] }));
    registerTTSProvider(mkProvider({ id: 'any', supportedLanguages: [] }));
    expect(selectProviders({ language: 'zh-CN' }).map((p) => p.id).sort()).toEqual(['any', 'zh-only']);
    expect(selectProviders({ language: 'ja-JP' }).map((p) => p.id)).toEqual(['any']);
  });

  it('prefer hoists matching to front', () => {
    registerTTSProvider(mkProvider({ id: 'a', priority: 30 }));
    registerTTSProvider(mkProvider({ id: 'b', priority: 50 }));
    registerTTSProvider(mkProvider({ id: 'c', priority: 100 }));
    expect(selectProviders({ prefer: 'c' }).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('exclude removes specific id', () => {
    registerTTSProvider(mkProvider({ id: 'a', priority: 50 }));
    registerTTSProvider(mkProvider({ id: 'b', priority: 100 }));
    expect(selectProviders({ exclude: new Set(['a']) }).map((p) => p.id)).toEqual(['b']);
  });
});

describe('v3.2 P2 · dispatchTTSGenerate', () => {
  it('returns first successful result', async () => {
    registerTTSProvider(mkProvider({
      id: 'first',
      priority: 50,
      generate: async () => ({
        audioUrl: 'https://x/a.mp3', duration: 2, subtitle: [], provider: 'first',
      }),
    }));
    registerTTSProvider(mkProvider({ id: 'second', priority: 100 }));
    const r = await dispatchTTSGenerate({ text: 'hi', voiceId: 'v1' });
    expect(r.result?.provider).toBe('first');
  });

  it('falls back on throw', async () => {
    registerTTSProvider(mkProvider({
      id: 'broken',
      priority: 50,
      generate: async () => { throw new Error('oops'); },
    }));
    registerTTSProvider(mkProvider({
      id: 'good',
      priority: 100,
      generate: async () => ({ audioUrl: 'https://x/g.mp3', duration: 2, subtitle: [], provider: 'good' }),
    }));
    const r = await dispatchTTSGenerate({ text: 'hi', voiceId: 'v1' });
    expect(r.result?.provider).toBe('good');
    expect(r.tried).toEqual([{ id: 'broken', error: 'oops' }]);
  });

  it('rejects invalid audioUrl', async () => {
    registerTTSProvider(mkProvider({
      id: 'bogus',
      priority: 50,
      generate: async () => ({ audioUrl: 'file:///etc/x', duration: 1, subtitle: [], provider: 'bogus' }),
    }));
    registerTTSProvider(mkProvider({
      id: 'real',
      priority: 100,
      generate: async () => ({ audioUrl: 'https://x/r.mp3', duration: 2, subtitle: [], provider: 'real' }),
    }));
    const r = await dispatchTTSGenerate({ text: 'hi', voiceId: 'v1' });
    expect(r.result?.provider).toBe('real');
    expect(r.tried[0].id).toBe('bogus');
  });

  it('data:audio/* URL IS accepted', async () => {
    registerTTSProvider(mkProvider({
      id: 'b64',
      priority: 50,
      generate: async () => ({
        audioUrl: 'data:audio/mpeg;base64,SUQzAA==',
        duration: 1, subtitle: [], provider: 'b64',
      }),
    }));
    const r = await dispatchTTSGenerate({ text: 'hi', voiceId: 'v1' });
    expect(r.result?.provider).toBe('b64');
  });

  it('all fail → result null + tried log', async () => {
    registerTTSProvider(mkProvider({
      id: 'a', priority: 50, generate: async () => { throw new Error('a'); },
    }));
    registerTTSProvider(mkProvider({
      id: 'b', priority: 100, generate: async () => { throw new Error('b'); },
    }));
    const r = await dispatchTTSGenerate({ text: 'x', voiceId: 'v' });
    expect(r.result).toBeNull();
    expect(r.tried.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('emotion request skips non-emotion provider', async () => {
    let called = false;
    registerTTSProvider(mkProvider({
      id: 'flat', priority: 50, supportsEmotion: false,
      generate: async () => { called = true; throw new Error('should not be called'); },
    }));
    registerTTSProvider(mkProvider({
      id: 'emo', priority: 100, supportsEmotion: true,
      generate: async () => ({ audioUrl: 'https://x/e.mp3', duration: 1, subtitle: [], provider: 'emo' }),
    }));
    const r = await dispatchTTSGenerate({ text: 'hi', voiceId: 'v', emotion: 'sad' });
    expect(r.result?.provider).toBe('emo');
    expect(called).toBe(false);
  });
});
