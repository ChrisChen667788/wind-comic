/**
 * v12.55 — 产品抠图 provider(rembg/HTTP 后端探测 + 命令拼装)。纯逻辑测试。
 */
import { describe, it, expect } from 'vitest';
import { rembgCliArgs, resolveBgRemovalBackend, bgRemovalAvailable, prepProductReferences } from '@/lib/image-tools/bg-removal';

describe('v12.55 · 抠图 provider 纯逻辑', () => {
  it('rembgCliArgs:i [-m model] input output', () => {
    expect(rembgCliArgs('a.png', 'b.png')).toEqual(['i', 'a.png', 'b.png']);
    expect(rembgCliArgs('a.png', 'b.png', 'isnet-general-use')).toEqual(['i', '-m', 'isnet-general-use', 'a.png', 'b.png']);
  });

  it('resolveBgRemovalBackend:HTTP 优先,其次 REMBG_CMD,都没有 → null', () => {
    expect(resolveBgRemovalBackend({ BG_REMOVAL_URL: 'https://bg.example/api/remove' } as any))
      .toEqual({ kind: 'http', url: 'https://bg.example/api/remove' });
    expect(resolveBgRemovalBackend({ REMBG_CMD: '/usr/bin/rembg' } as any))
      .toEqual({ kind: 'rembg-cli', cmd: '/usr/bin/rembg' });
    // HTTP 优先于 CLI
    expect(resolveBgRemovalBackend({ BG_REMOVAL_URL: 'http://x/api', REMBG_CMD: 'rembg' } as any).kind).toBe('http');
    expect(resolveBgRemovalBackend({} as any)).toBeNull();
  });

  it('非法 BG_REMOVAL_URL(非 http)被忽略', () => {
    expect(resolveBgRemovalBackend({ BG_REMOVAL_URL: 'ftp://nope' } as any)).toBeNull();
  });

  it('bgRemovalAvailable:显式配置即 true', () => {
    expect(bgRemovalAvailable({ BG_REMOVAL_URL: 'https://x/api' } as any)).toBe(true);
    expect(bgRemovalAvailable({ REMBG_CMD: 'rembg' } as any)).toBe(true);
  });

  it('prepProductReferences:空/全 falsy 输入短路返回(不碰后端)', async () => {
    expect(await prepProductReferences([])).toEqual([]);
    expect(await prepProductReferences([null, undefined, ''])).toEqual([]);
  });
});
