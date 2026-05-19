/**
 * v3.2 P1 — 示例 plugin: Replicate SDXL.
 *
 * 这是给二次开发者看的"如何写一个新 provider"的范本.
 * **默认不自动注册** — 只在 ENABLE_REPLICATE=1 + REPLICATE_API_TOKEN 都齐时才注册.
 *
 * 用法 (开发者):
 *   1. 复制本文件改个 id + name + endpoint
 *   2. 在 orchestrator 启动入口 import 你的文件触发副作用注册
 *   3. 设环境变量 → 注册表自动接你进 chain
 *
 * 注意: 这不是真跑过的 endpoint, 是参考骨架. 真用请按 Replicate 实际 API 文档调.
 */

import { registerImageProvider } from './registry';
import type { ImageGenerateInput } from './types';

if (process.env.ENABLE_REPLICATE === '1' && process.env.REPLICATE_API_TOKEN) {
  registerImageProvider({
    id: 'replicate-sdxl',
    name: 'Replicate SDXL (example plugin)',
    supportsRefs: true,
    maxRefImages: 4,
    priority: 80,   // 默认比内置 minimax-multi (90) 优先
    available: () => !!process.env.REPLICATE_API_TOKEN,
    async generate(input: ImageGenerateInput) {
      const token = process.env.REPLICATE_API_TOKEN;
      if (!token) throw new Error('REPLICATE_API_TOKEN missing');

      // 1. 创建 prediction
      const createRes = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 示例版本 — 真用请替换最新 hash
          version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
          input: {
            prompt: input.prompt,
            negative_prompt: 'low quality, blurry, watermark',
            width: input.aspectRatio === '9:16' ? 768 : 1024,
            height: input.aspectRatio === '9:16' ? 1024 : 768,
            num_outputs: 1,
            scheduler: 'K_EULER',
            num_inference_steps: 25,
          },
        }),
      });
      if (!createRes.ok) throw new Error(`Replicate create ${createRes.status}`);
      const pred = await createRes.json();
      const id = pred.id;
      const pollUrl = pred.urls?.get;
      if (!pollUrl) throw new Error('Replicate: no poll url');

      // 2. 轮询结果 (Replicate 同步 API 可能直接返完成, 但通用做法是 poll)
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(pollUrl, { headers: { Authorization: `Token ${token}` } });
        if (!pollRes.ok) continue;
        const status = await pollRes.json();
        if (status.status === 'succeeded' && Array.isArray(status.output) && status.output[0]) {
          return {
            imageUrl: status.output[0],
            provider: 'replicate-sdxl',
            upstreamId: id,
          };
        }
        if (status.status === 'failed' || status.status === 'canceled') {
          throw new Error(`Replicate ${status.status}: ${status.error || 'unknown'}`);
        }
      }
      throw new Error('Replicate poll timeout');
    },
  });
}
