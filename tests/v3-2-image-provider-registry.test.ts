/**
 * v3.2 P1 — Image provider registry unit tests.
 *
 * 不跑真 API. Mock provider 验证 register / select / dispatch 行为契约.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  registerImageProvider,
  clearImageProviders,
  listImageProviders,
  selectProviders,
  dispatchImageGenerate,
} from '@/lib/image-providers/registry';
import type { ImageProvider } from '@/lib/image-providers/types';

const mkProvider = (overrides: Partial<ImageProvider> = {}): ImageProvider => ({
  id: 'test-' + Math.random().toString(36).slice(2, 8),
  name: 'Test Provider',
  supportsRefs: true,
  maxRefImages: 4,
  priority: 100,
  available: () => true,
  generate: async ({ prompt }) => ({ imageUrl: 'https://example.com/' + encodeURIComponent(prompt).slice(0, 30) + '.png', provider: 'test' }),
  ...overrides,
});

beforeEach(() => clearImageProviders());

describe('v3.2 P1 · registerImageProvider', () => {
  it('registers + lists providers', () => {
    registerImageProvider(mkProvider({ id: 'a', priority: 100 }));
    registerImageProvider(mkProvider({ id: 'b', priority: 50 }));
    const list = listImageProviders();
    expect(list.map((p) => p.id)).toEqual(['b', 'a']); // sorted by priority asc
  });

  it('duplicate id overrides previous', () => {
    registerImageProvider(mkProvider({ id: 'x', priority: 100, name: 'v1' }));
    registerImageProvider(mkProvider({ id: 'x', priority: 50, name: 'v2' }));
    const list = listImageProviders();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('v2');
    expect(list[0].priority).toBe(50);
  });

  it('throws when missing required fields', () => {
    expect(() =>
      registerImageProvider({ ...mkProvider(), id: '' } as ImageProvider),
    ).toThrow();
  });
});

describe('v3.2 P1 · selectProviders', () => {
  it('respects available()', () => {
    registerImageProvider(mkProvider({ id: 'on', available: () => true }));
    registerImageProvider(mkProvider({ id: 'off', available: () => false }));
    expect(selectProviders({ refCount: 0 }).map((p) => p.id)).toEqual(['on']);
  });

  it('excludes providers exceeding maxRefImages', () => {
    registerImageProvider(mkProvider({ id: 'mj', maxRefImages: 2, priority: 100 }));
    registerImageProvider(mkProvider({ id: 'multi', maxRefImages: 8, priority: 110 }));
    // refCount 5 — MJ can't (max 2), multi can
    expect(selectProviders({ refCount: 5 }).map((p) => p.id)).toEqual(['multi']);
    // refCount 1 — both can; sorted by priority
    expect(selectProviders({ refCount: 1 }).map((p) => p.id)).toEqual(['mj', 'multi']);
  });

  it('honors prefer hoists matching to front', () => {
    registerImageProvider(mkProvider({ id: 'fast', priority: 100 }));
    registerImageProvider(mkProvider({ id: 'cheap', priority: 50 }));
    registerImageProvider(mkProvider({ id: 'pro', priority: 30 }));
    const r = selectProviders({ refCount: 0, prefer: 'fast' });
    expect(r[0].id).toBe('fast');
    // others still present in original (priority asc) order after the hit
    expect(r.slice(1).map((p) => p.id)).toEqual(['pro', 'cheap']);
  });

  it('exclude removes specific provider', () => {
    registerImageProvider(mkProvider({ id: 'a', priority: 50 }));
    registerImageProvider(mkProvider({ id: 'b', priority: 100 }));
    expect(selectProviders({ refCount: 0, exclude: new Set(['a']) }).map((p) => p.id)).toEqual(['b']);
  });

  it('empty registry returns empty array', () => {
    expect(selectProviders({ refCount: 3 })).toEqual([]);
  });
});

describe('v3.2 P1 · dispatchImageGenerate', () => {
  it('returns first successful result', async () => {
    registerImageProvider(mkProvider({
      id: 'first',
      priority: 50,
      generate: async () => ({ imageUrl: 'https://example.com/first.png', provider: 'first' }),
    }));
    registerImageProvider(mkProvider({ id: 'second', priority: 100 }));
    const r = await dispatchImageGenerate({ prompt: 'test' }, { refCount: 0 });
    expect(r.result?.provider).toBe('first');
    expect(r.tried).toHaveLength(0);
  });

  it('falls back on throw', async () => {
    registerImageProvider(mkProvider({
      id: 'broken',
      priority: 50,
      generate: async () => { throw new Error('oops'); },
    }));
    registerImageProvider(mkProvider({
      id: 'good',
      priority: 100,
      generate: async () => ({ imageUrl: 'https://example.com/good.png', provider: 'good' }),
    }));
    const r = await dispatchImageGenerate({ prompt: 'test' }, { refCount: 0 });
    expect(r.result?.provider).toBe('good');
    expect(r.tried).toEqual([{ id: 'broken', error: 'oops' }]);
  });

  it('rejects invalid imageUrl (not http/data:) — moves to next', async () => {
    registerImageProvider(mkProvider({
      id: 'returns-mock',
      priority: 50,
      generate: async () => ({ imageUrl: '<svg></svg>', provider: 'returns-mock' }),
    }));
    registerImageProvider(mkProvider({
      id: 'real',
      priority: 100,
      generate: async () => ({ imageUrl: 'https://x/y.png', provider: 'real' }),
    }));
    const r = await dispatchImageGenerate({ prompt: 'test' }, { refCount: 0 });
    expect(r.result?.provider).toBe('real');
    expect(r.tried[0].id).toBe('returns-mock');
  });

  it('all fail → result null + complete tried log', async () => {
    registerImageProvider(mkProvider({
      id: 'a', priority: 50, generate: async () => { throw new Error('a-err'); },
    }));
    registerImageProvider(mkProvider({
      id: 'b', priority: 100, generate: async () => { throw new Error('b-err'); },
    }));
    const r = await dispatchImageGenerate({ prompt: 'x' }, { refCount: 0 });
    expect(r.result).toBeNull();
    expect(r.tried.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(r.tried[0].error).toContain('err');
  });

  it('data: URI imageUrl IS accepted (persisted base64 case)', async () => {
    registerImageProvider(mkProvider({
      id: 'base64',
      priority: 50,
      generate: async () => ({ imageUrl: 'data:image/png;base64,iVBORw0KGgo=', provider: 'base64' }),
    }));
    const r = await dispatchImageGenerate({ prompt: 'x' }, { refCount: 0 });
    expect(r.result?.provider).toBe('base64');
  });
});
