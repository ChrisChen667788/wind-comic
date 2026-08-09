/**
 * v12.272 — HappyHorse(阿里)视频引擎接入。
 *
 * 接口契约全部**实测**得来(见 services/happyhorse.service.ts 顶部注释):该模型禁走网关通用视频口,
 * 必须用百炼专属异步端点。这里锁住纯函数 + 请求形态 + 引擎链序接线。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clampHappyHorseDuration,
  happyHorseModelFor,
  hasHappyHorse,
  extractHappyHorseVideoUrl,
} from '@/services/happyhorse.service';
import { parseEngineOrderEnv, resolveEngineOrder } from '@/lib/engine-order';

describe('v12.272 · HappyHorse 纯函数', () => {
  it('时长夹到 3~15s(1.1 公开规格),非法值回落 5s', () => {
    expect(clampHappyHorseDuration(1)).toBe(3);
    expect(clampHappyHorseDuration(99)).toBe(15);
    expect(clampHappyHorseDuration(8)).toBe(8);
    expect(clampHappyHorseDuration(undefined)).toBe(5);
    expect(clampHappyHorseDuration(NaN as any)).toBe(5);
    expect(clampHappyHorseDuration(-3)).toBe(5);
  });

  it('有首帧 → i2v,无首帧 → t2v;HAPPYHORSE_MODEL 可覆盖', () => {
    expect(happyHorseModelFor(true, {})).toBe('happyhorse-1.1-i2v');
    expect(happyHorseModelFor(false, {})).toBe('happyhorse-1.1-t2v');
    expect(happyHorseModelFor(false, { HAPPYHORSE_MODEL: 'happyhorse-1.0-t2v' })).toBe('happyhorse-1.0-t2v');
  });

  it('可用性:无 key 不可用;占位符不可用;DISABLE=1 一票否决', () => {
    expect(hasHappyHorse({})).toBe(false);
    expect(hasHappyHorse({ VECTORENGINE_API_KEY: 'your_key_here' })).toBe(false);
    expect(hasHappyHorse({ VECTORENGINE_API_KEY: 'sk-real' })).toBe(true);
    expect(hasHappyHorse({ HAPPYHORSE_API_KEY: 'sk-real' })).toBe(true);
    expect(hasHappyHorse({ VECTORENGINE_API_KEY: 'sk-real', HAPPYHORSE_DISABLE: '1' })).toBe(false);
  });

  it('视频地址抽取:兼容 video_url / results[] / 嵌套,拒非 http', () => {
    // live 实测返回的就是 output.video_url 这一支
    expect(extractHappyHorseVideoUrl({ video_url: 'https://x/a.mp4' })).toBe('https://x/a.mp4');
    expect(extractHappyHorseVideoUrl({ results: [{ url: 'https://x/b.mp4' }] })).toBe('https://x/b.mp4');
    expect(extractHappyHorseVideoUrl({ video_url: 'ftp://x/a.mp4' })).toBe('');
    expect(extractHappyHorseVideoUrl(null)).toBe('');
    expect(extractHappyHorseVideoUrl({})).toBe('');
  });
});

describe('v12.272 · 引擎链序接线', () => {
  it('VIDEO_ENGINE_ORDER 认得 happyhorse(此前是闭合联合,不加就被静默丢弃)', () => {
    expect(parseEngineOrderEnv('happyhorse,kling')).toEqual(['happyhorse', 'kling']);
    expect(parseEngineOrderEnv('bogus,happyhorse')).toEqual(['happyhorse']);
  });

  it('显式选择 happyhorse(含别名)时打头', () => {
    const avail: any = ['veo', 'kling', 'happyhorse'];
    expect(resolveEngineOrder('happyhorse', avail)[0]).toBe('happyhorse');
    expect(resolveEngineOrder('hh', avail)[0]).toBe('happyhorse');
    expect(resolveEngineOrder('happy-horse', avail)[0]).toBe('happyhorse');
  });

  it('零回归:不配置时默认链序**不含** happyhorse(装了新引擎不改变既有用户出片)', () => {
    const avail: any = ['veo', 'minimax', 'kling', 'happyhorse'];
    expect(resolveEngineOrder(undefined, avail)).not.toContain('happyhorse');
  });
});

describe('v12.272 · 请求形态(锁实测出来的契约)', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

  it('行为:打百炼专属端点,body 为 {model,input:{prompt,img_url?},parameters}', async () => {
    process.env.VECTORENGINE_API_KEY = 'sk-test';
    delete process.env.HAPPYHORSE_SIZE;
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, status: 200, text: async () => JSON.stringify({ output: { task_id: 't-1' } }) } as any;
    }) as any;
    const { HappyHorseService } = await import('@/services/happyhorse.service');
    await new HappyHorseService().submitTask('夜色霓虹', { imageUrl: 'https://x/first.png', duration: 7, aspectRatio: '9:16' });

    expect(calls).toHaveLength(1);
    // 必须是专属端点 —— 走通用 /v1/video/create 会被网关 400 明确拒绝
    expect(calls[0].url).toContain('/alibailian/api/v1/services/aigc/video-generation/video-synthesis');
    expect(calls[0].body.model).toBe('happyhorse-1.1-i2v'); // 有首帧 → i2v
    expect(calls[0].body.input.prompt).toBe('夜色霓虹');
    expect(calls[0].body.input.img_url).toBe('https://x/first.png');
    expect(calls[0].body.parameters.duration).toBe(7);
  });

  // v12.295 改写:原断言锁的是「HAPPYHORSE_SIZE 覆盖时只发 size」——
  // 而查证官方文档后确认**上游根本没有 size 这个参数**,那条断言锁住的是一个错误行为。
  // 现在锁的是正确参数:ratio(+ resolution),且 HAPPYHORSE_SIZE 已废弃并忽略。
  it('行为:画幅走官方的 ratio 参数,不再发不存在的 size', async () => {
    process.env.VECTORENGINE_API_KEY = 'sk-test';
    process.env.HAPPYHORSE_SIZE = '720*1280';   // 废弃项:设了也不该影响请求
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      calls.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, text: async () => JSON.stringify({ output: { task_id: 't-2' } }) } as any;
    }) as any;
    const { HappyHorseService } = await import('@/services/happyhorse.service');
    await new HappyHorseService().submitTask('测试', { aspectRatio: '9:16' });
    expect(calls[0].parameters.ratio).toBe('9:16');
    expect(calls[0].parameters.size, '上游没有 size 参数,发了只会被静默忽略').toBeUndefined();
    expect(calls[0].parameters.aspect_ratio, '同样不是官方字段').toBeUndefined();
    delete process.env.HAPPYHORSE_SIZE;
  });

  it('行为:上游报错时抛出可读错误,不返回空串冒充成功', async () => {
    process.env.VECTORENGINE_API_KEY = 'sk-test';
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, text: async () => '{"code":"quota_not_enough"}' } as any)) as any;
    const { HappyHorseService } = await import('@/services/happyhorse.service');
    await expect(new HappyHorseService().submitTask('x')).rejects.toThrow(/429|quota/);
  });
});
