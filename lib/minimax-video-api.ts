/**
 * lib/minimax-video-api.ts — MiniMax 视频接口的**版本差异单点收敛**(v12.402)。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * MiniMax 把 H3 放在了 **Video Generation V2**,而 V2 与 v1 不是「换个模型名」那么简单:
 *
 *   v1:POST /v1/video_generation      扁平 { model, prompt, first_frame_image, aspect_ratio }
 *      GET  /v1/query/video_generation?task_id=…   → { status: 'Success', file_id }
 *      再 GET /v1/files/retrieve?file_id=…         → { file: { download_url } }
 *
 *   V2:POST /v2/video_generation      { model, content:[{type,role,…}], resolution, duration, ratio }
 *      GET  /v2/query/video_generation/{task_id}   → { task: { status:'succeeded', content:{ url } } }
 *      直接给 url,没有 files/retrieve 这一步。
 *
 * 请求体、轮询路径、状态字面量、取片方式**四处全不一样**。如果在 service 里写成
 * `if (isV2) {…} else {…}`,那就是这个项目反复栽跟头的那个形态:**同一语义两份实现**,
 * 改了一处忘了另一处。所以这里把「版本差异」全部收进一个模块,service 只有一条请求流、
 * 一条轮询流,差异由本模块以数据形式返回。
 *
 * ── 默认值为什么翻到 H3 ────────────────────────────────────────────────
 * `MiniMax-Hailuo-2.3` / `2.3-Fast` 已被官方降为 legacy。同一家供应商停 Music API 时
 * 是**无预告**的(410 + 2153),legacy 端点没有任何宽限承诺。所以默认走官方推荐的 H3;
 * 但账号套餐不一定开通 H3(历史上 I2V-01 就报过 2061 "your current token plan not
 * support model"),所以遇到「模型不可用」类错误时**自动回落到 legacy 并大声记日志** ——
 * 不是静默替换:静默替换会让人以为自己在用 H3,而实际不是。
 *
 * 官方字段表(2026-09-02 核):
 *   https://platform.minimax.io/docs/api-reference/video-generation-v2-create
 *   https://platform.minimax.io/docs/api-reference/video-generation-v2-query
 */

export type MinimaxApiVersion = 'v1' | 'v2';

/** V2 允许的分辨率。480P 仅 H3-Max,2K 仅 H3;768P 两者都行 —— 故默认取 768P。 */
export const V2_RESOLUTIONS = ['480P', '768P', '2K'] as const;
/** V2 允许的画幅。'adaptive' = 跟随首帧。 */
export const V2_RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
/** V2 时长上下限(秒),官方枚举 4…15。 */
export const V2_DURATION_MIN = 4;
export const V2_DURATION_MAX = 15;

/** 走 V2 的模型族。只认前缀,免得每出一个 H3 变体就要回来改一次。 */
const V2_MODEL_PREFIXES = ['MiniMax-H3', 'MiniMax-Hailuo-03', 'MiniMax-Hailuo-3'];

/** legacy 兜底模型 —— H3 不可用时回落到它(而不是直接失败)。 */
export const LEGACY_VIDEO_MODEL = 'MiniMax-Hailuo-2.3';

/** 默认模型:官方推荐路径。可用 MINIMAX_VIDEO_MODEL 覆盖。 */
export function defaultVideoModel(): string {
  return process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-H3';
}

/** 该模型该走哪版接口。 */
export function apiVersionFor(model: string): MinimaxApiVersion {
  return V2_MODEL_PREFIXES.some((p) => model.startsWith(p)) ? 'v2' : 'v1';
}

/**
 * 「这个错误是不是在说『你的套餐用不了这个模型』」。
 * 命中则由调用方回落到 legacy 模型 —— 与额度耗尽(那是 quota,另有 Fast 兜底)区分开:
 * 额度耗尽换模型没用,套餐不支持换模型才有用。
 */
export function isModelUnavailableError(message: string): boolean {
  const m = message.toLowerCase();
  if (/\b2061\b/.test(message)) return true;
  return (
    (m.includes('not support') && m.includes('model')) ||
    m.includes('model not found') ||
    m.includes('invalid model') ||
    m.includes('unknown model')
  );
}

/**
 * 该模型的创建端点。
 *
 * S2V / Fast 各有专属请求体(`subject_reference`、`reference_images` 等),不该硬塞进
 * 同一个 body builder —— 但**「模型 → 端点」这层映射必须只有一份**:
 * 哪天把 Fast 换成某个 H3 变体,写死 `/v1/video_generation` 的那处就会静默打错端点,
 * 而错的端点返回的错误长得像「模型不存在」,人会去查模型名,查不到真因。
 */
export function videoCreatePath(model: string): string {
  return apiVersionFor(model) === 'v2' ? '/v2/video_generation' : '/v1/video_generation';
}

