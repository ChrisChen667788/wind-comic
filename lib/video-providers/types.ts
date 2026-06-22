/**
 * v3.2 P2 — VideoProvider plugin contract.
 *
 * 设计哲学和 image-providers 一致, 但视频侧的差异更大 (T2V vs I2V vs FLF vs S2V),
 * 所以 capability flag 比 image 多.
 *
 * Provider 二开样例: `lib/video-providers/example-runway.ts`.
 * 调度规则: `lib/video-providers/registry.ts` → selectProviders / dispatchVideoGenerate.
 */

export type ProgressCallback = (pct: number, msg?: string) => void;

/** 调度时供 selectProviders 过滤用的输入特征. */
export interface VideoGenerateInput {
  /** 必填. 描述要生成什么 (中英不限, registry 不做翻译). */
  prompt: string;

  /**
   * 首帧图 URL. 给了就走 I2V (image-to-video) 模式.
   * 不给走 T2V (text-to-video). 需要 provider supportsImage2Video=true.
   */
  firstFrameUrl?: string;

  /**
   * 尾帧图 URL (Kling FLF — first/last frame fusion).
   * 给了需要 provider supportsLastFrame=true.
   */
  lastFrameUrl?: string;

  /** 视频时长, 秒. provider 内部会 clip 到自身 maxDurationSec. */
  durationSec?: number;

  /** 分辨率 hint, e.g. "1280x720" / "720x1280". provider 自行决定怎么映射. */
  resolution?: string;

  /** 横竖屏 hint. 与 resolution 二选一即可. */
  aspectRatio?: '16:9' | '9:16' | '1:1';

  /** Kling 专用: standard | professional (4K Master). */
  mode?: 'standard' | 'professional';

  /** Vidu 等用的 style hint (realistic / anime / etc). */
  style?: string;

  /**
   * Minimax S2V 多主体: 每个主要角色一个 imageUrl, 保角色一致性.
   * 需要 provider supportsSubjectReference=true.
   * v12.15.0(Phase 2.1): refImageUrls 为该主体的「多角度」附加参考图(正面之外的侧/3-4 视图),
   * 供 Kling Elements(frontal_image_url + reference_image_urls)用;不支持的引擎忽略它。
   */
  subjectReferences?: Array<{ imageUrl: string; name?: string; refImageUrls?: string[] }>;

  /** 通用参考图 (场景/风格), Veo ingredients / Seedance @Image / LTX 等 multi-reference 通道. */
  referenceImages?: string[];

  /** 调试用 label, 进调用日志方便定位. */
  label?: string;

  /**
   * v12.29.0(P1 原生音画一体):请求引擎**自带音频**(对白+音效),供后续跳过 TTS/对唇形.
   * 仅 supportsNativeAudio 的 provider honor;其余忽略(非原生引擎不受影响).
   */
  nativeAudio?: boolean;
  /**
   * v12.29.0:要被「念出来」的台词原文 —— 仅原生音频 provider 读取(拼进自身 prompt 让其发声),
   * **不进主 visualPrompt**(非原生引擎看不到 → 不会把 CJK 渲染成画面文字).
   */
  spokenDialogue?: string;

  /** 进度回调 (provider 内 poll loop 调). */
  onProgress?: ProgressCallback;
}

export interface VideoGenerateResult {
  /** 必填. 必须 http(s) 或 data: video/*. registry 校验. */
  videoUrl: string;
  /** 实际跑的 provider id, 不一定等于 selected.id (例如内部 fallback). */
  provider: string;
  /** 实际成片时长, 秒 (从上游 metadata 拿到才填). */
  durationSec?: number;
  /** 上游 taskId, 便于事后审计. */
  upstreamId?: string;
  /** 估算花费, 人民币元. provider 可不填. */
  estCostCny?: number;
}

export interface VideoProvider {
  /** 唯一 id, kebab-case, 比如 "veo" / "kling" / "minimax-s2v" / "runway-gen3". */
  id: string;
  /** 显示名, 给日志和 UI 用. */
  name: string;
  /**
   * 调度优先级. 数字小先选. Kling 50, Veo 60, Minimax 70, Vidu 80 这种.
   * prefer 会把指定 id 顶到链头, exclude 会剔除, 但 priority 决定 prefer 不命中时的顺序.
   */
  priority: number;

  // ─── Capability flags (selectProviders 根据 input 过滤用) ─────────
  /** I2V 支持. firstFrameUrl 有值时必须 true. */
  supportsImage2Video: boolean;
  /** T2V 支持. firstFrameUrl 空时必须 true. */
  supportsText2Video: boolean;
  /** Kling FLF 同款首尾帧融合. lastFrameUrl 有值时必须 true. */
  supportsLastFrame: boolean;
  /** Minimax S2V 同款多主体参考. subjectReferences.length>0 时必须 true. */
  supportsSubjectReference: boolean;
  /** 最大输出时长 (秒). request durationSec 超过会被 filter 掉. */
  maxDurationSec: number;
  /**
   * v12.29.0(P1):成片是否**自带原生音频**(对白+音效一体生成).
   * true → native 模式下该 provider 出的镜可跳 TTS,composer 取成片真音轨. 可选,默认 falsy.
   */
  supportsNativeAudio?: boolean;

  /**
   * 同步检查: provider 当前是否能跑 (env 配齐 / SDK 可加载等).
   * 注意要快, registry 选链时会同步调用, 不要做 I/O.
   */
  available: () => boolean;

  /** 真正干活. 失败 throw, registry 自动 fallback 到下一 provider. */
  generate: (input: VideoGenerateInput) => Promise<VideoGenerateResult>;
}

/** selectProviders 入参. 用于过滤+排序 provider list. */
export interface VideoSelectInput {
  /** 决定 supportsImage2Video / Text2Video 哪个被要求. */
  hasFirstFrame: boolean;
  /** 决定 supportsLastFrame 是否被要求. */
  hasLastFrame: boolean;
  /** 决定 supportsSubjectReference 是否被要求. */
  hasSubjectReference: boolean;
  /** 决定 maxDurationSec 过滤. */
  durationSec?: number;
  /** 把 id 命中的 provider 顶到链头 (priority 决定其他). */
  prefer?: string;
  /** 显式剔除. */
  exclude?: Set<string>;
}
