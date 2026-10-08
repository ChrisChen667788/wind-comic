/**
 * v12.465 · 草图交给「真会按草图构图」的引擎,MiniMax 只收人像参考;MiniMax 参考图请求格式修正。
 *
 * 真调(每家只出一张)撞出来的三件事:
 *   ① MiniMax `subject_reference[].image_file` 官方是**字符串**,本仓自 v2.20 一直传数组 →
 *      每次 2013「传入参数异常」(真人正脸照也一样被拒),带参考图的 MiniMax 出图从没成功过,静默退到下一个引擎;
 *      改成字符串后同一请求出图成功。
 *   ② 草图送 MiniMax 不锁构图:官方「主体类型,当前仅支持 character(人像)」;同一张草图
 *      (左下近处大人、右上远处小人)出图是两人并排站在画面正中。v12.463 把草图优先送 MiniMax 是错的。
 *   ③ 能按草图构图的:fal Kontext(编辑输入图本身)、Seedream(火山方舟官方:image 支持 URL 或 Base64);
 *      MJ 走垫图(midjourney-proxy 的 base64Array,源码核实)但灰块草图会不会把画面带灰没验证 → 默认关。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sketchEnginesFor, preferInlineRefEngines, refsForEngine, stripSketchLock, type ImageRouteDecision,
} from '@/lib/image-router';
import { sketchTargets } from '@/lib/storyboard-sketch';

const PNG = `data:image/png;base64,${Buffer.from('fake-sketch-png').toString('base64')}`;
const HTTP_SKETCH = 'https://cdn.example.com/sketch.png';
const CHAR = ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png', 'https://cdn.example.com/c.png'];

// 同 v12-463:vitest 的 ESM 环境里没有 require,站内地址转内联图那一步打桩
vi.mock('@/lib/first-frame', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/first-frame')>();
  return { ...orig, toEngineImage: (u: string | null | undefined) => (u && u.startsWith('/api/serve-file') ? PNG : orig.toEngineImage(u)) };
});
// Seedream 出图后的画幅守门要下载图片 —— 这里只关心发出去的请求
vi.mock('@/lib/image-aspect-guard', () => ({ ensureImageAspect: async (u: string) => u }));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('v12.465 · stripSketchLock 只去掉草图锁那一句', () => {
  it('去锁句、保留其余提示词(包括换行后追加的画中字说明)', async () => {
    const { buildSketchDirective } = await import('@/lib/storyboard-sketch');
    const p = `a rainy street${buildSketchDirective({ shotSize: 'LS', angle: 'high' })}\nRender the sign text exactly: 雨夜`;
    expect(p).toContain('[STORYBOARD LOCK]');
    expect(stripSketchLock(p)).toBe('a rainy street\nRender the sign text exactly: 雨夜');
    expect(stripSketchLock('no lock here')).toBe('no lock here');
  });
});

describe('v12.465 · 谁能按草图构图(sketchEnginesFor)', () => {
  it('默认:fal + Seedream;**MiniMax 不在内**(它收图只当人像参考)', () => {
    expect(sketchEnginesFor(PNG, {})).toEqual(['falflux', 'seedream']);
    expect(sketchEnginesFor(HTTP_SKETCH, {})).toEqual(['falflux', 'seedream']);
    for (const env of [{}, { MJ_SKETCH_IMAGE_PROMPT: '1', KONTEXT_GATEWAY_IMAGE_INPUT: '1' }]) {
      expect(sketchEnginesFor(HTTP_SKETCH, env)).not.toContain('minimax-multi');
      expect(sketchEnginesFor(HTTP_SKETCH, env)).not.toContain('minimax-single');
    }
  });

  it('MJ 垫图默认关,MJ_SKETCH_IMAGE_PROMPT=1 才开;网关 kontext 沿用 KONTEXT_GATEWAY_IMAGE_INPUT=1 且只收公网草图', () => {
    expect(sketchEnginesFor(PNG, { MJ_SKETCH_IMAGE_PROMPT: '1' })).toEqual(['falflux', 'seedream', 'mj']);
    expect(sketchEnginesFor(PNG, { KONTEXT_GATEWAY_IMAGE_INPUT: '1' }), '内联草图不给网关 kontext').toEqual(['falflux', 'seedream']);
    expect(sketchEnginesFor(HTTP_SKETCH, { KONTEXT_GATEWAY_IMAGE_INPUT: '1' })).toEqual(['falflux', 'seedream', 'kontext']);
  });

  it('关掉 Seedream 参考图生图(或整档)就不算它', () => {
    expect(sketchEnginesFor(PNG, { SEEDREAM_I2I_DISABLE: '1' })).toEqual(['falflux']);
    expect(sketchEnginesFor(PNG, { IMAGE_SEEDREAM_DISABLE: '1' })).toEqual(['falflux']);
  });
});

describe('v12.465 · sketchTargets:只算当前可用的', () => {
  it('按可用性过滤;都不可用 → 空,并说出来(不静默)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(sketchTargets(PNG, { falflux: false, seedream: true, mj: true }, {})).toEqual(['seedream']);
    expect(sketchTargets(PNG, { falflux: true, seedream: true }, {})).toEqual(['falflux', 'seedream']);
    expect(warn).not.toHaveBeenCalled();
    expect(sketchTargets(PNG, { 'minimax-multi': true, 'minimax-single': true, mj: true }, {}), '只有 MiniMax / MJ(没开垫图)').toEqual([]);
    expect(sketchTargets('/api/serve-file?key=x', { falflux: true, seedream: true }, {}), '引擎取不到的站内地址').toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('v12.465 · 有草图时能按草图构图的引擎排前面', () => {
  const route = (primary: ImageRouteDecision['primary'], fallbacks: ImageRouteDecision['fallbacks']): ImageRouteDecision => ({ primary, fallbacks, reason: 'r' });

  it('**MJ 主位 + MiniMax 在前 → Seedream 提到最前,MiniMax 不因草图被提前**', () => {
    const r = preferInlineRefEngines(route('mj', ['minimax-single', 'kontext', 'seedream']), true, ['seedream']);
    expect([r.primary, ...r.fallbacks]).toEqual(['seedream', 'mj', 'minimax-single', 'kontext']);
  });

  it('没有草图时仍是 v12.463 的「内联图 → 认得的在前」;都没有就原样(正常侧)', () => {
    const r = preferInlineRefEngines(route('mj', ['minimax-single', 'kontext']), true);
    expect(r.primary).toBe('minimax-single');
    const a = route('mj', ['minimax-single']);
    expect(preferInlineRefEngines(a, false)).toBe(a);
    expect(preferInlineRefEngines(a, false, [])).toBe(a);
  });

  it('Seedream 现在拿得到内联图(火山方舟官方支持 Base64);MJ / 网关 kontext 仍只给公网图', () => {
    expect(refsForEngine([PNG, CHAR[0]], 'seedream')).toEqual([PNG, CHAR[0]]);
    expect(refsForEngine([PNG, CHAR[0]], 'mj')).toEqual([CHAR[0]]);
    expect(refsForEngine([PNG, CHAR[0]], 'kontext')).toEqual([CHAR[0]]);
  });
});

describe('v12.465 · MiniMax 参考图请求格式', () => {
  async function bodyOf(refs: string[]) {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ data: { image_urls: ['https://minimax.out/img.png'] }, base_resp: { status_code: 0 } }) };
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { MinimaxService } = await import('@/services/minimax.service');
    const svc = new MinimaxService() as any;
    svc.baseURL = 'https://api.minimaxi.com'; svc.apiKey = 'test-key'; svc.imageEndpointAvailable = true;
    expect(await svc.generateImageWithRefs('a portrait', refs, { aspectRatio: '9:16' })).toBe('https://minimax.out/img.png');
    return bodies[0];
  }

  it('**image_file 是字符串**(官方示例 `"image_file": "https://…"`;修前是数组,每次 2013 被拒)', async () => {
    const body = await bodyOf([CHAR[0], PNG]);
    expect(body.subject_reference).toEqual([
      { type: 'character', image_file: CHAR[0] },
      { type: 'character', image_file: PNG },
    ]);
    for (const s of body.subject_reference) expect(typeof s.image_file).toBe('string');
  });
});

describe('v12.465 · MJ 垫图(midjourney-proxy base64Array)', () => {
  async function submitBody(imagePrompts?: string[]) {
    const bodies: any[] = [];
    // 只看提交的请求体:提交即回失败,省掉轮询(轮询有真实的等待间隔)
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u).includes('/mj/submit/imagine')) bodies.push(JSON.parse(String(init!.body)));
      return { ok: true, status: 200, json: async () => ({ code: 0, description: 'stop-after-submit' }) };
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { MidjourneyService } = await import('@/services/midjourney.service');
    const svc = new MidjourneyService('test-key');
    await expect(svc.generateImage('a rainy street', { aspectRatio: '9:16', imagePrompts, skipUpscale: true })).rejects.toThrow('stop-after-submit');
    expect(bodies).toHaveLength(1);
    return bodies[0];
  }

  it('内联图进 base64Array(完整 data URL);公网图按 MJ 语法写在提示词最前', async () => {
    const b = await submitBody([PNG, HTTP_SKETCH]);
    expect(b.base64Array).toEqual([PNG]);
    expect(b.prompt.startsWith(`${HTTP_SKETCH} a rainy street`)).toBe(true);
  });

  it('**没给垫图:请求体与修前一样只有 prompt**(正常侧);裸 base64 / 站内地址不收', async () => {
    const plain = await submitBody();
    expect(Object.keys(plain)).toEqual(['prompt']);
    expect(plain.prompt.startsWith('a rainy street')).toBe(true);
    const junk = await submitBody(['iVBORw0KGgo=', '/api/serve-file?key=x']);
    expect(Object.keys(junk)).toEqual(['prompt']);
  });
});

describe('v12.465 · 编排器:草图只交给能按它构图的引擎', () => {
  type Call = { engine: string; prompt: string; refs: string[]; imagePrompts?: string[] };
  async function run(opts: { fal?: 'ok' | 'fail'; minimax?: boolean; mj?: boolean | 'fail'; env?: Record<string, string>; refs?: string[]; gatewayStatus?: number; before?: () => Promise<void>; comfy?: boolean }) {
    for (const [k, v] of Object.entries(opts.env || {})) vi.stubEnv(k, v);
    vi.resetModules();   // API_CONFIG 在模块加载时读环境变量
    await opts.before?.();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storagePut } = await import('@/lib/storage');
    const put = await storagePut(Buffer.from('\x89PNG\r\n\x1a\nv12465-sketch'), 'image/png', 'png');
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const orch = new HybridOrchestrator() as any;
    const calls: Call[] = [];
    orch.mjService = opts.mj === false ? null : { generateImage: vi.fn(async (prompt: string, o: any) => {
      calls.push({ engine: 'mj', prompt, refs: [], imagePrompts: o?.imagePrompts });
      if (opts.mj === 'fail') throw new Error('mj down');
      return 'https://mj.out/x.png';
    }) };
    orch.comfyuiService = opts.comfy ? {
      generateWithControlNet: vi.fn(async (prompt: string, o: any) => { calls.push({ engine: 'comfy-controlnet', prompt, refs: [o.controlImageUrl] }); return 'https://comfy.out/x.png'; }),
      generateWithIPAdapter: vi.fn(async (prompt: string) => { calls.push({ engine: 'comfy-ipadapter', prompt, refs: [] }); return 'https://comfy.out/y.png'; }),
    } : null;
    orch.falFluxService = opts.fal ? { generateImage: vi.fn(async (prompt: string, o: any) => {
      calls.push({ engine: 'falflux', prompt, refs: o.referenceImages });
      if (opts.fal === 'fail') throw new Error('fal down');
      return 'https://fal.out/x.png';
    }) } : null;
    orch.minimaxService = opts.minimax ? {
      isImageAvailable: () => true,
      generateImageWithRefs: vi.fn(async (prompt: string, refs: string[]) => { calls.push({ engine: 'minimax', prompt, refs }); return 'https://minimax.out/x.png'; }),
      generateImage: vi.fn(async (prompt: string) => { calls.push({ engine: 'minimax', prompt, refs: [] }); return 'https://minimax.out/y.png'; }),
    } : null;
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      bodies.push({ url: String(u), body: init?.body ? JSON.parse(String(init.body)) : null });
      const status = opts.gatewayStatus ?? 200;
      if (status !== 200) return { ok: false, status, json: async () => ({}), text: async () => '{"error":{"message":"Token quota exhausted","type":"new_api_error"}}' };
      return { ok: true, status: 200, json: async () => ({ data: [{ url: 'https://seedream.out/x.png' }] }), text: async () => '' };
    }));
    const out = await orch.doLegacyGenerateImage('a rainy street at night', {
      sketchUrl: put.url, sketchLock: true, label: 'Shot 1', aspectRatio: '9:16', referenceImages: opts.refs,
    });
    const warned = warn.mock.calls.map((c) => String(c[0]));
    return { out, calls, bodies, warned };
  }

  it('**fal 可用:草图(内联图)送到 fal 且排最前,提示词带锁;MiniMax 没被叫到**', async () => {
    const { out, calls } = await run({ fal: 'ok', minimax: true });
    expect(out).toBe('https://fal.out/x.png');
    expect(calls).toHaveLength(1);
    expect(calls[0].engine).toBe('falflux');
    expect(calls[0].refs[0]).toBe(PNG);
    expect(calls[0].prompt).toContain('[STORYBOARD LOCK]');
  });

  it('**fal 挂了退到 MiniMax:MiniMax 只拿人物参考图,草图被剔掉**', async () => {
    const { out, calls } = await run({ fal: 'fail', minimax: true, mj: false, refs: CHAR });
    expect(out).toBe('https://minimax.out/x.png');
    const mm = calls.find((c) => c.engine === 'minimax')!;
    expect(mm.refs).toEqual(CHAR);
    expect(mm.refs).not.toContain(PNG);
    expect(calls[0].engine, '窗口自证:草图确实先给了 fal').toBe('falflux');
  });

  it('**Seedream 可用(网关有 key):排到 MJ 前面,请求体 image 里第一张就是草图**', async () => {
    const { out, bodies, calls } = await run({ minimax: true, env: { QINGYUNTOP_API_KEY: 'test-qyt' } });
    expect(out).toBe('https://seedream.out/x.png');
    expect(calls, 'MJ / MiniMax 都没被叫到').toHaveLength(0);
    const req = bodies.find((b) => b.url.endsWith('/v1/images/generations'))!;
    expect(req.body.image, '只有草图一张参考图 → 字符串形态').toBe(PNG);
    expect(req.body.prompt).toContain('[STORYBOARD LOCK]');
  });

  it('**Seedream 拿着草图失败(网关额度耗尽)→ 退到 MJ:MJ 的提示词不再带草图锁**(它没拿到草图)', async () => {
    const { out, bodies, calls } = await run({ env: { QINGYUNTOP_API_KEY: 'test-qyt' }, gatewayStatus: 401 });
    expect(out).toBe('https://mj.out/x.png');
    const sd = bodies.filter((b) => b.url.endsWith('/v1/images/generations'));
    expect(sd.length, '窗口自证:先试了 Seedream').toBeGreaterThan(0);
    expect(sd[0].body.prompt, 'Seedream 拿着草图 → 带锁').toContain('[STORYBOARD LOCK]');
    expect(calls[0].engine).toBe('mj');
    expect(calls[0].prompt).not.toContain('[STORYBOARD LOCK]');
    expect(calls[0].prompt).toContain('a rainy street at night');
  });

  it('网关已知额度耗尽(冷却中):Seedream 不算能用 → 只剩它能用时不加锁、也不把草图塞进参考图', async () => {
    const { calls, bodies, warned } = await run({
      env: { QINGYUNTOP_API_KEY: 'test-qyt' },
      before: async () => {
        const { markGatewayOutOfCredits } = await import('@/lib/gateway-budget');
        markGatewayOutOfCredits('https://api.qingyuntop.top');
      },
    });
    expect(warned.some((w) => w.includes('草图没有引擎能用')), '路由前就知道没人能用草图').toBe(true);
    expect(bodies.filter((b) => b.url.endsWith('/v1/images/generations')), '没去撞冷却中的网关').toHaveLength(0);
    expect(calls[0].engine).toBe('mj');
    expect(calls[0].prompt).not.toContain('[STORYBOARD LOCK]');
  });

  it('**引擎链全挂、退到 ComfyUI ControlNet(拿着草图):带锁** —— 修前用的是被上一个引擎剥过锁的提示词', async () => {
    const { out, calls } = await run({
      env: { QINGYUNTOP_API_KEY: 'test-qyt', COMFYUI_ENABLED: 'true', COMFYUI_CONTROLNET_MODEL: 'canny' },
      gatewayStatus: 401, mj: 'fail', comfy: true,
    });
    expect(out).toBe('https://comfy.out/x.png');
    const mj = calls.find((c) => c.engine === 'mj')!;
    expect(mj.prompt, '窗口自证:链里最后试的 MJ 拿的是去锁的提示词').not.toContain('[STORYBOARD LOCK]');
    const cn = calls.find((c) => c.engine === 'comfy-controlnet')!;
    expect(cn.prompt).toContain('[STORYBOARD LOCK]');
    expect(cn.prompt).toContain('a rainy street at night');
  });

  it('MJ 垫图打开(且只有 MJ 能用):草图作 imagePrompts 交给 MJ,提示词带锁', async () => {
    const { out, calls } = await run({ env: { MJ_SKETCH_IMAGE_PROMPT: '1' } });
    expect(out).toBe('https://mj.out/x.png');
    expect(calls[0].imagePrompts).toEqual([PNG]);
    expect(calls[0].prompt).toContain('[STORYBOARD LOCK]');
  });

  it('MJ 垫图没开:MJ 不拿草图、提示词不带锁(正常侧)', async () => {
    const { calls } = await run({});
    expect(calls[0].engine).toBe('mj');
    expect(calls[0].imagePrompts).toBeUndefined();
    expect(calls[0].prompt).not.toContain('[STORYBOARD LOCK]');
    expect(calls[0].prompt).toContain('a rainy street at night');
  });
});
