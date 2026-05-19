/**
 * v3.2 P1 — Image Provider plugin interface.
 *
 * 目的:
 *   - 让二次开发者写 1 个文件 + 1 个 env 变量就能接入新 image API
 *     (Replicate / Stability / Recraft / OpenAI gpt-image / SDXL Turbo 等)
 *   - 不破坏现有 MJ / Minimax / Flux / ComfyUI 多引擎竞速链路
 *
 * 现有架构:
 *   orchestrator.generateImage() → switch over hard-coded ImageEngine types
 *     mj | minimax-multi | minimax-single | kontext
 *
 * 新架构 (本文件):
 *   - 上面那个 switch 走"内置 provider"
 *   - 任何额外 provider 走 ProviderRegistry — 加进去就自动加入 fallback chain
 *
 * 用法 (写一个 Replicate 适配器):
 *
 *   // services/image-providers/replicate.ts
 *   import { registerImageProvider } from '@/lib/image-providers/registry';
 *
 *   registerImageProvider({
 *     id: 'replicate-sdxl',
 *     name: 'Replicate SDXL',
 *     supportsRefs: true,
 *     maxRefImages: 4,
 *     priority: 50,    // 数字越小越优先, 内置默认 100
 *     available: () => !!process.env.REPLICATE_API_TOKEN,
 *     async generate(input) {
 *       const r = await fetch('https://api.replicate.com/v1/predictions', {
 *         method: 'POST',
 *         headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`, ... },
 *         body: JSON.stringify({ version: 'sdxl-...', input: { prompt: input.prompt, ... } }),
 *       });
 *       const data = await r.json();
 *       return { imageUrl: data.output[0], provider: 'replicate-sdxl' };
 *     },
 *   });
 *
 *   // 然后在某处 (例如 app/api/create-stream/route.ts 顶部) import 'services/image-providers/replicate'
 *   // 注册副作用就把它接入了整个 pipeline.
 */

export type AspectRatio = '16:9' | '9:16' | '1:1' | '2.35:1' | '4:3' | '3:4';

export interface ImageGenerateInput {
  /** 主 prompt — 已经过 sanitize + neg prompts (由 orchestrator 处理) */
  prompt: string;
  /** 画幅 — provider 自行映射到该家的 size 参数 */
  aspectRatio?: AspectRatio;
  /** 参考图 URL 列表 — provider 按自己上限截取. 全部 http(s). */
  referenceImages?: string[];
  /** Cameo / 主角脸参考 (MJ 的 --cref 语义). provider 不区分时合到 referenceImages. */
  cref?: string;
  /** 风格参考 (MJ 的 --sref 语义). 同上. */
  sref?: string;
  /** Cameo weight (MJ 0-125). 非 MJ provider 可忽略. */
  cw?: number;
  /** UI label, 仅日志用 */
  label?: string;
  /** 进度回调 (可选 — 长任务) */
  onProgress?: (pct: number, msg: string) => void;
}

export interface ImageGenerateResult {
  /** 输出图 URL — 必须 http(s) 或者持久化后的 data URI (data: 会被下游过滤) */
  imageUrl: string;
  /** 实际使用的 provider id (审计 + 日志) */
  provider: string;
  /** 可选: provider 端的 task/request id 给追踪用 */
  upstreamId?: string;
  /** 可选: 上游服务的 cost (¥), 用于 cost_log */
  estCostCny?: number;
}

export interface ImageProvider {
  /** 唯一 id (例 'replicate-sdxl'). 跨 provider 不可重复. */
  id: string;
  /** 人类可读名 (banner / log) */
  name: string;
  /** 是否支持参考图 (含 cref/sref/referenceImages) */
  supportsRefs: boolean;
  /** 最多吃几张参考图 — provider 超过自己截取 */
  maxRefImages: number;
  /**
   * 优先级 — 数字越小越优先. 内置默认 100. 自定义 provider 想抢首位就设 50.
   * 在 ref 数量适配的前提下, 注册表按 priority 排序.
   */
  priority: number;
  /**
   * 是否当前可用 — 通常检查 env key. 在 register 时立刻调一次, 决定是否进 chain.
   */
  available: () => boolean;
  /**
   * 主调用. 失败抛 Error (调用方会在 chain 里 fallback). 不要返 null/空字符串.
   */
  generate: (input: ImageGenerateInput) => Promise<ImageGenerateResult>;
}

/**
 * 选 provider 的输入. 由 orchestrator 在调度时构造.
 */
export interface SelectInput {
  /** 用户实际有几张 ref image 要传 */
  refCount: number;
  /** 偏好首选某个 provider id (orchestrator 已有路由策略时填). 不填走自动. */
  prefer?: string;
  /** 排除某些 provider (例如某次调用刚崩过的). */
  exclude?: Set<string>;
}
