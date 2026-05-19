/**
 * v3.2 P2 — TTSProvider plugin contract.
 *
 * Image / Video / TTS 三件套里 TTS 的 API 形态分歧最小 (基本都是
 * text → audioUrl + duration), 但定价 / 音色 / 是否支持 emotion / 是否支持
 * voice clone 差异大. 这个 plugin 接口给二开者写 1 个文件接 ElevenLabs / OpenAI
 * TTS / Azure Cognitive / Coqui XTTS / 等等.
 */

export interface SubtitleEntry {
  start: number;
  end: number;
  text: string;
  character?: string;
}

export interface TTSGenerateInput {
  /** 必填. 要朗读的文本. */
  text: string;

  /** 必填. 由调度方按角色分配, provider 自行映射成自家 voice catalog id. */
  voiceId: string;

  /** 语速倍率 (Minimax: 0.5-2.0, ElevenLabs 用 stability 等映射). */
  speed?: number;

  /** 音量倍率. */
  volume?: number;

  /** 音调偏移 (半音). */
  pitch?: number;

  /** 情感 hint (happy / sad / angry / serious 等). 不是所有 provider 都吃. */
  emotion?: string;

  /** 语言代码 (zh-CN / en-US / etc). provider 不显式支持时忽略. */
  language?: string;

  /** 角色名 — 不影响 TTS, 但写进 subtitle.character 方便调用方拼字幕. */
  character?: string;

  /** 调试 label. */
  label?: string;
}

export interface TTSGenerateResult {
  /** 必填. 必须 http(s) 或 data:audio/*. registry 校验. */
  audioUrl: string;
  /** 实际成片时长, 秒. provider 拿不到则自己估算. */
  duration: number;
  /** 字幕条目. provider 自己切句 + 计时, 或留空让调用方处理. */
  subtitle: SubtitleEntry[];
  /** 实际跑的 provider id. */
  provider: string;
  /** 上游 taskId. */
  upstreamId?: string;
  /** 估算花费, 人民币元. */
  estCostCny?: number;
}

export interface TTSProvider {
  /** 唯一 id, kebab-case. minimax / elevenlabs / openai-tts / azure-cognitive 等. */
  id: string;
  /** 显示名. */
  name: string;
  /** 数字小先选. minimax 100, openai-tts 90, elevenlabs 80. */
  priority: number;

  // ─── Capability flags ───────────────────────────────────────────
  /** 支持 emotion 字段 (Minimax / OpenAI gpt-4o-mini-tts 支持; ElevenLabs 通过 voice 选择). */
  supportsEmotion: boolean;
  /** 支持 voice cloning (ElevenLabs / Coqui XTTS). 此 plugin 自身的 voiceId 命名空间. */
  supportsCloning: boolean;
  /** 支持流式 (chunked) 输出. 不影响 result.audioUrl, 仅 hint 给调度方. */
  supportsStreaming: boolean;
  /** 单次最长 text 字符数. 超过会被 filter 掉, 调用方应该自行切片重试. */
  maxTextLen: number;
  /** 支持的语言代码列表 (e.g. ['zh-CN', 'en-US']). 空列表代表"任何语言". */
  supportedLanguages: string[];

  /** 同步检查 — env 配齐 + SDK 可加载. 不要 I/O. */
  available: () => boolean;

  /** 真正干活. 失败 throw, registry 自动 fallback. */
  generate: (input: TTSGenerateInput) => Promise<TTSGenerateResult>;
}

/** selectProviders 入参. */
export interface TTSSelectInput {
  /** 是否要求 emotion 支持. */
  requiresEmotion?: boolean;
  /** 是否要求 cloning. */
  requiresCloning?: boolean;
  /** 是否要求 streaming. */
  requiresStreaming?: boolean;
  /** 文本长度, 用于 maxTextLen 过滤. */
  textLen?: number;
  /** 语言代码, 用于 supportedLanguages 过滤. */
  language?: string;
  /** prefer 优先 (顶到链头). */
  prefer?: string;
  /** exclude 剔除. */
  exclude?: Set<string>;
}
