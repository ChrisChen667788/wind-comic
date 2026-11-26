/**
 * ModelHub(modelhub.cc)视频网关 —— Seedance 2.0 / 2.5 一把 key。
 *
 * 形态与 qyt-vidu / HappyHorse 相同:建任务 → 轮询 → 返回上游 URL。
 * 上游 URL 会过期,**这里不落盘** —— 返回值与其他引擎一样交给既有持久化步骤
 *(主管线 saveAsset → persistFirstValid → persistAsset;单镜重生 route 里的 persistAsset)。
 *
 * 接口契约(2026-11-25 真 key 实测;参数取值以 `GET /v1/models` 为准):
 *   - POST {base}/v1/videos/generations
 *       { model, prompt, ratio, resolution, duration:number, generate_audio:boolean,
 *         functionMode: 'first_last_frames' | 'omni_reference', image_file_1..N: '<https url>' }
 *     → 200 { task_id, status: 'processing', requested_model, effective_model, created }(**平铺**,无包装)
 *     → 4xx { error: { message, type: 'invalid_request_error', code: '-2000' } }
 *     参考图**必须**是 `functionMode` + `image_file_N` 平铺字段 —— `image_files` 数组会被静默忽略。
 *     first_last_frames 实测**必须正好 2 张**:image_file_1 = 首帧,image_file_2 = 尾帧(已目测确认);
 *     有首尾帧时输出尺寸跟随输入图,不跟 ratio。只有首帧时改走 omni_reference(首帧作参考图)。
 *     `image_file_N` 填 data: URI 会被 400 拒;本地图要走 multipart/form-data 的文件分片 ——
 *     所以有 data: 图时整个请求改发 multipart,纯 https 图时发 JSON。
 *   - GET  {base}/v1/videos/tasks/{id}
 *     → { task_id, status: processing|completed|failed|cancelled, progress: 0–100, creditsConsumed, result: { url }, error, created_at }
 *       (failed / cancelled 时失败原因在顶层 `error` 字符串;公开文档示例写的是 credits_consumed,线上实际是 creditsConsumed,两者都认)
 *     result.url 会过期,host 不固定(media.modelhub.cc 代理链接或上游 CDN 直链),别按域名做任何假设。
 *   - 文档早期写过 `{ code: 0, data: {...} }` 包装,这里两种都认。
 *   - 失败 / 审核拦截的任务不计费。
 *   - base:控制台现写 https://api.modelhub.cc/v1,https://modelhub.cc/v1 同样可用,默认用后者。
 *
 * ⚠️ 建任务返回 5xx 或超时 = **结果未知**(上游可能已经建好并开始计费)。
 * 这里不自动重试同一请求,报错里写明「结果未知」,由引擎链去试下一个引擎。
 *
 * 默认链序不含它:只有 VIDEO_ENGINE_ORDER 显式列出或用户显式选择才参与(见 lib/engine-order.ts)。
 */

import { classifyPollStatus, terminalPollMessage } from '@/lib/poll-policy';
import { fetchWithTimeout } from '@/lib/fetch-timeout';
import { normalizeBaseURL } from '@/lib/base-url';
import { isPlaceholder } from '@/lib/provider-health';
import type { RefVideoOutcome } from '@/lib/ref-video';

export const MODELHUB_DEFAULT_BASE = 'https://modelhub.cc';
export const MODELHUB_DEFAULT_MODEL = 'seedance-2.0';

/** `GET /v1/models` 中各视频模型 ratio 取值的交集(auto/adaptive 不是项目画幅,不列) */
export const MODELHUB_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export const MODELHUB_RESOLUTIONS = ['480p', '720p', '1080p', '2k', '4k'] as const;

