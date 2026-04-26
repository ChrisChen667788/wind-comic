// Midjourney is consumed via any OpenAI/MJ-compatible aggregator.
// Set MJ_BASE_URL to your provider (e.g. https://api.vectorengine.ai, https://api.qingyuntop.top).
// Falls back to a safe default; keys are read from MJ_API_KEY (preferred) or BANANA_API_KEY (legacy).
const MJ_BASE_URL = process.env.MJ_BASE_URL || 'https://api.vectorengine.ai';
const MJ_API_KEY = process.env.MJ_API_KEY || process.env.BANANA_API_KEY || '';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** 带超时的 fetch —— 防止 API 无响应时无限挂起 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// 进度回调
type MJProgressCallback = (progress: string, status: string) => void;

export class MidjourneyService {
  private apiKey: string;
  public onProgress?: MJProgressCallback;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || MJ_API_KEY;
  }

  /**
   * 生成单张图片（imagine 4宫格 → 自动 U1 upscale → 返回单图 URL）
   *
   * 这是业界标准流程：MJ 默认输出 2×2 四宫格，必须 upscale 后才能用作
   * 角色参考图(--cref)、场景参考图(--sref)、或视频首帧(first_frame)。
   */
  async generateImage(prompt: string, options?: {
    aspectRatio?: string;
    style?: string;
    cref?: string;  // --cref 角色一致性参考图URL
    sref?: string;  // --sref 风格一致性参考图URL
    cw?: number;    // --cw 角色权重 0-100
    upscaleIndex?: 1 | 2 | 3 | 4; // 选择四宫格中的哪一张（默认 U1）
    skipUpscale?: boolean; // 跳过 upscale（仅在不需要单图时使用）
  }): Promise<string> {
    let fullPrompt = prompt;

    // 追加 Midjourney 参数
    if (options?.cref) fullPrompt += ` --cref ${options.cref} --cw ${options.cw ?? 100}`;
    if (options?.sref) fullPrompt += ` --sref ${options.sref}`;
    if (options?.aspectRatio) fullPrompt += ` --ar ${options.aspectRatio}`;
    if (options?.style) fullPrompt += ` --style ${options.style}`;

    console.log(`[MJ] Submit imagine: ${fullPrompt.slice(0, 120)}...`);

    // ── Step 1: 提交 imagine 任务 → 获取四宫格 ──
    const response = await fetchWithTimeout(`${MJ_BASE_URL}/mj/submit/imagine`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: fullPrompt }),
    }, 30_000);

    const data = await response.json();
    if (data.code !== 1 || !data.result) {
      throw new Error(`MJ submit failed: ${data.description || JSON.stringify(data)}`);
    }

    const imagineTaskId = data.result;
    console.log(`[MJ] Imagine task: ${imagineTaskId}`);

    // 等待四宫格生成完成
    const imagineResult = await this.pollResult(imagineTaskId);

    // 如果不需要 upscale，直接返回四宫格（仅用于预览等特殊场景）
    if (options?.skipUpscale) {
      return imagineResult.imageUrl;
    }

    // ── Step 2: 提交 U1 upscale → 获取单张图片 ──
    // 如果 upscale 失败（503 等），优雅降级返回原始四宫格而非抛出异常
    const upscaleIndex = options?.upscaleIndex || 1;
    console.log(`[MJ] Upscale U${upscaleIndex} from task ${imagineTaskId}`);

    try {
      const upscaleUrl = await this.upscale(imagineTaskId, upscaleIndex);
      return upscaleUrl;
    } catch (e) {
      console.warn(`[MJ] Upscale failed, returning original grid image as fallback:`, e instanceof Error ? e.message : e);
      return imagineResult.imageUrl;
    }
  }

  /**
   * 从四宫格中选择并 upscale 单张图片
   * 使用 /mj/submit/simple-change 端点（midjourney-proxy 标准协议）
   */
  async upscale(imagineTaskId: string, index: 1 | 2 | 3 | 4 = 1): Promise<string> {
    const content = `${imagineTaskId} U${index}`;
    console.log(`[MJ] Simple-change: ${content}`);

    const response = await fetchWithTimeout(`${MJ_BASE_URL}/mj/submit/simple-change`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    }, 30_000);

    const data = await response.json();
    if (data.code !== 1 || !data.result) {
      // 如果 simple-change 不支持，尝试 action 端点
      console.warn(`[MJ] simple-change failed: ${data.description}, trying action endpoint...`);
      return await this.upscaleViaAction(imagineTaskId, index);
    }

    const upscaleTaskId = data.result;
    console.log(`[MJ] Upscale task: ${upscaleTaskId}`);

    const result = await this.pollResult(upscaleTaskId);
    return result.imageUrl;
  }

  /**
   * 备用 upscale 方法：通过 /mj/submit/action 端点（button-based）
   */
  private async upscaleViaAction(imagineTaskId: string, index: 1 | 2 | 3 | 4): Promise<string> {
    // 先获取 imagine 任务的 buttons
    const taskRes = await fetchWithTimeout(`${MJ_BASE_URL}/mj/task/${imagineTaskId}/fetch`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    }, 15_000);

    const taskData = await taskRes.json();
    const buttons = taskData.buttons || [];

    // 查找 U{index} 按钮的 customId
    const upscaleButton = buttons.find((btn: any) =>
      btn.customId?.includes(`upsample::${index}`) ||
      btn.emoji === `U${index}` ||
      btn.label === `U${index}`
    );

    if (!upscaleButton?.customId) {
      console.warn(`[MJ] No U${index} button found, returning original image`);
      return taskData.imageUrl || '';
    }

    console.log(`[MJ] Action upscale: customId=${upscaleButton.customId.slice(0, 50)}...`);

    const actionRes = await fetchWithTimeout(`${MJ_BASE_URL}/mj/submit/action`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customId: upscaleButton.customId,
        taskId: imagineTaskId,
      }),
    }, 30_000);

    const actionData = await actionRes.json();
    if (actionData.code !== 1 || !actionData.result) {
      console.warn(`[MJ] Action upscale failed, returning original image`);
      return taskData.imageUrl || '';
    }

    const result = await this.pollResult(actionData.result);
    return result.imageUrl;
  }

  /**
   * 轮询任务结果（带进度回调）
   * 返回完整的任务数据（包含 imageUrl 和 buttons）
   */
  private async pollResult(taskId: string, maxAttempts = 60): Promise<{ imageUrl: string; buttons?: any[] }> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);

      const response = await fetchWithTimeout(`${MJ_BASE_URL}/mj/task/${taskId}/fetch`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }, 15_000);

      if (!response.ok) throw new Error(`MJ fetch error: ${response.status}`);

      const data = await response.json();
      const status = data.status;
      const progress = data.progress || '0%';

      // 回调进度
      this.onProgress?.(progress, status);

      if (status === 'SUCCESS' && data.imageUrl) {
        console.log(`[MJ] Done: ${data.imageUrl.slice(0, 80)}`);
        return { imageUrl: data.imageUrl, buttons: data.buttons };
      }

      if (status === 'FAILURE') {
        throw new Error(`MJ failed: ${data.failReason || 'unknown'}`);
      }
    }

    throw new Error('MJ timeout (5 min)');
  }

  // 批量生成（每张都自动 upscale）
  async generateImages(prompts: string[], options?: {
    aspectRatio?: string;
    cref?: string;
    sref?: string;
  }): Promise<string[]> {
    const results: string[] = [];
    for (const prompt of prompts) {
      try {
        const url = await this.generateImage(prompt, options);
        results.push(url);
      } catch (error) {
        console.error(`[MJ] Failed: ${prompt.slice(0, 50)}`, error);
        results.push('');
      }
    }
    return results;
  }
}

export function hasMidjourney(): boolean {
  return !!MJ_API_KEY && !MJ_API_KEY.startsWith('your_');
}
