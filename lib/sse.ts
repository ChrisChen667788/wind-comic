/**
 * v4.1.4 — Server-Sent Events 工具.
 *
 * 把长任务 (I2V 生成 / 工作流执行) 的进度通过 SSE 实时推给前端, 进度环从"时间估算"
 * 变"真实生命周期" (submit → rendering → done/error 即时到达).
 *
 * 纯格式化部分 (formatSSE / parseSSEChunk) 单测; createSSEResponse 给 route 用.
 *
 * 单测: tests/v4-1-4-sse.test.ts.
 */

export interface SSEEvent {
  /** 事件类型 (progress / done / error). 省略则前端按 message 默认事件收. */
  event?: string;
  data: unknown;
}

/** 一条 SSE 帧: `event: x\ndata: {...}\n\n`. data 自动 JSON.stringify. */
export function formatSSE(ev: SSEEvent): string {
  const lines: string[] = [];
  if (ev.event) lines.push(`event: ${ev.event}`);
  const payload = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data);
  // data 可能多行, 每行加 data: 前缀
  for (const line of payload.split('\n')) lines.push(`data: ${line}`);
  return lines.join('\n') + '\n\n';
}

/** 解析一段 SSE 文本 (可能含多帧), 返回 {event,data} 列表 + 剩余未完成 buffer. */
export function parseSSEChunk(buffer: string): { events: Array<{ event: string; data: any }>; rest: string } {
  const events: Array<{ event: string; data: any }> = [];
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? ''; // 最后一段可能不完整, 留回 buffer
  for (const frame of frames) {
    if (!frame.trim()) continue;
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    const raw = dataLines.join('\n');
    let data: any = raw;
    try { data = JSON.parse(raw); } catch { /* 保留原始字符串 */ }
    events.push({ event, data });
  }
  return { events, rest };
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // 关 nginx 缓冲, 保证实时
};

export type SSESend = (ev: SSEEvent) => void;

/**
 * 用一个 handler 构造 SSE Response. handler 拿到 send (推帧) + 必须最终 resolve
 * (resolve 后流自动关闭). handler 抛错会被捕获并推一条 error 帧再关流.
 */
export function createSSEResponse(handler: (send: SSESend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send: SSESend = (ev) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(formatSSE(ev))); } catch { /* 已关 */ }
      };
      try {
        await handler(send);
      } catch (e) {
        send({ event: 'error', data: { error: e instanceof Error ? e.message : String(e) } });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