export interface ModelHubGenerateOptions {
  /** 首帧图(http(s) 或 data:image);有尾帧时走 first_last_frames,否则作 omni_reference 参考图 */
  imageUrl?: string;
  /** 尾帧图(http(s) 或 data:image);仅在有首帧时生效 */
  tailImageUrl?: string;
  /** 参考图(http(s) 或 data:image),走 omni_reference;有首帧时首帧排第一张 */
  referenceImages?: string[];
  /** 分镜参考视频(http(s) 或 data:video,来自 refVideoOptsForShot),走 omni_reference 的 video_file_1。上游按参考视频时长加计费用 */
  referenceVideoUrl?: string;
  /** 参考视频用没用上,回报给进度流(与 MiniMax 同一契约) */
  onRefOutcome?: (o: RefVideoOutcome) => void;
  aspectRatio?: string;
  duration?: number;
  onProgress?: (progress: number, status: string) => void;
  /** 轮询上限秒数(默认 1800;实测 1080p 15s 出片约 20 分钟) */
  timeoutSec?: number;
  /** 轮询间隔(默认 8000ms;测试注入 0) */
  pollIntervalMs?: number;
}

type Env = Record<string, string | undefined>;

export function modelHubConfig(env: Env = process.env): { apiKey: string; baseURL: string; model: string } {
  const key = (env.MODELHUB_API_KEY || '').trim();
  return {
    apiKey: key && !isPlaceholder(key) ? key : '',
    // 文档给的 base 是 https://modelhub.cc/v1 —— 剪掉末尾版本段,调用点自己拼 /v1/...(避免 /v1/v1)
    baseURL: normalizeBaseURL((env.MODELHUB_BASE_URL || '').trim() || MODELHUB_DEFAULT_BASE, { stripApiVersion: true }),
    model: (env.MODELHUB_MODEL || '').trim() || MODELHUB_DEFAULT_MODEL,
  };
}

export function hasModelHub(env: Env = process.env): boolean {
  return !!modelHubConfig(env).apiKey && env.MODELHUB_DISABLE !== '1';
}

/** 时长取值随模型:Seedance 2.0 系 4–15s;Seedance 2.5 系 4–30s;其他 id 按 2.0 系处理。越界夹取。 */
export function clampModelHubDuration(sec: number | undefined, model: string): number {
  const m = model.toLowerCase();
  const [min, max] = m.startsWith('seedance-2.5') ? [4, 30] : [4, 15];
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * 画幅门禁:只接受上游列出的比例。**不传 ratio 时上游默认 9:16** ——
 * 横屏项目若因比例不认被省略,会静默拿到竖屏素材,所以不认的比例直接不登记这个引擎。
 */
export function modelHubAspectSupported(aspect: string | undefined): boolean {
  if (!aspect) return true;
  return (MODELHUB_RATIOS as readonly string[]).includes(aspect);
}

const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);
const isDataImage = (u: unknown): u is string => typeof u === 'string' && /^data:image\/[\w.+-]+;base64,/.test(u);
const isDataMedia = (u: unknown): u is string => typeof u === 'string' && /^data:(image|video|audio)\/[\w.+-]+;base64,/.test(u);
const isSendableVideo = (u: unknown): u is string => isHttpUrl(u) || (typeof u === 'string' && /^data:video\/[\w.+-]+;base64,/.test(u));
/**
 * 全能参考(omni_reference)单次素材上限,按模型:
 *   Seedance 2.0 系(含 fast / mini):图 9 / 视频 3 / 音频 3
 *   Seedance 2.5:图 30 / 视频 10 / 音频 10
 *   Seedance 2.5 Flash:图 10 / 视频 5 / 音频 5
 * 本适配器目前只发 1 段分镜参考视频,图按模型上限截断。
 */
export function modelHubRefLimits(model: string): { images: number; videos: number; audios: number } {
  const m = (model || '').toLowerCase();
  if (m.startsWith('seedance-2.5-flash')) return { images: 10, videos: 5, audios: 5 };
  if (m.startsWith('seedance-2.5')) return { images: 30, videos: 10, audios: 10 };
  return { images: 9, videos: 3, audios: 3 };
}
/** 本次请求能用的图:公网 http(s) 或 data:image(后者走 multipart 文件分片) */
const isSendableImage = (u: unknown): u is string => isHttpUrl(u) || isDataImage(u);

