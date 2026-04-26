import { API_CONFIG } from '@/lib/config';

/** 带超时的 fetch */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface VeoCreateResponse {
  id?: string;
  task_id?: string;
  status: string;
  status_update_time?: number;
  created_at?: string;
}

interface VeoQueryResponse {
  id?: string;
  task_id?: string;
  status: string; // qingyuntop 返回值很多：pending / queued / in_progress / video_generating / completed / failed / video_generation_failed / succeed
  // unified 格式
  video_url?: string;
  enhanced_prompt?: string;
  thumbnail_url?: string;
  progress?: number;
  error?: string | { code?: string; message?: string };
  // OpenAI 异步格式（sora-2）
  result_url?: string;
  result?: { video_url?: string; url?: string };
  task_result?: { videos?: Array<{ url: string }> };
  output?: { video_url?: string; url?: string };
  completed_at?: number;
  expires_at?: number;
}

type ProgressCallback = (progress: number, status: string) => void;

export class VeoService {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private format: 'unified' | 'openai';
  /** 模型级 fallback 链 — 主模型失败时依次尝试 */
  private fallbackModels: string[];

  constructor() {
    this.apiKey = API_CONFIG.veo.apiKey;
    this.baseURL = API_CONFIG.veo.baseURL;
    this.model = API_CONFIG.veo.model || 'veo3.1';
    this.format = (API_CONFIG.veo.format as 'unified' | 'openai') || 'unified';
    this.fallbackModels = (API_CONFIG.veo as any).fallbackModels || [];
  }

  /** 判断一个错误是不是 transient 的"整池饱和",值得换一个模型再试 */
  private isTransientPoolError(err: Error): boolean {
    const msg = err.message || '';
    return /pre_consume_token_quota_failed|上游负载已饱和|分组.*饱和|rate.?limit|429|timeout|ETIMEDOUT|saturated/i.test(msg);
  }

  /**
   * Generate video from image + prompt (full lifecycle: create → poll → return URL)
   * @param imageUrl Primary reference image URL
   * @param prompt Text prompt describing the scene
   * @param options.referenceImages Additional reference images (character, scene) for consistency
   */
  async generateVideo(
    imageUrl: string,
    prompt: string,
    options?: {
      duration?: number;
      resolution?: string;
      style?: string;
      referenceImages?: string[];
      onProgress?: ProgressCallback;
    }
  ): Promise<string> {
    if (!this.apiKey || this.apiKey.startsWith('your_')) {
      throw new Error('VEO_API_KEY is not configured');
    }

    // ═══ 模型级 fallback 链: 主模型 + 配置的 fallback ═══
    // 如果主模型报"整池饱和"类错误, 立刻换 fallback 模型重试,
    // 避免用户看到"整条 Veo 引擎都坏了"的假象 (其实只是 sora-2 池子满了)
    const modelChain = [this.model, ...this.fallbackModels.filter(m => m !== this.model)];
    const originalModel = this.model;
    const originalFormat = this.format;
    let lastError: Error | null = null;

    for (let i = 0; i < modelChain.length; i++) {
      const m = modelChain[i];
      // sora 系走 openai 格式, veo 系走 unified 格式 (qingyuntop 的实际路由)
      const fmt: 'unified' | 'openai' = m.toLowerCase().startsWith('sora') ? 'openai' : 'unified';
      this.model = m;
      this.format = fmt;

      try {
        console.log(`[Veo] [${i + 1}/${modelChain.length}] Trying model=${m} format=${fmt} duration=${options?.duration || 8}s`);
        console.log(`[Veo] Prompt: ${prompt.slice(0, 100)}...`);

        const taskId = fmt === 'openai'
          ? await this.createTaskOpenAI(prompt, imageUrl, options)
          : await this.createTaskUnified(prompt, imageUrl, options);

        console.log(`[Veo] Task created on ${m}: ${taskId}`);
        const videoUrl = await this.pollResult(taskId, 60, options?.onProgress);

        // 成功, 恢复原始配置 (下次调用仍然先用用户选定的主模型)
        this.model = originalModel;
        this.format = originalFormat;
        return videoUrl;
      } catch (error) {
        lastError = error as Error;
        const transient = this.isTransientPoolError(lastError);
        console.warn(`[Veo] Model ${m} failed: ${lastError.message?.slice(0, 150)} (transient=${transient})`);

        // 非 transient 错误 (比如协议/校验错误) 就没必要再试其他模型了
        if (!transient) {
          this.model = originalModel;
          this.format = originalFormat;
          throw lastError;
        }
        // 是 transient 就继续试下一个 fallback 模型
      }
    }

    // 恢复原始配置
    this.model = originalModel;
    this.format = originalFormat;
    // 所有模型都失败了, 抛出最后一个错误
    console.error('[Veo] All models exhausted:', modelChain.join(', '));
    throw lastError || new Error('Veo: all fallback models failed');
  }

