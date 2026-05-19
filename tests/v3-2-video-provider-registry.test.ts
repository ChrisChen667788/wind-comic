/**
 * v3.2 P2 — Video provider registry unit tests.
 *
 * Mock provider 验证 register / select / dispatch 行为契约.
 * 比 image-provider 多了 FLF / S2V 的 capability filter 分支.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  registerVideoProvider,
  clearVideoProviders,
  listVideoProviders,
  selectProviders,
  dispatchVideoGenerate,
} from '@/lib/video-providers/registry';
import type { VideoProvider } from '@/lib/video-providers/types';

const mkProvider = (overrides: Partial<VideoProvider> = {}): VideoProvider => ({
  id: 'test-' + Math.random().toString(36).slice(2, 8),
  name: 'Test Video Provider',
  priority: 100,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: false,
  supportsSubjectReference: false,
  maxDurationSec: 10,
  available: () => true,
  generate: async ({ prompt }) => ({
    videoUrl: 'https://example.com/' + encodeURIComponent(prompt).slice(0, 24) + '.mp4',
    provider: 'test',
  }),
  ...overrides,
});

beforeEach(() => clearVideoProviders());

describe('v3.2 P2 · registerVideoProvider', () => {
  it('registers + lists providers (sorted by priority asc)', () => {
    registerVideoProvider(mkProvider({ id: 'a', priority: 100 }));
    registerVideoProvider(mkProvider({ id: 'b', priority: 50 }));
    expect(listVideoProviders().map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('duplicate id overrides previous', () => {
    registerVideoProvider(mkProvider({ id: 'x', priority: 100, name: 'v1' }));
    registerVideoProvider(mkProvider({ id: 'x', priority: 50, name: 'v2' }));
    const list = listVideoProviders();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('v2');
  });

  it('throws when missing id / generate / priority / maxDurationSec', () => {
    expect(() => registerVideoProvider({ ...mkProvider(), id: '' } as VideoProvider)).toThrow();
    expect(() => registerVideoProvider({ ...mkProvider(), maxDurationSec: 0 } as VideoProvider)).toThrow();
    expect(() => registerVideoProvider({ ...mkProvider(), priority: 'high' as any } as VideoProvider)).toThrow();
  });
});

describe('v3.2 P2 · selectProviders capability filtering', () => {
  it('respects available()', () => {
    registerVideoProvider(mkProvider({ id: 'on', available: () => true }));
    registerVideoProvider(mkProvider({ id: 'off', available: () => false }));
    expect(
      selectProviders({ hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false })
        .map((p) => p.id),
    ).toEqual(['on']);
  });

  it('hasFirstFrame requires supportsImage2Video', () => {
    registerVideoProvider(mkProvider({ id: 'i2v', supportsImage2Video: true, supportsText2Video: false }));
    registerVideoProvider(mkProvider({ id: 't2v-only', supportsImage2Video: false, supportsText2Video: true }));
    const r = selectProviders({ hasFirstFrame: true, hasLastFrame: false, hasSubjectReference: false });
    expect(r.map((p) => p.id)).toEqual(['i2v']);
  });

  it('no firstFrame requires supportsText2Video', () => {
    registerVideoProvider(mkProvider({ id: 'i2v-only', supportsText2Video: false }));
    registerVideoProvider(mkProvider({ id: 'both', supportsText2Video: true }));
    expect(
      selectProviders({ hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false })
        .map((p) => p.id),
    ).toEqual(['both']);
  });

  it('hasLastFrame requires supportsLastFrame (FLF)', () => {
    registerVideoProvider(mkProvider({ id: 'no-flf', supportsLastFrame: false, priority: 50 }));
    registerVideoProvider(mkProvider({ id: 'flf', supportsLastFrame: true, priority: 100 }));
    const r = selectProviders({
      hasFirstFrame: true, hasLastFrame: true, hasSubjectReference: false,
    });
    expect(r.map((p) => p.id)).toEqual(['flf']);
  });

  it('hasSubjectReference requires supportsSubjectReference (S2V)', () => {
    registerVideoProvider(mkProvider({ id: 'no-s2v', supportsSubjectReference: false }));
    registerVideoProvider(mkProvider({ id: 's2v', supportsSubjectReference: true }));
    const r = selectProviders({
      hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: true,
    });
    expect(r.map((p) => p.id)).toEqual(['s2v']);
  });

  it('filters by maxDurationSec', () => {
    registerVideoProvider(mkProvider({ id: 'short', maxDurationSec: 5, priority: 50 }));
    registerVideoProvider(mkProvider({ id: 'long', maxDurationSec: 15, priority: 100 }));
    // Need 8s → 'short' is excluded
    const r = selectProviders({
      hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false, durationSec: 8,
    });
    expect(r.map((p) => p.id)).toEqual(['long']);
  });

  it('prefer hoists matching provider to front', () => {
    registerVideoProvider(mkProvider({ id: 'fast', priority: 100 }));
    registerVideoProvider(mkProvider({ id: 'cheap', priority: 50 }));
    registerVideoProvider(mkProvider({ id: 'pro', priority: 30 }));
    const r = selectProviders({
      hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false, prefer: 'fast',
    });
    expect(r[0].id).toBe('fast');
    expect(r.slice(1).map((p) => p.id)).toEqual(['pro', 'cheap']);
  });

  it('exclude removes specific provider', () => {
    registerVideoProvider(mkProvider({ id: 'a', priority: 50 }));
    registerVideoProvider(mkProvider({ id: 'b', priority: 100 }));
    expect(
      selectProviders({
        hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false,
        exclude: new Set(['a']),
      }).map((p) => p.id),
    ).toEqual(['b']);
  });

  it('empty registry returns empty array', () => {
    expect(selectProviders({ hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false }))
      .toEqual([]);
  });
});

describe('v3.2 P2 · dispatchVideoGenerate', () => {
  it('returns first successful result', async () => {
    registerVideoProvider(mkProvider({
      id: 'first',
      priority: 50,
      generate: async () => ({ videoUrl: 'https://example.com/first.mp4', provider: 'first' }),
    }));
    registerVideoProvider(mkProvider({ id: 'second', priority: 100 }));
    const r = await dispatchVideoGenerate({ prompt: 'test' });
    expect(r.result?.provider).toBe('first');
    expect(r.tried).toHaveLength(0);
  });

  it('falls back on throw', async () => {
    registerVideoProvider(mkProvider({
      id: 'broken',
      priority: 50,
      generate: async () => { throw new Error('oops'); },
    }));
    registerVideoProvider(mkProvider({
      id: 'good',
      priority: 100,
      generate: async () => ({ videoUrl: 'https://example.com/good.mp4', provider: 'good' }),
    }));
    const r = await dispatchVideoGenerate({ prompt: 'test' });
    expect(r.result?.provider).toBe('good');
    expect(r.tried).toEqual([{ id: 'broken', error: 'oops' }]);
  });

  it('rejects invalid videoUrl — moves to next', async () => {
    registerVideoProvider(mkProvider({
      id: 'returns-bogus',
      priority: 50,
      generate: async () => ({ videoUrl: 'file:///etc/hosts', provider: 'returns-bogus' }),
    }));
    registerVideoProvider(mkProvider({
      id: 'real',
      priority: 100,
      generate: async () => ({ videoUrl: 'https://x/y.mp4', provider: 'real' }),
    }));
    const r = await dispatchVideoGenerate({ prompt: 'test' });
    expect(r.result?.provider).toBe('real');
    expect(r.tried[0].id).toBe('returns-bogus');
  });

  it('all fail → result null + complete tried log', async () => {
    registerVideoProvider(mkProvider({
      id: 'a', priority: 50, generate: async () => { throw new Error('a-err'); },
    }));
    registerVideoProvider(mkProvider({
      id: 'b', priority: 100, generate: async () => { throw new Error('b-err'); },
    }));
    const r = await dispatchVideoGenerate({ prompt: 'x' });
    expect(r.result).toBeNull();
    expect(r.tried.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('data:video/* URL IS accepted', async () => {
    registerVideoProvider(mkProvider({
      id: 'b64',
      priority: 50,
      generate: async () => ({
        videoUrl: 'data:video/mp4;base64,AAAAGGZ0eXBtcDQy',
        provider: 'b64',
      }),
    }));
    const r = await dispatchVideoGenerate({ prompt: 'x' });
    expect(r.result?.provider).toBe('b64');
  });

  it('I2V request skips T2V-only providers', async () => {
    let called = false;
    registerVideoProvider(mkProvider({
      id: 't2v-only',
      priority: 50,
      supportsImage2Video: false,
      supportsText2Video: true,
      generate: async () => { called = true; return { videoUrl: 'https://x/y.mp4', provider: 't2v-only' }; },
    }));
    registerVideoProvider(mkProvider({
      id: 'i2v',
      priority: 100,
      generate: async () => ({ videoUrl: 'https://x/i2v.mp4', provider: 'i2v' }),
    }));
    const r = await dispatchVideoGenerate({ prompt: 'x', firstFrameUrl: 'https://x/f.png' });
    expect(r.result?.provider).toBe('i2v');
    expect(called).toBe(false);   // T2V-only didn't even get called
  });

  it('FLF (lastFrameUrl) only dispatched to FLF-capable provider', async () => {
    registerVideoProvider(mkProvider({
      id: 'no-flf', priority: 50, supportsLastFrame: false,
      generate: async () => { throw new Error('should not be called'); },
    }));
    registerVideoProvider(mkProvider({
      id: 'has-flf', priority: 100, supportsLastFrame: true,
      generate: async () => ({ videoUrl: 'https://x/flf.mp4', provider: 'has-flf' }),
    }));
    const r = await dispatchVideoGenerate({
      prompt: 'morph', firstFrameUrl: 'https://x/a.png', lastFrameUrl: 'https://x/b.png',
    });
    expect(r.result?.provider).toBe('has-flf');
  });
});