/** 响应平铺;兼容旧文档的 `{ code, data }` 包装 */
export function unwrapModelHub(j: any): any {
  if (j && typeof j === 'object' && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) return j.data;
  return j || {};
}

/** 从错误响应里取人话:`{ error: { message, code } }` 或旧式 `{ code, message }` */
export function modelHubErrorText(j: any, fallback: string): string {
  const e = j?.error;
  if (e && typeof e === 'object') return `${e.message || fallback}${e.code ? ` (code ${e.code})` : ''}`;
  if (typeof e === 'string') return e;
  return String(j?.message || j?.msg || fallback);
}

/** data:image|video|audio/...;base64 → Blob(multipart 文件分片用) */
function dataUriToBlob(uri: string): { blob: Blob; ext: string } {
  const m = uri.match(/^data:((?:image|video|audio)\/([\w.+-]+));base64,([\s\S]*)$/)!;
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2] === 'quicktime' ? 'mov' : m[2] === 'mpeg' ? 'mp3' : m[2];
  return { blob: new Blob([Buffer.from(m[3], 'base64')], { type: m[1] }), ext };
}

/**
 * 请求体 → fetch body。全是 https 图时发 JSON;含 data: 图时整体改发 multipart
 *(上游拒收 data: URI 字段,本地图只认文件分片)。
 */
export function encodeModelHubBody(body: Record<string, unknown>): { body: string | FormData; headers: Record<string, string>; multipart: boolean } {
  const hasLocal = Object.values(body).some(isDataMedia);
  if (!hasLocal) return { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, multipart: false };
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) {
    if (isDataMedia(v)) {
      const { blob, ext } = dataUriToBlob(v);
      form.append(k, blob, `${k}.${ext}`);
    } else if (v !== undefined && v !== null) {
      form.append(k, String(v));
    }
  }
  return { body: form, headers: {}, multipart: true }; // Content-Type(含 boundary)由 fetch 生成
}

/** 拼请求体(纯函数,可单测)。 */
export function buildModelHubRequest(
  prompt: string,
  options: ModelHubGenerateOptions = {},
  env: Env = process.env,
): Record<string, unknown> {
  const { model } = modelHubConfig(env);
  const body: Record<string, unknown> = {
    model,
    prompt,
    duration: clampModelHubDuration(options.duration, model),
    // 管线自己做 TTS + 混音,非原生音频镜的成片音轨会被 composer 丢弃 —— 默认不让上游生成音频。
    // 实测:即使 false 上游也会带一条音轨回来(composer 照样丢弃,不影响成片)。
    generate_audio: /^(1|true)$/i.test((env.MODELHUB_GENERATE_AUDIO || '').trim()),
  };
  if (options.aspectRatio && modelHubAspectSupported(options.aspectRatio)) body.ratio = options.aspectRatio;

  const res = (env.MODELHUB_RESOLUTION || '').trim().toLowerCase();
  body.resolution = (MODELHUB_RESOLUTIONS as readonly string[]).includes(res) ? res : '720p';

  // 公网 http(s) 图原样发;data:image 由 encodeModelHubBody 转成 multipart 文件分片;
  // 站内 serve-file 等相对地址上游拿不到,丢弃(调用方应先经 toEngineImage 转 data:)
  // first_last_frames **必须正好 2 张**(实测只给首帧 → 400「首尾帧模式必须正好 2 张图片」),
  // 所以只有首帧时走 omni_reference,首帧作 image_file_1 参考(不是严格首帧锁定)。
  // 有参考视频时一律走 omni_reference(首尾帧模式不收视频),尾帧此时不发。
  const refVideo = isSendableVideo(options.referenceVideoUrl) ? options.referenceVideoUrl : undefined;
  if (!refVideo && isSendableImage(options.imageUrl) && isSendableImage(options.tailImageUrl)) {
    body.functionMode = 'first_last_frames';
    body.image_file_1 = options.imageUrl;
    body.image_file_2 = options.tailImageUrl;
    return body;
  }
  // 全能参考:首帧(若有)排第一张,再接角色/场景/风格参考图,去重,按模型上限截断;参考视频挂 video_file_1。
  const imgs = [...new Set([options.imageUrl, ...(options.referenceImages || [])].filter(isSendableImage))].slice(0, modelHubRefLimits(model).images);
  if (imgs.length || refVideo) {
    body.functionMode = 'omni_reference';
    imgs.forEach((u, i) => { body[`image_file_${i + 1}`] = u; });
    if (refVideo) body.video_file_1 = refVideo;
  }
  return body;
}

