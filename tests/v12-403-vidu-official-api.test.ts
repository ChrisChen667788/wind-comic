/**
 * v12.403 — 这条 Vidu 路径**从来就跑不通**,而决策日志还在替它撒谎。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * v12.401 做竞品复核时,我为了核实「我们接的 Vidu 是哪一版」去读源码,
 * 发现它一个 `model` 字段都不传。顺着官方字段表逐项对下来,错的不止一处 ——
 * 端点、鉴权方案、图片入参形态、必填 model、查询端点、状态字段,**六处全错**。
 * 也就是说它每次都失败、每次静默回落到 Kling,所以谁也没发现。
 *
 * 而 `app/api/u2v/route.ts` 把结果标成 `model: 'Vidu-Q3-Pro-15s'` ——
 * **决策日志里记着一件没发生过的事**。这个项目有「逐镜可审计决策日志」这项能力,
 * 一条撒谎的记录比没有记录更糟:它让复盘从错误的前提开始。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 锁「照着官方字段表发请求」,而不是「没报错」。历史教训在此格外贴切:
 * 上游静默忽略不认识的字段,而响应里的回显常常是请求参数的镜像 ——
 * 于是错的请求看起来像是生效了。所以这里逐字段比对,并且**禁掉旧的错写法复活**。
 *
 * 官方字段表(2026-09-02 核):
 *   https://platform.vidu.com/docs/image-to-video
 *   https://platform.vidu.com/docs/get-generation
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';

/**
 * 断言「某写法不存在」之前必须先剥掉注释 —— 否则命中的是文档里那张
 * 「旧实现 vs 官方」对照表(它当然要写出旧的错写法)。这个坑本项目栽过多次:
 * 只剥了 import 没剥注释、或反过来。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

const SRC = stripComments(fs.readFileSync('services/vidu.service.ts', 'utf-8'));

/** 跑一次 generateVideo,把它实际发出的 fetch 调用截下来 */
async function captureRequests(opts?: { duration?: number }) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchMock = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return { ok: true, json: async () => ({ task_id: 'TASK-1' }) } as any;
    }
    return {
      ok: true,
      json: async () => ({ state: 'success', creations: [{ url: 'https://cdn/out.mp4' }] }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  process.env.VIDU_API_KEY = 'test-key';

  const { ViduService } = await import('@/services/vidu.service');
  const svc = new ViduService();
  // 轮询前有 5s sleep —— 用假时钟推过去,别真等
  vi.useFakeTimers();
  const p = svc.generateVideo('https://x/first.png', '一个镜头', opts);
  await vi.advanceTimersByTimeAsync(6000);
  const url = await p;
  vi.useRealTimers();
  return { calls, url, svc };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('v12.403 · Vidu 官方 API', () => {
  it('创建请求打的是官方端点,且鉴权用 Token 而不是 Bearer', async () => {
    const { calls } = await captureRequests();
    expect(calls.length, '窗口自证:一次请求都没发出').toBeGreaterThanOrEqual(1);
    expect(calls[0].url).toBe('https://api.vidu.com/ent/v2/img2video');
    // 写成 Bearer 会得到 401,而 401 长得像「key 不对」—— 人会去反复换 key
    expect(calls[0].init.headers.Authorization).toMatch(/^Token /);
    expect(calls[0].init.headers.Authorization).not.toMatch(/^Bearer /);
  });

  it('请求体逐字段符合官方 schema:model 必填、images 是数组', async () => {
    const { calls } = await captureRequests({ duration: 15 });
    const body = JSON.parse(calls[0].init.body);
    expect(body.model, 'model 是官方必填项 —— 旧实现整个漏了').toBe('viduq3-pro');
    expect(Array.isArray(body.images), 'images 是数组,旧实现发的是 image_url 字符串').toBe(true);
    expect(body.images).toEqual(['https://x/first.png']);
    expect(body.duration).toBe(15);
    expect(body.resolution).toBeTruthy();
    // 旧实现里那两个官方根本不存在的字段不得复活(上游会静默忽略 → 看起来像生效了)
    expect(body.image_url).toBeUndefined();
    expect(body.style).toBeUndefined();
  });

  it('轮询打的是官方查询端点,并从 creations[0].url 取片', async () => {
    const { calls, url } = await captureRequests();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[1].url).toBe('https://api.vidu.com/ent/v2/tasks/TASK-1/creations');
    expect(url).toBe('https://cdn/out.mp4');
  });

  it('实际发出的模型会被记下来 —— 决策日志不能再自己编一个标签', async () => {
    const { svc } = await captureRequests();
    expect(svc.lastModel).toBe('viduq3-pro');
  });

  it('VIDU_MODEL 只接受官方模型 id,乱填回落到默认而不是照发', async () => {
    const { viduModel, VIDU_DEFAULT_MODEL, VIDU_MODELS } = await import('@/lib/../services/vidu.service');
    const prev = process.env.VIDU_MODEL;
    try {
      process.env.VIDU_MODEL = 'viduq3-turbo';
      expect(viduModel()).toBe('viduq3-turbo');
      process.env.VIDU_MODEL = 'vidu-nonexistent';
      expect(viduModel(), '乱填就照发 = 把一个必然 400 的请求送出去').toBe(VIDU_DEFAULT_MODEL);
      expect(VIDU_MODELS).toContain(VIDU_DEFAULT_MODEL);
    } finally {
      if (prev === undefined) delete process.env.VIDU_MODEL;
      else process.env.VIDU_MODEL = prev;
    }
  });

  it('六处旧错写法一处都不许复活', () => {
    // 窗口自证:先确认读到的确实是这个服务
    expect(SRC).toContain('img2video');
    expect(SRC).toContain('creations');
    for (const wrong of [
      '/v1/video/generate',        // 错端点
      '/v1/video/query/',          // 错查询端点
      'image_url: imageUrl',       // 错入参形态
      "'realistic'",               // 官方没有的 style 值
    ]) {
      expect(SRC.includes(wrong), `旧错写法复活了:${wrong}`).toBe(false);
    }
    expect(SRC.includes('Bearer'), '鉴权又写回 Bearer 了').toBe(false);
  });

  it('u2v 路由不得再硬编模型标签', () => {
    const route = fs.readFileSync('app/api/u2v/route.ts', 'utf-8');
    const i = route.indexOf('new ViduService()');
    expect(i, '找不到 Vidu 调用点').toBeGreaterThan(0);
    const block = stripComments(route.slice(i, route.indexOf('} catch', i)));
    expect(block, '窗口自证').toContain('generateVideo');
    expect(block).toContain('lastModel');
    expect(block.includes("'Vidu-Q3-Pro-15s'"), '硬编的假标签复活了').toBe(false);
  });
});
