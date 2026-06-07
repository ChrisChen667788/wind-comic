/**
 * GET /api/projects/[id]/comments/stream (v10.2.0) — 项目评论实时流 (SSE)。
 *
 * 订阅该项目的 comment 频道:有新评论即推一帧 → 评论区实时刷新,取代轮询。
 * 与项目评论 GET 一致按 projectId 作用域(GET 本就无需 token),帧内只带
 * {type, commentId, at}(无内容),前端收到后走原有评论 GET 取最新列表。
 * 25s keepalive;客户端断开 → 清理订阅。
 */
import { createSSEResponse } from '@/lib/sse';
import { subscribe, commentChannel } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return createSSEResponse(async (send) => {
    send({ event: 'ready', data: { ok: true } });
    const off = subscribe(commentChannel(id), (ev) => send({ event: 'comment', data: ev }));
    const ping = setInterval(() => send({ event: 'ping', data: { at: Date.now() } }), 25_000);
    await new Promise<void>((resolve) => {
      const done = () => { clearInterval(ping); off(); resolve(); };
      if (request.signal.aborted) return done();
      request.signal.addEventListener('abort', done);
    });
  });
}