/**
 * 成片要经 persistAsset 落盘,它有单文件上限(ASSET_MAX_REMOTE_BYTES,默认 64MB),超了就**不落盘、只剩会过期的外链**。
 * 实测 seedance-2.0-mini 1080p 15s ≈ 95MiB(1920×1088),已超默认上限;720p 为默认分辨率。
 * 高分辨率但没调大上限时启动告警(只告警不拦:是否值得多占盘由运营者决定)。
 */
export const MODELHUB_HIRES = ['1080p', '2k', '4k'] as const;
export function modelHubSizeWarning(env: Env = process.env): string | undefined {
  const res = (env.MODELHUB_RESOLUTION || '').trim().toLowerCase();
  if (!(MODELHUB_HIRES as readonly string[]).includes(res)) return undefined;
  const cap = Number(env.ASSET_MAX_REMOTE_BYTES);
  const capBytes = Number.isFinite(cap) && cap > 0 ? cap : 64 * 1024 * 1024;
  if (capBytes >= 128 * 1024 * 1024) return undefined;
  return `MODELHUB_RESOLUTION=${res}:成片可能超过 persistAsset 单文件上限 ${Math.round(capBytes / 1048576)}MB` +
    `(实测 1080p 15s ≈ 95MiB),超限时只保留会过期的外链。建议 ASSET_MAX_REMOTE_BYTES=268435456 或改用 720p。`;
}

export class ModelHubService {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(env: Env = process.env) {
    const cfg = modelHubConfig(env);
    this.apiKey = cfg.apiKey;
    this.baseURL = cfg.baseURL;
    this.model = cfg.model;
    const warn = modelHubSizeWarning(env);
    if (warn) console.warn(`[ModelHub] ${warn}`);
  }

  isAvailable(): boolean {
    return hasModelHub();
  }

  async generateVideo(prompt: string, options?: ModelHubGenerateOptions): Promise<string> {
    const report = options?.onRefOutcome;
    const wantsRef = !!options?.referenceVideoUrl;
    if (wantsRef && !isSendableVideo(options!.referenceVideoUrl)) report?.({ status: 'ignored', reason: 'ModelHub 只收公网链接或 MP4/MOV 文件作参考视频;本镜不带参考视频出片' });
    let taskId: string;
    try {
      ({ taskId } = await this.submitTask(prompt, options));
    } catch (e) {
      if (wantsRef) report?.({ status: 'ignored', reason: `ModelHub 建任务失败:${e instanceof Error ? e.message.slice(0, 120) : String(e)}` });
      throw e;
    }
    if (wantsRef && isSendableVideo(options!.referenceVideoUrl)) {
      const body = buildModelHubRequest(prompt, options);
      const sent = Object.keys(body).filter((k) => k.startsWith('image_file_')).length;
      const offered = new Set([options!.imageUrl, ...(options!.referenceImages || [])].filter(isSendableImage)).size;
      report?.({ status: 'sent', engine: 'modelhub', imagesSent: sent, imagesDropped: Math.max(0, offered - sent) });
    }
    return await this.pollResult(taskId, options);
  }

