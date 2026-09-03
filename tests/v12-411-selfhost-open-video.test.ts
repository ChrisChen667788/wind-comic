/**
 * v12.411 — 一个主打「MIT 开源、可自托管」的项目,注册表里全是闭源商业 API。
 *
 * ── 由来:上一轮的 C2 被本轮推翻 ──────────────────────────────────────
 * C2 原文:「生成层已红海,开源侧质量进不了第一梯队,所以我们不在生成层竞争。」
 * 截至 2026-09 这条不成立了:
 *   · Wan 2.7(阿里,2026-04,**Apache 2.0**):1080p/15s + 原生音频 + 声音克隆,
 *     14B 模型 24GB 显存(RTX 4090 可跑);
 *   · LTX-2.5(2026-08,宽松商业许可):单次 diffusion 同步出音视频,16GB 显存,
 *     Artificial Analysis 榜 I2V 第 3 / T2V 第 4,**高于闭源的 Sora 2 Pro**。
 *
 * 于是那个很难看的事实浮出来:用户可以自托管这个应用,却必须为每一帧向别人付费、
 * 并承担别人的停服风险 —— 而停服不是假设(MiniMax Music 410 无预告;
 * Seedance 2.0 海外 API 因好莱坞停止函中止,至今未和解)。
 *
 * ── 为什么是通用适配器,不是「Wan 2.7 service」──────────────────────────
 * 这两个模型迭代极快(Wan 2.1→2.7 不到一年)。绑死某一版,下次升级又要重写 ——
 * 那正是 v12.402 / 403 / 404 连着三版在还的债。所以只约定最小 HTTP 契约。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';

/**
 * safeFetch 会**真做 DNS 解析**,所以测试用的域名会先被 SSRF 拦下 ——
 * 第一次写这条测试就撞到了(报的是「DNS 解析失败」而不是我造的失败)。
 * 这反过来证明 safeFetch 确实在路径上,是好事;所以这里 mock 掉这一层,
 * 而「是否真的走了 safeFetch」交由下面那条源码级断言单独守。
 */
const fetchMock = vi.fn();
vi.mock('@/lib/ssrf-guard', () => ({
  safeFetch: (...args: any[]) => fetchMock(...args),
  assertOutboundUrlSafe: () => {},
}));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fetchMock.mockReset(); delete process.env.SELFHOST_VIDEO_URL; });

/** 按 5s 步进推时钟直到 promise 落定(一次性推太猛会触发内部 abort 定时器) */
async function runWithClock<T>(p: Promise<T>, steps = 40): Promise<T> {
  let done = false;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
  // **立刻接住** —— 否则在推时钟的这段时间里,它是一个「已拒绝但还没人处理」的 promise。
  // Node 20 会把它报成 unhandled rejection 让整个 vitest 退出 1,而 Node 25 不报:
  // 本地 5294 全绿、CI 却红,真因就在这里。「本地绿推不出 CI 绿」的又一个具体形态。
  p.then(
    (value) => { outcome = { ok: true, value }; done = true; },
    (error) => { outcome = { ok: false, error }; done = true; },
  );
  for (let i = 0; i < steps && !done; i++) await vi.advanceTimersByTimeAsync(5000);
  if (!outcome) throw new Error('runWithClock: promise 未在给定步数内落定');
  if ((outcome as { ok: boolean }).ok) return (outcome as { ok: true; value: T }).value;
  throw (outcome as { ok: false; error: unknown }).error;
}

