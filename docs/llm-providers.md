# 接入你自己的 LLM API · Bring Your Own LLM

> 本项目所有 LLM 文本调用 (Director / Writer / Storyboard planner / Vision audit / 等) 都走 **OpenAI 兼容 chat completions API**. 换 provider 只改 `.env`, **0 代码改动**.
>
> *All LLM text calls in this project go through an OpenAI-compatible `chat/completions` API. Swap providers by editing `.env` only — zero code change.*

---

## TL;DR — 1 分钟换 provider

```bash
# 在项目根的 .env (或 .env.local) 改这 3 行:
OPENAI_API_KEY=<your-key>
OPENAI_BASE_URL=<endpoint, 例: https://api.openai.com/v1>
OPENAI_MODEL=<model-name>

# 可选: 创意写作走第 2 个 model (温度更高)
OPENAI_CREATIVE_MODEL=<a different model id, default = OPENAI_MODEL>

# 可选: 单次最大 token (默认 8192). 紧 quota 时可降.
OPENAI_MAX_TOKENS=8192
```

重启 dev: `npm run dev`. **不需要重新 build, 不需要改任何 .ts 文件**.

---

## 兼容性矩阵 · Compatibility Matrix

下面是经过测试 / 文档承诺的 OpenAI-compatible provider. 字段名 = `OPENAI_BASE_URL`:

| Provider | `OPENAI_BASE_URL` | `OPENAI_MODEL` 示例 | 备注 |
|---|---|---|---|
| **OpenAI 官方** | `https://api.openai.com/v1` | `gpt-4o` / `gpt-5-mini` / `o3` | 全官方支持 |
| **Anthropic Claude** | 走第三方代理 (Anthropic 原生 API 不是 OpenAI-compat) | `claude-opus-4-7` (via proxy) | 推荐用 vectorengine.ai / openrouter.ai 中转 |
| **Minimax (海螺)** | `https://api.minimaxi.com/v1` | `MiniMax-M2` / `MiniMax-Text-01` | 本项目默认配置 (2026-05) |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-r1` | r1 是 reasoning 模型, callLLM 已自动剥 `<think>` 块 |
| **阿里通义 (Qwen)** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-max` / `qwen-plus` | 中文场景实测好 |
| **智谱 ChatGLM** | `https://open.bigmodel.cn/api/paas/v4/` | `glm-4` / `glm-4.5-air` | 阶跃星辰也类似 |
| **Moonshot Kimi** | `https://api.moonshot.cn/v1` | `moonshot-v1-128k` | 长上下文场景适用 |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-4` / `google/gemini-2.5-pro` / 任意 model | **强烈推荐** — 一个 key 通所有 LLM |
| **Together AI** | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | 开源模型托管 |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` / `kimi-k2` | 超快推理 (500+ tok/s) |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest` | 欧洲合规场景 |
| **本地 Ollama** | `http://localhost:11434/v1` | `llama3.3:70b` / `qwen2.5:32b` | 0 成本完全离线 |
| **vLLM / TGI / FastChat** | 你自部署的 endpoint | 自托模型名 | 私有部署 |

> **不在表里? 只要 provider 暴露 `POST /chat/completions` 接 OpenAI body schema, 大概率能跑.**
> *Not listed? Any provider that implements `POST /chat/completions` with OpenAI's body schema will likely work.*

---

## 详细配置示例

### 例 1: 改用 OpenAI gpt-4o

```bash
# .env.local
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
OPENAI_CREATIVE_MODEL=gpt-4o
```

### 例 2: 改用 DeepSeek (推理模型)

```bash
# .env.local
OPENAI_API_KEY=sk-deepseek-xxxxxxxxxxxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-chat
OPENAI_CREATIVE_MODEL=deepseek-r1   # r1 推理模型, 创意场景更强
```
`callLLM` (`services/hybrid-orchestrator.ts`) 会自动检测 reasoning 模型 (`isReasoningModelName` 命中 r1) 并:
- 把超时从 300s 拉到 420s (推理块要时间)
- 剥掉输出里的 `<think>...</think>` 块, 只保留答案

