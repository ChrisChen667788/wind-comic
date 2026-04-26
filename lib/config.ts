// API 配置
export const API_CONFIG = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'claude-sonnet-4-20250514',
    // 编剧/导演等关键创意阶段可使用更强模型（牺牲速度换质量）
    creativeModel: process.env.OPENAI_CREATIVE_MODEL || process.env.OPENAI_MODEL || 'claude-sonnet-4-20250514',
    pricing: {
      input: 2.5,  // $/1M tokens
      output: 10   // $/1M tokens
    }
  },

  banana: {
    apiKey: process.env.BANANA_API_KEY || '',
    modelKey: process.env.BANANA_MODEL_KEY || '',
    baseURL: 'https://api.banana.dev',
    pricing: 0.0005  // $/秒
  },

  minimax: {
    apiKey: process.env.MINIMAX_API_KEY || '',
    groupId: process.env.MINIMAX_GROUP_ID || '',
    baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com',
    pricing: 0.15  // ¥/秒
  },

  vidu: {
    apiKey: process.env.VIDU_API_KEY || '',
    baseURL: process.env.VIDU_BASE_URL || 'https://api.vidu.ai',
    pricing: 0.3  // ¥/秒
  },

  keling: {
    apiKey: process.env.KELING_API_KEY || '',
    baseURL: process.env.KELING_BASE_URL || 'https://api.klingai.com',
    pricing: 0.2  // ¥/秒
  },

  // Veo / Sora 视频生成 —— 通过 qingyuntop 聚合网关
  // 文档: https://api.qingyuntop.top/about
  // 路径:
  //   unified 格式: POST /v1/video/create  → GET /v1/video/query?id=<id>
  //   openai  格式: POST /v1/videos        → GET /v1/videos/<id>
  veo: {
    apiKey: process.env.VEO_API_KEY || '',
    baseURL: process.env.VEO_BASE_URL || 'https://api.qingyuntop.top',
    model: process.env.VEO_MODEL || 'sora-2',
    format: process.env.VEO_API_FORMAT || 'openai', // 'unified' | 'openai'
    fallbackModels: (process.env.VEO_FALLBACK_MODELS || 'veo3.1-fast,veo3-fast')
      .split(',').map(s => s.trim()).filter(Boolean),
    pricing: 0.25  // ¥/秒（估算）
  },

  // qingyuntop 聚合网关（统一 Key，可被所有视频/图像服务共享）
  qingyuntop: {
    apiKey: process.env.QINGYUNTOP_API_KEY || process.env.VEO_API_KEY || '',
    baseURL: process.env.QINGYUNTOP_BASE_URL || 'https://api.qingyuntop.top',
  },

  // ── 高级一致性引擎 ──

  fal: {
    apiKey: process.env.FAL_KEY || '',
    baseURL: 'https://queue.fal.run',
    pricing: 0.04  // $/image（FLUX Kontext）
  },

  comfyui: {
    url: process.env.COMFYUI_URL || 'http://localhost:8188',
    enabled: process.env.COMFYUI_ENABLED === 'true',
    pricing: 0  // 本地运行，无额外费用
  },

  // ── XVERSE-Ent 开源 MoE 编剧模型 ──
  // GitHub:   https://github.com/xverse-ai/XVERSE-Ent
  // HF:       https://huggingface.co/xverse/XVERSE-Ent-A4.2B
  //           https://huggingface.co/xverse/XVERSE-Ent-A5.7B
  // ModelScope: https://modelscope.cn/models/xverse/XVERSE-Ent-A4.2B
  //             https://modelscope.cn/models/xverse/XVERSE-Ent-A5.7B
  //
  // 部署方式（任选）:
  //   1. vLLM:    `python -m vllm.entrypoints.openai.api_server --model xverse/XVERSE-Ent-A5.7B --trust-remote-code`
  //   2. sglang:  `python -m sglang.launch_server --model-path xverse/XVERSE-Ent-A4.2B --port 30000`
  //   3. ModelScope inference: 通过其托管推理 endpoint
  //
  // 接口要求:OpenAI 兼容 `/v1/chat/completions`，本项目通过 scripts/xverse-call.mjs 子进程调用
  xverse: {
    apiKey: process.env.XVERSE_API_KEY || '',
    baseURL: process.env.XVERSE_BASE_URL || 'http://localhost:8000/v1',
    /** 默认模型——A5.7B 适合编剧/导演等强创意环节，质量更高 */
    model: process.env.XVERSE_MODEL || 'xverse/XVERSE-Ent-A5.7B',
    /** 快速模型——A4.2B 适合规划、校验、补丁等高频小任务，速度更快 */
    fastModel: process.env.XVERSE_FAST_MODEL || 'xverse/XVERSE-Ent-A4.2B',
    /** 是否启用 XVERSE 作为编剧/导演主用 LLM（true=强制启用；false=仅在 OpenAI 缺席时降级使用） */
    enabled: process.env.XVERSE_ENABLED === 'true',
    /** 是否在 OpenAI/Claude 主链路失败时作为 fallback 使用 */
    fallback: process.env.XVERSE_FALLBACK !== 'false',
    /** 默认采样参数 */
    temperature: Number(process.env.XVERSE_TEMPERATURE || 0.85),
    topP: Number(process.env.XVERSE_TOP_P || 0.9),
    /** 单次最大输出 tokens（A5.7B 在 32K 上下文窗口内推荐 4096-8192） */
    maxTokens: Number(process.env.XVERSE_MAX_TOKENS || 6144),
    /** 子进程超时（ms） */
    timeout: Number(process.env.XVERSE_TIMEOUT || 180000),
    pricing: 0,  // 本地/私有部署，无 token 计费
  },
};
