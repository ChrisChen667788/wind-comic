/**
 * ModelHub 视频网关接入:纯函数 + 请求形态(mock fetch)+ 引擎链序接线。
 * 不打真实接口 —— 全部 HTTP 都由 globalThis.fetch mock 返回。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  buildModelHubRequest,
  encodeModelHubBody,
  clampModelHubDuration,
  hasModelHub,
  modelHubAspectSupported,
  modelHubConfig,
  modelHubSizeWarning,
  modelHubRefLimits,
  ModelHubService,
} from '@/services/modelhub.service';
import { parseEngineOrderEnv, resolveEngineOrder } from '@/lib/engine-order';

const KEY_ENV = { MODELHUB_API_KEY: 'mh-test' };

function jsonRes(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) } as any;
}

describe('ModelHub · 配置与纯函数', () => {
  it('可用性:无 key / 占位符不可用;DISABLE=1 一票否决', () => {
    expect(hasModelHub({})).toBe(false);
    expect(hasModelHub({ MODELHUB_API_KEY: 'your_key_here' })).toBe(false);
    expect(hasModelHub(KEY_ENV)).toBe(true);
    expect(hasModelHub({ ...KEY_ENV, MODELHUB_DISABLE: '1' })).toBe(false);
  });

  it('base 默认 modelhub.cc;带 /v1 的文档地址会被剪掉(调用点自己拼 /v1)', () => {
    expect(modelHubConfig(KEY_ENV).baseURL).toBe('https://modelhub.cc');
    expect(modelHubConfig({ ...KEY_ENV, MODELHUB_BASE_URL: 'https://modelhub.cc/v1/' }).baseURL).toBe('https://modelhub.cc');
    expect(modelHubConfig(KEY_ENV).model).toBe('seedance-2.0');
  });

  it('时长按模型夹取', () => {
    expect(clampModelHubDuration(20, 'seedance-2.0')).toBe(15);
    expect(clampModelHubDuration(2, 'seedance-2.0-fast')).toBe(4);
    expect(clampModelHubDuration(25, 'seedance-2.5')).toBe(25);
    expect(clampModelHubDuration(40, 'seedance-2.5-flash')).toBe(30);
    expect(clampModelHubDuration(undefined, 'seedance-2.0')).toBe(5);
    expect(clampModelHubDuration(NaN, 'seedance-2.0')).toBe(5);
  });

  it('高分辨率 + 落盘上限没调大 → 告警(实测 1080p 15s ≈ 95MiB > 默认 64MB);720p 或已调大则不告警', () => {
    expect(modelHubSizeWarning({})).toBeUndefined();
    expect(modelHubSizeWarning({ MODELHUB_RESOLUTION: '720p' })).toBeUndefined();
    expect(modelHubSizeWarning({ MODELHUB_RESOLUTION: '1080p' })).toMatch(/64MB.*ASSET_MAX_REMOTE_BYTES/);
    expect(modelHubSizeWarning({ MODELHUB_RESOLUTION: '4K' })).toMatch(/64MB/);
    expect(modelHubSizeWarning({ MODELHUB_RESOLUTION: '1080p', ASSET_MAX_REMOTE_BYTES: '67108864' })).toMatch(/64MB/);
    expect(modelHubSizeWarning({ MODELHUB_RESOLUTION: '1080p', ASSET_MAX_REMOTE_BYTES: '268435456' })).toBeUndefined();
  });

  it('画幅门禁:只认上游列出的比例', () => {
    expect(modelHubAspectSupported('16:9')).toBe(true);
    expect(modelHubAspectSupported('9:16')).toBe(true);
    expect(modelHubAspectSupported('2.39:1')).toBe(false);
    expect(modelHubAspectSupported(undefined)).toBe(true);
  });
});

describe('ModelHub · 请求体', () => {
  it('t2v:无 functionMode / image_file;duration 为 number;默认 720p、不生成音频', () => {
    const b = buildModelHubRequest('夜色霓虹', { aspectRatio: '16:9', duration: 8 }, KEY_ENV);
    expect(b).toEqual({ model: 'seedance-2.0', prompt: '夜色霓虹', duration: 8, generate_audio: false, ratio: '16:9', resolution: '720p' });
  });

  it('首帧 + 尾帧 → first_last_frames(image_file_1 = 首帧,image_file_2 = 尾帧)', () => {
    const b = buildModelHubRequest('x', { imageUrl: 'https://cdn/a.png', tailImageUrl: 'https://cdn/b.png' }, KEY_ENV);
    expect(b.functionMode).toBe('first_last_frames');
    expect(b.image_file_1).toBe('https://cdn/a.png');
    expect(b.image_file_2).toBe('https://cdn/b.png');
  });

  it('只有首帧 → omni_reference(实测首尾帧模式只给 1 张会 400「必须正好 2 张图片」);首帧排第一,参考图接在后面、去重', () => {
    const b = buildModelHubRequest('x', { imageUrl: 'https://cdn/a.png', referenceImages: ['https://cdn/a.png', 'https://cdn/r.png'] }, KEY_ENV);
    expect(b.functionMode).toBe('omni_reference');
    expect(b.image_file_1).toBe('https://cdn/a.png');
    expect(b.image_file_2).toBe('https://cdn/r.png');
    expect(b.image_file_3).toBeUndefined();
  });

  it('参考图上限按模型:2.0 系 9 张,2.5 Flash 10 张,2.5 30 张', () => {
    const refs = Array.from({ length: 40 }, (_, i) => `https://cdn/${i}.png`);
    const count = (model: string) => Object.keys(buildModelHubRequest('x', { referenceImages: refs }, { ...KEY_ENV, MODELHUB_MODEL: model })).filter((k) => k.startsWith('image_file_')).length;
    expect(count('seedance-2.0-mini')).toBe(9);
    expect(count('seedance-2.5-flash')).toBe(10);
    expect(count('seedance-2.5')).toBe(30);
    expect(modelHubRefLimits('seedance-2.0-fast')).toEqual({ images: 9, videos: 3, audios: 3 });
  });

  it('分镜参考视频 → omni_reference + video_file_1;有参考视频时不走首尾帧(首尾帧模式不收视频)', () => {
    const b = buildModelHubRequest('x', { imageUrl: 'https://cdn/a.png', tailImageUrl: 'https://cdn/b.png', referenceVideoUrl: 'https://cdn/ref.mp4' }, KEY_ENV);
    expect(b.functionMode).toBe('omni_reference');
    expect(b.image_file_1).toBe('https://cdn/a.png');
    expect(b.image_file_2).toBeUndefined();
    expect(b.video_file_1).toBe('https://cdn/ref.mp4');
    // 只有参考视频、没有图也成立
    expect(buildModelHubRequest('x', { referenceVideoUrl: 'https://cdn/ref.mp4' }, KEY_ENV)).toMatchObject({ functionMode: 'omni_reference', video_file_1: 'https://cdn/ref.mp4' });
    // 站内相对地址 / 非视频 data: 不发
    expect(buildModelHubRequest('x', { referenceVideoUrl: '/api/serve-file?key=v' }, KEY_ENV).video_file_1).toBeUndefined();
  });

  it('本地参考视频(data:video)走 multipart 文件分片', () => {
    const enc = encodeModelHubBody(buildModelHubRequest('x', { referenceVideoUrl: `data:video/mp4;base64,${Buffer.from('fake-mp4').toString('base64')}` }, KEY_ENV));
    expect(enc.multipart).toBe(true);
    const form = enc.body as FormData;
    const f = form.get('video_file_1') as File;
    expect(f).toBeInstanceOf(Blob);
    expect(f.type).toBe('video/mp4');
    expect(f.name).toBe('video_file_1.mp4');
  });

  it('参考图 → omni_reference + 平铺 image_file_N(不发会被静默忽略的 image_files 数组);站内相对地址丢弃', () => {
    const b = buildModelHubRequest('x', {
      referenceImages: ['https://cdn/1.png', '/api/serve-file?key=1', 'data:image/png;base64,AAAA', 'https://cdn/2.png'],
    }, KEY_ENV);
    expect(b.functionMode).toBe('omni_reference');
    expect(b.image_file_1).toBe('https://cdn/1.png');
    expect(b.image_file_2).toBe('data:image/png;base64,AAAA');
    expect(b.image_file_3).toBe('https://cdn/2.png');
    expect(b.image_file_4).toBeUndefined();
    expect(b.image_files).toBeUndefined();
  });

  it('全是 https 图 → JSON;含 data: 图 → multipart,图片作文件分片、其余字段作表单字段', async () => {
    const json = encodeModelHubBody(buildModelHubRequest('x', { imageUrl: 'https://cdn/a.png' }, KEY_ENV));
    expect(json.multipart).toBe(false);
    expect(json.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(json.body as string).image_file_1).toBe('https://cdn/a.png');

    // 上游对 image_file_N=data:... 返回 400 —— 必须转成文件分片
    const png = Buffer.from('fake-png-bytes').toString('base64');
    const enc = encodeModelHubBody(buildModelHubRequest('猫', { imageUrl: `data:image/png;base64,${png}`, duration: 6 }, KEY_ENV));
    expect(enc.multipart).toBe(true);
    expect(enc.headers['Content-Type'], 'boundary 交给 fetch 生成').toBeUndefined();
    const form = enc.body as FormData;
    const file = form.get('image_file_1') as File;
    expect(typeof file).not.toBe('string');
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('fake-png-bytes');
    expect(form.get('functionMode')).toBe('omni_reference');
    expect(form.get('prompt')).toBe('猫');
    expect(form.get('duration')).toBe('6');
    expect(form.get('generate_audio')).toBe('false');
  });

  it('env 覆盖:模型 / 分辨率 / 音频;非法分辨率回落 720p', () => {
    const b = buildModelHubRequest('x', { duration: 20 }, { ...KEY_ENV, MODELHUB_MODEL: 'seedance-2.5', MODELHUB_RESOLUTION: '1080P', MODELHUB_GENERATE_AUDIO: '1' });
    expect(b).toMatchObject({ model: 'seedance-2.5', duration: 20, resolution: '1080p', generate_audio: true });
    expect(buildModelHubRequest('x', {}, { ...KEY_ENV, MODELHUB_RESOLUTION: '8k' }).resolution).toBe('720p');
  });
});

describe('ModelHub · HTTP 生命周期(mock fetch)', () => {
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };
  beforeEach(() => {
    process.env.MODELHUB_API_KEY = 'mh-test';
    delete process.env.MODELHUB_BASE_URL;
    delete process.env.MODELHUB_MODEL;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  // 以下响应形态取自 2026-11-25 真 key 实测(平铺,无 {code,data} 包装)
  const VIDEO_URL = 'https://media.modelhub.cc/api/proxy/video?url=https%3A%2F%2Fexample%2Fv.mp4';

  it('建任务 → processing(带 progress)→ completed,返回 result.url', async () => {
    const calls: Array<{ url: string; method: string; auth: string; body: any }> = [];
    const polls = [
      { task_id: 'task-1', status: 'processing', progress: 0, created_at: 1764000000000 },
      { task_id: 'task-1', status: 'processing', progress: 40, created_at: 1764000000000 },
      { task_id: 'task-1', status: 'completed', progress: 100, creditsConsumed: 60, result: { url: VIDEO_URL }, created_at: 1764000000000 },
    ];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), method: init?.method || 'GET', auth: init?.headers?.Authorization, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith('/v1/videos/generations')) {
        return jsonRes(200, { created: 1764000000, task_id: 'task-1', status: 'processing', requested_model: 'seedance-2.0', effective_model: 'seedance-2.0' });
      }
      return jsonRes(200, polls.shift());
    }) as any;

    const progress: Array<[number, string]> = [];
    const url = await new ModelHubService().generateVideo('一只猫', {
      imageUrl: 'https://cdn/first.png', aspectRatio: '9:16', duration: 6, pollIntervalMs: 0,
      onProgress: (p, s) => progress.push([p, s]),
    });

    expect(url).toBe(VIDEO_URL);
    expect(calls[0]).toMatchObject({ url: 'https://modelhub.cc/v1/videos/generations', method: 'POST', auth: 'Bearer mh-test' });
    expect(calls[0].body).toMatchObject({ model: 'seedance-2.0', prompt: '一只猫', ratio: '9:16', duration: 6, functionMode: 'omni_reference', image_file_1: 'https://cdn/first.png' });
    expect(calls.slice(1).every((c) => c.url === 'https://modelhub.cc/v1/videos/tasks/task-1')).toBe(true);
    // 上游 progress 为 0 时(实测出片前一直是 0)按已等时长估算;> 0 时用上游值
    expect(progress[0][1]).toBe('processing');
    expect(progress[0][0]).toBeGreaterThanOrEqual(0);
    expect(progress[0][0]).toBeLessThan(40);
    expect(progress[1]).toEqual([40, 'processing']);
  });

  it('data: 首帧 → multipart 上传(上游拒收 data: URI 字段)', async () => {
    let sent: any;
    globalThis.fetch = vi.fn(async (_u: any, init: any) => {
      sent = init;
      return jsonRes(200, { task_id: 'task-m', status: 'processing' });
    }) as any;
    const r = await new ModelHubService().submitTask('x', { imageUrl: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}` });
    expect(r.taskId).toBe('task-m');
    expect(sent.body).toBeInstanceOf(FormData);
    expect(sent.headers['Content-Type']).toBeUndefined();
    expect((sent.body.get('image_file_1') as File).name).toBe('image_file_1.jpg');
  });

  it('HTTP 4xx + {error:{message,type,code}} → 确定失败,带上游原文与 code', async () => {
    const fetchMock = vi.fn(async () => jsonRes(400, { error: { message: 'image_file_1 must be a valid URL or file', type: 'invalid_request_error', code: '-2000' } }));
    globalThis.fetch = fetchMock as any;
    const err = await new ModelHubService().submitTask('x').catch((e) => e);
    expect(err.message).toMatch(/HTTP 400.*image_file_1 must be a valid URL or file \(code -2000\)/);
    expect(err.message, '4xx 是确定失败,不是「结果未知」').not.toMatch(/结果未知/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('兼容旧文档的 {code,data} 包装:code 0 取 data.task_id;code ≠ 0 即失败', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes(200, { code: 0, data: { task_id: 'task-w' } })) as any;
    await expect(new ModelHubService().submitTask('x')).resolves.toEqual({ taskId: 'task-w' });

    globalThis.fetch = vi.fn(async () => jsonRes(200, { code: 4001, message: 'insufficient credits' })) as any;
    await expect(new ModelHubService().submitTask('x')).rejects.toThrow(/insufficient credits/);

    globalThis.fetch = vi.fn(async () => jsonRes(200, { code: 0, data: { status: 'completed', result: { url: VIDEO_URL } } })) as any;
    await expect(new ModelHubService().pollResult('t', { pollIntervalMs: 0 })).resolves.toBe(VIDEO_URL);
  });

  it('建任务 5xx → 「结果未知」且只发一次请求(不盲目重提)', async () => {
    const fetchMock = vi.fn(async () => jsonRes(502, 'Bad Gateway'));
    globalThis.fetch = fetchMock as any;
    await expect(new ModelHubService().submitTask('x')).rejects.toThrow(/结果未知/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('建任务网络错误 → 「结果未知」且只发一次', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    globalThis.fetch = fetchMock as any;
    await expect(new ModelHubService().submitTask('x')).rejects.toThrow(/结果未知/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('任务 failed → 抛出上游给的原因', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes(200, { task_id: 't', status: 'failed', progress: 0, result: { error: 'content moderation' } })) as any;
    await expect(new ModelHubService().pollResult('t', { pollIntervalMs: 0 })).rejects.toThrow(/content moderation/);
  });

  it('轮询 401 立刻终止;5xx / 网络抖动继续轮', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes(401, '{}')) as any;
    await expect(new ModelHubService().pollResult('t', { pollIntervalMs: 0 })).rejects.toThrow(/401/);

    const seq: Array<() => any> = [
      () => { throw new TypeError('socket hang up'); },
      () => jsonRes(503, 'busy'),
      () => jsonRes(200, { task_id: 't', status: 'completed', progress: 100, result: { url: 'https://cdn/x.mp4' } }),
    ];
    globalThis.fetch = vi.fn(async () => seq.shift()!()) as any;
    await expect(new ModelHubService().pollResult('t', { pollIntervalMs: 0 })).resolves.toBe('https://cdn/x.mp4');
  });

  it('completed 但无 url → 报错,不返回空串冒充成功', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes(200, { task_id: 't', status: 'completed', progress: 100, result: {} })) as any;
    await expect(new ModelHubService().pollResult('t', { pollIntervalMs: 0 })).rejects.toThrow(/无视频地址/);
  });

  it('轮询超时报错带 task id', async () => {
    globalThis.fetch = vi.fn(async () => jsonRes(200, { task_id: 'task-9', status: 'processing', progress: 10 })) as any;
    await expect(new ModelHubService().pollResult('task-9', { pollIntervalMs: 0, timeoutSec: 0 })).rejects.toThrow(/task-9/);
  });
});

describe('ModelHub · 终态', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

  it('cancelled 立即报错(不空等到轮询超时),带上顶层 error 原因', async () => {
    globalThis.fetch = vi.fn(async (url: any) => String(url).endsWith('/v1/videos/generations')
      ? jsonRes(200, { task_id: 't-c', status: 'submitted' })
      : jsonRes(200, { task_id: 't-c', status: 'cancelled', error: '任务已取消', creditsConsumed: null })) as any;
    await expect(new ModelHubService(KEY_ENV).generateVideo('x', { pollIntervalMs: 0 })).rejects.toThrow(/已取消.*任务已取消/);
  });

  it('failed 报顶层 error 字符串', async () => {
    globalThis.fetch = vi.fn(async (url: any) => String(url).endsWith('/v1/videos/generations')
      ? jsonRes(200, { task_id: 't-f', status: 'submitted' })
      : jsonRes(200, { task_id: 't-f', status: 'failed', error: '内容审核未通过', failureType: 'blocked' })) as any;
    await expect(new ModelHubService(KEY_ENV).generateVideo('x', { pollIntervalMs: 0 })).rejects.toThrow(/失败.*内容审核未通过/);
  });
});

describe('ModelHub · 参考视频结果回报(与 MiniMax 同一契约)', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

  it('建任务成功 → sent(engine=modelhub,报发出几张图);建任务被拒 → ignored 并照常抛错交给下一个引擎', async () => {
    const outcomes: any[] = [];
    globalThis.fetch = vi.fn(async (url: any) => String(url).endsWith('/v1/videos/generations')
      ? jsonRes(200, { task_id: 't-ref', status: 'processing' })
      : jsonRes(200, { task_id: 't-ref', status: 'completed', result: { url: 'https://cdn/out.mp4' } })) as any;
    const svc = new ModelHubService(KEY_ENV);
    await svc.generateVideo('x', { imageUrl: 'https://cdn/a.png', referenceImages: ['https://cdn/r.png'], referenceVideoUrl: 'https://cdn/ref.mp4', pollIntervalMs: 0, onRefOutcome: (o) => outcomes.push(o) });
    expect(outcomes).toEqual([{ status: 'sent', engine: 'modelhub', imagesSent: 2, imagesDropped: 0 }]);

    outcomes.length = 0;
    globalThis.fetch = vi.fn(async () => jsonRes(400, { error: { message: 'bad video', type: 'invalid_request_error', code: '-2000' } })) as any;
    await expect(svc.generateVideo('x', { referenceVideoUrl: 'https://cdn/ref.mp4', pollIntervalMs: 0, onRefOutcome: (o) => outcomes.push(o) })).rejects.toThrow();
    expect(outcomes[0].status).toBe('ignored');
  });
});

describe('ModelHub · 引擎链序接线', () => {
  it('VIDEO_ENGINE_ORDER 认得 modelhub', () => {
    expect(parseEngineOrderEnv('modelhub,kling')).toEqual(['modelhub', 'kling']);
  });

  it('显式选择 modelhub(含别名)时打头', () => {
    const avail: any = ['veo', 'kling', 'modelhub'];
    expect(resolveEngineOrder('modelhub', avail)[0]).toBe('modelhub');
    expect(resolveEngineOrder('model-hub', avail)[0]).toBe('modelhub');
  });

  it('零回归:不配置时默认链序不含 modelhub', () => {
    const avail: any = ['veo', 'minimax', 'kling', 'modelhub'];
    expect(resolveEngineOrder(undefined, avail)).not.toContain('modelhub');
    expect(resolveEngineOrder(undefined, avail, ['modelhub', 'kling'])[0]).toBe('modelhub');
  });

  it('主管线与单镜重生两条路径都接了 modelhub,且都带上分镜参考视频', () => {
    const orch = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(orch).toMatch(/availableEngines\.push\('modelhub'\)/);
    expect(orch).toMatch(/engine === 'modelhub' && modelhub\) \{ const ref = await refVideoOptsForShot\(.*return await modelhub\.generateVideo\(enhancedPrompt, \{ \.\.\.ref,/);
    const regen = orch.slice(orch.indexOf('const availForRegen'), orch.indexOf('const attempts', orch.indexOf('const availForRegen')));
    expect(regen).toMatch(/hasModelHub\(\) && 'modelhub'/);
    expect(regen).toMatch(/modelhub: async \(\) => .*getModelHubService\(\)!\.generateVideo\(videoPrompt, \{ \.\.\.\(await refVideoOptsForShot\(/);
  });
});

describe('ModelHub · 出片落盘带 User-Agent(媒体 CDN 需要浏览器式 UA;host 不固定,不按域名区分)', () => {
  afterEach(() => { vi.doUnmock('@/lib/ssrf-guard'); vi.resetModules(); });

  it('persistAsset 下载远端文件时带 PERSIST_USER_AGENT', async () => {
    vi.resetModules();
    const seen: any[] = [];
    vi.doMock('@/lib/ssrf-guard', async (orig) => ({
      ...(await orig<any>()),
      // 回 404:只看请求头,不真的写盘
      safeFetch: vi.fn(async (_url: string, init: any) => { seen.push(init); return new Response('', { status: 404 }); }),
    }));
    const { persistAsset, PERSIST_USER_AGENT } = await import('@/lib/asset-storage');
    await persistAsset('https://media.modelhub.cc/api/proxy/video?url=x');
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['User-Agent']).toBe(PERSIST_USER_AGENT);
    expect(PERSIST_USER_AGENT).toMatch(/^Mozilla\/5\.0/);
  });
});