export interface CreateInput {
  model: string;
  prompt: string;
  /** 首帧图 URL(http 或 data:image/…);无则走纯文生视频 */
  imageUrl?: string | null;
  /** 画幅,如 '9:16'。V2 有图时默认 'adaptive'(跟随首帧) */
  aspectRatio?: string;
  duration?: number;
  /** 仅 V2:'480P' | '768P' | '2K' */
  resolution?: string;
}

export interface CreateRequest {
  version: MinimaxApiVersion;
  path: string;
  body: Record<string, unknown>;
}

function clampDuration(d: number | undefined): number {
  const n = Number(d);
  if (!Number.isFinite(n)) return 6;
  return Math.min(V2_DURATION_MAX, Math.max(V2_DURATION_MIN, Math.round(n)));
}

/** 首帧图是否「真图」—— 与 service 里历史判定一致:非空、且是 http 或 data:image/。 */
export function hasRealImage(imageUrl?: string | null): boolean {
  return !!imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:image/'));
}

export function buildCreateRequest(input: CreateInput): CreateRequest {
  const version = apiVersionFor(input.model);
  const withImage = hasRealImage(input.imageUrl);

  if (version === 'v1') {
    // 历史形态,一个字节都不改 —— 这条路径在产的,不该被本次升级波及。
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      prompt_optimizer: true,
    };
    if (withImage) {
      body.first_frame_image = input.imageUrl;
    } else if (input.aspectRatio) {
      body.aspect_ratio = input.aspectRatio;
    }
    return { version, path: videoCreatePath(input.model), body };
  }

  // V2:content 是**多模态数组**,且官方要求「任何场景都必须带一条非空 text」。
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
  if (withImage) {
    content.push({ type: 'image_url', image_url: { url: input.imageUrl }, role: 'first_frame' });
  }

  const resolution = input.resolution || process.env.MINIMAX_VIDEO_RESOLUTION || '768P';
  // 有首帧时用 adaptive 跟随首帧比例(与 v1「I2V 跟首帧比例」的行为一致);
  // 纯文生视频沿用调用方给的画幅,没给则 16:9(与 v1 注释里的历史默认一致)。
  const ratio = withImage ? (input.aspectRatio || 'adaptive') : (input.aspectRatio || '16:9');

  return {
    version,
    path: videoCreatePath(input.model),
    body: {
      model: input.model,
      content,
      resolution,
      duration: clampDuration(input.duration),
      ratio,
    },
  };
}

/** 轮询路径。v1 是 query string,V2 是 path 参数 —— 这正是最容易抄错的一处。 */
export function pollPath(version: MinimaxApiVersion, taskId: string): string {
  return version === 'v2'
    ? `/v2/query/video_generation/${encodeURIComponent(taskId)}`
    : `/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
}

export type PollState = 'pending' | 'success' | 'failed';

export interface PollResult {
  state: PollState;
  /** 直接可下载的视频 URL(V2 一定给这个;v1 可能给) */
  videoUrl?: string;
  /** 仅 v1:需再走 /v1/files/retrieve 换 URL */
  fileId?: string;
  /** 失败原因 */
  error?: string;
  /** 原始状态字面量,用于日志 */
  rawStatus?: string;
}

export function parsePollResponse(version: MinimaxApiVersion, data: any): PollResult {
  if (version === 'v2') {
    const task = data?.task ?? data;
    const status = String(task?.status ?? '');
    if (status === 'succeeded') {
      const url = task?.content?.url;
      return url
        ? { state: 'success', videoUrl: url, rawStatus: status }
        : { state: 'failed', error: 'V2 报 succeeded 但 task.content.url 为空', rawStatus: status };
    }
    if (status === 'failed' || status === 'cancelled') {
      const err = task?.error;
      const detail = err ? `${err.code ?? ''} ${err.message ?? ''}`.trim() : status;
      return { state: 'failed', error: detail || status, rawStatus: status };
    }
    // queued / running
    return { state: 'pending', rawStatus: status };
  }

  // v1:历史判定原样保留(实测网关会返回 'Fail' 无 -ed,故用正则)
  const status = data?.status;
  if (status === 'Success' || status === 'success') {
    const videoUrl = data?.video_url || data?.output?.video_url || data?.result?.video_url;
    if (videoUrl) return { state: 'success', videoUrl, rawStatus: status };
    if (data?.file_id) return { state: 'success', fileId: data.file_id, rawStatus: status };
    return { state: 'failed', error: 'success 但响应里没有视频 URL 也没有 file_id', rawStatus: status };
  }
  if (/^fail(ed)?$/i.test(String(status || ''))) {
    return {
      state: 'failed',
      error: data?.error || data?.base_resp?.status_msg || 'unknown',
      rawStatus: String(status),
    };
  }
  return { state: 'pending', rawStatus: String(status ?? '') };
}
