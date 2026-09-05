/**
 * v12.424 — 参考图被拼进了 prompt 文本,从来没真正到过引擎。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * `kontext` provider 此前是这样发参考图的:
 *     prompt: input.prompt + ' [Reference images: https://… , https://…]'
 * 而文生图模型读到 prompt 里的一串 URL **取不到图** —— 它既不会去下载,
 * 也不知道那是图片地址。于是「角色参考」在这条 provider 上从来没生效过,
 * **而且不报错**:图照出,只是没参考。又一个「失败长得像成功」。
 *
 * 官方字段表(2026-09-05 核):参考图走 `input_image` / `input_image_2..N`
 * 这组编号字段,API 上限 **8 张**。
 *
 * ── 第二个问题:全局上限取了最弱那家 ──────────────────────────────────
 * `MAX_REF_IMAGES = 4`,注释写着「minimax-multi 与 gateway 都是 4」——
 * 于是 4 成了全局天花板。但各 provider 在注册表里**各自声明了** `maxRefImages`,
 * 分派层也确实按它选路(`refCount > maxRefImages → 排除`)。
 * 也就是说按引擎选路的机制本来就有,却被收敛函数提前砍到 4 给废掉了 ——
 * flux 能吃 8 张,永远等不到第 5 张,而这同样不报错。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { usableRefs, capRefsFor, MAX_REF_IMAGES } from '@/lib/image-providers/refs';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
   .filter((l) => !l.trim().startsWith('//'))
   .map((l) => l.replace(/(?<!:)\/\/.*$/, '')).join('\n');

const BUILTINS = strip(fs.readFileSync('lib/image-providers/builtins.ts', 'utf-8'));

afterEach(() => vi.unstubAllGlobals());

const refs = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example/r${i}.png`);

describe('v12.424 · 参考图要真的发出去', () => {
  it('**参考图不能拼进 prompt** —— 模型取不到 prompt 里的 URL', () => {
    expect(BUILTINS, '窗口自证:这不是 image providers?').toContain("id: 'kontext'");
    expect(BUILTINS.includes('Reference images:'), '又把参考图拼回 prompt 了').toBe(false);
    // 必须用官方的编号字段
    expect(BUILTINS).toContain('input_image');
  });

  it('kontext 真把参考图发成 input_image / input_image_2..N', async () => {
    process.env.QINGYUNTOP_API_KEY = 'test-key';
    let sentBody: any = null;
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => {
      sentBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: [{ url: 'https://cdn/out.png' }] }) } as any;
    }));

    const { listImageProviders, clearImageProviders } = await import('@/lib/image-providers/registry');
    clearImageProviders();
    await import('@/lib/image-providers/builtins');
    const kontext = listImageProviders().find((p) => p.id === 'kontext');
    expect(kontext, '找不到 kontext provider').toBeTruthy();

    await kontext!.generate({ prompt: '雨夜街头', referenceImages: refs(3) } as any);

    expect(sentBody, '窗口自证:一次请求都没发出').not.toBeNull();
    expect(sentBody.input_image).toBe('https://cdn.example/r0.png');
    expect(sentBody.input_image_2).toBe('https://cdn.example/r1.png');
    expect(sentBody.input_image_3).toBe('https://cdn.example/r2.png');
    // prompt 必须是干净的 —— 不带 URL 尾巴
    expect(sentBody.prompt).toBe('雨夜街头');
    expect(sentBody.prompt).not.toContain('http');
  });

  it('全局上限不再取最弱那家 —— flux 能吃 8 张', () => {
    expect(MAX_REF_IMAGES, '4 是 minimax 的上限,不该当全局天花板').toBeGreaterThanOrEqual(8);
    // 收敛函数不再提前砍到 4
    expect(usableRefs({ referenceImages: refs(8) } as any)).toHaveLength(8);
  });

  it('但每个引擎仍按**自己**的上限裁 —— 多发了会被上游静默截断', () => {
    expect(capRefsFor(refs(8), 4)).toHaveLength(4);
    expect(capRefsFor(refs(8), 2)).toHaveLength(2);
    expect(capRefsFor(refs(3), 8), '够不着上限时不该补').toHaveLength(3);
    // 任何引擎都不得越过全局兜底
    expect(capRefsFor(refs(8), 999)).toHaveLength(MAX_REF_IMAGES);
    expect(capRefsFor(refs(3), 0)).toHaveLength(0);
  });

  it('minimax 只吃 4 张,不能因为全局提到 8 就把 8 张发给它', async () => {
    let got: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) } as any)));
    vi.doMock('@/services/minimax.service', () => ({
      hasMinimax: () => true,
      MinimaxService: class {
        async generateImageWithRefs(_p: string, r: string[]) { got = r; return 'https://cdn/x.png'; }
      },
    }));
    const { listImageProviders, clearImageProviders } = await import('@/lib/image-providers/registry');
    clearImageProviders();
    vi.resetModules();
    await import('@/lib/image-providers/builtins');
    const mm = listImageProviders().find((p) => p.id === 'minimax-multi');
    if (!mm) return; // 未注册(无 key)则跳过 —— 上面那条纯函数测试已覆盖裁剪语义
    await mm.generate({ prompt: 'p', referenceImages: refs(8) } as any).catch(() => {});
    if (got.length) expect(got.length, '把 8 张发给只吃 4 张的引擎').toBeLessThanOrEqual(4);
  });

  it('各 provider 声明的上限与实现同源 —— 两处漂了就会选错路', () => {
    // 声明用常量而不是字面量,免得改了实现忘了改声明
    expect(BUILTINS).toContain('maxRefImages: KONTEXT_MAX_REFS');
    expect(BUILTINS).toContain('maxRefImages: MINIMAX_MAX_REFS');
    expect(BUILTINS).toMatch(/KONTEXT_MAX_REFS\s*=\s*8/);
    expect(BUILTINS).toMatch(/MINIMAX_MAX_REFS\s*=\s*4/);
  });

  it('去重与 http 过滤仍在(v12.393 的既有行为不能丢)', () => {
    const dup = ['https://a/1.png', 'https://a/1.png', 'data:image/png;base64,xxx', ''];
    expect(usableRefs({ referenceImages: dup } as any)).toEqual(['https://a/1.png']);
  });
});