  /**
   * Text-to-video (no reference image)
   */
  async generateVideoFromText(
    prompt: string,
    options?: {
      duration?: number;
      resolution?: string;
      onProgress?: ProgressCallback;
    }
  ): Promise<string> {
    return this.generateVideo('', prompt, options);
  }

  // ─── Unified format: POST /v1/video/create ───

  private async createTaskUnified(
    prompt: string,
    imageUrl: string,
    options?: { duration?: number; resolution?: string; referenceImages?: string[] }
  ): Promise<string> {
    const body: Record<string, any> = {
      model: this.model,
      prompt: prompt,
    };

    // Only add duration if explicitly set (some providers don't support it)
    if (options?.duration) {
      body.duration = Math.min(options.duration, 10);
    }

    // sora-2 在 unified 通道也要求 size (1280x720 / 720x1280 / 1024x1024)
    // 不显式设置会被网关回 "size is required for sora-2"
    if (this.model.toLowerCase().startsWith('sora')) {
      body.size = options?.resolution || '1280x720';
    }

    // 使用场景图/分镜图作为 first_frame_image（锁第一帧构图）
    const primaryImage = imageUrl && !imageUrl.startsWith('data:') && imageUrl.startsWith('http') ? imageUrl : '';
    if (primaryImage) {
      body.first_frame_image = primaryImage;
      console.log(`[Veo3.1] Using scene image as first_frame_image for composition`);
    }

    // v2.8 (Seedance 2.0 同款): 把"主角图+次要角色图+风格图"打包成多参考图,
    // 交给 Veo 3.1 ingredient-to-video / Sora 2 multi-reference 通道。
    // 去重 + 过滤 data URI + 剔除和 first_frame 重复的 URL。
    const refs = (options?.referenceImages || [])
      .filter((u): u is string => typeof u === 'string' && !!u && !u.startsWith('data:'))
      .filter((u) => u.startsWith('http') || u.startsWith('/api/serve-file'))
      .filter((u) => u !== primaryImage);
    const uniqueRefs: string[] = [];
    const seen = new Set<string>();
    for (const u of refs) {
      if (!seen.has(u)) {
        seen.add(u);
        uniqueRefs.push(u);
        if (uniqueRefs.length >= 4) break; // Veo 3.1 / 多数 unified 网关单次最多 4 张
      }
    }
    if (uniqueRefs.length > 0) {
      // qingyuntop 统一通道兼容 images[] / reference_images[] 两种字段名,
      // 两个都带上对上游更安全;网关侧会取它认识的那个。
      body.images = uniqueRefs;
      body.reference_images = uniqueRefs;
      console.log(`[Veo3.1] Multi-ref bundle: first_frame=1 + refs=${uniqueRefs.length} (total ${1 + uniqueRefs.length} images)`);
    }

    const response = await fetchWithTimeout(`${this.baseURL}/v1/video/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Veo API error (${response.status}): ${error.slice(0, 500)}`);
    }

