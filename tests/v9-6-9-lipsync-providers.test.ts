/**
 * v9.6.9 — 口型引擎 provider 子系统(registry 调度 + env 门控 + 内置 wav2lip-http 注册)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '@/lib/lipsync-providers'; // 顶层导入 → 触发内置注册(在任何 clear 之前)
import {
  registerLipSyncProvider, clearLipSyncProviders, listLipSyncProviders, getLipSyncProvider,
  selectLipSyncProviders, dispatchLipSyncGenerate, lipSyncEngineConfigured,
  type LipSyncProvider,
} from '@/lib/lipsync-providers/registry';

const fake = (over: Partial<LipSyncProvider>): LipSyncProvider => ({
  id: 'f', name: 'F', priority: 50, supportsVideoDriver: false,
  available: () => true,
  generate: async () => ({ videoUrl: 'https://x/out.mp4', provider: 'f' }),
  ...over,
});

describe('v9.6.9 · 内置 wav2lip-http(导入即注册 + env 门控)', () => {
  it('注册存在 + available 取决于 LIPSYNC_API_URL', () => {
    const p = getLipSyncProvider('wav2lip-http');
    expect(p).toBeTruthy();
    delete process.env.LIPSYNC_API_URL;
    expect(p!.available()).toBe(false);
    process.env.LIPSYNC_API_URL = 'http://localhost:9999/lipsync';
    expect(p!.available()).toBe(true);
    delete process.env.LIPSYNC_API_URL;
  });
});

describe('v9.6.9 · registry 调度', () => {
  beforeEach(() => clearLipSyncProviders());

  it('register / list / get', () => {
    registerLipSyncProvider(fake({ id: 'a' }));
    expect(listLipSyncProviders().map((p) => p.id)).toEqual(['a']);
    expect(getLipSyncProvider('a')?.id).toBe('a');
  });

  it('register 缺字段 → throw', () => {
    expect(() => registerLipSyncProvider({ id: '', generate: fake({}).generate } as LipSyncProvider)).toThrow();
  });

  it('lipSyncEngineConfigured:有 available → true,全不可用 → false', () => {
    expect(lipSyncEngineConfigured()).toBe(false);
    registerLipSyncProvider(fake({ id: 'off', available: () => false }));
    expect(lipSyncEngineConfigured()).toBe(false);
    registerLipSyncProvider(fake({ id: 'on', available: () => true }));
    expect(lipSyncEngineConfigured()).toBe(true);
  });

  it('select:滤掉不可用 + 按 priority 升序 + prefer 顶头', () => {
    registerLipSyncProvider(fake({ id: 'hi', priority: 40 }));
    registerLipSyncProvider(fake({ id: 'lo', priority: 80 }));
    registerLipSyncProvider(fake({ id: 'dead', priority: 10, available: () => false }));
    expect(selectLipSyncProviders().map((p) => p.id)).toEqual(['hi', 'lo']); // dead 被滤
    expect(selectLipSyncProviders({ prefer: 'lo' }).map((p) => p.id)).toEqual(['lo', 'hi']);
  });

  it('select:needsVideoDriver 滤掉只支持静态图的', () => {
    registerLipSyncProvider(fake({ id: 'img', supportsVideoDriver: false }));
    registerLipSyncProvider(fake({ id: 'vid', supportsVideoDriver: true }));
    expect(selectLipSyncProviders({ needsVideoDriver: true }).map((p) => p.id)).toEqual(['vid']);
  });

  it('dispatch:首个成功即用;失败 / 非法 url 自动 fallback;全失败 → null', async () => {
    registerLipSyncProvider(fake({ id: 'boom', priority: 30, generate: async () => { throw new Error('上游炸了'); } }));
    registerLipSyncProvider(fake({ id: 'badurl', priority: 40, generate: async () => ({ videoUrl: 'ftp://nope', provider: 'badurl' }) }));
    registerLipSyncProvider(fake({ id: 'good', priority: 50, generate: async () => ({ videoUrl: 'https://x/ok.mp4', provider: 'good' }) }));
    const r = await dispatchLipSyncGenerate({ faceUrl: 'https://x/f.png', audioUrl: 'https://x/a.mp3' });
    expect(r.result?.provider).toBe('good');
    expect(r.tried.map((t) => `${t.id}:${t.ok}`)).toEqual(['boom:false', 'badurl:false', 'good:true']);

    clearLipSyncProviders();
    registerLipSyncProvider(fake({ id: 'boom', generate: async () => { throw new Error('x'); } }));
    expect((await dispatchLipSyncGenerate({ faceUrl: 'a', audioUrl: 'b' })).result).toBeNull();
  });
});
