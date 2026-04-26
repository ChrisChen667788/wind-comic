/**
 * 可灵 AI (Kling) Service - 快手视频生成
 * 支持文生视频、图生视频，中文理解强
 */
import { API_CONFIG } from '@/lib/config';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** 带超时的 fetch */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

type ProgressCallback = (progress: number, status: string) => void;

export class KlingService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = API_CONFIG.keling.apiKey;
    this.baseURL = API_CONFIG.keling.baseURL;
  }

  /**
   * Generate video from image + prompt
   */
  async generateVideo(
    imageUrl: string,
    prompt: string,
    options?: {
      duration?: number;
      resolution?: string;
      mode?: 'standard' | 'professional';
      onProgress?: ProgressCallback;
    }
  ): Promise<string> {
    try {
      if (!this.apiKey || this.apiKey.startsWith('your_')) {
        throw new Error('KELING_API_KEY is not configured');
      }

      const hasRealImage = imageUrl && !imageUrl.startsWith('data:') && imageUrl.startsWith('http');

      console.log(`[Kling] Starting video generation: ${hasRealImage ? 'image-to-video' : 'text-to-video'}`);
      console.log(`[Kling] Prompt: ${prompt.slice(0, 100)}...`);

      const body: Record<string, any> = {
        model_name: 'kling-v1',
        prompt: prompt,
        mode: options?.mode || 'standard',
        duration: String(Math.min(options?.duration || 5, 10)),
      };

      if (hasRealImage) {
        body.image = imageUrl;
      }

      // Kling API: POST /v1/videos/image2video or /v1/videos/text2video
      const endpoint = hasRealImage
        ? `${this.baseURL}/v1/videos/image2video`
        : `${this.baseURL}/v1/videos/text2video`;

      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 30_000);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kling API error (${response.status}): ${error.slice(0, 500)}`);
      }

      const data = await response.json();
      const taskId = data.data?.task_id || data.task_id || data.id;
      if (!taskId) {
        throw new Error(`Kling: no task_id in response: ${JSON.stringify(data).slice(0, 300)}`);
      }

      console.log(`[Kling] Task created: ${taskId}`);
      const videoUrl = await this.pollResult(taskId, 120, options?.onProgress);
      return videoUrl;
    } catch (error) {
      console.error('[Kling] Video generation error:', error);
      throw error;
    }
  }

  /**
   * Generate image from text (可灵图像生成)
   */
  async generateImage(prompt: string, options?: {
    aspectRatio?: string;
  }): Promise<string> {
    try {
      console.log(`[Kling] Generating image: ${prompt.slice(0, 100)}...`);

      const body: Record<string, any> = {
        model_name: 'kling-v1',
        prompt: prompt,
      };

      if (options?.aspectRatio) {
        body.aspect_ratio = options.aspectRatio;
      }

      const response = await fetchWithTimeout(`${this.baseURL}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Kling image API error (${response.status}): ${error.slice(0, 500)}`);
      }

      const data = await response.json();
      const taskId = data.data?.task_id || data.task_id;
      if (!taskId) {
        throw new Error(`Kling: no image task_id: ${JSON.stringify(data).slice(0, 300)}`);
      }

      return await this.pollImageResult(taskId);
    } catch (error) {
      console.error('[Kling] Image generation error:', error);
      throw error;
    }
  }

  // ─── Video Polling ───

  private async pollResult(
    taskId: string,
    maxAttempts = 60,
    onProgress?: ProgressCallback
  ): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);

      const response = await fetchWithTimeout(
        `${this.baseURL}/v1/videos/image2video/${taskId}`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
        }, 15_000
      );

      if (!response.ok) {
        // Try text2video endpoint
        const response2 = await fetchWithTimeout(
          `${this.baseURL}/v1/videos/text2video/${taskId}`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
          }, 15_000
        );
        if (!response2.ok) {
          throw new Error(`Kling query error: ${response.status}`);
        }
        const data2 = await response2.json();
        const result = this.extractResult(data2, i, maxAttempts, onProgress);
        if (result) return result;
        continue;
      }

      const data = await response.json();
      const result = this.extractResult(data, i, maxAttempts, onProgress);
      if (result) return result;
    }

    throw new Error('Kling video generation timeout (5 min)');
  }

  private extractResult(
    data: any,
    attempt: number,
    maxAttempts: number,
    onProgress?: ProgressCallback
  ): string | null {
    const taskData = data.data || data;
    const status = taskData.task_status || taskData.status;
    const progress = taskData.task_status_msg?.match(/(\d+)/)?.[1]
      ? parseInt(taskData.task_status_msg.match(/(\d+)/)[1])
      : Math.round((attempt / maxAttempts) * 90);

    console.log(`[Kling] Poll #${attempt + 1}: status=${status}, progress=${progress}`);
    onProgress?.(progress, status);

    if (status === 'succeed' || status === 'completed' || status === 'success') {
      const videoUrl = taskData.task_result?.videos?.[0]?.url
        || taskData.video_url
        || taskData.result?.video_url
        || taskData.output?.video_url;
      if (videoUrl) return videoUrl;
      throw new Error(`Kling: completed but no video URL: ${JSON.stringify(data).slice(0, 300)}`);
    }

    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Kling video generation failed: ${taskData.task_status_msg || 'unknown'}`);
    }

    return null; // still processing
  }

  // ─── Image Polling ───

  private async pollImageResult(taskId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(3000);

      const response = await fetchWithTimeout(
        `${this.baseURL}/v1/images/generations/${taskId}`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.apiKey}` },
        }, 15_000
      );

      if (!response.ok) continue;

      const data = await response.json();
      const taskData = data.data || data;
      const status = taskData.task_status || taskData.status;

      if (status === 'succeed' || status === 'completed' || status === 'success') {
        const imageUrl = taskData.task_result?.images?.[0]?.url
          || taskData.image_url
          || taskData.result?.image_url;
        if (imageUrl) return imageUrl;
      }

      if (status === 'failed') {
        throw new Error(`Kling image generation failed: ${taskData.task_status_msg || 'unknown'}`);
      }
    }

    throw new Error('Kling image generation timeout (3 min)');
  }
}

export function hasKling(): boolean {
  return !!API_CONFIG.keling?.apiKey && !API_CONFIG.keling.apiKey.startsWith('your_');
}