    const data: VeoCreateResponse = await response.json();
    const taskId = data.id || data.task_id;
    if (!taskId) {
      throw new Error(`Veo: no task_id in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return taskId;
  }

  // ─── OpenAI async format: POST /v1/videos ───

  private async createTaskOpenAI(
    prompt: string,
    imageUrl: string,
    options?: { duration?: number }
  ): Promise<string> {
    const body: Record<string, any> = {
      model: this.model,
      prompt: prompt,
      seconds: String(options?.duration || 8),
      size: '1280x720',
    };

    const response = await fetchWithTimeout(`${this.baseURL}/v1/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Veo API error (${response.status}): ${error.slice(0, 500)}`);
    }

    const data = await response.json();
    // qingyuntop sora-2 返回 { id, task_id, object, status, progress, size }
    // 两个字段都有时优先用 id（查询路径是 /v1/videos/<id>）
    const taskId = data.id || data.task_id;
    if (!taskId) {
      throw new Error(`Veo: no task_id in response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return taskId;
  }

  // ─── Polling ───

  private async pollResult(
    taskId: string,
    maxAttempts = 60,
    onProgress?: ProgressCallback
  ): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(5000);

      const data = this.format === 'openai'
        ? await this.queryTaskOpenAI(taskId)
        : await this.queryTaskUnified(taskId);

      const progress = data.progress || Math.round((i / maxAttempts) * 90);
      const normalizedStatus = this.normalizeStatus(data.status);

      console.log(`[Veo3.1] Poll #${i + 1}: status=${data.status}, progress=${progress}`);
      onProgress?.(progress, normalizedStatus);

      if (normalizedStatus === 'completed') {
        const videoUrl = this.extractVideoUrl(data);
        if (videoUrl) return videoUrl;
        throw new Error(`Veo: completed but no video URL: ${JSON.stringify(data).slice(0, 300)}`);
      }

      if (normalizedStatus === 'failed') {
        const errMsg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || JSON.stringify(data).slice(0, 300);
        throw new Error(`Veo video generation failed: ${errMsg}`);
      }
    }

    throw new Error('Veo video generation timeout (5 min)');
  }

  private async queryTaskUnified(taskId: string): Promise<VeoQueryResponse> {
    const response = await fetchWithTimeout(
      `${this.baseURL}/v1/video/query?id=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }, 15_000
    );

    if (!response.ok) {
      throw new Error(`Veo query error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async queryTaskOpenAI(taskId: string): Promise<VeoQueryResponse> {
    const response = await fetchWithTimeout(
      `${this.baseURL}/v1/videos/${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }, 15_000
    );

    if (!response.ok) {
      throw new Error(`Veo query error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // ─── Helpers ───

  private normalizeStatus(status: string): string {
    const s = String(status || '').toLowerCase();
    if ([
      'queued', 'initializing', 'in_progress', 'processing', 'pending',
      'downloading', 'uploading', 'video_generating', 'running', 'waiting',
    ].includes(s)) {
      return 'processing';
    }
    if (['completed', 'succeed', 'success', 'finished'].includes(s)) {
      return 'completed';
    }
    if (['failed', 'cancelled', 'canceled', 'error', 'video_generation_failed'].includes(s)) {
      return 'failed';
    }
    return 'processing';
  }

  private extractVideoUrl(data: VeoQueryResponse): string | null {
    return data.video_url
      || data.result_url                      // qingyuntop sora-2 主字段
      || data.result?.video_url
      || data.result?.url
      || data.task_result?.videos?.[0]?.url
      || data.output?.video_url
      || data.output?.url
      || null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Check if Veo is configured
export function hasVeo(): boolean {
  return !!API_CONFIG.veo?.apiKey && !API_CONFIG.veo.apiKey.startsWith('your_');
}
