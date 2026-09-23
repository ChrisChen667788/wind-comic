/**
 * v12.452 · Sora 退役闸门**真跑**一遍(假时钟 + 模拟网络)。
 *
 * v12.173/207 加了「2026-09-24 起自动把 Sora 从模型链剔除」,但锁它的两条测试只在源码里搜字符串 ——
 * 这个分支**从来没被执行过**,而它 9-24 才第一次生效。兜底分支平时走不到,测试里不真跑就等于没写。
 * 同时补一处:闸门按 UTC 零点翻,上游若提前停,Sora 报的非 transient 错误原来会让整条链中止、veo 兜底都不试。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/fetch-timeout', () => ({ fetchWithTimeout: vi.fn() }));
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { VeoService } from '@/services/veo.service';

const fetchMock = fetchWithTimeout as unknown as ReturnType<typeof vi.fn>;
const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  json: async () => body, text: async () => JSON.stringify(body),
});

/** 按 URL 回:创建任务 → 查询即完成。sora 走 /v1/videos(openai 格式),veo 走 /v1/video/create(unified) */
function upstream(opts: { soraCreate?: () => ReturnType<typeof json> } = {}) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/v1/videos') && init?.method === 'POST') return opts.soraCreate ? opts.soraCreate() : json(200, { id: 'sora-task' });
    if (url.includes('/v1/videos/')) return json(200, { status: 'completed', video_url: 'https://cdn/sora.mp4' });
    if (url.endsWith('/v1/video/create')) return json(200, { id: `veo-task-${body.model}` });
    if (url.includes('/v1/video/query')) return json(200, { status: 'completed', video_url: 'https://cdn/veo.mp4' });
    throw new Error('unexpected ' + url);
  });
}
const calls = () => fetchMock.mock.calls.map(([url, init]: any[]) => ({ url: String(url).replace('https://gw', ''), model: init?.body ? JSON.parse(init.body).model : undefined }));

function svc(model: string, fallback: string[]) {
  const s = new VeoService() as any;
  s.apiKey = 'k-test'; s.baseURL = 'https://gw'; s.model = model; s.fallbackModels = fallback; s.format = 'unified';
  s.sleep = async () => {};
  return s as VeoService;
}

beforeEach(() => { fetchMock.mockReset(); vi.useFakeTimers({ toFake: ['Date'] }); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('v12.452 · Sora 退役闸门真跑', () => {
  it('退役日前一刻:链里的 Sora 照常先用(只告警)', async () => {
    vi.setSystemTime(new Date('2026-09-23T23:59:59Z'));
    upstream();
    const url = await svc('sora-2', ['veo3.1']).generateVideo('https://img/1.png', 'p');
    expect(url).toBe('https://cdn/sora.mp4');
    expect(calls()[0]).toEqual({ url: '/v1/videos', model: 'sora-2' });
  });

  it('退役日零点起:Sora 被剔除,一次都不请求,直接走 veo 兜底', async () => {
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));
    upstream();
    const url = await svc('sora-2', ['veo3.1']).generateVideo('https://img/1.png', 'p');
    expect(url).toBe('https://cdn/veo.mp4');
    expect(calls().some((c) => c.url.startsWith('/v1/videos')), '不该再碰 Sora 端点').toBe(false);
    expect(calls()[0]).toEqual({ url: '/v1/video/create', model: 'veo3.1' });
  });

  it('退役后链里只剩 Sora:不发请求,直接抛出能照着改的错误', async () => {
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    upstream();
    await expect(svc('sora-2', []).generateVideo('https://img/1.png', 'p')).rejects.toThrow(/仅含已退役的 Sora.*VEO_MODEL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('闸门还没翻、上游已先停(任何非 transient 报错):Sora 失败换下一个模型,而不是整条链中止', async () => {
    vi.setSystemTime(new Date('2026-09-23T20:00:00Z'));
    upstream({ soraCreate: () => json(410, { error: { message: 'gone' } }) });
    const url = await svc('sora-2', ['veo3.1']).generateVideo('https://img/1.png', 'p');
    expect(url).toBe('https://cdn/veo.mp4');
    expect(calls().map((c) => c.model).filter(Boolean)).toEqual(['sora-2', 'veo3.1']);
  });

  it('非 Sora 模型的非 transient 错误语义不变:照旧立即抛,不乱试下一个', async () => {
    vi.setSystemTime(new Date('2026-09-23T20:00:00Z'));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/v1/video/create')) return json(400, { error: 'prompt rejected' });
      throw new Error('unexpected ' + url);
    });
    await expect(svc('veo3.1', ['veo3.1-fast']).generateVideo('https://img/1.png', 'p')).rejects.toThrow(/400/);
    expect(calls().map((c) => c.model)).toEqual(['veo3.1']);
  });
});
