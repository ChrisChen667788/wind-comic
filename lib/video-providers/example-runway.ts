/**
 * v3.2 P2 — VideoProvider 二开范本: Runway Gen-3 Alpha.
 *
 * Runway 不在内置链里 (需要单独 API key + 用户自付费). 这文件演示如何写一个
 * 第三方 video provider, 让你只需 import + 设两个 env 就能接入新的视频引擎.
 *
 * 接入步骤:
 *   1. 设置 ENABLE_RUNWAY=1, RUNWAY_API_KEY=key_xxx 在 .env.local
 *   2. 在某处 import 此文件 (例如 lib/video-providers/index.ts 加一行)
 *      或者把文件放到 IMAGE_PROVIDERS_DIR-like 目录由 autoDiscoverProviders 自动加载
 *   3. orchestrator.generateVideo 通过 registry 调度链自动包含 runway
 *
 * 如果你只是想跑测试, 不用真的开 ENABLE_RUNWAY — available() 会返回 false, 调度链跳过.
 */

import { registerVideoProvider } from './registry';
import type { VideoGenerateInput } from './types';

if (process.env.ENABLE_RUNWAY === '1' && process.env.RUNWAY_API_KEY) {
  registerVideoProvider({
    id: 'runway-gen3',
    name: 'Runway Gen-3 Alpha',
    priority: 65,   // 介于 Veo (60) 和 Kling (70) — 用户实测决定
    supportsImage2Video: true,
    supportsText2Video: true,
    supportsLastFrame: false,
    supportsSubjectReference: false,
    maxDurationSec: 10,
    available: () => !!process.env.RUNWAY_API_KEY,
    async generate(input: VideoGenerateInput) {
      const key = process.env.RUNWAY_API_KEY!;
      const base = process.env.RUNWAY_BASE_URL || 'https://api.runwayml.com';

      // ─── Step 1: create task ────────────────────────────────────────
      const createRes = await fetch(`${base}/v1/image_to_video`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify({
          model: 'gen3a_turbo',
          promptText: input.prompt,
          promptImage: input.firstFrameUrl,
          duration: Math.min(input.durationSec || 5, 10),
          ratio: input.aspectRatio === '9:16' ? '768:1280' : '1280:768',
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!createRes.ok) {
        throw new Error(`runway create ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`);
      }
      const created = await createRes.json();
      const taskId = created.id || created.task_id;
      if (!taskId) throw new Error('runway: no task id in create response');

      // ─── Step 2: poll until done ────────────────────────────────────
      const start = Date.now();
      const POLL_MS = 5_000;
      const TIMEOUT_MS = 12 * 60 * 1000;
      while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const statusRes = await fetch(`${base}/v1/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${key}`,
            'X-Runway-Version': '2024-11-06',
          },
          signal: AbortSignal.timeout(15_000),
        });
        if (!statusRes.ok) continue;
        const j = await statusRes.json();
        if (j.status === 'SUCCEEDED' && j.output?.[0]) {
          input.onProgress?.(1, 'runway: succeeded');
          return { videoUrl: j.output[0], provider: 'runway-gen3', upstreamId: taskId };
        }
        if (j.status === 'FAILED') {
          throw new Error(`runway task failed: ${j.failure || 'unknown'}`);
        }
        input.onProgress?.(Math.min(0.9, (Date.now() - start) / TIMEOUT_MS), `runway: ${j.status}`);
      }
      throw new Error('runway: poll timeout');
    },
  });
  console.log('[VideoProviders] runway-gen3 registered (priority 65)');
}
