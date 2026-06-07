/**
 * lib/sse-client (v10.2.0) — 前端 SSE 订阅(基于 fetch + ReadableStream)。
 *
 * 为何不用原生 EventSource:它无法带自定义请求头,而本应用用 Authorization: Bearer 鉴权。
 * fetch 流式读取可带 header,且复用 lib/sse.ts 的 parseSSEChunk 解析帧。
 * 断线自动重连(指数退避封顶 30s);close() 主动停止。纯客户端用,勿在服务端 import。
 */
import { parseSSEChunk } from '@/lib/sse';

export interface SSESubscription {
  close: () => void;
}

export interface SubscribeOpts {
  token?: string | null;
  onEvent: (ev: { event: string; data: any }) => void;
  onStatus?: (status: 'open' | 'error' | 'closed') => void;
}

export function subscribeSSE(url: string, opts: SubscribeOpts): SSESubscription {
  const ctrl = new AbortController();
  let stopped = false;
  let backoff = 1000;

  async function run() {
    while (!stopped) {
      try {
        const res = await fetch(url, {
          headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (!res.ok || !res.body) throw new Error(`sse http ${res.status}`);
        opts.onStatus?.('open');
        backoff = 1000; // 连上即重置退避
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const { events, rest } = parseSSEChunk(buf);
          buf = rest;
          for (const ev of events) opts.onEvent(ev);
        }
      } catch {
        if (stopped) break;
        opts.onStatus?.('error');
      }
      if (stopped) break;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
    opts.onStatus?.('closed');
  }

  run();
  return {
    close: () => {
      stopped = true;
      ctrl.abort();
    },
  };
}