describe('v12.411 · 自托管开源视频端点', () => {
  it('未配置时不可用 —— 整条链行为与此前完全一致(零回归)', async () => {
    delete process.env.SELFHOST_VIDEO_URL;
    const { hasSelfhostVideo } = await import('@/services/selfhost-video.service');
    expect(hasSelfhostVideo()).toBe(false);
  });

  it('同步返回 url 的自建服务能直接用', async () => {
    process.env.SELFHOST_VIDEO_URL = 'https://selfhost.example/generate';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://selfhost.example/out.mp4' }) } as any);
    const { SelfhostVideoService } = await import('@/services/selfhost-video.service');
    expect(await new SelfhostVideoService().generateVideo('一个镜头')).toBe('https://selfhost.example/out.mp4');
  });

  it('异步返回 task_id 的自建服务也能用 —— 两种写法都常见,只认一种会挡掉一半用户', async () => {
    process.env.SELFHOST_VIDEO_URL = 'https://selfhost.example/generate';
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n++;
      if (n === 1) return { ok: true, json: async () => ({ task_id: 'T7' }) } as any;
      return { ok: true, json: async () => ({ status: 'succeeded', video_url: 'https://selfhost.example/done.mp4' }) } as any;
    });
    const { SelfhostVideoService } = await import('@/services/selfhost-video.service');
    vi.useFakeTimers();
    const url = await runWithClock(new SelfhostVideoService().generateVideo('p'));
    vi.useRealTimers();
    expect(url).toBe('https://selfhost.example/done.mp4');
  }, 30_000);

  it('轮询时的瞬时非 200 不判死 —— 自建服务重启/冷启很常见', async () => {
    process.env.SELFHOST_VIDEO_URL = 'https://selfhost.example/generate';
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n++;
      if (n === 1) return { ok: true, json: async () => ({ task_id: 'T8' }) } as any;
      if (n === 2) return { ok: false, status: 502, text: async () => 'bad gateway' } as any;
      return { ok: true, json: async () => ({ url: 'https://selfhost.example/late.mp4' }) } as any;
    });
    const { SelfhostVideoService } = await import('@/services/selfhost-video.service');
    vi.useFakeTimers();
    const url = await runWithClock(new SelfhostVideoService().generateVideo('p'));
    vi.useRealTimers();
    expect(url, '一次 502 就把已在跑的任务判死 = 白花一次算力').toBe('https://selfhost.example/late.mp4');
  }, 30_000);

  it('明确 failed 状态要立刻抛,不能白轮到超时', async () => {
    process.env.SELFHOST_VIDEO_URL = 'https://selfhost.example/generate';
    let n = 0;
    fetchMock.mockImplementation(async () => {
      n++;
      if (n === 1) return { ok: true, json: async () => ({ task_id: 'T9' }) } as any;
      return { ok: true, json: async () => ({ status: 'failed', error: '显存不足' }) } as any;
    });
    const { SelfhostVideoService } = await import('@/services/selfhost-video.service');
    vi.useFakeTimers();
    await expect(runWithClock(new SelfhostVideoService().generateVideo('p'))).rejects.toThrow(/显存不足/);
    vi.useRealTimers();
  }, 30_000);

  it('走 safeFetch —— 自托管 URL 是用户可配的,正是 SSRF 要防的形态', () => {
    const src = fs.readFileSync('services/selfhost-video.service.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src, '窗口自证').toContain('generateVideo');
    expect(src).toContain('safeFetch(');
    expect(src.includes('await fetch('), '裸 fetch 默认 redirect:follow,可被 302 到内网地址').toBe(false);
  });

  it('已注册进 provider 注册表,且优先级排在闭源之前', () => {
    const src = fs.readFileSync('lib/video-providers/builtins.ts', 'utf-8');
    const i = src.indexOf("id: 'selfhost'");
    expect(i, '自托管 provider 没注册 = 又是造好没接线').toBeGreaterThan(0);
    const block = src.slice(i, i + 900);
    expect(block).toContain('SelfhostVideoService');
    // 自托管零边际成本,配了就该优先用
    const mine = /priority:\s*(\d+)/.exec(block);
    expect(mine, '窗口自证:取不到优先级').not.toBeNull();
    const others = [...src.matchAll(/priority:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(Number(mine![1]), '自托管应排在所有闭源 provider 之前').toBe(Math.min(...others));
  });
});
