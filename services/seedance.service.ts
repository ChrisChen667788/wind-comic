/**
 * 即梦视频生成服务 (Seedance 2.0 via 火山引擎 CV 官方 API)
 *
 * 对应 v2.0 Sprint 0 D3。
 *
 * 架构说明：
 * - 使用 `services/jimeng-signer.ts` 生成 Volc4 签名
 * - 走火山引擎官方接口 `visual.volcengineapi.com`
 * - 异步任务流：`CVSync2AsyncSubmitTask` → 轮询 `CVSync2AsyncGetResult`
 *
 * 本期支持：
 * - 文生视频 / 图生视频 / 首尾帧生成
 * - 分辨率 360P / 480P / 720P（v2.0 上限 720P）
 * - 多模态参考：最多 9 图 + 3 视频 + 3 音频
 * - 原生音画同生（native audio-video）
 * - 新编辑模式：换角色 / 增减内容 / 续写 / 拼接
 *
 * 注意：req_key 会因即梦模型升级而变化，已在 `REQ_KEY_MAP` 中集中管理。
 * 如果接口失败（例如账户未开通 CV 服务），会抛出明确错误由上层降级到 Vidu/Kling。
 *
 * 环境变量：
 *   JIMENG_AK       火山引擎 Access Key ID
 *   JIMENG_SK       火山引擎 Secret Access Key
 *   JIMENG_REGION   默认 cn-north-1
 *   JIMENG_SERVICE  默认 cv
 */

import { signRequest, getJimengCredentials, hasJimengCredentials } from './jimeng-signer';

// ──────────────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────────────

export type SeedanceResolution = '360p' | '480p' | '720p';
export type SeedanceDuration = 4 | 5 | 8 | 10 | 15;
export type SeedanceAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type SeedanceCameraMotion =
  | 'static'
  | 'push_in'
  | 'pull_out'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'orbit'
  | 'handheld';

export interface SeedanceEditMode {
  type: 'replace_character' | 'add_content' | 'delete_content' | 'extend' | 'concat';
  /** 源视频 URL（必填） */
  sourceVideo: string;
  /** 目标（替换的新角色 / 新增内容的描述 / 拼接的下一段视频） */
  target?: string;
}

export interface SeedanceGenerateOptions {
  prompt: string;
  duration?: SeedanceDuration;
  resolution?: SeedanceResolution;
  aspectRatio?: SeedanceAspectRatio;
  /** 最多 9 张参考图（URL） */
  referenceImages?: string[];
  /** 最多 3 段参考视频（URL） */
  referenceVideos?: string[];
  /** 最多 3 段参考音频（URL） */
  referenceAudios?: string[];
  /** 原生音画同生 */
  nativeAudio?: boolean;
  /** 运镜方式 */
  cameraMotion?: SeedanceCameraMotion;
  /** 负向提示词 */
  negativePrompt?: string;
  /** 随机种子（确定性复现） */
  seed?: number;
  /** 编辑模式 —— 二次创作场景 */
  editMode?: SeedanceEditMode;
  /** 额外透传的原始字段（调试用，会覆盖同名字段） */
  raw?: Record<string, unknown>;
}

export interface SeedanceSubmitResult {
  taskId: string;
  reqKey: string;
  submittedAt: string;
}

export interface SeedanceTaskResult {
  taskId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  videoUrl?: string;
  coverUrl?: string;
  audioUrl?: string;
  raw?: unknown;
  error?: string;
}

// ──────────────────────────────────────────────────────────
// req_key 映射（即梦模型升级只需改这里）
// ──────────────────────────────────────────────────────────

/** 即梦 CV 接口 req_key 集中管理（按业务场景 + 分辨率选择） */
const REQ_KEY_MAP = {
  /** 文生视频 Lite（720P / 480P / 360P 通用） */
  t2v: 'jimeng_vgfm_t2v_l20',
  /** 图生视频 Lite（首帧图 → 视频） */
  i2v: 'jimeng_vgfm_i2v_l21',
  /** 原生音画同生 */
  av: 'jimeng_vgfm_av_l10',
  /** 视频编辑（换角色 / 续写 / 拼接 / 增减内容） */
  edit: 'jimeng_vgfm_edit_l10',
};

