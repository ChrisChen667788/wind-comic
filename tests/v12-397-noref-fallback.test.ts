/**
 * v12.397:四个图像 provider 里,有一个从来没被选中过。
 *
 * owner 的重跑日志里,场景图三个 provider 全挂:
 *   Minimax multi-ref needs at least 1 ref | flux-2-pro 401 Token quota exhausted | MJ submit failed
 * 而第四个 —— `minimax-single`(纯 T2I)—— **一次都没出现在 tried 里**。
 *
 * 它的 `maxRefImages: 0`,而 `selectProviders` 判「refCount > maxRefImages → 排除」。
 * 于是只要传了任何参考图(哪怕只是 styleBible 的风格锚),它就永远出不了场。
 * 结果是「**宁可一张图都没有,也不肯出一张没有风格锚的图**」。
 *
 * 而对场景图来说,参考图是加分项不是必需品:有当然更好,
 * 没有也总比整个项目卡在这里强。
 *
 * 两条边界,缺一不可:
 *   · 只在**主轮全失败**之后才走 —— 不抢正常路径、不改变正常情况下的选路顺序;
 *   · **必须如实标注 refsIgnored 并一路透传到人眼前** —— 只把 URL 存下来、
 *     不说它是怎么来的,就是又一次静默降级。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const codeOf = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('降级轮的行为', () => {
  let registry: typeof import('@/lib/image-providers/registry');

  beforeEach(async () => {
    vi.resetModules();
    registry = await import('@/lib/image-providers/registry');
  });
  afterEach(() => vi.restoreAllMocks());

  /** 造一个「支持 ref 但必然失败」的 + 一个「不支持 ref 但能出图」的 */
  function setup(failMsg = 'boom') {
    registry.registerImageProvider({
      id: 'needs-ref', name: 'needs ref', supportsRefs: true,
      maxRefImages: 4, minRefImages: 1, priority: 10,
      available: () => true,
      generate: async () => { throw new Error(failMsg); },
    } as any);
    registry.registerImageProvider({
      id: 'no-ref-only', name: 'T2I only', supportsRefs: false,
      maxRefImages: 0, priority: 20,
      available: () => true,
      generate: async () => ({ imageUrl: 'https://cdn/x.png', provider: 'no-ref-only' }),
    } as any);
  }

  it('主轮全失败 → 走降级轮出图,并标 refsIgnored', async () => {
    setup();
    const r = await registry.dispatchImageGenerate(
      { prompt: 'p', referenceImages: ['https://a/1.png'] } as any,
      { refCount: 1 } as any,
    );
    expect(r.result?.imageUrl, '本来一张图都出不来').toBe('https://cdn/x.png');
    expect(r.result?.refsIgnored, '不标注就是静默降级').toBe(true);
    // 主轮那次失败要留在 tried 里,便于排查
    expect(r.tried.some((t) => t.id === 'needs-ref')).toBe(true);
  });

  it('主轮成功时**不**走降级轮,也不该有 refsIgnored', async () => {
    registry.registerImageProvider({
      id: 'ok-with-ref', name: 'ok', supportsRefs: true, maxRefImages: 4, priority: 5,
      available: () => true,
      generate: async () => ({ imageUrl: 'https://cdn/main.png', provider: 'ok-with-ref' }),
    } as any);
    setup();
    const r = await registry.dispatchImageGenerate(
      { prompt: 'p', referenceImages: ['https://a/1.png'] } as any,
      { refCount: 1 } as any,
    );
    expect(r.result?.imageUrl).toBe('https://cdn/main.png');
    expect(r.result?.refsIgnored).toBeUndefined();
  });

  it('本来就没有参考图时不触发降级轮 —— 那不是降级,是正常路径', async () => {
    setup();
    const r = await registry.dispatchImageGenerate({ prompt: 'p' } as any, { refCount: 0 } as any);
    // refCount 0 时 no-ref-only 本来就在主轮里,结果不该被标成降级
    expect(r.result?.refsIgnored).toBeUndefined();
  });

  it('降级轮里的失败也记进 tried,带 (no-ref) 后缀便于区分', async () => {
    registry.registerImageProvider({
      id: 'needs-ref', name: 'x', supportsRefs: true, maxRefImages: 4, minRefImages: 1, priority: 10,
      available: () => true, generate: async () => { throw new Error('main fail'); },
    } as any);
    registry.registerImageProvider({
      id: 'no-ref-only', name: 'y', supportsRefs: false, maxRefImages: 0, priority: 20,
      available: () => true, generate: async () => { throw new Error('fallback fail'); },
    } as any);
    const r = await registry.dispatchImageGenerate(
      { prompt: 'p', referenceImages: ['https://a/1.png'] } as any,
      { refCount: 1 } as any,
    );
    expect(r.result).toBeNull();
    expect(r.tried.some((t) => t.id.includes('(no-ref)')), '分不清是主轮还是降级轮失败的').toBe(true);
  });
});

describe('标注一路透传到人眼前', () => {
  it('registry 返回 refsIgnored', () => {
    expect(codeOf(read('lib/image-providers/registry.ts'))).toContain('refsIgnored: true');
  });

  it('类型里有这个字段,不是靠 any 硬塞', () => {
    expect(read('lib/image-providers/types.ts')).toContain('refsIgnored?: boolean');
  });

  it('API 把它写进资产、也回给调用方 —— 只存 URL 不说来历就是静默降级', () => {
    const code = codeOf(read('app/api/projects/[id]/regenerate-asset-image/route.ts'));
    expect(code).toContain('refsIgnored');
    const i = code.indexOf('upsertAsset(');
    expect(i).toBeGreaterThan(0);
    const win = code.slice(i, i + 400);
    expect(win, '窗口自证').toContain('mediaUrls');
    expect(win, '资产里要留痕,否则事后分不清这张图为什么不一样').toContain('refsIgnored');
  });

  it('插件链边界也透出(否则标了没人看得见)', () => {
    expect(codeOf(read('lib/plugin-chain-router.ts'))).toContain("refsIgnored ? '(no-ref)'");
  });

  it('重跑脚本会打出来 —— owner 看日志就知道哪几张没有风格锚', () => {
    const s = read('scripts/rerun-project.mjs');
    expect(s).toContain('j.refsIgnored');
    expect(s).toMatch(/无参考图/);
  });
});
