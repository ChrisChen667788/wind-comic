import {
  planExtension, isExtendUnsupported, VEO_SEGMENT_SEC, VEO_EXTEND_MAX_SEGMENTS,
  type ExtendOutcome,
} from '@/lib/veo-scene-extension';
import { API_CONFIG } from '@/lib/config';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { veoSizeFromAspect } from '@/lib/video-aspect'; // v12.14.0 横竖屏

/** 带超时的 fetch */
// v12.304:本地那份 fetchWithTimeout 已收口到 lib/fetch-timeout(两处曾是一字不差的复制)

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


// v12.149:失败埋点 —— 进 api-usage-tracker 告警管道,让 /api/api-status 引擎天气面板可见
// (此前只有 minimax/midjourney 埋点,Veo 渠道 503 对用户是黑箱)。失败不反炸业务。
function _trackVeoError(error: unknown, model: string, method: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  void (async () => {
    try {
      const { recordApiCall } = await import('@/lib/api-usage-tracker');
      const codeM = msg.match(/\((\d{3})\)/);
      void recordApiCall({ provider: 'veo', model, method, success: false, statusCode: codeM ? parseInt(codeM[1], 10) : undefined, errorMessage: msg });
    } catch { /* 监控失败不阻塞 */ }
  })();
}

