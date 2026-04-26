import { API_CONFIG } from '@/lib/config';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** 带超时的 fetch —— 防止 API 无响应时无限挂起 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * 敏感词净化器 —— Minimax 1026 (input new_sensitive) 的通用改写层
 * 将常见触发词替换为语义相近但安全的表达；用于图像/视频 prompt 初清洗
 */
const SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  // 暴力/血腥
  [/\b(血腥|鲜血|流血|血迹|血泊)\b/g, '红色液体'],
  [/\b(尸体|死尸|遗体)\b/g, '倒下的身影'],
  [/\b(杀害|杀死|杀戮|屠杀|砍杀|斩杀)\b/g, '击败'],
  [/\b(暴力|殴打|狂揍|毒打)\b/g, '激烈对抗'],
  [/\b(枪|步枪|手枪|机枪|冲锋枪)\b/g, '能量装置'],
  [/\b(子弹|炮弹|弹药)\b/g, '能量光束'],
  [/\b(爆炸|炸弹|炸药|核弹)\b/g, '能量迸发'],
  // 裸露/色情
  [/\b(裸体|全裸|赤裸|半裸|裸露)\b/g, '身披薄纱'],
  [/\b(色情|淫秽|淫荡|淫欲)\b/g, '浪漫'],
  [/\b(性感至极|极度性感)\b/g, '优雅'],
  // 政治敏感（去除地名/人名等 — 这些由 LLM 层通常已过滤，此处兜底删词）
  [/\b(习近平|毛泽东|普京|特朗普|拜登)\b/g, ''],
  [/\b(台独|港独|藏独|疆独)\b/g, ''],
  // 毒品/自残
  [/\b(毒品|海洛因|冰毒|大麻)\b/g, '神秘物质'],
  [/\b(自杀|自尽|自残)\b/g, '情绪崩溃'],
];

export function sanitizePromptForMinimax(prompt: string): string {
  let out = prompt;
  for (const [re, rep] of SENSITIVE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  // 连续空格 / 多余标点清理
  return out.replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
}

/** 判断错误是否为 Minimax 1026 敏感词错误 */
function isSensitiveContentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /1026|new_sensitive|sensitive/i.test(msg);
}

/**
 * Minimax T2A / 音乐接口把音频数据以 **hex 字符串** 形式返回（data.data.audio）
 * 此处把 hex 写入本地 tmp 文件，返回 /api/serve-file?path=... URL 供 composer / 浏览器消费
 */
