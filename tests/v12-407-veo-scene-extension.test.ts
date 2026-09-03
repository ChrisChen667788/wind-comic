/**
 * v12.407 — Veo Scene Extension:把成片接长,**而不是让单次生成变长**。
 *
 * ── 这一版的由来是我自己写错的一句话 ──────────────────────────────────
 * v12.401 竞品复核时,我把「Veo 3.1 单次 60s+」写进了 README,被独立二次检索
 * **当场推翻**:那 60s+ 是 Scene Extension **续接**出来的,单次生成上限仍是 8–10s。
 * 所以本模块的命名、日志、返回值一律说「段数」而不说「时长上限」——
 * 代码本身要挡住下一个人重犯同一个错。
 *
 * ── 最要紧的一条断言 ──────────────────────────────────────────────────
 * **续接失败绝不能把已经生成、已经计费的首段一起丢掉**。
 * 这个项目的老毛病就是「一处失败拖垮整体」。首段是真金白银出来的,
 * 接不上就把首段还回去 + 说明原因,由调用方决定接受短片还是重试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  planExtension, isExtendUnsupported, VEO_SEGMENT_SEC, VEO_EXTEND_MAX_SEGMENTS,
} from '@/lib/veo-scene-extension';


/**
 * 按 5s 步进推进假时钟,直到 promise 落定。
 * 一次性 advance 60s 会把 `fetchWithTimeout` 内部那个 30s 的 AbortController
 * 定时器也一起触发,于是每个 fetch 都被自己abort 掉 —— 表现成「测试超时」,
 * 但真因是时钟推得太猛。步进即可让每次 fetch 在它自己的超时之前落定。
 */
async function runWithClock<T>(p: Promise<T>, steps = 40): Promise<T> {
  let done = false;
  const wrapped = p.then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
  for (let i = 0; i < steps && !done; i++) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  return wrapped;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('v12.407 · Veo Scene Extension', () => {
  it('规划:目标时长换算成段数,而不是塞给单次生成', () => {
    expect(planExtension(8)).toMatchObject({ extendCount: 0, plannedSec: 8, shortfallSec: 0 });
    expect(planExtension(24)).toMatchObject({ extendCount: 2, plannedSec: 24 });
    // 60s 要 8 段(7 次续接)—— 这正是「60s+ 不是单次能力」的具体形状
    const p60 = planExtension(60);
    expect(p60.extendCount).toBe(7);
    expect(p60.plannedSec).toBe(64);
  });

  it('超过链长上限时如实报缺口,不假装能做到', () => {
    const far = planExtension((VEO_EXTEND_MAX_SEGMENTS + 5) * VEO_SEGMENT_SEC);
    expect(far.extendCount).toBe(VEO_EXTEND_MAX_SEGMENTS - 1);
    expect(far.shortfallSec, '做不到就要报缺口,不能悄悄截断').toBeGreaterThan(0);
  });

  it('单段量级是 8s —— 这个常量存在的意义就是提醒长度不靠它变大', () => {
    expect(VEO_SEGMENT_SEC).toBeLessThanOrEqual(10);
  });

  it('「网关没有续接端点」要能与「生成失败」区分开', () => {
    expect(isExtendUnsupported('Veo extend error (404): not found')).toBe(true);
    expect(isExtendUnsupported('unsupported operation')).toBe(true);
    // 内容/额度类失败不该被当成「不支持」而静默降级
    expect(isExtendUnsupported('quota exceeded')).toBe(false);
    expect(isExtendUnsupported('content policy violation')).toBe(false);
  });

  it('续接失败时**返回已生成的首段**,而不是连首段一起丢掉', { timeout: 30_000 }, async () => {
    process.env.VEO_API_KEY = 'test-key';
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      call++;
      if (u.includes('/v1/video/create')) return { ok: true, json: async () => ({ id: 'T1' }) } as any;
      if (u.includes('/v1/video/query')) {
        return { ok: true, json: async () => ({ status: 'succeeded', video_url: 'https://cdn/seg1.mp4' }) } as any;
      }
      if (u.includes('/v1/video/extend')) {
        return { ok: false, status: 404, text: async () => 'not found' } as any;
      }
      return { ok: false, status: 500, text: async () => 'x' } as any;
    }));

    const { VeoService } = await import('@/services/veo.service');
    const svc = new VeoService();
    vi.useFakeTimers();
    const out = await runWithClock(svc.generateExtended('https://x/f.png', '一个镜头', 24));
    vi.useRealTimers();

    expect(call, '窗口自证:确实发出了请求').toBeGreaterThan(0);
    expect(out.videoUrl, '首段已计费,绝不能丢').toBe('https://cdn/seg1.mp4');
    expect(out.segments).toBe(1);
    expect(out.stoppedBecause, '停下的原因必须说清楚').toContain('续接端点');
  });

  it("轮询认得出 'succeeded' —— 差一个后缀就会把已计费的任务白轮到超时", async () => {
    // 写本版测试时当场撞到:mock 返回 'succeeded',而 normalizeStatus 只认
    // succeed/success/completed/finished,于是轮满 60 次超时。
    // 与 v12.122 的 Kling 'Fail'(无 -ed)同型 —— 状态字面量差一个后缀,
    // 表现却是「生成失败」,人会去查生成侧,查不到真因。
    process.env.VEO_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('/v1/video/create')) return { ok: true, json: async () => ({ id: 'T1' }) } as any;
      return { ok: true, json: async () => ({ status: 'succeeded', video_url: 'https://cdn/ok.mp4' }) } as any;
    }));
    const { VeoService } = await import('@/services/veo.service');
    vi.useFakeTimers();
    const out = await runWithClock(new VeoService().generateExtended('https://x/f.png', 'p', 8));
    vi.useRealTimers();
    expect(out.videoUrl).toBe('https://cdn/ok.mp4');
  }, 30_000);

  it('目标时长本就在一段之内时,不会去调续接端点', { timeout: 30_000 }, async () => {
    process.env.VEO_API_KEY = 'test-key';
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      seen.push(String(url));
      if (String(url).includes('/v1/video/create')) return { ok: true, json: async () => ({ id: 'T1' }) } as any;
      return { ok: true, json: async () => ({ status: 'succeeded', video_url: 'https://cdn/one.mp4' }) } as any;
    }));
    const { VeoService } = await import('@/services/veo.service');
    vi.useFakeTimers();
    const out = await runWithClock(new VeoService().generateExtended('https://x/f.png', 'p', 8));
    vi.useRealTimers();

    expect(seen.length, '窗口自证').toBeGreaterThan(0);
    expect(out.segments).toBe(1);
    expect(seen.some((u) => u.includes('/extend')), '一段就够时不该白调续接').toBe(false);
  });
});