### 例 3: OpenRouter 一站通

```bash
# .env.local
OPENAI_API_KEY=sk-or-v1-xxxxxxxxxxxx
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=anthropic/claude-opus-4
OPENAI_CREATIVE_MODEL=anthropic/claude-opus-4
```

OpenRouter 优势:
- 1 个 key 调所有主流 LLM (Claude / GPT / Gemini / Llama / DeepSeek / Mistral 等)
- 自动 failover (一家挂另一家顶)
- 按量计费, 不预付

### 例 4: 完全本地 (Ollama)

```bash
# 1. brew install ollama && ollama pull qwen2.5:32b
# 2. ollama serve   # 默认 :11434

# .env.local
OPENAI_API_KEY=ollama       # ollama 不校验 key, 但 sdk 要求非空
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=qwen2.5:32b
OPENAI_MAX_TOKENS=4096      # 本地模型 context 通常小, 降一下省 RAM
```

完全离线 + 0 API 费. 显存需求: 70B 模型 ~ 40GB, 32B ~ 20GB, 7B ~ 6GB.

---

## 架构: LLM 调用怎么走的?

整片唯一的 LLM 调用入口在:

- **`services/hybrid-orchestrator.ts` → `private async callLLM(...)`** (line ~600)
- 它 spawn 一个子进程 **`scripts/llm-call.mjs`** 跑实际 fetch (绕开 Next.js Turbopack 的 fetch 阻塞 bug)
- 子进程读 stdin JSON → 发请求到 `${OPENAI_BASE_URL}/chat/completions` → 写 stdout JSON

```
┌────────────────────────┐     stdin JSON      ┌─────────────────────┐
│ callLLM(systemPrompt,  │ ─────────────────▶  │ scripts/llm-call.mjs│
│         userMessage)   │                     │                     │
│  hybrid-orchestrator   │                     │  fetch(BASE/v1/chat │
│                        │ ◀───────────────── │        /completions)│
└────────────────────────┘   stdout JSON       └─────────────────────┘
                                                         │
                                                         ▼
                                              ${OPENAI_BASE_URL}
```

**整片 LLM 调用都走 callLLM** — 包括:
- Director 拆故事大纲 / 角色 / 风格
- Writer 写剧本 (Pass 1 + Pass 2)
- Storyboard planner 排镜头语言
- Vision audit (cameo-retry, style-audit, character-DNA — 这些用 OpenAI sdk 直调因为要传 image_url)
- Editor 评分 / 反馈
- Idea normalizer / Director review

所以**改 `OPENAI_BASE_URL` 等于换整片所有 LLM 文本生成**.

---

## 哪些 API 不走 LLM `OPENAI_*` 配置?

下表是 **provider-specific** 的 API, 用 `.env` 里独立的 key. 这些**不能**通过改 OpenAI base url 切换:

| 功能 | 默认 provider | 环境变量 | 可替换? |
|---|---|---|---|
| 图像生成 (角色/场景/分镜) | Midjourney via vectorengine + Minimax image-01 fallback | `MINIMAX_API_KEY` / `OPENAI_API_KEY` (MJ via openai-compat) | 走自己的 service file, 见下 |
| 视频生成 (T2V/I2V) | Minimax Hailuo-2.3 + Veo + Kling 多链路 | `MINIMAX_API_KEY` / `VEO_API_KEY` / `KELING_API_KEY` | 同上 |
| TTS (语音) | Minimax speech-2.8-hd | `MINIMAX_API_KEY` | 同上 |
| 音乐 BGM | Minimax music-2.6 | `MINIMAX_API_KEY` | 同上 |
| Lipsync | Kling / Sync.so / Hailuo lipsync (auto-select) | `KELING_API_KEY` / `SYNCSO_API_KEY` / `HAILUO_API_KEY` | 见下面 §"替换 image/video/TTS provider" |

### 替换 image/video/TTS provider

