/**
 * v12.448 · MinimaxService 的参考视频分支(模拟网络真跑 generateVideo)。
 *
 * 要证的是**结局**:发出去的请求长什么样(参考模式无首帧、带参考视频与参考图、跳过 S2V),
 * 以及每一种失败都去掉参考视频照常出片、并如实回报 —— 参考视频不许让这一镜丢掉,也不许悄悄没了。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MinimaxService } from '@/services/minimax.service';
import { resetH3Availability, isH3KnownUnavailable, markH3Unavailable } from '@/lib/h3-availability';
import { REF_VIDEO_HINT } from '@/lib/ref-video';

const PLAN_BLOCKED = { type: 'error', error: { type: 'bad_request_error', message: 'invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)', http_code: '400' } };
const REF = 'https://cdn.example/move.mp4';
const FRAME = 'https://cdn.example/frame.png';

type Call = { path: string; method: string; body: any };
let calls: Call[];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** v2 创建由 onV2 决定;v1(S2V / legacy)创建默认成功(可用 onV1 改);轮询一律成功 */
function stub(onV2: (body: any, n: number) => Response, onV1?: (body: any, n: number) => Response) {
  let v2n = 0, v1n = 0, runaway = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const p = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: p, method: init?.method || 'GET', body });
    // 熔断:请求次数失控时**放行成功**让调用收尾,由各条断言(请求数 / 路径)判红 —— 抛错只会让失控的递归接着转、挂到超时
    if (calls.length > 30) runaway = true;
    if (runaway && p.endsWith('/video_generation')) return json(200, { task_id: 'runaway', base_resp: { status_code: 0 } });
    if (p === '/v2/video_generation') return onV2(body, ++v2n);
    if (p.startsWith('/v2/query/video_generation/')) return json(200, { task: { status: 'succeeded', content: { url: 'https://cdn.example/h3.mp4' } } });
    if (p === '/v1/video_generation') return onV1 ? onV1(body, ++v1n) : json(200, { task_id: 'v1-task', base_resp: { status_code: 0 } });
    if (p === '/v1/query/video_generation') return json(200, { status: 'Success', file_id: 'f1', base_resp: { status_code: 0 } });
    if (p === '/v1/files/retrieve') return json(200, { file: { download_url: 'https://cdn.example/legacy.mp4' } });
    return json(404, { error: 'unexpected ' + p });
  }));
}

const svc = () => { const s = new MinimaxService(); (s as any).sleep = async () => {}; return s; };
const posts = () => calls.filter((c) => c.method === 'POST');