export class VeoService {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  /** v12.407:最近一次成功建任务的 id / 模型 —— Scene Extension 的入参 */
  public lastTaskId?: string;
  public lastTaskModel?: string;
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
      aspectRatio?: string; // v12.14.0 横竖屏:'16:9'|'9:16'|'1:1'
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
    let modelChain = [this.model, ...this.fallbackModels.filter(m => m !== this.model)];
    // v12.173/207:Sora-2 API 2026-09-24 退役。退役日前:显式配仍可用但每次告警;退役日后:
    // 自动从链中剔除(走 veo/kling fallback),剔完若链空才抛,免到期日静默 401 白等。
    const soraModels = modelChain.filter((m) => m.toLowerCase().startsWith('sora'));
    if (soraModels.length > 0) {
      const retired = new Date() >= new Date('2026-09-24T00:00:00Z');
      if (retired) {
        modelChain = modelChain.filter((m) => !m.toLowerCase().startsWith('sora'));
        console.warn(`[Veo] ⚠️ Sora 系(${soraModels.join(',')})已过 2026-09-24 退役日,自动剔除走 fallback`);
        if (modelChain.length === 0) {
          throw new Error('Veo: 模型链仅含已退役的 Sora 系(2026-09-24 停服),请改 VEO_MODEL/VEO_FALLBACK_MODELS 为 veo3.1 / kling');
        }
      } else {
        console.warn(`[Veo] ⚠️ 模型链含即将退役的 Sora 系(${soraModels.join(',')}):OpenAI Sora-2 API 将于 2026-09-24 停服,请迁移到 veo3.1 / kling(改 VEO_MODEL / VEO_FALLBACK_MODELS)`);
      }
    }
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
        // v12.407:续接需要**前一次任务的 task_id**(不是视频 URL)。
        // 此前这个 id 轮询完就丢了,所以 Scene Extension 根本无从谈起。
        this.lastTaskId = taskId;
        this.lastTaskModel = m;
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
          _trackVeoError(lastError, m, 'generateVideo'); // v12.149 引擎天气埋点
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
    _trackVeoError(lastError || new Error('all fallback models failed'), modelChain.join('|'), 'generateVideo'); // v12.149
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
      aspectRatio?: string; // v12.14.0 横竖屏
      onProgress?: ProgressCallback;
    }
  ): Promise<string> {
    return this.generateVideo('', prompt, options);
  }

  // ─── Unified format: POST /v1/video/create ───

  private async createTaskUnified(
    prompt: string,
    imageUrl: string,
    options?: { duration?: number; resolution?: string; aspectRatio?: string; referenceImages?: string[] }
  ): Promise<string> {
    const body: Record<string, any> = {
      model: this.model,
      prompt: prompt,
    };

    // Only add duration if explicitly set (some providers don't support it)
    if (options?.duration) {
      body.duration = Math.min(options.duration, 10);
    }

    // v12.14.0 横竖屏:把项目比例传给引擎,否则默认出 16:9(竖屏短剧也变横屏)。
    // size 由比例映射(竖屏 720x1280);同时带通用 aspect_ratio 字段,网关取它认识的那个。
    if (this.model.toLowerCase().startsWith('sora')) {
      // sora-2 在 unified 通道也要求 size,不显式设置会被网关回 "size is required for sora-2"
      body.size = options?.resolution || veoSizeFromAspect(options?.aspectRatio);
    } else if (options?.resolution) {
      body.size = options.resolution;
    }
    if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;

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

  /**
   * v12.407 · Scene Extension —— 把成片接到更长,**而不是让单次生成变长**。
   *
   * 竞品复核里我把「Veo 3.1 单次 60s+」写进过 README,被二次检索当场推翻:
   * 那是续接拼出来的,单次上限仍是 8–10s。所以这里的参数、日志、返回值
   * 一律说「段」,不说「时长上限」—— 免得下一个人重犯同一个错。
   *
   * 三条硬约束:
   * ① 续接的入参是**前一次任务的 task_id**,不是视频 URL(故主流程要留住它);
   * ② 网关不一定暴露续接端点 —— 那不是生成失败,不该按失败处理;
   * ③ **续接失败绝不能把已经生成、已经计费的首段一起丢掉**。
   *    这个项目的老毛病就是「一处失败拖垮整体」;首段是真金白银出来的,
   *    接不上就把首段还回去 + 说明原因,由调用方决定接受短片还是重试。
   */
  async generateExtended(
    imageUrl: string,
    prompt: string,
    targetSec: number,
    options?: { onProgress?: (p: number, s: string) => void },
  ): Promise<ExtendOutcome> {
    const plan = planExtension(targetSec);
    const firstUrl = await this.generateVideo(imageUrl, prompt, { duration: VEO_SEGMENT_SEC, ...options });

    if (plan.extendCount === 0) {
      return { videoUrl: firstUrl, segments: 1, approxSec: VEO_SEGMENT_SEC };
    }
    if (plan.shortfallSec > 0) {
      console.warn(
        `[Veo] 目标 ${targetSec}s 超过链长上限(${VEO_EXTEND_MAX_SEGMENTS} 段 × ${VEO_SEGMENT_SEC}s)——` +
        `按 ${plan.plannedSec}s 规划,缺口 ${plan.shortfallSec}s`,
      );
    }

    let url = firstUrl;
    let segments = 1;
    let stoppedBecause: string | undefined;

    for (let i = 0; i < plan.extendCount; i++) {
      const prevTaskId = this.lastTaskId;
      if (!prevTaskId) {
        stoppedBecause = '上一段没有留下 task_id,无法续接';
        break;
      }
      try {
        const taskId = await this.createExtendTask(prevTaskId, prompt);
        this.lastTaskId = taskId;
        url = await this.pollResult(taskId, 60, options?.onProgress);
        segments++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stoppedBecause = isExtendUnsupported(msg)
          ? `网关未提供续接端点(${msg.slice(0, 80)})`
          : `第 ${segments + 1} 段续接失败(${msg.slice(0, 80)})`;
        console.warn(`[Veo] Scene Extension 在第 ${segments + 1} 段停下:${stoppedBecause} —— 保留已生成的 ${segments} 段`);
        break;
      }
    }

    return {
      videoUrl: url,
      segments,
      approxSec: segments * VEO_SEGMENT_SEC,
      stoppedBecause,
    };
  }

  /** 建续接任务。入参是**前一次的 task_id**,不是视频 URL。 */
  private async createExtendTask(prevTaskId: string, prompt: string): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseURL}/v1/video/extend`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.lastTaskModel || this.model,
        task_id: prevTaskId,
        prompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Veo extend error (${response.status}): ${error.slice(0, 300)}`);
    }
    const data = await response.json();
    const taskId = data.id || data.task_id;
    if (!taskId) throw new Error(`Veo extend: no task_id in response: ${JSON.stringify(data).slice(0, 200)}`);
    return taskId;
  }

  // ─── OpenAI async format: POST /v1/videos ───

  private async createTaskOpenAI(
    prompt: string,
    imageUrl: string,
    options?: { duration?: number; aspectRatio?: string }
  ): Promise<string> {
    const body: Record<string, any> = {
      model: this.model,
      prompt: prompt,
      seconds: String(options?.duration || 8),
      // v12.14.0 横竖屏:size 跟项目比例(竖屏 720x1280),不再写死 16:9
      size: veoSizeFromAspect(options?.aspectRatio),
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
    // v12.407:补 'succeeded' / 'complete'。此前只认 succeed/success/completed/finished ——
    // 网关一旦返回 'succeeded'(MiniMax V2、Vidu 等都用这个词),这里判不出完成,
    // 就会把**已经生成、已经计费**的任务白轮到超时。与 v12.122 的 Kling 'Fail'(无 -ed)同型:
    // 状态字面量差一个后缀,表现却是「任务失败」,人会去查生成侧,查不到真因。
    if (['completed', 'complete', 'succeed', 'succeeded', 'success', 'finished'].includes(s)) {
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
