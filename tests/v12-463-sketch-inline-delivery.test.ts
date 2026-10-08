/**
 * v12.463 · 本地存储下草图锁的草图终于送得到出图引擎。
 *
 * 链路:草图在本地(`/api/serve-file?…`)→ toEngineImage 转成内联图(data:image/png;base64,…)
 *   → 修前 `mergeSketchIntoRefs` 只收 http,当场丢掉;后面 collectValidRefs / falflux / minimax 也都只收 http。
 * 而提示词照样追加「Strictly follow … the provided reference storyboard sketch」—— 图没给,让模型去猜。
 * 导演台渲的布局草图天生是本地文件;v12.347 起 AI 画的、上传的草图也落到本地 —— 本地部署下草图锁从没真正生效。
 *
 * 只对**官方文档写明**收 base64 的引擎放行(MiniMax、fal;v12.465 加 Seedream,见 lib/image-router INLINE_REF_ENGINES 的出处),
 * MJ / 网关 kontext 维持只收 http。草图送不到时不再追加草图锁提示。
 *
 * v12.465 改:**草图不再送 MiniMax**。真调发现 MiniMax 收图只当人像参考 —— 同一张草图送过去,出图两人并排站在画面正中,
 * 构图没跟;而且本仓给 MiniMax 的 image_file 一直是数组(官方是字符串),每次都被 2013 拒,v12.463 的「送到了」只在模拟请求里成立。
 * 「谁能按草图构图」的新口径与测试见 v12-465-sketch-engine-routing。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isInlineImage, refsForEngine, collectValidRefs, preferInlineRefEngines, INLINE_REF_ENGINES, INLINE_IMAGE_MAX_CHARS,
  type ImageRouteDecision,
} from '@/lib/image-router';
import { mergeSketchIntoRefs } from '@/lib/storyboard-sketch';

const PNG = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;

// toEngineImage 解析站内地址用的是 require(Next 运行时里可用,vitest 的 ESM 环境里没有)——
// 编排器那组测只测「转成内联图之后」的接线;站内地址真能转成 base64 已在 Next 开发服务器里实测(新文件与无扩展名老文件都转出)。
vi.mock('@/lib/first-frame', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/first-frame')>();
  return { ...orig, toEngineImage: (u: string | null | undefined) => (u && u.startsWith('/api/serve-file') ? PNG : orig.toEngineImage(u)) };
});
const HTTP = 'https://cdn.example.com/ref.png';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('v12.463 · 哪些引擎认内联图', () => {
  it('isInlineImage:只认 data:image/…;base64,', () => {
    expect(isInlineImage(PNG)).toBe(true);
    expect(isInlineImage('data:text/plain;base64,AAAA')).toBe(false);
    expect(isInlineImage(HTTP)).toBe(false);
    expect(isInlineImage('/api/serve-file?key=abc')).toBe(false);
  });

  it('**只有官方文档写明支持 base64 的引擎拿得到内联图**;http 谁都给', () => {
    // v12.465 加 seedream(火山方舟官方:image 支持 URL 或 Base64 编码)
    expect([...INLINE_REF_ENGINES].sort()).toEqual(['falflux', 'minimax-multi', 'minimax-single', 'seedream']);
    for (const e of ['falflux', 'minimax-multi', 'minimax-single', 'seedream'] as const) expect(refsForEngine([PNG, HTTP], e)).toEqual([PNG, HTTP]);
    for (const e of ['mj', 'kontext'] as const) expect(refsForEngine([PNG, HTTP], e), e).toEqual([HTTP]);
  });

  it('超过 MiniMax 官方 10MB 上限的内联图不给(省得白发一个必然被拒的请求)', () => {
    const big = `data:image/png;base64,${'A'.repeat(INLINE_IMAGE_MAX_CHARS + 1)}`;
    expect(refsForEngine([big], 'minimax-multi')).toEqual([]);
  });

  it('collectValidRefs 默认仍只收 http(其它调用方零变化);allowInline 才收内联图', () => {
    expect(collectValidRefs({ referenceImages: [PNG, HTTP] })).toEqual([HTTP]);
    expect(collectValidRefs({ referenceImages: [PNG, HTTP, '/api/serve-file?key=x'], allowInline: true })).toEqual([PNG, HTTP]);
  });
});

describe('v12.463 · 有本地草图时认得它的引擎排前面', () => {
  const route = (primary: ImageRouteDecision['primary'], fallbacks: ImageRouteDecision['fallbacks']): ImageRouteDecision => ({ primary, fallbacks, reason: 'r' });

  it('**1–2 张参考图老规矩先给 MJ —— 而 MJ 只看 cref/sref,草图被静默丢掉** → 改为 MiniMax / fal 在前', () => {
    const r = preferInlineRefEngines(route('mj', ['minimax-single', 'kontext']), true);
    expect(r.primary).toBe('minimax-single');
    expect(r.fallbacks).toEqual(['mj', 'kontext']);
    const withFal = preferInlineRefEngines(route('mj', ['falflux', 'minimax-single', 'kontext']), true);
    expect([withFal.primary, ...withFal.fallbacks]).toEqual(['falflux', 'minimax-single', 'mj', 'kontext']);
  });

  it('没有内联图 / 主位已经认得 / 链里一个认得的都没有 → 原样(正常侧)', () => {
    const a = route('mj', ['minimax-single']);
    expect(preferInlineRefEngines(a, false)).toBe(a);
    const b = route('minimax-multi', ['mj']);
    expect(preferInlineRefEngines(b, true)).toBe(b);
    const c = route('mj', ['kontext']);
    expect(preferInlineRefEngines(c, true)).toBe(c);
  });
});

describe('v12.463 · 草图并入参考图', () => {
  it('**mergeSketchIntoRefs 保留内联草图且放最前**;引擎取不到的站内相对地址仍丢', () => {
    expect(mergeSketchIntoRefs(PNG, [HTTP, '/api/serve-file?key=x'])).toEqual([PNG, HTTP]);
  });
  // 「送不送得到」(sketchDeliverable)v12.465 换成「谁能按草图构图」(sketchTargets),见 v12-465-sketch-engine-routing
});

describe('v12.463 · 落盘扩展名:修前 `<key>png` 没有扩展名,本地图认不出 MIME', () => {
  it('**storagePut 传 \'png\' 也落成 .png**(导演台草图、逐帧检视的帧图都这么传)', async () => {
    const { storagePut } = await import('@/lib/storage');
    const put = await storagePut(Buffer.from(`\x89PNG\r\n\x1a\nnodot-${Date.now()}`), 'image/png', 'png');
    expect(put.absPath!.endsWith('.png')).toBe(true);
    const put2 = await storagePut(Buffer.from(`\x89PNG\r\n\x1a\ndot-${Date.now()}`), 'image/png', '.png');
    expect(put2.absPath!.endsWith('.png') && !put2.absPath!.endsWith('..png')).toBe(true);
  });

  it('**已经落成无扩展名的老文件:按文件头认出图片类型**;不是图的照旧认不出', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
    const { sniffImageMime } = await import('@/lib/first-frame');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v12463-'));
    const w = (name: string, b: Buffer) => { const f = path.join(dir, name); fs.writeFileSync(f, b); return f; };
    expect(sniffImageMime(w('k1png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])))).toBe('image/png');
    expect(sniffImageMime(w('k2jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])))).toBe('image/jpeg');
    expect(sniffImageMime(w('k3', Buffer.from('RIFF\0\0\0\0WEBP')))).toBe('image/webp');
    expect(sniffImageMime(w('k4mp4', Buffer.from('\0\0\0\x18ftypmp42')))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('v12.463 · MiniMax 真把内联草图放进请求体', () => {
  it('subject_reference[].image_file 里就是 data URI(官方:支持公网 URL 或 Base64 Data URL;v12.465 起是字符串)', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ data: { image_urls: ['https://minimax.out/img.png'] }, base_resp: { status_code: 0 } }) };
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { MinimaxService } = await import('@/services/minimax.service');
    const svc = new MinimaxService() as any;
    svc.baseURL = 'https://api.minimaxi.com'; svc.apiKey = 'test-key'; svc.imageEndpointAvailable = true;
    const url = await svc.generateImageWithRefs('two people facing off', [PNG, HTTP], { aspectRatio: '9:16' });
    expect(url).toBe('https://minimax.out/img.png');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].subject_reference.map((s: any) => s.image_file)).toEqual([PNG, HTTP]);
  });
});

describe('v12.463 · 编排器:本地草图 + 草图锁(v12.465 改:MiniMax 不再收草图)', () => {
  async function run(avail: { minimax: boolean }) {
    const { storagePut } = await import('@/lib/storage');
    const put = await storagePut(Buffer.from('\x89PNG\r\n\x1a\nstage-sketch'), 'image/png', 'png');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const orch = new HybridOrchestrator() as any;
    const calls: { prompt: string; refs: string[] }[] = [];
    orch.mjService = { generateImage: vi.fn(async (prompt: string) => { calls.push({ prompt, refs: [] }); return 'https://mj.out/x.png'; }) };
    orch.falFluxService = null;
    orch.minimaxService = avail.minimax ? {
      isImageAvailable: () => true,
      generateImageWithRefs: vi.fn(async (prompt: string, refs: string[]) => { calls.push({ prompt, refs }); return 'https://minimax.out/x.png'; }),
      generateImage: vi.fn(async (prompt: string) => { calls.push({ prompt, refs: [] }); return 'https://minimax.out/y.png'; }),
    } : null;
    const out = await orch.doLegacyGenerateImage('a rainy street at night', { sketchUrl: put.url, sketchLock: true, label: 'Shot 1', aspectRatio: '9:16' });
    return { out, calls };
  }

  it('**只有 MiniMax / MJ 可用:没人能按草图构图 → 不加锁,MiniMax 也拿不到草图**(v12.465 改;修前草图被当人像参考送进去)', async () => {
    const { out, calls } = await run({ minimax: true });
    expect(out, '0 张参考图老规矩先给 MJ').toBe('https://mj.out/x.png');
    expect(calls.every((c) => !c.refs.some(isInlineImage)), '谁都不该拿到草图').toBe(true);
    expect(calls[0].prompt).not.toContain('[STORYBOARD LOCK]');
    expect(calls[0].prompt, '窗口自证:是这次出图的提示词').toContain('a rainy street at night');
  });

  it('**MiniMax / fal 都不可用:送不到 → 不追加草图锁提示**(修前照样写「按提供的草图」,图却没给)', async () => {
    const { out, calls } = await run({ minimax: false });
    expect(out).toBe('https://mj.out/x.png');
    expect(calls[0].prompt).not.toContain('[STORYBOARD LOCK]');
    expect(calls[0].prompt, '窗口自证:是这次出图的提示词').toContain('a rainy street at night');
  });
});
