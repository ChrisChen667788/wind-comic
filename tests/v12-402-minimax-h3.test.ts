/**
 * v12.402 — 我们把 MiniMax H3 当竞品写进了对照表,自己却还在调它的上一代。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * `services/minimax.service.ts` 默认 `MiniMax-Hailuo-2.3`,而 `.env.local` 没覆盖它 ——
 * 即实际跑的就是这个默认值。而 2.3 / 2.3-Fast **已被官方降为 legacy**。
 * 同一家供应商停 Music API 时是**无预告**的(410 + 2153),legacy 端点没有宽限承诺。
 *
 * ── 为什么不是「改个字符串」────────────────────────────────────────────
 * H3 在 **Video Generation V2**,而 V2 与 v1 有四处不同:请求体(扁平 vs content 数组)、
 * 轮询路径(query string vs path 参数)、状态字面量('Success' vs 'succeeded')、
 * 取片方式(file_id 再换一次 vs 直接给 url)。写成 `if (isV2)` 就是同一语义两份实现。
 * 所以差异收进 `lib/minimax-video-api.ts`,service 只有一条请求流、一条轮询流。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 锁**行为**,而且锁的是「照着官方字段表发请求」——
 * 历史教训:传了上游不认的字段,上游静默忽略,而响应里的 usage 常是请求参数的镜像,
 * 于是看起来「生效了」。所以这里逐字段比对官方 schema,而不是只看「没报错」。
 */
import { describe, it, expect } from 'vitest';
import {
  apiVersionFor, buildCreateRequest, pollPath, parsePollResponse,
  defaultVideoModel, isModelUnavailableError, LEGACY_VIDEO_MODEL,
  V2_RATIOS, V2_RESOLUTIONS,
} from '@/lib/minimax-video-api';
import fs from 'node:fs';