  async submitTask(prompt: string, options?: ModelHubGenerateOptions): Promise<{ taskId: string }> {
    if (!this.apiKey) throw new Error('ModelHub 未配置(需 MODELHUB_API_KEY)');
    const body = buildModelHubRequest(prompt, options);
    const enc = encodeModelHubBody(body);

    let res: Response;
    try {
      res = await fetchWithTimeout(`${this.baseURL}/v1/videos/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, ...enc.headers },
        body: enc.body,
      }, enc.multipart ? 120_000 : 60_000);
    } catch (e) {
      throw new Error(`ModelHub 建任务结果未知(网络错误/超时,上游可能已建任务,不自动重提):${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    if (res.status >= 500) {
      throw new Error(`ModelHub 建任务结果未知 (HTTP ${res.status},上游可能已建任务,不自动重提): ${text.slice(0, 200)}`);
    }
    let j: any = {};
    try { j = JSON.parse(text); } catch { throw new Error(`ModelHub 建任务返回非 JSON (HTTP ${res.status}): ${text.slice(0, 160)}`); }
    // 4xx 是确定失败(请求被拒,未建任务);旧式包装 code ≠ 0 同理
    const wrappedFail = typeof j?.code === 'number' && j.code !== 0;
    if (!res.ok || wrappedFail || j?.error) {
      throw new Error(`ModelHub 建任务失败 (HTTP ${res.status}): ${modelHubErrorText(j, text).slice(0, 200)}`);
    }
    const d = unwrapModelHub(j);
    const taskId = d.task_id;
    if (!taskId) throw new Error(`ModelHub 未返回 task_id: ${text.slice(0, 200)}`);
    console.log(`[ModelHub] task created: ${taskId} (${d.effective_model || this.model}, ${body.functionMode || 't2v'}${enc.multipart ? ', multipart' : ''})`);
    return { taskId: String(taskId) };
  }

  async pollResult(taskId: string, options?: ModelHubGenerateOptions): Promise<string> {
    const timeoutSec = options?.timeoutSec ?? 1800;
    const intervalMs = options?.pollIntervalMs ?? 8_000;
    const started = Date.now();
    const deadline = started + timeoutSec * 1000;
    let tries = 0;
    while (Date.now() < deadline || tries === 0) {
      tries++;
      if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
      let res: Response;
      try {
        res = await fetchWithTimeout(`${this.baseURL}/v1/videos/tasks/${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
      } catch {
        continue; // 查询偶发超时/断连:任务多半还在跑,继续轮
      }
      if (!res.ok) {
        if (classifyPollStatus(res.status) === 'terminal') throw new Error(terminalPollMessage('ModelHub', res.status));
        continue;
      }
      const j: any = await res.json().catch(() => ({}));
      const data = unwrapModelHub(j);
      const status = String(data.status || '').toLowerCase();
      if (status === 'completed') {
        const url = data.result?.url;
        if (!isHttpUrl(url)) throw new Error(`ModelHub 任务完成但无视频地址: ${JSON.stringify(data).slice(0, 200)}`);
        console.log(`[ModelHub] ✅ ${this.model} 出片 task=${taskId} credits=${data.creditsConsumed ?? data.credits_consumed ?? '?'}`);
        return url;
      }
      if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
        // 失败 / 审核拦截不计费;失败与取消的原因都在顶层 error(字符串)
        throw new Error(`ModelHub 任务${status === 'failed' ? '失败' : '已取消'}: ${String(data.result?.error || modelHubErrorText(data, 'unknown')).slice(0, 200)}`);
      }
      // 实测上游 progress 在出片前一直是 0 —— 为 0 时按已等时长估算,别让进度条卡死在 0
      const pct = Number(data.progress);
      const elapsed = Math.round(((Date.now() - started) / (timeoutSec * 1000)) * 90);
      options?.onProgress?.(pct > 0 ? Math.min(99, pct) : Math.min(90, Math.max(0, elapsed)), status || 'queued');
    }
    throw new Error(`ModelHub 轮询超时(${timeoutSec}s),task=${taskId} —— 上游任务可能仍会完成,勿直接重提`);
  }
}

let _svc: ModelHubService | null = null;
export function getModelHubService(): ModelHubService | null {
  if (!hasModelHub()) return null;
  if (!_svc) _svc = new ModelHubService();
  return _svc;
}
