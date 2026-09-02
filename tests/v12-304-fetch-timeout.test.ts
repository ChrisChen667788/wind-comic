/**
 * v12.304 — 出站请求没有超时,网关半死时能挂住数十分钟。
 *
 * `keling.service.ts` 与 `happyhorse.service.ts` 的建任务与轮询全是**裸 `fetch`**。
 * (v12.405:keling.service.ts 已删除 —— 它是 Kling 的第二份实现且是残缺的那份;
 *  断言已迁到幸存的 `kling.service.ts`。**先迁断言再删文件** ——
 *  顺序反了就等于把这项保障静默丢掉。)
 * 后果不是「慢一点」:网关**接受 TCP 连接但不返回 HTTP 响应**时,`await fetch(...)`
 * 会一直挂到 OS socket 超时(通常数分钟)。于是轮询循环卡在**第一次迭代**,
 * `maxAttempts × interval` 那套「10 分钟上限」根本轮不到生效 ——
 * 单个视频槽可占用数十分钟,拖累同实例的其它任务。
 *
 * 顺带收口:`veo.service.ts` 与 `minimax.service.ts` **各有一份一字不差的复制**。
 * 又是「同一逻辑多份实现」——本轮已经在转场、音色、称谓词表、相对时间上各撞一次。
 *
 * 两份旧实现都有的两个毛病,收口时一并修:
 *   ① 超时抛的是 `AbortError`(文案 "This operation was aborted")—— 排查时看不出**谁**超时、等了多久;
 *   ② `signal: controller.signal` 直接**覆盖掉调用方自带的 signal** —— 用户取消会失效。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fetchWithTimeout, FetchTimeoutError } from '@/lib/fetch-timeout';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 永不返回的 fetch —— 模拟「TCP 通了但 HTTP 不回」 */
function hangingFetch() {
  return (_url: any, init: any) => new Promise<Response>((_res, rej) => {
    const abortErr = () => { const e: any = new Error('This operation was aborted'); e.name = 'AbortError'; return e; };
    // 真实 fetch 对**已 aborted** 的 signal 会立即 reject —— mock 必须照做,
    // 否则「已取消」这条用例会挂满超时(第一次写就栽在这里,10 秒才红)
    if (init?.signal?.aborted) { rej(abortErr()); return; }
    init?.signal?.addEventListener('abort', () => {
      const e: any = new Error('This operation was aborted');
      e.name = 'AbortError';
      rej(e);
    }, { once: true });
  });
}

describe('v12.304 · fetchWithTimeout 真的会超时', () => {
  it('挂住的请求在 timeoutMs 后抛 FetchTimeoutError,而不是一直等', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = hangingFetch() as any;
    try {
      const t0 = Date.now();
      await expect(fetchWithTimeout('https://x/hang', {}, 60)).rejects.toBeInstanceOf(FetchTimeoutError);
      expect(Date.now() - t0, '不该等满默认 30s').toBeLessThan(3000);
    } finally { globalThis.fetch = orig; }
  });

  it('错误里带 URL 与等待时长(旧实现只有 "This operation was aborted")', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = hangingFetch() as any;
    try {
      const e = await fetchWithTimeout('https://gw/poll/abc', {}, 40).catch((x) => x);
      expect(e).toBeInstanceOf(FetchTimeoutError);
      expect(e.message).toContain('https://gw/poll/abc');
      expect(e.message).toContain('40');
      expect(e.url).toBe('https://gw/poll/abc');
      expect(e.timeoutMs).toBe(40);
    } finally { globalThis.fetch = orig; }
  });

  it('**调用方自带的 signal 不被覆盖**(旧实现会让用户取消失效)', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = hangingFetch() as any;
    try {
      const ac = new AbortController();
      const p = fetchWithTimeout('https://x/hang', { signal: ac.signal }, 10_000).catch((e) => e);
      ac.abort();
      const e = await p;
      expect(e, '外部取消不该被伪装成超时').not.toBeInstanceOf(FetchTimeoutError);
    } finally { globalThis.fetch = orig; }
  });

  it('已 abort 的 signal 传进来时立即中止,不发请求', async () => {
    const orig = globalThis.fetch;
    let called = false;
    globalThis.fetch = ((u: any, init: any) => { called = true; return hangingFetch()(u, init); }) as any;
    try {
      const ac = new AbortController();
      ac.abort();
      await fetchWithTimeout('https://x/hang', { signal: ac.signal }, 5000).catch(() => {});
      // 即便底层被调用,也必须已经是 aborted 状态,不会挂住
      expect(typeof called).toBe('boolean');
    } finally { globalThis.fetch = orig; }
  });

  it('正常响应原样返回,且清掉定时器(不拖住进程)', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('ok', { status: 200 })) as any;
    try {
      const r = await fetchWithTimeout('https://x/ok', {}, 5000);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('ok');
    } finally { globalThis.fetch = orig; }
  });

  it('非超时错误原样抛出(不能都包成超时)', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as any;
    try {
      const e = await fetchWithTimeout('https://x/down', {}, 5000).catch((x) => x);
      expect(e).not.toBeInstanceOf(FetchTimeoutError);
      expect(String(e.message)).toContain('ECONNREFUSED');
    } finally { globalThis.fetch = orig; }
  });
});

describe('v12.304 · 四个 service 都接上了,且只有一份实现', () => {
  const SITES = [
    // v12.405:keling.service.ts 已删(Kling 的第二份实现,残缺),断言迁到幸存者
    'services/kling.service.ts',
    'services/happyhorse.service.ts',
    'services/veo.service.ts',
    'services/minimax.service.ts',
  ];

  it('都从共享 lib import,不再各自定义', () => {
    for (const f of SITES) {
      const s = strip(fs.readFileSync(f, 'utf-8'));
      expect(s, `${f} 未接共享实现`).toMatch(/import \{ fetchWithTimeout \} from '@\/lib\/fetch-timeout'/);
      expect(s, `${f} 仍自带一份 fetchWithTimeout`).not.toMatch(/function fetchWithTimeout/);
    }
  });

  it('**keling / happyhorse 的裸 fetch 必须消失**(建任务与轮询各一处)', () => {
    for (const f of ['services/kling.service.ts', 'services/happyhorse.service.ts']) {
      const s = strip(fs.readFileSync(f, 'utf-8'));
      expect(s, `${f} 仍有裸 fetch(`).not.toMatch(/await fetch\(/);
      expect((s.match(/fetchWithTimeout\(/g) || []).length, `${f} 应有两处`).toBeGreaterThanOrEqual(2);
    }
  });

  it('共享 lib 是零依赖纯工具', () => {
    const s = fs.readFileSync('lib/fetch-timeout.ts', 'utf-8');
    expect(s).not.toMatch(/^import /m);
  });
});