describe('v12.402 · MiniMax 升 H3(V2)', () => {
  it('默认模型是 H3,不再是被降为 legacy 的 2.3', () => {
    const prev = process.env.MINIMAX_VIDEO_MODEL;
    delete process.env.MINIMAX_VIDEO_MODEL;
    try {
      expect(defaultVideoModel()).toBe('MiniMax-H3');
      expect(defaultVideoModel()).not.toBe(LEGACY_VIDEO_MODEL);
    } finally {
      if (prev === undefined) delete process.env.MINIMAX_VIDEO_MODEL;
      else process.env.MINIMAX_VIDEO_MODEL = prev;
    }
  });

  it('模型 → 接口版本的判定:H3 族走 V2,历史模型仍走 v1', () => {
    expect(apiVersionFor('MiniMax-H3')).toBe('v2');
    expect(apiVersionFor('MiniMax-H3-Max')).toBe('v2');
    expect(apiVersionFor('MiniMax-Hailuo-2.3')).toBe('v1');
    expect(apiVersionFor('MiniMax-Hailuo-2.3-Fast')).toBe('v1');
    expect(apiVersionFor('video-01')).toBe('v1');
  });

  it('V2 文生视频请求体逐字段符合官方 schema', () => {
    const req = buildCreateRequest({ model: 'MiniMax-H3', prompt: '海边打篮球的男孩', duration: 5 });
    expect(req.version).toBe('v2');
    expect(req.path).toBe('/v2/video_generation');

    const b = req.body as any;
    expect(b.model).toBe('MiniMax-H3');
    // content 必须是数组,且**任何场景都必须带一条非空 text**(官方明文要求)
    expect(Array.isArray(b.content)).toBe(true);
    expect(b.content[0]).toEqual({ type: 'text', text: '海边打篮球的男孩' });
    // 三个必填项一个都不能少 —— 少了上游直接拒
    expect(V2_RESOLUTIONS).toContain(b.resolution);
    expect(V2_RATIOS).toContain(b.ratio);
    expect(b.duration).toBe(5);
    // v1 的扁平字段绝不该出现在 V2 请求里(上游会静默忽略 → 看起来像生效了)
    const text = JSON.stringify(b);
    expect(text, '窗口自证:请求体不是空的').toContain('MiniMax-H3');
    expect(b.first_frame_image).toBeUndefined();
    expect(b.prompt).toBeUndefined();
    expect(b.aspect_ratio).toBeUndefined();
  });

  it('V2 图生视频把首帧放进 content 数组并标 role=first_frame', () => {
    const req = buildCreateRequest({
      model: 'MiniMax-H3', prompt: '镜头推向背景人物',
      imageUrl: 'https://example.com/a.png', duration: 6,
    });
    const b = req.body as any;
    expect(b.content).toHaveLength(2);
    expect(b.content[0].type).toBe('text');
    expect(b.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/a.png' },
      role: 'first_frame',
    });
    // 有首帧时跟随首帧比例
    expect(b.ratio).toBe('adaptive');
  });

  it('时长被夹在官方允许的 4–15 秒内(越界会被上游拒)', () => {
    const dur = (d: number | undefined) => (buildCreateRequest({ model: 'MiniMax-H3', prompt: 'x', duration: d }).body as any).duration;
    expect(dur(1)).toBe(4);
    expect(dur(99)).toBe(15);
    expect(dur(8)).toBe(8);
    expect(dur(undefined)).toBeGreaterThanOrEqual(4);
    expect(dur(undefined)).toBeLessThanOrEqual(15);
  });

  it('v1 请求体一个字节都没被这次升级改动', () => {
    const t2v = buildCreateRequest({ model: 'MiniMax-Hailuo-2.3', prompt: 'p', aspectRatio: '9:16' });
    expect(t2v.path).toBe('/v1/video_generation');
    expect(t2v.body).toEqual({ model: 'MiniMax-Hailuo-2.3', prompt: 'p', prompt_optimizer: true, aspect_ratio: '9:16' });

    const i2v = buildCreateRequest({ model: 'MiniMax-Hailuo-2.3', prompt: 'p', imageUrl: 'https://x/y.png' });
    expect(i2v.body).toEqual({ model: 'MiniMax-Hailuo-2.3', prompt: 'p', prompt_optimizer: true, first_frame_image: 'https://x/y.png' });
  });

  it('轮询路径两版不同 —— 这是最容易抄错的一处', () => {
    expect(pollPath('v1', 'T1')).toBe('/v1/query/video_generation?task_id=T1');
    expect(pollPath('v2', 'T1')).toBe('/v2/query/video_generation/T1');
  });

  it('V2 状态解析:succeeded 直接给 url,failed/cancelled 带出原因', () => {
    expect(parsePollResponse('v2', { task: { status: 'queued' } }).state).toBe('pending');
    expect(parsePollResponse('v2', { task: { status: 'running' } }).state).toBe('pending');

    const ok = parsePollResponse('v2', { task: { status: 'succeeded', content: { url: 'https://cdn/v.mp4' } } });
    expect(ok.state).toBe('success');
    expect(ok.videoUrl).toBe('https://cdn/v.mp4');

    const bad = parsePollResponse('v2', { task: { status: 'failed', error: { code: 'E1', message: '内容不合规' } } });
    expect(bad.state).toBe('failed');
    expect(bad.error).toContain('内容不合规');

    // succeeded 却没有 url —— 必须当失败,不能返回 undefined 让上游拿着空串继续跑
    expect(parsePollResponse('v2', { task: { status: 'succeeded' } }).state).toBe('failed');
  });

  it('v1 状态解析保持历史行为(含实测过的 Fail 无 -ed)', () => {
    expect(parsePollResponse('v1', { status: 'Processing' }).state).toBe('pending');
    expect(parsePollResponse('v1', { status: 'Success', file_id: 'F1' })).toMatchObject({ state: 'success', fileId: 'F1' });
    expect(parsePollResponse('v1', { status: 'Success', video_url: 'u' })).toMatchObject({ state: 'success', videoUrl: 'u' });
    expect(parsePollResponse('v1', { status: 'Fail', base_resp: { status_msg: 'x' } }).state).toBe('failed');
    expect(parsePollResponse('v1', { status: 'Failed' }).state).toBe('failed');
  });

  it('「套餐不支持模型」与「额度用尽」必须分得开 —— 前者换模型有用,后者换了也没用', () => {
    expect(isModelUnavailableError('base_resp 2061: your current token plan not support model')).toBe(true);
    expect(isModelUnavailableError('invalid model')).toBe(true);
    expect(isModelUnavailableError('model not found')).toBe(true);
    // 额度类不该命中 —— 命中了就会白白换成 legacy 而问题依旧
    expect(isModelUnavailableError('2056 usage limit reached')).toBe(false);
    expect(isModelUnavailableError('rate limit exceeded')).toBe(false);
  });

  it('回落到 legacy 时必须大声告警,不能静默替换', () => {
    const src = fs.readFileSync('services/minimax.service.ts', 'utf-8');
    const i = src.indexOf('isModelUnavailableError(emsg)');
    expect(i, '找不到回落分支 —— 改了实现就得同步这条').toBeGreaterThan(0);
    // 窗口必须收在「回落分支内部」:切到 return 那行为止。
    // 初版切了固定 1200 字符,把后面 quota 兜底那处的 console.warn 也圈了进来 ——
    // 于是把本分支的告警删掉,断言照样绿。窗口开太宽 = 断言在验别人家的代码。
    const end = src.indexOf('_forceModel: LEGACY_VIDEO_MODEL', i);
    expect(end, '回落分支里找不到 _forceModel 递归调用').toBeGreaterThan(i);
    const block = src.slice(i, end);
    // 窗口自证:先确认切到的确实是那段
    expect(block).toContain('LEGACY_VIDEO_MODEL');
    expect(block).toContain('legacy');
    // 静默替换会让人以为自己在用 H3 —— 必须留下可被看见的痕迹
    expect(block, '回落分支里没有任何告警 —— 那就是静默替换').toMatch(/console\.(warn|error)\(/);
  });

  it('service 里不许再出现写死的 v1 视频路径 —— 版本差异只能有一个出处', () => {
    const src = fs.readFileSync('services/minimax.service.ts', 'utf-8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    // 窗口自证:确认读到的是接了单点模块之后的版本
    expect(src).toContain('pollPath(version, taskId)');
    expect(src).toContain('buildCreateRequest(');
    // 视频的创建/轮询路径不得再写死(图片路径 /v1/image_generation 不在本次范围)
    expect(src).not.toContain('/v1/query/video_generation?task_id=');
    expect(src).not.toContain('`${this.baseURL}/v1/video_generation`');
  });
});