describe('v12.448 · 参考视频走 H3「参考生视频」', () => {
  const prevModel = process.env.MINIMAX_VIDEO_MODEL;
  beforeEach(() => {
    resetH3Availability();
    delete process.env.MINIMAX_VIDEO_MODEL;
    calls = [];
    for (const k of ['warn', 'log', 'error'] as const) vi.spyOn(console, k).mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (prevModel === undefined) delete process.env.MINIMAX_VIDEO_MODEL; else process.env.MINIMAX_VIDEO_MODEL = prevModel;
  });

  it('H3 可用:发 reference_video + 参考图(分镜图打头)、无首帧、提示词带动作说明;跳过 S2V;回报 sent', async () => {
    stub(() => json(200, { task_id: 'h3-task', base_resp: { status_code: 0 } }));
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'She spins around', {
      aspectRatio: '9:16',
      subjectReferences: [{ imageUrl: 'https://cdn.example/face.png', refImageUrls: ['https://cdn.example/side.png'] }],
      referenceVideoUrl: REF,
      onRefOutcome: (o) => outcomes.push(o),
    });
    expect(url).toBe('https://cdn.example/h3.mp4');
    expect(posts().map((c) => c.path)).toEqual(['/v2/video_generation']); // 没去 S2V(/v1)
    const body = posts()[0].body;
    expect(body.model).toBe('MiniMax-H3');
    expect(body.content.some((c: any) => c.role === 'first_frame')).toBe(false);
    expect(body.content.filter((c: any) => c.role === 'reference_video').map((c: any) => c.video_url.url)).toEqual([REF]);
    expect(body.content.filter((c: any) => c.role === 'reference_image').map((c: any) => c.image_url.url))
      .toEqual([FRAME, 'https://cdn.example/face.png', 'https://cdn.example/side.png']);
    expect(body.content[0].text).toContain(REF_VIDEO_HINT);
    expect(body.ratio).toBe('9:16');
    expect(outcomes).toEqual([{ status: 'sent', engine: 'minimax-h3', imagesSent: 3, imagesDropped: 0 }]);
  });

  it('即便 MINIMAX_VIDEO_MODEL 设成 legacy,参考视频也要走 H3(只有它能吃参考视频)', async () => {
    process.env.MINIMAX_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';
    stub(() => json(200, { task_id: 'h3-task', base_resp: { status_code: 0 } }));
    await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: () => {} });
    expect(posts()[0].path).toBe('/v2/video_generation');
    expect(posts()[0].body.model).toBe('MiniMax-H3');
  });

  it('套餐不支持(真实报文 2013):回报 ignored(点明按量付费)、记下 H3 不可用、去掉参考视频按原流程出片,不再白打一次 H3', async () => {
    stub(() => json(400, PLAN_BLOCKED));
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) });
    expect(url).toBe('https://cdn.example/legacy.mp4');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('ignored');
    expect(outcomes[0].reason).toContain('按量付费');
    expect(isH3KnownUnavailable()).toBe(true);
    // 只撞了一次 H3;重出走 legacy,且不再带参考视频
    expect(posts().map((c) => c.path)).toEqual(['/v2/video_generation', '/v1/video_generation']);
    expect(JSON.stringify(posts()[1].body)).not.toContain(REF);
    expect(posts()[1].body.first_frame_image).toBe(FRAME); // 重出时首帧回来了
  });

  it('套餐不支持且有角色参考:重出走 S2V-01(角色一致性还在),不是直接丢掉角色', async () => {
    stub(() => json(400, PLAN_BLOCKED));
    const outcomes: any[] = [];
    await svc().generateVideo(FRAME, 'p', {
      subjectReferences: [{ imageUrl: 'https://cdn.example/face.png' }],
      referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o),
    });
    expect(outcomes[0].status).toBe('ignored');
    expect(posts()[1].path).toBe('/v1/video_generation');
    expect(posts()[1].body.model).toBe('S2V-01');
  });

  it('已知 H3 不可用:当场回报 ignored,一次 H3 都不打', async () => {
    markH3Unavailable('2013 暂不支持');
    stub(() => { throw new Error('不该打 H3'); });
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) });
    expect(url).toBe('https://cdn.example/legacy.mp4');
    expect(posts().some((c) => c.path.startsWith('/v2/'))).toBe(false);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('ignored');
  });

  it('H3 因别的原因失败(比如参考视频被拒):回报 ignored 带原因,去掉参考视频重出 —— 不丢镜', async () => {
    stub((body, n) => n === 1
      ? json(400, { type: 'error', error: { message: 'invalid params, reference_video duration out of range (2013)', http_code: '400' } })
      : json(200, { task_id: 'h3-plain', base_resp: { status_code: 0 } }));
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) });
    expect(url).toBe('https://cdn.example/h3.mp4');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: 'ignored' });
    expect(outcomes[0].reason).toContain('duration out of range');
    expect(isH3KnownUnavailable(), '参数错误不能记成「H3 不可用」').toBe(false);
    // 第二次是普通的 H3 首帧请求,没有参考视频
    const second = posts()[1].body;
    expect(second.content.some((c: any) => c.role === 'reference_video')).toBe(false);
    expect(second.content.some((c: any) => c.role === 'first_frame')).toBe(true);
  });

  it('参考模式里用掉的敏感词重试,不能让去掉参考视频的重出少一次机会(对抗复查挖出)', async () => {
    // ① 参考模式报 1026 → 净化后重试(仍是参考模式)→ ② 因别的原因失败 → 去掉参考视频重出
    // ③ 重出(H3 首帧)又报 1026 → 必须还能净化重试一次 → ④ 成功
    const SENSITIVE = () => json(200, { base_resp: { status_code: 1026, status_msg: 'input new_sensitive' } }); // 每次新建:响应体只能读一次
    stub((body, n) => {
      if (n === 1) return SENSITIVE();
      if (n === 2) return json(500, { error: 'upstream timeout' });
      if (n === 3) return SENSITIVE();
      return json(200, { task_id: 'ok-task', base_resp: { status_code: 0 } });
    });
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) });
    expect(url).toBe('https://cdn.example/h3.mp4');
    const v2 = posts().filter((c) => c.path === '/v2/video_generation').map((c) => c.body);
    expect(v2).toHaveLength(4);
    expect(v2.slice(0, 2).every((b) => b.content.some((c: any) => c.role === 'reference_video'))).toBe(true);
    expect(v2.slice(2).every((b) => !b.content.some((c: any) => c.role === 'reference_video'))).toBe(true);
    expect(outcomes.map((o) => o.status)).toEqual(['ignored']);
  });

  it('净化重试途中别的镜刚把 H3 记成不可用:去掉参考视频的重出同样重试计数清零(并发出片时真会发生)', async () => {
    // ① 参考模式报 1026;与此同时另一镜确认 H3 套餐不支持 → ② 净化重试进入「已知不可用」分支,去掉参考视频走 legacy
    // ③ legacy 又报 1026 → 必须还能净化重试一次 → ④ 成功。没清零时 ③ 直接抛错,这一镜丢掉
    const SENSITIVE = () => json(200, { base_resp: { status_code: 1026, status_msg: 'input new_sensitive' } });
    stub(
      (body, n) => { if (n === 1) { markH3Unavailable('另一镜:TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)'); return SENSITIVE(); } throw new Error('不该再打 H3'); },
      (body, n) => (n === 1 ? SENSITIVE() : json(200, { task_id: 'v1-task', base_resp: { status_code: 0 } })),
    );
    const outcomes: any[] = [];
    const url = await svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) });
    expect(url).toBe('https://cdn.example/legacy.mp4');
    expect(posts().map((c) => c.path)).toEqual(['/v2/video_generation', '/v1/video_generation', '/v1/video_generation']);
    expect(outcomes.map((o) => o.status)).toEqual(['ignored']);
  });

  it('递归出去的那次已经兜底失败了,外层不再兜第二遍(不重复请求、不重复回报)', async () => {
    // ① 参考模式 1026 → 净化重试(递归)→ ② 失败 → 去掉参考视频重出 → ③ 也失败 → 递归那次整体失败
    // 修前:外层 catch 再做一遍「去掉参考视频重出」→ 第 4 次请求 + 第 2 条 ignored
    stub((body, n) => (n === 1 ? json(200, { base_resp: { status_code: 1026, status_msg: 'sensitive' } }) : json(500, { error: 'upstream down' })));
    const outcomes: any[] = [];
    await expect(svc().generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) })).rejects.toThrow(/500/);
    expect(posts().filter((c) => c.path === '/v2/video_generation')).toHaveLength(3);
    expect(outcomes.map((o) => o.status)).toEqual(['ignored']);
  });

  it('Fast 兜底:原文与净化版都命中 1026 → 只发 2 次,外层不再发第三次(对抗复查第三轮)', async () => {
    stub(() => { throw new Error('不该打 v2'); }, () => json(200, { base_resp: { status_code: 1026, status_msg: 'input new_sensitive' } }));
    await expect(svc().generateVideoFast('p', { firstFrameImage: FRAME })).rejects.toThrow(/1026/);
    expect(posts().filter((c) => c.path === '/v1/video_generation')).toHaveLength(2);
  });

  it('MiniMax 视频接口不可用(非官方端点):照样回报参考视频没用上,再抛错交给下一个引擎', async () => {
    stub(() => { throw new Error('不该发请求'); });
    const s = svc(); (s as any).videoEndpointAvailable = false;
    const outcomes: any[] = [];
    await expect(s.generateVideo(FRAME, 'p', { referenceVideoUrl: REF, onRefOutcome: (o) => outcomes.push(o) })).rejects.toThrow(/unavailable/);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ status: 'ignored' });
    expect(outcomes[0].reason).toContain('下一个引擎');
    // 没挂参考视频时不回报
    const none: any[] = [];
    await expect(s.generateVideo(FRAME, 'p', { onRefOutcome: (o) => none.push(o) })).rejects.toThrow(/unavailable/);
    expect(none).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('没有参考视频:行为与修前一致(不回报、H3 首帧)', async () => {
    stub(() => json(200, { task_id: 'h3-task', base_resp: { status_code: 0 } }));
    const outcomes: any[] = [];
    await svc().generateVideo(FRAME, 'p', { onRefOutcome: (o) => outcomes.push(o) });
    expect(outcomes).toEqual([]);
    expect(posts()[0].body.content.map((c: any) => c.role ?? 'text')).toEqual(['text', 'first_frame']);
  });

  it('普通出片也吃记忆:已知 H3 不可用时直接 legacy,不再每镜白打一次 H3', async () => {
    markH3Unavailable('2013 暂不支持');
    stub(() => { throw new Error('不该打 H3'); });
    const url = await svc().generateVideo(FRAME, 'p');
    expect(url).toBe('https://cdn.example/legacy.mp4');
    expect(posts().map((c) => c.path)).toEqual(['/v1/video_generation']);
  });
});
