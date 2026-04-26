/**
 * fal.ai FLUX Kontext Service — 角色一致性图片生成
 *
 * FLUX Kontext 支持多参考图（最多4张），可在生成新图时严格保持角色外观一致性。
 * 一致性保真度: 90-95%（面部、发型、服装、配饰）
 *
 * API: https://fal.ai/models/fal-ai/flux-kontext/max/api
 * 文档: https://docs.fal.ai/
 *
 * 环境变量:
 *   FAL_KEY=your_fal_ai_key
 */

import { API_CONFIG } from '@/lib/config';

const FAL_KEY = process.env.FAL_KEY || '';
const FAL_BASE_URL = 'https://queue.fal.run';

/** 带超时的 fetch —— 防止 API 无响应时无限挂起 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function hasFalFlux(): boolean {
  return !!FAL_KEY && !FAL_KEY.startsWith('your_');
}

interface FalFluxOptions {
  /** 参考图 URL 列表（最多4张，用于角色一致性） */
  referenceImages?: string[];
  /** 宽高比 */
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  /** 图片尺寸 */
  width?: number;
  height?: number;
  /** 引导强度 (1-20, 默认 3.5) */
  guidanceScale?: number;
  /** 推理步数 (默认 28) */
  numInferenceSteps?: number;
  /** 安全检查 */
  enableSafetyChecker?: boolean;
}

interface FalSubmitResponse {
  request_id: string;
  status?: string;
}

interface FalResultResponse {
  images: Array<{
    url: string;
    width: number;
    height: number;
    content_type: string;
  }>;
  seed: number;
  has_nsfw_concepts: boolean[];
  prompt: string;
}

