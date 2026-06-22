/**
 * 阶段二十七 P0c — LTX-2.3(Lightricks)视频引擎适配。
 *
 * LTX-2 是首个 DiT 音画一体开源基模(2026-01 全量开源,HuggingFace 可下权重),2026-06 盲投
 * 文生视频榜次席、**开源权重最强**。对 Wind Comic 的战略意义:它是**唯一能让「连视频引擎都自托管」**
 * 的拼图 —— 平台已可自托管,补上 LTX 后整链(LLM/图/视频)都能离云。
 *
 * 接入方式(BYO,二选一,同一套代码):
 *   - 托管:LTX_API_KEY(= fal key)→ 默认打 fal 队列 `https://queue.fal.run/{model}`。
 *   - 自托管:设 LTX_BASE_URL 指向自己的 fal 兼容服务(同样的队列协议)。
 *
 * fal 队列协议(2026-06 核实):
 *   POST {base}/{model}  → { request_id, status_url, response_url }
 *   GET  {status_url}    → { status: IN_QUEUE|IN_PROGRESS|COMPLETED }
 *   GET  {response_url}  → { video: { url } }
 *
 * 无 key → hasLtx()=false → 调度链跳过(零回归)。诚实:本环境无 key 未做真网络验证 ——
 * 请求体构造 / 结果解析为纯函数有单测;调用失败由 registry 自动 fallback。
 * 成片自带原生音频(取用留给 P1)。
 */

const LTX_ALLOWED_ASPECTS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);

function ltxKey(): string {
  return process.env.LTX_API_KEY || process.env.FAL_KEY || '';
}

export function hasLtx(): boolean {
  return !!ltxKey();
}

/** I2V / T2V 走不同 fal 模型路径(可 env 覆盖)。 */
export function ltxModelFor(imageUrl?: string): string {
  const isHttp = (u?: string) => !!u && /^https?:\/\//.test(u);
  const t2v = process.env.LTX_MODEL || 'fal-ai/ltx-2.3/text-to-video';
  const i2v = process.env.LTX_MODEL_I2V || 'fal-ai/ltx-2.3/image-to-video';
  return isHttp(imageUrl) ? i2v : t2v;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface LtxGenerateOptions {
  duration?: number;
  aspectRatio?: string;
  resolution?: string;        // '1080p' | '4k' | ...(fal LTX 取值)
  nativeAudio?: boolean;      // v12.29.0(P1):请求自带音频(LTX-2 音画一体)
  onProgress?: (pct: number, msg?: string) => void;
}

/** 纯函数:构造 LTX(fal)请求体。I2V 带 image_url;duration 夹 [1,20];aspect 仅取支持枚举。 */
export function buildLtxRequestBody(
  imageUrl: string | undefined,
  prompt: string,
  opts: LtxGenerateOptions = {},
): Record<string, unknown> {
  const isHttp = (u?: string) => !!u && /^https?:\/\//.test(u);
  const body: Record<string, unknown> = { prompt, enhance_prompt: true };
  if (isHttp(imageUrl)) body.image_url = imageUrl;
  if (opts.aspectRatio && LTX_ALLOWED_ASPECTS.has(opts.aspectRatio)) body.aspect_ratio = opts.aspectRatio;
  body.resolution = opts.resolution || '1080p';
  body.duration = Math.max(1, Math.min(20, Math.round(opts.duration ?? 5)));
  if (opts.nativeAudio) body.generate_audio = true; // v12.29.0(P1)音画一体
  return body;
}

/** 纯函数:从 fal 输出里提取视频 URL;缺则 throw。 */
export function parseLtxResult(data: unknown): { url: string } {
  const j = (data || {}) as any;
  const url =
    j.video?.url ||
    j.output?.video?.url ||
    (Array.isArray(j.videos) ? j.videos[0]?.url : undefined) ||
    j.url;
  if (!url) throw new Error('LTX: result has no video url');
  return { url };
}

export class LtxService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = ltxKey();
    this.baseURL = (process.env.LTX_BASE_URL || 'https://queue.fal.run').replace(/\/+$/, '');
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Key ${this.apiKey}`, 'Content-Type': 'application/json' };
  }

  /** 生成视频(I2V / T2V)。返回成片 http(s) URL;失败 throw 让 registry fallback。 */
  async generateVideo(imageUrl: string, prompt: string, opts: LtxGenerateOptions = {}): Promise<string> {
    if (!this.apiKey) throw new Error('LTX: LTX_API_KEY / FAL_KEY missing');

    const model = ltxModelFor(imageUrl);
    const body = buildLtxRequestBody(imageUrl, prompt, opts);

    const startRes = await fetchWithTimeout(`${this.baseURL}/${model}`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!startRes.ok) {
      throw new Error(`LTX submit ${startRes.status}: ${(await startRes.text()).slice(0, 200)}`);
    }
    const created = await startRes.json();
    const requestId = created.request_id || created.requestId;
    const statusUrl = created.status_url || (requestId ? `${this.baseURL}/${model}/requests/${requestId}/status` : '');
    const responseUrl = created.response_url || (requestId ? `${this.baseURL}/${model}/requests/${requestId}` : '');
    if (!statusUrl || !responseUrl) {
      // 某些自托管同步返回直接带结果
      try { return parseLtxResult(created).url; } catch { /* fallthrough */ }
      throw new Error(`LTX: no request_id/status_url in response: ${JSON.stringify(created).slice(0, 160)}`);
    }

    const POLL_MS = 5_000;
    const TIMEOUT_MS = 12 * 60 * 1000;
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const sRes = await fetchWithTimeout(statusUrl, { headers: this.authHeaders() }, 15_000);
      if (!sRes.ok) continue;
      const s = await sRes.json();
      const status = String(s.status || '').toUpperCase();
      if (status === 'COMPLETED' || status === 'OK' || status === 'SUCCESS') {
        const rRes = await fetchWithTimeout(responseUrl, { headers: this.authHeaders() }, 20_000);
        if (!rRes.ok) throw new Error(`LTX result ${rRes.status}`);
        opts.onProgress?.(1, 'ltx: done');
        return parseLtxResult(await rRes.json()).url;
      }
      if (status === 'FAILED' || status === 'ERROR') {
        throw new Error(`LTX task ${status}: ${s.error || JSON.stringify(s).slice(0, 120)}`);
      }
      opts.onProgress?.(Math.min(0.9, (Date.now() - start) / TIMEOUT_MS), `ltx: ${status || 'pending'}`);
    }
    throw new Error('LTX: poll timeout (12 min)');
  }
}
