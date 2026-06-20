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
      aspectRatio?: string; // v12.14.0 横竖屏:'16:9'|'9:16'|'1:1'
      mode?: 'standard' | 'professional';
      // v12.15.0(Phase 2.1):多参 Elements —— 角色(frontal + 多角度 refs)+ 场景/风格参考图。
      // 仅 KLING_ELEMENTS=1 启用(默认关,零回归;需 kling-v1-6 Elements 套餐)。
      subjectReferences?: Array<{ imageUrl: string; name?: string; refImageUrls?: string[] }>;
      referenceImages?: string[];
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

      // v12.14.0 横竖屏:Kling 支持 aspect_ratio('16:9'|'9:16'|'1:1');竖屏短剧必须传,否则默认 16:9
      if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;

      if (hasRealImage) {
        body.image = imageUrl;
      }

      // v12.15.0(Phase 2.1):多参 Elements —— 给 Kling 喂角色(frontal+多角度)+ 场景参考图。
      // 现状 Kling 路径只有 first_frame,没有任何角色/场景参考;开启后一致性更强。
      // 默认关(KLING_ELEMENTS=1 开):需 kling-v1-6 Elements 套餐,且本套餐 API 未在此环境验证,
      // 故 opt-in,失败由 orchestrator 跳到下一引擎(Kling 是末位兜底,影响可控)。
      const subj = (options?.subjectReferences || []).filter((s) => s?.imageUrl?.startsWith('http'));
      const sceneRefs = (options?.referenceImages || []).filter((u) => u && u.startsWith('http'));
      if (process.env.KLING_ELEMENTS === '1' && (subj.length > 0 || sceneRefs.length > 0)) {
        body.model_name = process.env.KELING_ELEMENTS_MODEL || 'kling-v1-6';
        if (subj.length > 0) {
          body.elements = subj.slice(0, 4).map((s) => ({
            frontal_image_url: s.imageUrl,
            reference_image_urls: (s.refImageUrls || []).filter((u) => u && u.startsWith('http')).slice(0, 3),
          }));
        }
        if (sceneRefs.length > 0) body.image_urls = sceneRefs.slice(0, 4);
        console.log(`[Kling] Elements 模式(${body.model_name}):${subj.length} 角色 + ${sceneRefs.length} 场景/风格参考`);
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
   * v2.14 P0.3: 首尾帧融合 — 用户给首帧 + 尾帧, Kling 自动补中间运动。
   *
   * Kling API: POST /v1/videos/image2video, body 同 image2video, 但额外加 image_tail。
   * 失败时调用方 (route 层) 应当退回到普通 I2V (用 firstFrame 单图).
   */
  async generateFirstLastFrame(
    firstFrameUrl: string,
    lastFrameUrl: string,
    prompt: string,
    options?: {
      duration?: number;
      mode?: 'standard' | 'professional';
      onProgress?: ProgressCallback;
    },
  ): Promise<string> {
    if (!this.apiKey || this.apiKey.startsWith('your_')) {
      throw new Error('KELING_API_KEY is not configured');
    }
    if (!firstFrameUrl || !lastFrameUrl) {
      throw new Error('Kling FLF: 首帧 + 尾帧都必须有');
    }
    if (firstFrameUrl.startsWith('data:') || lastFrameUrl.startsWith('data:')) {
      throw new Error('Kling FLF: 不接受 data URI, 请先落盘成 http URL');
    }

    console.log('[Kling-FLF] 首尾帧融合视频生成');
    console.log(`[Kling-FLF] First: ${firstFrameUrl.slice(0, 80)}`);
    console.log(`[Kling-FLF] Last:  ${lastFrameUrl.slice(0, 80)}`);
    console.log(`[Kling-FLF] Prompt: ${prompt.slice(0, 100)}...`);

    const body: Record<string, any> = {
      model_name: 'kling-v1',
      prompt,
      mode: options?.mode || 'standard',
      duration: String(Math.min(options?.duration || 5, 10)),
      image: firstFrameUrl,
      image_tail: lastFrameUrl,
    };

    const response = await fetchWithTimeout(
      `${this.baseURL}/v1/videos/image2video`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      30_000,
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kling FLF API error (${response.status}): ${error.slice(0, 500)}`);
    }

    const data = await response.json();
    const taskId = data.data?.task_id || data.task_id || data.id;
    if (!taskId) {
      throw new Error(`Kling FLF: no task_id in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    console.log(`[Kling-FLF] Task created: ${taskId}`);
    return await this.pollResult(taskId, 120, options?.onProgress);
  }

  /**
   * v2.16 P1.3: 真 4K Kling Master per-shot 重渲。
   *
   * Kling Master (kling-v1-6 + mode='professional') 输出 1080p+ 高质量, 单
   * 镜头 60-90s。我们在 export 路由 ffmpeg lanczos 上采样到 2160p (P0.2),
   * 这条路是"真 4K 源"路径 — 直接让 Kling 重新出一段, 而不是后期上采样。
   *
   * 当前 Kling 公开 API 只到 1080p (kling-v1-6), 真 2160p 要等 Kling 3.0
   * 公开。这里先做"切成更高规格的重渲", 拿 1080p 源再后期 lanczos 到 2160p,
   * 视觉质量已经超过单纯 lanczos from 720p。
   *
   * 失败语义: throw, 调用方 (路由层) catch 后写 audioWarning 让用户知道。
   */
  async regenerateShotAt4K(
    firstFrameUrl: string,
    prompt: string,
    options?: {
      duration?: number;
      onProgress?: ProgressCallback;
    },
  ): Promise<string> {
    if (!this.apiKey || this.apiKey.startsWith('your_')) {
      throw new Error('KELING_API_KEY is not configured (4K re-render requires Kling Master access)');
    }
    if (!firstFrameUrl || firstFrameUrl.startsWith('data:')) {
      throw new Error('regenerateShotAt4K: 需要 http URL 形式的首帧, 不接受 data URI');
    }

    const body: Record<string, any> = {
      // v2.16: 默认 v1-6 (写死, 等 Kling 3.0 GA 时调成 'kling-v1-6-master');
      // 通过 env KELING_4K_MODEL 覆盖, 让运维能配置而不改代码
      model_name: process.env.KELING_4K_MODEL || 'kling-v1-6',
      prompt,
      mode: 'professional',  // 4K 必须 professional 档
      duration: String(Math.min(options?.duration || 5, 10)),
      image: firstFrameUrl,
      // 期望分辨率 (kling 当前最高 1080p, 真 4K 等 master 上线; 多传一个字段不会出错)
      resolution: '4k',
    };

    console.log(`[Kling-4K] 重渲分镜 prompt=${prompt.slice(0, 80)}...`);

    const response = await fetchWithTimeout(
      `${this.baseURL}/v1/videos/image2video`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      30_000,
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kling 4K API error (${response.status}): ${error.slice(0, 500)}`);
    }

    const data = await response.json();
    const taskId = data.data?.task_id || data.task_id || data.id;
    if (!taskId) {
      throw new Error(`Kling 4K: no task_id in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    console.log(`[Kling-4K] Task created: ${taskId}`);
    return await this.pollResult(taskId, 180, options?.onProgress); // 4K 渲染慢, 给 15min
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