interface FalStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_url?: string;
  logs?: Array<{ message: string; timestamp: string }>;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export class FalFluxService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || FAL_KEY;
  }

  /**
   * 使用 FLUX Kontext 生成图片（支持角色参考图一致性）
   *
   * @param prompt 图片描述提示词
   * @param options.referenceImages 参考图URL列表（角色三视图等）
   * @returns 生成的图片URL
   */
  async generateImage(prompt: string, options?: FalFluxOptions): Promise<string> {
    const model = options?.referenceImages?.length
      ? 'fal-ai/flux-kontext/max'     // 有参考图 → 用 Kontext (支持角色一致性)
      : 'fal-ai/flux-pro/v1.1-ultra'; // 无参考图 → 用 FLUX Pro

    console.log(`[FalFlux] Using model: ${model}`);
    console.log(`[FalFlux] Prompt: ${prompt.slice(0, 120)}...`);
    if (options?.referenceImages?.length) {
      console.log(`[FalFlux] Reference images: ${options.referenceImages.length}`);
    }

    // 构建请求体
    const body = this.buildRequestBody(prompt, model, options);

    // 提交到队列
    const submitRes = await fetchWithTimeout(`${FAL_BASE_URL}/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`fal.ai submit failed (${submitRes.status}): ${err}`);
    }

    const submitData: FalSubmitResponse = await submitRes.json();
    const requestId = submitData.request_id;

    if (!requestId) {
      // 同步返回（小模型可能直接返回）
      const syncData = submitData as any;
      if (syncData.images?.[0]?.url) {
        return syncData.images[0].url;
      }
      throw new Error('fal.ai: no request_id in response');
    }

    console.log(`[FalFlux] Queued: ${requestId}`);

    // 轮询结果
    return await this.pollResult(model, requestId);
  }

  /**
   * 使用 FLUX Kontext 编辑图片（保持角色一致性的同时改变场景/动作）
   * 适合：给同一个角色换场景、换姿势、换表情
   */
  async editImage(
    sourceImageUrl: string,
    editPrompt: string,
    options?: Omit<FalFluxOptions, 'referenceImages'>
  ): Promise<string> {
    const model = 'fal-ai/flux-kontext/max';
    console.log(`[FalFlux] Edit mode: transforming source image`);

    const body: Record<string, any> = {
      prompt: editPrompt,
      image_url: sourceImageUrl,
      guidance_scale: options?.guidanceScale ?? 3.5,
      num_inference_steps: options?.numInferenceSteps ?? 28,
      enable_safety_checker: options?.enableSafetyChecker ?? false,
    };

    if (options?.aspectRatio) {
      const sizeMap = this.getSize(options.aspectRatio);
      body.image_size = sizeMap;
    }

    const submitRes = await fetchWithTimeout(`${FAL_BASE_URL}/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`fal.ai edit failed (${submitRes.status}): ${err}`);
    }

    const submitData = await submitRes.json();
    if (submitData.images?.[0]?.url) {
      return submitData.images[0].url;
    }

    const requestId = submitData.request_id;
    if (!requestId) throw new Error('fal.ai edit: no request_id');

    return await this.pollResult(model, requestId);
  }

  // ═══════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════

  private buildRequestBody(prompt: string, model: string, options?: FalFluxOptions): Record<string, any> {
    const body: Record<string, any> = {
      prompt,
      num_images: 1,
      enable_safety_checker: options?.enableSafetyChecker ?? false,
    };

    // Kontext 模型：使用 image_url 传入参考图
    if (model.includes('kontext') && options?.referenceImages?.length) {
      // FLUX Kontext 使用 image_url 作为参考输入
      body.image_url = options.referenceImages[0];

      // 如果有多个参考图，在提示词中说明
      if (options.referenceImages.length > 1) {
        body.image_urls = options.referenceImages;
      }

      body.guidance_scale = options?.guidanceScale ?? 4.0; // 稍高引导以保持一致性
      body.num_inference_steps = options?.numInferenceSteps ?? 30;
    } else {
      // FLUX Pro：标准文生图
      body.guidance_scale = options?.guidanceScale ?? 3.5;
      body.num_inference_steps = options?.numInferenceSteps ?? 28;
    }

    // 尺寸
    if (options?.width && options?.height) {
      body.image_size = { width: options.width, height: options.height };
    } else if (options?.aspectRatio) {
      body.image_size = this.getSize(options.aspectRatio);
    } else {
      body.image_size = { width: 1344, height: 768 }; // 默认 16:9
    }

    return body;
  }

  private getSize(ratio: string): { width: number; height: number } {
    const sizeMap: Record<string, { width: number; height: number }> = {
      '1:1': { width: 1024, height: 1024 },
      '16:9': { width: 1344, height: 768 },
      '9:16': { width: 768, height: 1344 },
      '4:3': { width: 1152, height: 896 },
      '3:4': { width: 896, height: 1152 },
      '2.35:1': { width: 1408, height: 600 },
    };
    return sizeMap[ratio] || sizeMap['16:9'];
  }

  private async pollResult(model: string, requestId: string, maxAttempts = 120): Promise<string> {
    const statusUrl = `${FAL_BASE_URL}/${model}/requests/${requestId}/status`;
    const resultUrl = `${FAL_BASE_URL}/${model}/requests/${requestId}`;

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(2000);

      try {
        // 检查状态
        const statusRes = await fetchWithTimeout(statusUrl, {
          headers: { 'Authorization': `Key ${this.apiKey}` },
        });

        if (!statusRes.ok) {
          console.warn(`[FalFlux] Status check failed: ${statusRes.status}`);
          continue;
        }

        const statusData: FalStatusResponse = await statusRes.json();
        console.log(`[FalFlux] Poll #${i + 1}: ${statusData.status}`);

        if (statusData.status === 'COMPLETED') {
          // 获取结果
          const resultRes = await fetchWithTimeout(resultUrl, {
            headers: { 'Authorization': `Key ${this.apiKey}` },
          });

          if (!resultRes.ok) {
            throw new Error(`fal.ai result fetch failed: ${resultRes.status}`);
          }

          const resultData: FalResultResponse = await resultRes.json();
          if (resultData.images?.[0]?.url) {
            console.log(`[FalFlux] Done: ${resultData.images[0].url.slice(0, 80)}...`);
            return resultData.images[0].url;
          }
          throw new Error('fal.ai: completed but no image URL');
        }

        if (statusData.status === 'FAILED') {
          throw new Error('fal.ai generation failed');
        }

        // IN_QUEUE / IN_PROGRESS — 继续等待
      } catch (e) {
        if (i === maxAttempts - 1) throw e;
        console.warn(`[FalFlux] Poll error (will retry): ${e}`);
      }
    }

    throw new Error('fal.ai timeout (4 min)');
  }
}
