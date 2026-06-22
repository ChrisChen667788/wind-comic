/**
 * 阶段二十七 P0a — xAI Grok Imagine 1.5 视频引擎适配。
 *
 * 2026-06 起 Grok Imagine 1.5 登顶 Artificial Analysis 图生视频盲投榜(压过 Veo 3.1 / Kling /
 * Seedance),特点:**原生音频 + 极速 + 低价**,公开 API 可 BYO。本服务把它接进引擎链。
 *
 * API 契约(docs.x.ai,2026-06 核实):
 *   - 起任务: POST https://api.x.ai/v1/videos/generations
 *       body: { model, prompt, image?, reference_images?[], duration(1-15), aspect_ratio, resolution }
 *       → { request_id }
 *   - 轮询:   GET  https://api.x.ai/v1/videos/{request_id}
 *       → { status: pending|done|expired|failed, video:{url,duration}, error?:{code,message} }
 *
 * Key:GROK_API_KEY(兼容 XAI_API_KEY)。无 key → hasGrokImagine()=false → 调度链跳过(零回归)。
 * 诚实说明:本环境无 key,未做真网络验证 —— 纯函数(请求体构造 / 轮询解析)有单测覆盖,
 * 调用失败由 registry 自动 fallback 到下一引擎。
 *
 * 备注:Grok 成片**自带原生音频**;当前主管线仍走「视频→TTS→对唇形」,故 P0a 只取画面 URL,
 * 原生音画一体的取用留给 P1(`docs` 路线 P1)。
 */

const GROK_ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);

function grokKey(): string {
  return process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
}

export function hasGrokImagine(): boolean {
  return !!grokKey();
}

/** 带超时 fetch —— 防止上游无响应时无限挂起。 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface GrokGenerateOptions {
  duration?: number;
  aspectRatio?: string;        // '16:9' | '9:16' | '1:1' ...
  resolution?: '720p' | '480p';
  referenceImages?: string[];  // 场景/风格参考(reference_images 通道)
  nativeAudio?: boolean;       // v12.29.0(P1):请求自带音频(对白+音效)
  onProgress?: (pct: number, msg?: string) => void;
}

/**
 * 纯函数:构造 Grok 起任务请求体。可单测,无副作用。
 * - 有 imageUrl → I2V(带 image 字段);无 → T2V。
 * - duration 夹到 [1,15];aspect_ratio 仅接受 Grok 支持的枚举,否则省略(让上游默认)。
 */
export function buildGrokRequestBody(
  imageUrl: string | undefined,
  prompt: string,
  opts: GrokGenerateOptions = {},
  model = process.env.GROK_VIDEO_MODEL || 'grok-imagine-video',
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, prompt };
  const isHttp = (u?: string) => !!u && /^https?:\/\//.test(u);
  if (isHttp(imageUrl)) body.image = imageUrl;
  const refs = (opts.referenceImages || []).filter(isHttp).slice(0, 4);
  if (refs.length) body.reference_images = refs;
  const dur = Math.max(1, Math.min(15, Math.round(opts.duration ?? 5)));
  body.duration = dur;
  if (opts.aspectRatio && GROK_ASPECTS.has(opts.aspectRatio)) body.aspect_ratio = opts.aspectRatio;
  body.resolution = opts.resolution || '720p';
  if (opts.nativeAudio) body.generate_audio = true; // v12.29.0(P1)原生音画
  return body;
}

export interface GrokPollOutcome {
  done: boolean;
  url?: string;
  durationSec?: number;
}

/**
 * 纯函数:解析 Grok 轮询响应。done→{done:true,url};失败/过期→throw;其余→{done:false}。
 */
export function parseGrokPollResponse(data: unknown): GrokPollOutcome {
  const j = (data || {}) as any;
  const status = String(j.status || '').toLowerCase();
  if (status === 'done' || status === 'succeeded' || status === 'success') {
    const url = j.video?.url || j.url || j.output?.url;
    if (!url) throw new Error('Grok: status done but no video.url');
    const d = Number(j.video?.duration);
    return { done: true, url, durationSec: Number.isFinite(d) ? d : undefined };
  }
  if (status === 'failed' || status === 'expired' || status === 'error') {
    throw new Error(`Grok video ${status}: ${j.error?.message || j.error?.code || 'unknown'}`);
  }
  return { done: false };
}

export class GrokImagineService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = grokKey();
    this.baseURL = (process.env.GROK_BASE_URL || 'https://api.x.ai').replace(/\/+$/, '');
  }

  /**
   * 生成视频(I2V / T2V)。返回成片 http(s) URL;失败 throw 让 registry fallback。
   */
  async generateVideo(imageUrl: string, prompt: string, opts: GrokGenerateOptions = {}): Promise<string> {
    if (!this.apiKey) throw new Error('Grok Imagine: GROK_API_KEY missing');

    const body = buildGrokRequestBody(imageUrl, prompt, opts);
    const startRes = await fetchWithTimeout(`${this.baseURL}/v1/videos/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!startRes.ok) {
      throw new Error(`Grok create ${startRes.status}: ${(await startRes.text()).slice(0, 200)}`);
    }
    const created = await startRes.json();
    const requestId = created.request_id || created.id || created.request?.id;
    if (!requestId) throw new Error(`Grok: no request_id in response: ${JSON.stringify(created).slice(0, 160)}`);

    // 轮询(5s 间隔,~12 分钟封顶)
    const POLL_MS = 5_000;
    const TIMEOUT_MS = 12 * 60 * 1000;
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const pollRes = await fetchWithTimeout(`${this.baseURL}/v1/videos/${encodeURIComponent(requestId)}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      }, 15_000);
      if (!pollRes.ok) continue; // 瞬时错误,继续等
      const outcome = parseGrokPollResponse(await pollRes.json());
      if (outcome.done && outcome.url) {
        opts.onProgress?.(1, 'grok: done');
        return outcome.url;
      }
      opts.onProgress?.(Math.min(0.9, (Date.now() - start) / TIMEOUT_MS), 'grok: pending');
    }
    throw new Error('Grok Imagine: poll timeout (12 min)');
  }
}
