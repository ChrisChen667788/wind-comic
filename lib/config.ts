// API 配置
export const API_CONFIG = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    // v6.8: 通用 LLM (高频: 规划/校验/质检) —— Claude Sonnet 4.6 via 主网关
    // v10.6.3 模型雷达:模型 ID 一律 getter 读 env —— 扫描采用后免重启生效
    get model() { return process.env.OPENAI_MODEL || 'claude-sonnet-4-6'; },
    // v12.61.0 P0-2:同网关备用模型(主模型 429/503 时先切同网关这些健康模型,再落慢 MiniMax)。
    // 逗号分隔,如 OPENAI_ALT_MODELS=claude-sonnet-4-20250514,claude-sonnet-4-6。缺省空。
    get altModels(): string[] { return (process.env.OPENAI_ALT_MODELS || '').split(',').map(s => s.trim()).filter(Boolean); },
    // v7.0: 编剧/导演 创意主 LLM —— 默认 DeepSeek 最强 deepseek-v4-pro (独立 endpoint, 推理模型/质量优先)
    get creativeModel() { return process.env.OPENAI_CREATIVE_MODEL || 'deepseek-v4-pro'; },
    // v7.1: 创意"快档" LLM —— deepseek-v4-flash, 同属 DeepSeek v4 最新一族, 推理 token 远少于 pro
    //   用于"快草稿对比 / 润色basic"这类需要秒级响应的轻量环节 (pro 单次 35-75s 体验太差)。
    //   pro 仍用于主管线 runWriter / 导演 / 润色pro 等质量优先环节。
    get creativeFastModel() { return process.env.OPENAI_CREATIVE_FAST_MODEL || 'deepseek-v4-flash'; },
    creativeBaseURL: process.env.CREATIVE_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    creativeApiKey: process.env.CREATIVE_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '',
    // v7.0: 全局 LLM 兜底 —— 任何主 LLM 异常/欠费 → 路由到 MiniMax (OpenAI 兼容)
    fallbackBaseURL: process.env.LLM_FALLBACK_BASE_URL || 'https://api.minimaxi.com/v1',
    fallbackApiKey: process.env.LLM_FALLBACK_API_KEY || process.env.MINIMAX_API_KEY || '',
    // v12.94.0 OpenRouter 档(70+ provider 自动健康路由;配 key 即启用)
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openrouterBaseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    get openrouterModel() { return process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4'; },
    get fallbackModel() { return process.env.LLM_FALLBACK_MODEL || 'MiniMax-M2.7'; },
    pricing: {
      input: 2.5,  // $/1M tokens
      output: 10   // $/1M tokens
    }
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
    // v6.8: 默认升到最强 Veo 3.1 Pro; unified 通道 (qingyuntop /v1/video/create)
    get model() { return process.env.VEO_MODEL || 'veo3.1-pro'; },
    format: process.env.VEO_API_FORMAT || 'unified', // 'unified' | 'openai'
    get fallbackModels() {
      return (process.env.VEO_FALLBACK_MODELS || 'veo3.1') /* sora-2 退役:API 2026-09-24 停服 */
        .split(',').map(s => s.trim()).filter(Boolean);
    },
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
    get model() { return process.env.XVERSE_MODEL || 'xverse/XVERSE-Ent-A5.7B'; },
    /** 快速模型——A4.2B 适合规划、校验、补丁等高频小任务，速度更快 */
    get fastModel() { return process.env.XVERSE_FAST_MODEL || 'xverse/XVERSE-Ent-A4.2B'; },
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