const HOST = 'visual.volcengineapi.com';
const PATH = '/';
const API_VERSION = '2022-08-31';
const SUBMIT_ACTION = 'CVSync2AsyncSubmitTask';
const RESULT_ACTION = 'CVSync2AsyncGetResult';

/** 分辨率 → 像素尺寸（按 16:9 基准，客户端如需其他比例由 aspect_ratio 字段调整） */
const RESOLUTION_SIZE: Record<SeedanceResolution, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
};

// ──────────────────────────────────────────────────────────
// 公开函数：是否具备可用凭证
// ──────────────────────────────────────────────────────────

export function hasSeedance(): boolean {
  return hasJimengCredentials();
}

// ──────────────────────────────────────────────────────────
// Service 类
// ──────────────────────────────────────────────────────────

/** 带超时的 fetch */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class SeedanceService {
  private accessKey: string;
  private secretKey: string;
  private region: string;
  private service: string;

  constructor(creds?: { accessKey: string; secretKey: string; region?: string; service?: string }) {
    const c = creds ?? getJimengCredentials();
    this.accessKey = c.accessKey;
    this.secretKey = c.secretKey;
    this.region = c.region || 'cn-north-1';
    this.service = c.service || 'cv';
  }

  // ──────────────────────────────────────────────
  // 对外主入口：生成视频（自动 submit + poll）
  // ──────────────────────────────────────────────

  async generateVideo(options: SeedanceGenerateOptions): Promise<SeedanceTaskResult> {
    const submit = await this.submitTask(options);
    return await this.pollResult(submit.taskId, submit.reqKey);
  }

  // ──────────────────────────────────────────────
  // 构造请求体（根据 options 推断 req_key 与 payload）
  // 独立抽出便于单测
  // ──────────────────────────────────────────────

  buildPayload(options: SeedanceGenerateOptions): {
    reqKey: string;
    body: Record<string, unknown>;
  } {
    // 1. 基础校验
    if (!options.prompt || options.prompt.trim().length === 0) {
      throw new Error('[Seedance] prompt is required');
    }
    if (options.referenceImages && options.referenceImages.length > 9) {
      throw new Error(`[Seedance] referenceImages max 9, got ${options.referenceImages.length}`);
    }
    if (options.referenceVideos && options.referenceVideos.length > 3) {
      throw new Error(`[Seedance] referenceVideos max 3, got ${options.referenceVideos.length}`);
    }
    if (options.referenceAudios && options.referenceAudios.length > 3) {
      throw new Error(`[Seedance] referenceAudios max 3, got ${options.referenceAudios.length}`);
    }

    // 2. 按场景挑选 req_key
    let reqKey: string;
    if (options.editMode) {
      reqKey = REQ_KEY_MAP.edit;
    } else if (options.nativeAudio) {
      reqKey = REQ_KEY_MAP.av;
    } else if (options.referenceImages && options.referenceImages.length > 0) {
      reqKey = REQ_KEY_MAP.i2v;
    } else {
      reqKey = REQ_KEY_MAP.t2v;
    }

    // 3. 基础 body
    const resolution: SeedanceResolution = options.resolution ?? '720p';
    const size = RESOLUTION_SIZE[resolution];
    const duration: SeedanceDuration = options.duration ?? 5;
    const aspectRatio = options.aspectRatio ?? '16:9';

    const body: Record<string, unknown> = {
      req_key: reqKey,
      prompt: options.prompt,
      duration,
      resolution,
      width: size.width,
      height: size.height,
      aspect_ratio: aspectRatio,
    };

    if (options.negativePrompt) body.negative_prompt = options.negativePrompt;
    if (options.seed !== undefined) body.seed = options.seed;
    if (options.cameraMotion) body.camera_motion = options.cameraMotion;
    if (options.nativeAudio) body.native_audio = true;

    if (options.referenceImages && options.referenceImages.length > 0) {
      body.image_urls = options.referenceImages;
      // 兼容老字段：首张作为 first-frame
      body.first_frame_image = options.referenceImages[0];
    }
    if (options.referenceVideos && options.referenceVideos.length > 0) {
      body.reference_video_urls = options.referenceVideos;
    }
    if (options.referenceAudios && options.referenceAudios.length > 0) {
      body.reference_audio_urls = options.referenceAudios;
    }

    if (options.editMode) {
      body.edit_mode = options.editMode.type;
      body.source_video_url = options.editMode.sourceVideo;
      if (options.editMode.target) body.edit_target = options.editMode.target;
    }

    // 4. raw 覆盖
    if (options.raw) Object.assign(body, options.raw);

    return { reqKey, body };
  }

  // ──────────────────────────────────────────────
  // 提交任务
  // ──────────────────────────────────────────────

  async submitTask(options: SeedanceGenerateOptions): Promise<SeedanceSubmitResult> {
    this.assertCredentials();

    const { reqKey, body } = this.buildPayload(options);
    const bodyStr = JSON.stringify(body);

    const signed = signRequest({
      method: 'POST',
      host: HOST,
      path: PATH,
      query: { Action: SUBMIT_ACTION, Version: API_VERSION },
      headers: { 'content-type': 'application/json' },
      body: bodyStr,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: this.service,
    });

    const url = `https://${HOST}${PATH}?Action=${SUBMIT_ACTION}&Version=${API_VERSION}`;
    console.log(`[Seedance] Submit ${reqKey} (resolution=${options.resolution ?? '720p'}, duration=${options.duration ?? 5}s)`);

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: HOST,
          'X-Date': signed.xDate,
          'X-Content-Sha256': signed.headers['x-content-sha256'],
          Authorization: signed.authorization,
        },
        body: bodyStr,
      },
      60_000,
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(`[Seedance] Submit HTTP ${res.status}: ${safeStringify(data)}`);
    }
    // 火山引擎统一响应结构：{ ResponseMetadata: {...}, Result: { task_id, ... } } 或 { code, message, data: {...} }
    const taskId = extractTaskId(data);
    if (!taskId) {
      throw new Error(`[Seedance] Submit: no task_id in response: ${safeStringify(data)}`);
    }

    return {
      taskId,
      reqKey,
      submittedAt: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────
  // 查询单次结果
  // ──────────────────────────────────────────────

  async queryResult(taskId: string, reqKey: string): Promise<SeedanceTaskResult> {
    this.assertCredentials();

    const body = { req_key: reqKey, task_id: taskId };
    const bodyStr = JSON.stringify(body);

    const signed = signRequest({
      method: 'POST',
      host: HOST,
      path: PATH,
      query: { Action: RESULT_ACTION, Version: API_VERSION },
      headers: { 'content-type': 'application/json' },
      body: bodyStr,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: this.service,
    });

    const url = `https://${HOST}${PATH}?Action=${RESULT_ACTION}&Version=${API_VERSION}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: HOST,
          'X-Date': signed.xDate,
          'X-Content-Sha256': signed.headers['x-content-sha256'],
          Authorization: signed.authorization,
        },
        body: bodyStr,
      },
      30_000,
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        taskId,
        status: 'failed',
        error: `HTTP ${res.status}: ${safeStringify(data)}`,
        raw: data,
      };
    }

    return parseTaskResult(taskId, data);
  }

  // ──────────────────────────────────────────────
  // 轮询
  // ──────────────────────────────────────────────

  async pollResult(
    taskId: string,
    reqKey: string,
    opts: { intervalMs?: number; maxAttempts?: number } = {},
  ): Promise<SeedanceTaskResult> {
    const intervalMs = opts.intervalMs ?? 5_000;
    const maxAttempts = opts.maxAttempts ?? 60; // 5s × 60 = 5 min

    for (let i = 0; i < maxAttempts; i++) {
      await sleep(intervalMs);
      const result = await this.queryResult(taskId, reqKey);
      console.log(`[Seedance] Poll #${i + 1}: status=${result.status}`);

      if (result.status === 'success') return result;
      if (result.status === 'failed') {
        throw new Error(`[Seedance] Task failed: ${result.error || 'unknown'}`);
      }
      // pending / running → continue
    }

    throw new Error(`[Seedance] Task timeout after ${(intervalMs * maxAttempts) / 1000}s`);
  }

  // ──────────────────────────────────────────────
  // 内部工具
  // ──────────────────────────────────────────────

  private assertCredentials(): void {
    if (!this.accessKey || !this.secretKey) {
      throw new Error(
        '[Seedance] Missing credentials: please set JIMENG_AK / JIMENG_SK in env',
      );
    }
  }
}

