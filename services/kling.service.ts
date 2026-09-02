/**
 * 可灵 AI (Kling) Service - 快手视频生成
 * 支持文生视频、图生视频，中文理解强
 */
import {
  planMultiShot, worthMultiShot, multiShotBody,
  KLING_MULTISHOT_MAX_SHOTS, KLING_MULTISHOT_TOTAL_MAX_SEC,
  type ShotSpec, type MultiShotPlan,
} from '@/lib/kling-multishot';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { classifyPollStatus, terminalPollMessage } from '@/lib/poll-policy';
import { API_CONFIG } from '@/lib/config';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** 带超时的 fetch */

type ProgressCallback = (progress: number, status: string) => void;


// v12.162(对抗评审 R9):失败埋点 —— Kling 此前零埋点,api_usage_events 永无 kling 行,
// 引擎脉搏/告警对 Kling 全盲。失败不反炸业务。
function _trackKlingError(error: unknown, model: string, method: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  void (async () => {
    try {
      const { recordApiCall } = await import('@/lib/api-usage-tracker');
      const codeM = msg.match(/\((\d{3,4})\)/);
      void recordApiCall({ provider: 'kling', model, method, success: false, statusCode: codeM ? parseInt(codeM[1], 10) : undefined, errorMessage: msg });
    } catch { /* 监控失败不阻塞 */ }
  })();
}

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
  /**
   * v12.406:一次调用出多个**连贯**镜头(Kling 3.0 独有)。
   *
   * 与 `generateVideo` 的区别不只是「省调用次数」——
   * 同一次生成内的镜间一致性由模型自己保证,比我们事后用角色 DNA + vision retry
   * 去拼要稳。这正是竞品对比表第三列「我们用了多少」为 0 的那一行:
   * 能力早接进来了(注册表里就是 kling-v3),只是从没调用过。
   *
   * **返回值带 overflow**:放不进本次调用(超 6 镜或超 15 秒)的镜头会被原样回传,
   * 由调用方另行生成 —— 绝不静默丢弃。这个项目吃过「静默丢东西」的亏。
   */
  async generateMultiShot(
    shots: ShotSpec[],
    options?: {
      firstFrameUrl?: string;
      aspectRatio?: string;
      modelOverride?: string;
      onProgress?: ProgressCallback;
    }
  ): Promise<{ videoUrl: string; plan: MultiShotPlan; model: string }> {
    if (!this.apiKey || this.apiKey.startsWith('your_')) {
      throw new Error('KELING_API_KEY is not configured');
    }

    const model = options?.modelOverride || process.env.KELING_VIDEO_MODEL || 'kling-v3';
    // 多镜是 v3 独有 —— 在别的模型上传这些字段属于「上游静默忽略」,
    // 会得到一个看起来正常、实际只有一个镜头的成片。必须提前拒绝。
    if (!model.startsWith('kling-v3')) {
      throw new Error(
        `Kling 多镜连贯仅 kling-v3 支持(当前 ${model})——` +
        `在其它模型上这些字段会被静默忽略,产出一个「看起来正常但只有一镜」的成片`
      );
    }

    const plan = planMultiShot(shots);
    if (!worthMultiShot(plan)) {
      throw new Error(
        `多镜规划后只剩 ${plan.shots.length} 个镜头(上限 ${KLING_MULTISHOT_MAX_SHOTS} 镜 / ` +
        `${KLING_MULTISHOT_TOTAL_MAX_SEC} 秒)——不值得走多镜,请用单镜路径`
      );
    }

    const body: Record<string, any> = {
      model_name: model,
      mode: 'std',
      ...multiShotBody(plan),
    };
    if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;
    if (options?.firstFrameUrl) body.image_url = options.firstFrameUrl;

    const endpoint = options?.firstFrameUrl ? 'image2video' : 'text2video';
    console.log(
      `[Kling] 多镜连贯 ${plan.shots.length} 镜 / ${plan.totalSec}s (${model} · ${endpoint})` +
      (plan.overflow.length ? ` — ${plan.overflow.length} 镜溢出,交还调用方单独生成` : '')
    );

    const response = await fetchWithTimeout(`${this.baseURL}/v1/videos/${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 30_000);

    if (!response.ok) {
      throw new Error(`Kling 多镜提交失败 (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
    const data = await response.json();
    const taskId = data?.data?.task_id;
    if (!taskId) throw new Error(`Kling 多镜:响应里没有 task_id: ${JSON.stringify(data).slice(0, 300)}`);

    const videoUrl = await this.pollResult(taskId, 60, options?.onProgress);
    return { videoUrl, plan, model };
  }

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
      // v12.201:导演级运镜 —— camera_control 仅 kling-v1-5+pro+5s 可用(探测),故配 modelOverride 一起降级
      cameraControl?: import('@/lib/kling-camera').KlingCameraControl;
      modelOverride?: string;
      render4K?: boolean; // v12.213:4K 提档(仅 kling-v3,¥6/5s,与运镜/音效互斥)
      onProgress?: ProgressCallback;
    }
  ): Promise<string> {
    try {
      if (!this.apiKey || this.apiKey.startsWith('your_')) {
        throw new Error('KELING_API_KEY is not configured');
      }

      const hasRealImage = !!imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:image/')); // v12.154:base64 首帧

      console.log(`[Kling] Starting video generation: ${hasRealImage ? 'image-to-video' : 'text-to-video'}`);
      console.log(`[Kling] Prompt: ${prompt.slice(0, 100)}...`);

      // v12.174:模型 env 化,默认 kling-v3(账号零成本探测确认可用:v1/v1-6/v2-1/v2-1-master/v3;
      // v2/v2-5/v3-pro 无效)。v3 支持 15s(pro 实测过参数校验),v1/v2 系仍 5/10。
      const model = options?.modelOverride || process.env.KELING_VIDEO_MODEL || 'kling-v3';
      const wantSec = options?.duration || 5;
      const maxSec = model.startsWith('kling-v3') ? 15 : 10;
      // camera_control 硬限 5s(探测),强制;否则按模型上限
      const duration = options?.cameraControl ? '5' : (wantSec > 10 && maxSec >= 15 ? '15' : wantSec > 5 ? '10' : '5');
      // v12.197:官方硬限 prompt ≤2500 字(1201 报错实测)——超长裁断优于整镜失败
      if (prompt.length > 2450) { console.warn(`[Kling] prompt 超长 ${prompt.length} → 裁至 2450`); prompt = prompt.slice(0, 2450); }
      // v12.213:4K 提档 —— render4K=true 且模型为 kling-v3 时走 mode:'4k'(零成本探测证实**仅 v3** 支持,
      // v2.6/v2.1 明确 1201 not supported)。4K 与 camera_control/enable_audio 互斥(API 限制),按 4K 优先。
      // 成本约 ¥6/5s,故按镜 opt-in(render4K 默认 false)。
      const want4K = options?.render4K === true && model.startsWith('kling-v3');
      const body: Record<string, any> = {
        model_name: model,
        prompt: prompt,
        // 可灵官方 mode 枚举是 'std' | 'pro'(v12.154 live 实测:'standard' 报 1201 invalid);v12.213 +'4k'(仅 v3)
        mode: want4K ? '4k' : (options?.mode === 'professional' ? 'pro' : 'std'),
        duration,
      };
      if (want4K) console.log(`[Kling] 4K 模式(${model},约 ¥6/5s;禁用运镜/音效)`);

      // v12.14.0 横竖屏:Kling 支持 aspect_ratio('16:9'|'9:16'|'1:1');竖屏短剧必须传,否则默认 16:9
      if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;

      // v12.211:原生音效 —— KLING_AUDIO_ENABLED=true 且 pro mode 时开 enable_audio(探测:v3/v2.6/v2.1 均接受参数)。
      // ⚠️ v12.215 真机实测(2026-07-13,4 次真跑铁证):**enable_audio 名义接受、实际无效** ——
      //    image2video(v3+v2.6)与 text2video(v2.6)成片**全都无 audio stream**。根因:此账号套餐 / api-beijing
      //    当前版本不生成原生音效(参数不被拒但不产音)。**成片声音请走 MiniMax TTS + BGM 链,别依赖 Kling 原生音效**。
      //    此分支保留(未来套餐/端点升级可能生效)但默认关且不应指望出声。
      if (process.env.KLING_AUDIO_ENABLED === 'true' && body.mode === 'pro' && !want4K) {
        body.enable_audio = true;
        console.log(`[Kling] enable_audio=true(${model}/pro;⚠️ 本账号实测不产音轨,声音走 TTS+BGM,详见 v12.215)`);
      }
      // v12.201:运镜控制 —— 仅探测确认的 v1-5+pro 才注入(其余模型注入必 1201,忽略+warn)
      if (options?.cameraControl) {
        const { cameraControlSupported } = require('@/lib/kling-camera') as typeof import('@/lib/kling-camera');
        if (cameraControlSupported(model, body.mode)) {
          body.camera_control = options.cameraControl;
          console.log(`[Kling] camera_control 注入(${model}/${body.mode}): ${JSON.stringify(options.cameraControl.config)}`);
        } else {
          console.warn(`[Kling] camera_control 忽略:${model}/${body.mode} 不支持(仅 kling-v1-5+pro)`);
        }
      }

      if (hasRealImage) {
        // 可灵官方 image 字段:URL 或**纯 base64**(不带 data: 前缀)
        body.image = imageUrl.startsWith('data:image/') ? imageUrl.split(',')[1] : imageUrl;
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
      _trackKlingError(error, 'kling-video', 'generateVideo'); // v12.162 脉搏埋点
      console.error('[Kling] Video generation error:', error);
      throw error;
    }
  }

  /**
   * v12.175:Elements 多图参考生视频 —— 官方 multi-image2video 端点(零成本探测:
   * body 形态 image_list:[{image}],**仅 kling-v1-6 支持**(v3 报 model is not supported)。
   * 用于锁角色多参场景:角色正面图+参考图 ≤4 张,跨镜一致性优于单图 i2v。
   */
  async generateVideoWithElements(
    imageUrls: string[],
    prompt: string,
    options?: { duration?: number; aspectRatio?: string; mode?: 'standard' | 'professional'; onProgress?: ProgressCallback },
  ): Promise<string> {
    if (!this.apiKey || this.apiKey.startsWith('your_')) throw new Error('KELING_API_KEY is not configured');
    const images = imageUrls.filter((u) => u && (u.startsWith('http') || u.startsWith('data:image/'))).slice(0, 4);
    if (images.length === 0) throw new Error('Kling Elements: 无有效参考图');
    const body: Record<string, any> = {
      model_name: process.env.KELING_ELEMENTS_MODEL || 'kling-v1-6',
      prompt,
      mode: options?.mode === 'professional' ? 'pro' : 'std',
      duration: (options?.duration || 5) > 5 ? '10' : '5', // v1-6 只收 5/10
      image_list: images.map((u) => ({ image: u.startsWith('data:image/') ? u.split(',')[1] : u })),
    };
    if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;
    console.log(`[Kling-Elements] multi-image2video: ${images.length} 参考图`);
    const response = await fetchWithTimeout(`${this.baseURL}/v1/videos/multi-image2video`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      throw new Error(`Kling Elements error (${data.code ?? response.status}): ${data.message || 'unknown'}`);
    }
    const taskId = data.data?.task_id;
    if (!taskId) throw new Error(`Kling Elements: no task_id: ${JSON.stringify(data).slice(0, 150)}`);
    return await this.pollMultiImageResult(taskId, options?.onProgress);
  }

  /** multi-image2video 任务轮询(路径与 image2video 不同)。 */
  private async pollMultiImageResult(taskId: string, onProgress?: ProgressCallback): Promise<string> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetchWithTimeout(`${this.baseURL}/v1/videos/multi-image2video/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      const d = await res.json();
      const st = d.data?.task_status;
      onProgress?.(Math.min(95, i * 2), st || 'processing');
      console.log(`[Kling-Elements] Poll #${i + 1}: status=${st}`);
      if (st === 'succeed') {
        const url = d.data?.task_result?.videos?.[0]?.url;
        if (url) return url;
        throw new Error('Kling Elements: succeed 但无视频 URL');
      }
      if (st === 'failed') throw new Error(`Kling Elements failed: ${d.data?.task_status_msg || 'unknown'}`);
    }
    throw new Error('Kling Elements timeout (5 min)');
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
    // v12.197:官方 image/image_tail 均收「URL 或纯 base64」(零成本探测:v3/v2-1 都校验 image_tail)
    // —— data: URI 剥前缀即纯 base64,与 generateVideo 同口径,不再一刀切拒绝。
    const normFrame = (u: string) => (u.startsWith('data:image/') ? u.split(',')[1] : u);

    console.log('[Kling-FLF] 首尾帧融合视频生成');
    console.log(`[Kling-FLF] First: ${firstFrameUrl.slice(0, 80)}`);
    console.log(`[Kling-FLF] Last:  ${lastFrameUrl.slice(0, 80)}`);
    console.log(`[Kling-FLF] Prompt: ${prompt.slice(0, 100)}...`);

    if (prompt.length > 2450) { console.warn(`[Kling-FLF] prompt 超长 ${prompt.length} → 裁至 2450`); prompt = prompt.slice(0, 2450); }
    const body: Record<string, any> = {
      model_name: process.env.KELING_VIDEO_MODEL || 'kling-v3', // v12.174 补:FLF 同主模型
      prompt,
      mode: options?.mode === 'professional' ? 'pro' : 'std', // 官方枚举 std/pro
      duration: String(Math.min(options?.duration || 5, 10)),
      image: normFrame(firstFrameUrl),
      image_tail: normFrame(lastFrameUrl),
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
        model_name: process.env.KELING_IMAGE_MODEL || 'kling-v1', // 图像模型独立 env(视频 v3 ≠ 图像枚举)
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
          // v12.405:补上 v12.329 的抖动保护 —— 这个 service 此前完全没接 poll-policy,
          // 任何一次 5xx/超时都会把**已经在生成、已经计费**的任务直接判死。
          // 只有终局状态才抛;瞬时抖动继续等。
          if (classifyPollStatus(response2.status) === 'terminal') {
            throw new Error(terminalPollMessage('Kling', response2.status));
          }
          continue;
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