如果想换图像 / 视频 / TTS provider (例如换成 ComfyUI / Replicate / Stable Video Diffusion), 需要:
1. 在 `services/` 下创建新 service file (复用现有 pattern, 例如 `services/replicate.service.ts`)
2. 实现 `generateImage(prompt, opts)` / `generateVideo(...)` / `generateSpeech(...)` 等公开方法
3. 在 `services/hybrid-orchestrator.ts` 的 `generateImage` 智能路由里加一档 fallback 链
4. 加对应 env var 到 `lib/config.ts`

**这一块当前是 hard-wired 的多服务竞速 (race + fallback) 模式, 不能纯 env 切换**.
**v3.2 计划**: 把 image/video provider 也抽成 plugin 接口, 配置文件驱动. 见 ROADMAP §5.

---

## 故障排查

### ❌ `Module not found: Can't resolve 'fs'`
你在 client component 里 import 了 server-only 模块. 跟 LLM provider 无关.

### ❌ `insufficient_quota` / 余额耗尽 / `2061: token plan not support`
- `insufficient_quota` → 充值 / 换 key
- `2061` (Minimax) → 该模型在你的 plan 上 EOL, 改 `OPENAI_MODEL` 到你能用的 (例如 `MiniMax-Text-01`)
- dashboard 顶部会自动弹 API 配额告警 banner (v2.17 P0)

### ❌ `Request timeout` (300s+)
- 推理模型默认放宽到 420s (`isReasoningModelName` 命中)
- 仍超时 → 设 `OPENAI_MAX_TOKENS=4096` 让响应更短

### ❌ "JSON parse failed" — Director / Writer 输出乱
- 你的模型不严格遵守 JSON output. 我们有 4-tier 兜底 (`lib/robust-json-parse.ts`), 仍失败说明模型确实弱 (例如 7B 以下).
- 建议: 至少用 24B 参数 + 在 system prompt 里强调 "respond JSON only"

### ❌ Vision API failing
- 项目里 vision 调用 (`lib/cameo-vision.ts`, `lib/style-audit.ts`, `lib/character-dna.ts`) 用 OpenAI sdk 直发, 走的也是 `OPENAI_BASE_URL`
- 你的 provider 必须支持 `image_url` 输入 (大多数 modern provider 都支持)
- 不支持的 provider: vision 调用静默 fail, character DNA / style audit / cameo retry 跳过 (不阻塞主流程)

---

## 你的 LLM provider 要满足这些
- `POST {BASE_URL}/chat/completions` 接受标准 body: `{ model, messages, max_tokens, temperature, response_format? }`
- `messages[].content` 接受 string OR array of `{type, text}|{type, image_url}` (后者给 vision)
- `response_format: { type: 'json_object' }` 支持 (强 JSON 输出, 不支持的 provider 我们有 robustJsonParse 兜底)
- bearer token 鉴权 (`Authorization: Bearer {OPENAI_API_KEY}`)

**满足以上 4 条 = 大概率能跑**. 不满足 vision 那条, 跑文本 OK, 但 cameo-retry / style-audit 等高级功能会 skip.

---

## 二次开发: 为什么不直接抽 LLM provider interface?

当前架构 `callLLM` 直接走 OpenAI-compat fetch, 没有 `LLMProvider` interface. 原因:

1. **绝大多数主流 LLM provider 现在都暴露 OpenAI-compat endpoint** — 抽一层 interface 反而是多余的 indirection
2. 编辑 `.env` 比改 plugin loader + register 简单
3. 真要换协议不一样的 provider (例如 Anthropic 原生 messages API), 用第三方代理 (OpenRouter / Vectorengine) 比写自己的 adapter 省心

但 **image/video provider 不是这种情况** — 各家 API 千差万别 (MJ 用 `--cref --sref` 自定义语法, Minimax 用 `subject_reference[]`, Vidu 用 multi-frame conditioning, Kling 用 `image_tail`). 这块需要 plugin 接口, **v3.2 P1 已经在 ROADMAP**.

---

*如果你照本文配好了 provider 但还有问题, 把 dev.log 里 `[LLM:llm-xxx]` 开头的日志贴到 issue (脱敏 key) 我们看一下.*

*If you've configured the provider per this doc but still hit issues, paste the `[LLM:llm-xxx]` lines from dev.log into an issue (redact your key) and we'll take a look.*