// ──────────────────────────────────────────────────────────
// 工具函数 —— 可独立单测
// ──────────────────────────────────────────────────────────

/** 从火山引擎响应中提取 task_id —— 兼容多种可能的字段路径 */
export function extractTaskId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, any>;
  // 1. 火山官方结构：{ Result: { task_id } } 或 { data: { task_id } }
  return (
    d?.Result?.task_id ||
    d?.Result?.TaskId ||
    d?.data?.task_id ||
    d?.data?.TaskId ||
    d?.task_id ||
    d?.TaskId ||
    undefined
  );
}

/** 把火山引擎查询结果解析成 SeedanceTaskResult */
export function parseTaskResult(taskId: string, data: unknown): SeedanceTaskResult {
  if (!data || typeof data !== 'object') {
    return { taskId, status: 'failed', error: 'empty response', raw: data };
  }
  const d = data as Record<string, any>;

  // 业务错误：ResponseMetadata.Error.Code 或 code 非 0
  const bizErr =
    d?.ResponseMetadata?.Error?.Code ||
    (typeof d?.code === 'number' && d.code !== 0 && d.code !== 10000 ? d.message : undefined);
  if (bizErr) {
    return { taskId, status: 'failed', error: String(bizErr), raw: data };
  }

  const inner = d?.Result ?? d?.data ?? d;
  const status: string = String(
    inner?.status ?? inner?.Status ?? inner?.task_status ?? 'unknown',
  ).toLowerCase();

  // 火山常见状态：in_queue / generating / done / not_found / expired
  if (status === 'done' || status === 'success' || status === 'succeeded') {
    const videoUrl =
      inner?.video_url ??
      inner?.videoUrl ??
      inner?.data?.video_url ??
      (Array.isArray(inner?.video_urls) ? inner.video_urls[0] : undefined);
    const coverUrl = inner?.cover_url ?? inner?.cover_image_url;
    const audioUrl = inner?.audio_url;
    if (!videoUrl) {
      return {
        taskId,
        status: 'failed',
        error: 'done but no video_url',
        raw: data,
      };
    }
    return { taskId, status: 'success', videoUrl, coverUrl, audioUrl, raw: data };
  }

  if (status === 'failed' || status === 'error' || status === 'not_found' || status === 'expired') {
    return {
      taskId,
      status: 'failed',
      error: inner?.message || inner?.fail_reason || status,
      raw: data,
    };
  }

  // in_queue / generating / running / pending
  if (status === 'in_queue' || status === 'pending') {
    return { taskId, status: 'pending', raw: data };
  }
  return { taskId, status: 'running', raw: data };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 500);
  } catch {
    return String(v);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// 导出常量供测试 / 上层引用
export const SEEDANCE_REQ_KEYS = REQ_KEY_MAP;
export const SEEDANCE_RESOLUTION_SIZE = RESOLUTION_SIZE;
