/**
 * GET /api/projects/[id]/render-loop · v9.2.1 — 渲染循环实时反馈 (技术监看「渲染循环」面板).
 *
 * 把项目剧本镜头 + 已落库分镜/视频资产投影成每镜渲染状态 + 整体进度/ETA。
 *   - `?snapshot=1` → 单次 JSON 快照 (初始绘制 / 冒烟测试, 确定性)
 *   - 默认 → SSE 流: 每 tick 推快照, 收敛 (无 active/pending) 或达 maxTicks 后推 done 关流。
 *
 * 复用 lib/sse (createSSEResponse) + lib/render-loop (纯逻辑)。轮询 DB, 与生成请求解耦,
 * 不论生成是否在跑都能看到当前进度; 客户端断开 (signal.aborted) 即停止轮询。
 */

import { NextRequest } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { createSSEResponse } from '@/lib/sse';
import {
  deriveShotRenderStates, summarizeRenderLoop, isRenderLoopSettled,
  type ShotLike, type AssetLike,
} from '@/lib/render-loop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function snapshot(projectId: string) {
  const scriptRows = await listAssetsByType(projectId, 'script');
  let script: any = {};
  try { script = JSON.parse(scriptRows[0]?.data || '{}'); } catch { script = {}; }
  const shots: ShotLike[] = Array.isArray(script.shots) ? script.shots : [];
  const [videoAssets, storyboardAssets] = await Promise.all([
    listAssetsByType(projectId, 'video') as Promise<AssetLike[]>,
    listAssetsByType(projectId, 'storyboard') as Promise<AssetLike[]>,
  ]);
  const shotsState = deriveShotRenderStates({ shots, videoAssets, storyboardAssets });
  return { summary: summarizeRenderLoop(shotsState), shots: shotsState };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const url = new URL(request.url);

  // 单次快照 (初始绘制 / 测试)
  if (url.searchParams.get('snapshot') === '1') {
    return Response.json(await snapshot(projectId));
  }

  // SSE 流
  const intervalMs = Math.min(5000, Math.max(800, Number(url.searchParams.get('interval')) || 1500));
  const maxTicks = Math.min(400, Math.max(1, Number(url.searchParams.get('maxTicks')) || 200)); // ~5min @1.5s

  return createSSEResponse(async (send) => {
    let last = '';
    for (let tick = 0; tick < maxTicks; tick++) {
      if (request.signal?.aborted) return; // 客户端断开 → 停止轮询
      const snap = await snapshot(projectId);
      const fingerprint = JSON.stringify(snap);
      if (fingerprint !== last) { send({ event: 'progress', data: snap }); last = fingerprint; }
      if (isRenderLoopSettled(snap.summary)) { send({ event: 'done', data: snap }); return; }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (!request.signal?.aborted) send({ event: 'done', data: await snapshot(projectId) });
  });
}