function persistHexAudioToFile(hex: string, ext: 'mp3' | 'wav' = 'mp3'): string {
  const dir = path.join(os.tmpdir(), 'qf-audio');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `mnx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fullPath = path.join(dir, filename);
  const buf = Buffer.from(hex, 'hex');
  fs.writeFileSync(fullPath, buf);
  return `/api/serve-file?path=${encodeURIComponent(fullPath)}`;
}

export class MinimaxService {
  private apiKey: string;
  private baseURL: string;
  /** 视频/图片接口是否可用：仅当 baseURL 指向真正的 minimaxi.com / minimax.io 时为 true。
   *  qingyuntop 等聚合网关根本不存在 /v1/video_generation 和 /v1/image_generation 路径，
   *  会回 "Invalid URL (404)"，这里提前拦截，避免每次浪费 30s timeout。 */
  private videoEndpointAvailable: boolean;
  private imageEndpointAvailable: boolean;

  constructor() {
    this.apiKey = API_CONFIG.minimax.apiKey;
    this.baseURL = API_CONFIG.minimax.baseURL;
    const isOfficialEndpoint = /minimaxi?\.(com|io)/i.test(this.baseURL);
    this.videoEndpointAvailable = isOfficialEndpoint;
    this.imageEndpointAvailable = isOfficialEndpoint;
    if (!isOfficialEndpoint) {
      console.warn(
        `[Minimax] baseURL "${this.baseURL}" 不是官方 minimaxi.com 端点 — ` +
        `视频/图片接口将被跳过 (聚合网关通常不暴露 /v1/video_generation & /v1/image_generation)`
      );
    }
  }

  /** 视频接口是否真正可用（供 orchestrator 决定是否把 Minimax 加入引擎链） */
  isVideoAvailable(): boolean {
    return this.videoEndpointAvailable;
  }

  /** 图片接口是否真正可用 */
  isImageAvailable(): boolean {
    return this.imageEndpointAvailable;
  }

  /**
   * 生成视频（支持文生视频和图生视频）
   * 使用 video-01 模型，支持 first_frame_image 作为首帧锚定
   */
  async generateVideo(imageUrl: string, prompt: string, options?: {
    duration?: number;
    /** 角色参考图URL —— 如果提供，自动升级为 S2V-01 角色一致性模式 */
    subjectReferenceUrl?: string;
    /**
     * v2.8: 多主体参考 — 每个主要角色一个条目,S2V-01 可同时锁定多个主体。
     * 如果传了此字段且长度 > 0,将优先走 S2V-01 多主体模式;否则走单 subjectReferenceUrl。
     */
    subjectReferences?: Array<{ type?: string; imageUrl: string; name?: string }>;
    /** v2.8: 辅助参考图(场景/风格),经过 S2V-01 的 reference_images 字段 */
    referenceImages?: string[];
    /** 内部重试用,勿传 */
    _retryCount?: number;
  }): Promise<string> {
    // 快速失败:聚合网关上 Minimax 视频路径不存在,直接抛错让 orchestrator 跳到下一引擎
    if (!this.videoEndpointAvailable) {
      throw new Error(
        `Minimax video endpoint unavailable on baseURL "${this.baseURL}" — ` +
        `gateway does not expose /v1/video_generation, skipping`
      );
    }

    // S2V-01 多主体角色一致性引擎 — v2.8 Seedance 2.0 同款多参考图打包
    const hasMultiSubject = options?.subjectReferences && options.subjectReferences.length > 0;
    if (hasMultiSubject || options?.subjectReferenceUrl) {
      try {
        return await this.generateVideoS2V(
          prompt,
          options?.subjectReferenceUrl || '',
          {
            firstFrameImage: imageUrl,
            duration: options?.duration,
            subjectReferences: options?.subjectReferences,
            referenceImages: options?.referenceImages,
          }
        );
      } catch (e) {
        console.warn(`[Minimax] S2V-01 failed, fallback to I2V/Hailuo:`, e instanceof Error ? e.message : e);
        // 降级到 I2V-01/Hailuo-2.3（角色一致性靠 prompt 描述来保持）
      }
    }

    const retryCount = options?._retryCount ?? 0;
    const effectivePrompt = retryCount === 0 ? prompt : sanitizePromptForMinimax(prompt);

    try {
      // 判断是否有有效的图片 URL（非 data URI mock）
      const hasRealImage = imageUrl && !imageUrl.startsWith('data:') && imageUrl.startsWith('http');

      // 根据是否有首帧图选择最佳模型：
      //   有首帧 → I2V-01（图生视频，质量最高）
      //   无首帧 → MiniMax-Hailuo-2.3（文生视频，当前套餐支持）
      const model = hasRealImage ? 'I2V-01' : 'MiniMax-Hailuo-2.3';

      const body: Record<string, any> = {
        model,
        prompt: effectivePrompt,
        prompt_optimizer: true,
      };

      // 只有真实图片 URL 才传 first_frame_image
      if (hasRealImage) {
        body.first_frame_image = imageUrl;
      }

      console.log(`[Minimax] Generating video (${model}): ${hasRealImage ? 'image-to-video' : 'text-to-video'}`);
      console.log(`[Minimax] Prompt: ${prompt.slice(0, 100)}...`);

      const response = await fetchWithTimeout(`${this.baseURL}/v1/video_generation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Minimax API error (${response.status}): ${JSON.stringify(data)}`);
      }

      // Minimax 返回格式: { task_id, base_resp: { status_code, status_msg } }
      // 检查 base_resp 业务错误（HTTP 200 但实际失败）
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        const code = data.base_resp.status_code;
        const msg = data.base_resp.status_msg || 'unknown';
        // 1026 敏感词 — 用净化后的 prompt 自动重试一次
        if (code === 1026 && retryCount === 0) {
          console.warn('[Minimax] video 1026 sensitive content — retrying with sanitized prompt');
          return await this.generateVideo(imageUrl, prompt, { ...options, _retryCount: 1 });
        }
        throw new Error(`Minimax video-01 error (${code}): ${msg}`);
      }

      const taskId = data.task_id;
      if (!taskId) {
        throw new Error(`Minimax: no task_id in response: ${JSON.stringify(data)}`);
      }

      console.log(`[Minimax] Task created: ${taskId}`);

      // 轮询结果
      const videoUrl = await this.pollResult(taskId);
      return videoUrl;
    } catch (error) {
      if (isSensitiveContentError(error) && retryCount === 0) {
        console.warn('[Minimax] video sensitive content caught — retrying sanitized');
        return await this.generateVideo(imageUrl, prompt, { ...options, _retryCount: 1 });
      }
      console.error('[Minimax] Video generation error:', error);
      throw error;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════
   * v2.12: Hailuo-2.3-Fast (768P) 兜底
   *
   * Hailuo-2.3-Fast 是 Minimax 的低质快速版,**额度独立计算**(与 Hailuo-2.3
   * 标准版不共享日额度)。当 Hailuo-2.3 / Veo / Kling 等主用引擎额度耗尽时,
   * orchestrator 会拿这个当 Pass-B 的最后一站,保证至少能产出可看的视频
   * 而不是直接降级到 Ken Burns 静帧。
   *
   * 模型名通过 MINIMAX_FAST_VIDEO_MODEL env 可改;不设默认走
   * 'MiniMax-Hailuo-2.3-Fast'(纯文生,不支持 first_frame)。
   * ═══════════════════════════════════════════════════════
   */
  async generateVideoFast(prompt: string, options?: { duration?: number; _retryCount?: number }): Promise<string> {
    if (!this.videoEndpointAvailable) {
      throw new Error(
        `Minimax video endpoint unavailable on baseURL "${this.baseURL}" — ` +
        `Fast model (Hailuo-2.3-Fast) skipped`
      );
    }

    const retryCount = options?._retryCount ?? 0;
    const effectivePrompt = retryCount === 0 ? prompt : sanitizePromptForMinimax(prompt);
    const model = process.env.MINIMAX_FAST_VIDEO_MODEL || 'MiniMax-Hailuo-2.3-Fast';

    try {
      console.log(`[Minimax-Fast] T2V ${model} (separate daily quota)`);
      console.log(`[Minimax-Fast] Prompt: ${effectivePrompt.slice(0, 100)}...`);

      const response = await fetchWithTimeout(`${this.baseURL}/v1/video_generation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt: effectivePrompt,
          prompt_optimizer: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Minimax-Fast API error (${response.status}): ${JSON.stringify(data).slice(0, 200)}`);
      }
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        const code = data.base_resp.status_code;
        const msg = data.base_resp.status_msg || 'unknown';
        // 1026 敏感词 — 自动重试一次净化版
        if (code === 1026 && retryCount === 0) {
          console.warn('[Minimax-Fast] 1026 sensitive content — retrying sanitized');
          return await this.generateVideoFast(prompt, { ...options, _retryCount: 1 });
        }
        // 1008 余额不足 — 直接抛,让 orchestrator 进 Ken Burns 兜底
        throw new Error(`Minimax-Fast error (${code}): ${msg}`);
      }
      const taskId = data.task_id;
      if (!taskId) throw new Error(`Minimax-Fast: no task_id`);
      console.log(`[Minimax-Fast] Task created: ${taskId}`);
      return await this.pollResult(taskId);
    } catch (error) {
      if (isSensitiveContentError(error) && retryCount === 0) {
        return await this.generateVideoFast(prompt, { ...options, _retryCount: 1 });
      }
      console.error('[Minimax-Fast] generation error:', error);
      throw error;
    }
  }

  /**
   * ═══════════════════════════════════════════════════════
   * S2V-01 角色一致性视频生成（Subject-to-Video）
   *
   * 业界最佳实践："首帧锚定 + 角色参考" 双保险模式
   * - subject_reference: 角色参考图 → 锁定面部/服装/体型
   * - first_frame_image: 场景参考图 → 锁定构图/背景/氛围
   *
   * API: https://platform.minimax.io/docs/api-reference/video-generation-s2v
   * ═══════════════════════════════════════════════════════
   */
  async generateVideoS2V(prompt: string, characterRefUrl: string, options?: {
    firstFrameImage?: string;
    duration?: number;
    /**
     * v2.8 (Seedance 2.0 同款): 多主体参考 — 每个角色一个条目,锁定
     * 面部/服装/体型。如果传了此字段,会覆盖 characterRefUrl。
     * S2V-01 API 支持 subject_reference[] 数组,每个条目是一个独立
     * 主体(角色/道具/生物等),最大 3 个条目。
     */
    subjectReferences?: Array<{ type?: string; imageUrl: string; name?: string }>;
    /** 可选:额外的参考图(非主体类,如场景/风格样图),放到 reference_images */
    referenceImages?: string[];
  }): Promise<string> {
    if (!this.videoEndpointAvailable) {
      throw new Error(
        `Minimax S2V endpoint unavailable on baseURL "${this.baseURL}", skipping`
      );
    }

    const isHttpImg = (u?: string) =>
      !!u && !u.startsWith('data:') && (u.startsWith('http') || u.startsWith('/api/serve-file'));

    const hasFirstFrame = isHttpImg(options?.firstFrameImage);

    // 构建 subject_reference 数组:
    //   1) 如果传了 options.subjectReferences,优先使用(支持多主体)
    //   2) 否则退回单角色模式,用 characterRefUrl
    const subjectList = (options?.subjectReferences || [])
      .filter((s) => isHttpImg(s?.imageUrl))
      .slice(0, 3); // S2V-01 最多支持 3 个主体

    const subjectReferenceArray = subjectList.length > 0
      ? subjectList.map((s) => ({
          type: s.type || 'character',
          image: [s.imageUrl],
        }))
      : isHttpImg(characterRefUrl)
        ? [{ type: 'character', image: [characterRefUrl] }]
        : [];

    if (subjectReferenceArray.length === 0) {
      throw new Error('Minimax S2V: 至少需要一张有效的角色参考图');
    }

    const body: Record<string, any> = {
      model: 'S2V-01',
      prompt: prompt,
      prompt_optimizer: true,
      subject_reference: subjectReferenceArray,
    };

    if (hasFirstFrame) {
      body.first_frame_image = options!.firstFrameImage;
    }

    // 辅助参考图(场景/风格)— 如果网关支持 reference_images 字段就一起带上
    if (options?.referenceImages && options.referenceImages.length > 0) {
      const extras = options.referenceImages
        .filter(isHttpImg)
        .filter((u) => u !== options.firstFrameImage)
        .slice(0, 3);
      if (extras.length > 0) {
        body.reference_images = extras;
      }
    }

    console.log(`[Minimax-S2V] 多主体一致性视频生成`);
    console.log(`[Minimax-S2V] Subjects: ${subjectReferenceArray.length} (${subjectList.map((s) => s.name || s.type || '?').join(', ') || 'single'})`);
    console.log(`[Minimax-S2V] FirstFrame: ${hasFirstFrame ? 'YES' : 'NO'}`);
    console.log(`[Minimax-S2V] ExtraRefs: ${body.reference_images?.length || 0}`);
    console.log(`[Minimax-S2V] Prompt: ${prompt.slice(0, 100)}...`);

    const response = await fetchWithTimeout(`${this.baseURL}/v1/video_generation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Minimax S2V API error (${response.status}): ${JSON.stringify(data)}`);
    }

    // 检查 base_resp 错误（如 status_code 2061 = plan not support model）
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw new Error(`Minimax S2V error (${data.base_resp.status_code}): ${data.base_resp.status_msg || 'unknown'}`);
    }

    const taskId = data.task_id;
    if (!taskId) {
      if (data.base_resp?.status_code === 1008) {
        throw new Error('Minimax账户余额不足');
      }
      throw new Error(`Minimax S2V: no task_id: ${JSON.stringify(data)}`);
    }

    console.log(`[Minimax-S2V] Task created: ${taskId}`);
    return await this.pollResult(taskId);
  }

  // 轮询结果
  private async pollResult(taskId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(5000);

      const response = await fetchWithTimeout(`${this.baseURL}/v1/query/video_generation?task_id=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Minimax query error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const status = data.status;
      const fileId = data.file_id;
      const videoUrl = data.video_url;

      console.log(`[Minimax] Poll #${i + 1}: status=${status}, file_id=${fileId || 'none'}`);

      // Minimax 可能返回不同的状态字段格式
      if (status === 'Success' || status === 'success') {
        // 优先用 video_url，其次用 file_id 构造下载链接
        if (videoUrl) return videoUrl;
        if (fileId) {
          return await this.getFileUrl(fileId);
        }
        // 检查嵌套结构
        if (data.output?.video_url) return data.output.video_url;
        if (data.result?.video_url) return data.result.video_url;

        throw new Error(`Minimax: success but no video URL in response: ${JSON.stringify(data).slice(0, 300)}`);
      }

      if (status === 'Failed' || status === 'failed') {
        throw new Error(`Minimax video generation failed: ${data.error || data.base_resp?.status_msg || 'unknown'}`);
      }

      // Processing / Queueing — 继续等待
    }

    throw new Error('Minimax video generation timeout (5 min)');
  }

  // 通过 file_id 获取文件下载 URL
  private async getFileUrl(fileId: string): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseURL}/v1/files/retrieve?file_id=${fileId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Minimax file retrieve error: ${response.status}`);
    }

    const data = await response.json();
    const downloadUrl = data.file?.download_url || data.download_url;
    if (!downloadUrl) {
      throw new Error(`Minimax: no download_url for file ${fileId}`);
    }
    return downloadUrl;
  }

  // 生成图片（文生图）
  async generateImage(prompt: string, options?: {
    aspectRatio?: string;
    /** 内部重试用,勿传 */
    _retryCount?: number;
  }): Promise<string> {
    // 快速失败：聚合网关上 Minimax 图片路径不存在，直接抛错让 orchestrator 跳到下一引擎
    if (!this.imageEndpointAvailable) {
      throw new Error(
        `Minimax image endpoint unavailable on baseURL "${this.baseURL}" — ` +
        `gateway does not expose /v1/image_generation, skipping`
      );
    }

    const retryCount = options?._retryCount ?? 0;
    // 第 1 次尝试用原始 prompt；后续重试自动净化
    const effectivePrompt = retryCount === 0 ? prompt : sanitizePromptForMinimax(prompt);

    try {
      console.log(`[Minimax] Generating image ${retryCount > 0 ? '(sanitized retry) ' : ''}with prompt: ${effectivePrompt.slice(0, 100)}...`);

      const body: Record<string, any> = {
        model: 'image-01',
        prompt: effectivePrompt,
        prompt_optimizer: true,
      };

      // 设置宽高比
      if (options?.aspectRatio) {
        const ratioMap: Record<string, { width: number; height: number }> = {
          '1:1': { width: 1024, height: 1024 },
          '16:9': { width: 1344, height: 768 },
          '9:16': { width: 768, height: 1344 },
          '4:3': { width: 1152, height: 896 },
          '3:4': { width: 896, height: 1152 },
        };
        const size = ratioMap[options.aspectRatio] || ratioMap['1:1'];
        body.width = size.width;
        body.height = size.height;
      }

      const response = await fetchWithTimeout(`${this.baseURL}/v1/image_generation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 120_000); // image-01 复杂 prompt 可能需要 60-90 秒

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Minimax API error (${response.status}): ${JSON.stringify(data)}`);
      }

      // 检查 base_resp 业务错误（HTTP 200 但含敏感词等）
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        const code = data.base_resp.status_code;
        const msg = data.base_resp.status_msg || 'unknown';
        const err = new Error(`Minimax image-01 error (${code}): ${msg}`);
        // 1026 敏感词 — 用净化后的 prompt 自动重试一次
        if (code === 1026 && retryCount === 0) {
          console.warn('[Minimax] 1026 sensitive content — retrying with sanitized prompt');
          return await this.generateImage(prompt, { ...options, _retryCount: 1 });
        }
        throw err;
      }

      // 检查是否直接返回了图片URL（新版API）
      if (data.data?.image_urls && Array.isArray(data.data.image_urls) && data.data.image_urls.length > 0) {
        console.log(`[Minimax] Image generated directly: ${data.data.image_urls[0]}`);
        return data.data.image_urls[0];
      }

      // 旧版API：需要轮询
      const taskId = data.task_id;
      if (!taskId) {
        throw new Error(`Minimax: no task_id in response: ${JSON.stringify(data)}`);
      }

      console.log(`[Minimax] Image task created: ${taskId}`);

      // 轮询结果
      const imageUrl = await this.pollImageResult(taskId);
      return imageUrl;
    } catch (error) {
      // 1026 也可能从其他抛出路径冒出来 — 统一兜底一次
      if (isSensitiveContentError(error) && retryCount === 0) {
        console.warn('[Minimax] sensitive content caught on throw — retrying sanitized');
        return await this.generateImage(prompt, { ...options, _retryCount: 1 });
      }
      console.error('[Minimax] Image generation error:', error);
      throw error;
    }
  }

  // 轮询图片生成结果
  private async pollImageResult(taskId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(3000);

      const response = await fetchWithTimeout(`${this.baseURL}/v1/query/image_generation?task_id=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Minimax query error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const status = data.status;
      const fileId = data.file_id;

      console.log(`[Minimax] Image poll #${i + 1}: status=${status}, file_id=${fileId || 'none'}`);

      if (status === 'Success' || status === 'success') {
        // 检查各种可能的URL字段
        if (data.image_url) return data.image_url;
        if (data.output?.image_url) return data.output.image_url;
        if (data.result?.image_url) return data.result.image_url;

        if (fileId) {
          return await this.getFileUrl(fileId);
        }

        throw new Error(`Minimax: success but no image URL in response: ${JSON.stringify(data).slice(0, 300)}`);
      }

      if (status === 'Failed' || status === 'failed') {
        throw new Error(`Minimax image generation failed: ${data.error || data.base_resp?.status_msg || 'unknown'}`);
      }
    }

    throw new Error('Minimax image generation timeout (3 min)');
  }

  // 生成配乐/音乐
  async generateMusic(prompt: string, options?: {
    duration?: number;
    style?: string;
  }): Promise<string> {
    try {
      const musicPrompt = options?.style
        ? `${options.style} style background music: ${prompt}`
        : `cinematic background music: ${prompt}`;

      console.log(`[Minimax] Generating music: ${musicPrompt.slice(0, 100)}...`);

      const body: Record<string, any> = {
        model: 'music-2.6',
        prompt: musicPrompt,
        lyrics: '##\n[Music]\n##', // music-2.6 需要 lyrics 字段，纯音乐用占位符
        audio_setting: {
          sample_rate: 44100,
          bitrate: 256000,
          format: 'mp3',
        },
        ...(options?.duration && { duration: Math.min(options.duration, 120) }),
      };

      const response = await fetchWithTimeout(`${this.baseURL}/v1/music_generation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 180_000); // 音乐生成通常 60-120s

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Minimax Music API error (${response.status}): ${JSON.stringify(data)}`);
      }

      // base_resp 业务错误
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        throw new Error(`Minimax Music error (${data.base_resp.status_code}): ${data.base_resp.status_msg || 'unknown'}`);
      }

      // ═══ Minimax music_generation 同步响应 ═══
      // 同 T2A:data.data.audio 是 hex 字符串
      const audioField = data.data?.audio;
      if (typeof audioField === 'string' && audioField.length > 100 && /^[0-9a-fA-F]+$/.test(audioField.slice(0, 64))) {
        const url = persistHexAudioToFile(audioField, 'mp3');
        console.log(`[Minimax] Music saved hex audio → ${url}`);
        return url;
      }

      // 直接返回音频URL
      if (data.data?.audio_url) {
        console.log(`[Minimax] Music generated directly`);
        return data.data.audio_url;
      }
      if (data.audio_url) {
        return data.audio_url;
      }

      // 异步模式：需要轮询
      const taskId = data.task_id;
      if (!taskId) {
        // 如果 music-01 不可用，尝试用 speech-02 生成背景音
        console.warn('[Minimax] music-2.6 unavailable, trying speech synthesis as fallback...');
        return await this.generateSpeechMusic(prompt, options?.duration || 30);
      }

      console.log(`[Minimax] Music task created: ${taskId}`);
      return await this.pollMusicResult(taskId);
    } catch (error) {
      console.error('[Minimax] Music generation error:', error);
      // 回退到语音合成模拟
      try {
        return await this.generateSpeechMusic(prompt, options?.duration || 30);
      } catch {
        throw error;
      }
    }
  }

  // 轮询音乐生成结果
  private async pollMusicResult(taskId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(3000);

      const response = await fetchWithTimeout(`${this.baseURL}/v1/query/music_generation?task_id=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Minimax music query error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const status = data.status;

      console.log(`[Minimax] Music poll #${i + 1}: status=${status}`);

      if (status === 'Success' || status === 'success') {
        // hex 音频
        const audioField = data.data?.audio || data.audio;
        if (typeof audioField === 'string' && audioField.length > 100 && /^[0-9a-fA-F]+$/.test(audioField.slice(0, 64))) {
          return persistHexAudioToFile(audioField, 'mp3');
        }
        const audioUrl = data.audio_url || data.data?.audio_url || data.output?.audio_url;
        if (audioUrl) return audioUrl;
        if (data.file_id) return await this.getFileUrl(data.file_id);
        throw new Error(`Minimax: music success but no audio URL`);
      }

      if (status === 'Failed' || status === 'failed') {
        throw new Error(`Minimax music generation failed: ${data.error || 'unknown'}`);
      }
    }
    throw new Error('Minimax music generation timeout (3 min)');
  }

  // 使用语音合成API作为配乐后备方案
  private async generateSpeechMusic(prompt: string, duration: number): Promise<string> {
    console.log(`[Minimax] Using T2A for ambient audio (fallback, duration hint=${duration}s)...`);

    const body = {
      model: 'speech-2.8-hd',
      text: `[ambient music] ${prompt}`.slice(0, 500),
      stream: false,
      voice_setting: {
        voice_id: 'male-qn-jingying',
        speed: 0.8,
        vol: 0.6,
        pitch: -2,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    };

    const response = await fetchWithTimeout(`${this.baseURL}/v1/t2a_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, 60_000);

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Minimax T2A error: ${response.status}`);
    }

    const audioField = data.data?.audio;
    if (typeof audioField === 'string' && audioField.length > 100 && /^[0-9a-fA-F]+$/.test(audioField.slice(0, 64))) {
      return persistHexAudioToFile(audioField, 'mp3');
    }

    const audioUrl = data.data?.audio?.audio_url || data.audio_url || data.data?.audio_url;
    if (audioUrl) return audioUrl;

    if (data.data?.audio?.data) {
      return `data:audio/mp3;base64,${data.data.audio.data}`;
    }

    throw new Error('Minimax T2A: no audio URL in response');
  }

  // ═══ AI 配音（TTS 语音合成）═══
  // 使用 MiniMax Speech-02 模型生成角色配音/旁白
  async generateSpeech(text: string, options?: {
    voiceId?: string;    // 音色ID: 参见 MiniMax 文档
    speed?: number;      // 语速 0.5~2.0，默认1.0
    vol?: number;        // 音量 0~1，默认0.8
    pitch?: number;      // 音调 -12~12，默认0
    emotion?: string;    // 情绪关键词（用于自动选择合适的音色）
    gender?: 'male' | 'female';  // 性别偏好
  }): Promise<string> {
    try {
      // 根据情绪和性别自动选择音色
      const voiceId = options?.voiceId || this.selectVoiceByEmotion(
        options?.emotion || '平静',
        options?.gender || 'male'
      );

      console.log(`[Minimax] TTS: voice=${voiceId}, text="${text.slice(0, 50)}..."`);

      const body = {
        model: 'speech-2.8-hd',
        text: text,
        stream: false,
        voice_setting: {
          voice_id: voiceId,
          speed: options?.speed ?? 1.0,
          vol: options?.vol ?? 0.8,
          pitch: options?.pitch ?? 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
          channel: 1,
        },
      };

      const response = await fetchWithTimeout(`${this.baseURL}/v1/t2a_v2`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, 60_000);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Minimax TTS error (${response.status}): ${JSON.stringify(data)}`);
      }

      // base_resp 业务错误（HTTP 200 但失败）
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        throw new Error(`Minimax TTS error (${data.base_resp.status_code}): ${data.base_resp.status_msg || 'unknown'}`);
      }

      // ═══ Minimax 官方 T2A v2 非流式响应 ═══
      // 格式:{ data: { audio: "<HEX_STRING>", status: 2 }, extra_info: {...}, trace_id: "..." }
      // audio 字段是 **十六进制编码的 MP3 字节**,不是 base64、也不是 URL
      const audioField = data.data?.audio;
      if (typeof audioField === 'string' && audioField.length > 100) {
        // 快速判定是否像 hex(偶数长度,仅 0-9a-f)
        if (/^[0-9a-fA-F]+$/.test(audioField.slice(0, 64))) {
          const url = persistHexAudioToFile(audioField, 'mp3');
          console.log(`[Minimax] TTS saved hex audio → ${url}`);
          return url;
        }
      }

      // 兼容其他可能的格式:直接 URL
      const audioUrl = data.data?.audio?.audio_url || data.audio_url || data.data?.audio_url;
      if (audioUrl) return audioUrl;

      // base64 data
      if (data.data?.audio?.data) {
        return `data:audio/mp3;base64,${data.data.audio.data}`;
      }

      // 异步任务
      if (data.task_id) {
        return await this.pollTTSResult(data.task_id);
      }

      throw new Error(`Minimax TTS: no audio in response: ${JSON.stringify(data).slice(0, 300)}`);
    } catch (error) {
      console.error('[Minimax] TTS error:', error);
      throw error;
    }
  }

  // 批量生成多段配音（用于角色对白）
  async generateSpeechBatch(items: Array<{
    text: string;
    character?: string;
    emotion?: string;
    gender?: 'male' | 'female';
  }>): Promise<Array<{ text: string; audioUrl: string }>> {
    const results: Array<{ text: string; audioUrl: string }> = [];
    for (const item of items) {
      if (!item.text || item.text.trim().length === 0) continue;
      try {
        const audioUrl = await this.generateSpeech(item.text, {
          emotion: item.emotion,
          gender: item.gender,
        });
        results.push({ text: item.text, audioUrl });
      } catch (e) {
        console.error(`[Minimax] TTS batch item failed: "${item.text.slice(0, 30)}"`, e);
      }
    }
    return results;
  }

  // 根据情绪自动选择合适的音色
  private selectVoiceByEmotion(emotion: string, gender: 'male' | 'female'): string {
    // MiniMax 预置音色映射（根据情绪和性别选择最合适的音色）
    const maleVoices: Record<string, string> = {
      '默认': 'male-qn-qingse',
      '温暖': 'male-qn-qingse',
      '悲伤': 'male-qn-jingying',
      '愤怒': 'male-qn-badao',
      '紧张': 'male-qn-jingying',
      '搞笑': 'male-qn-qingse',
      '深沉': 'male-qn-jingying',
      '旁白': 'presenter_male',
    };
    const femaleVoices: Record<string, string> = {
      '默认': 'female-shaonv',
      '温暖': 'female-yujie',
      '悲伤': 'female-shaonv',
      '愤怒': 'female-yujie',
      '紧张': 'female-shaonv',
      '搞笑': 'female-shaonv',
      '深沉': 'female-yujie',
      '旁白': 'presenter_female',
    };

    const voiceMap = gender === 'female' ? femaleVoices : maleVoices;
    // 尝试匹配情绪关键词
    for (const [key, voice] of Object.entries(voiceMap)) {
      if (emotion.includes(key)) return voice;
    }
    return voiceMap['默认'];
  }

  // 轮询 TTS 异步结果
  private async pollTTSResult(taskId: string, maxAttempts = 30): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(2000);
      const response = await fetchWithTimeout(`${this.baseURL}/v1/query/t2a?task_id=${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) throw new Error(`TTS poll error: ${response.status}`);
      const data = await response.json();
      if (data.status === 'Success' || data.status === 'success') {
        const audioField = data.data?.audio || data.audio;
        if (typeof audioField === 'string' && audioField.length > 100 && /^[0-9a-fA-F]+$/.test(audioField.slice(0, 64))) {
          return persistHexAudioToFile(audioField, 'mp3');
        }
        const url = data.audio_url || data.data?.audio_url || data.data?.audio?.audio_url;
        if (url) return url;
        if (data.file_id) return await this.getFileUrl(data.file_id);
        throw new Error('TTS success but no audio URL');
      }
      if (data.status === 'Failed' || data.status === 'failed') {
        throw new Error(`TTS failed: ${data.error || 'unknown'}`);
      }
    }
    throw new Error('TTS timeout (60s)');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
