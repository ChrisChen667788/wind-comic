# 🎙️ TTS Provider Plugin

> v3.2 P2 — 让你写 1 个 `.ts` 文件就能接入新的语音合成引擎.

设计目标和 [image-providers.md](./image-providers.md) / [video-providers.md](./video-providers.md) 完全一致 — 注册到 registry 后, orchestrator 按 priority + capability 选链.

---

## 1-minute 接入: 加个 ElevenLabs 引擎

仓库里已经有 `lib/tts-providers/example-elevenlabs.ts` 作为完整范本:

```ts
import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';

if (process.env.ENABLE_ELEVENLABS === '1' && process.env.ELEVENLABS_API_KEY) {
  registerTTSProvider({
    id: 'elevenlabs',
    name: 'ElevenLabs (multilingual v2)',
    priority: 90,
    supportsEmotion: false,
    supportsCloning: true,        // ← 卖点
    supportsStreaming: true,
    maxTextLen: 5_000,
    supportedLanguages: [],         // 空数组 = 任何语言
    available: () => !!process.env.ELEVENLABS_API_KEY,
    async generate(input: TTSGenerateInput) {
      // POST /v1/text-to-speech/{voiceId} → 返回 audio/mpeg
      // 见 example-elevenlabs.ts 完整版.
      return { audioUrl: '...', duration: 0, subtitle: [], provider: 'elevenlabs' };
    },
  });
}
```

```bash
# .env.local
ENABLE_ELEVENLABS=1
ELEVENLABS_API_KEY=xi_xxx
```

启动后 orchestrator 自动注册. 因为 priority 90 < minimax-tts 的 100, ElevenLabs 会优先被选.

---

## API contract

### `TTSProvider`

```ts
interface TTSProvider {
  id: string;
  name: string;
  priority: number;

  // ─── Capability flags ─────────────────────────
  supportsEmotion: boolean;       // Minimax / OpenAI tts 支持
  supportsCloning: boolean;       // ElevenLabs / Coqui XTTS
  supportsStreaming: boolean;
  maxTextLen: number;             // request 超过会被 filter
  supportedLanguages: string[];   // 空数组 = "任何语言"

  available: () => boolean;       // 同步, 不要 I/O
  generate: (input: TTSGenerateInput) => Promise<TTSGenerateResult>;
}
```

### `TTSGenerateInput`

```ts
interface TTSGenerateInput {
  text: string;                          // 必填
  voiceId: string;                       // 必填, provider 自行映射
  speed?: number;                        // 倍率 (默认 1.0)
  volume?: number;
  pitch?: number;                        // 半音
  emotion?: string;                      // happy / sad / angry / serious
  language?: string;                     // zh-CN / en-US / etc
  character?: string;                    // 写进 subtitle.character
  label?: string;
}
```

### `TTSGenerateResult`

```ts
interface TTSGenerateResult {
  audioUrl: string;                      // 必须 http(s) 或 data:audio/*
  duration: number;                      // 秒
  subtitle: SubtitleEntry[];             // 调用方拼字幕用
  provider: string;
  upstreamId?: string;
  estCostCny?: number;
}
```

---

## 调度规则

```
1. 过滤 available() === true
2. 过滤 capability:
   - requiresEmotion   → supportsEmotion
   - requiresCloning   → supportsCloning
   - requiresStreaming → supportsStreaming
3. 过滤 maxTextLen >= request.textLen
4. 过滤 supportedLanguages 包含 request.language (空数组放行)
5. 过滤 exclude 集合
6. 按 priority 升序
7. prefer 命中则顶到链头
```

`dispatchTTSGenerate(input)` 顺序执行选出的链, 第一个 result.audioUrl 合法的就返回. 全部失败 → `result: null` + `tried` 数组.

---

## 内置 provider

| id            | priority | emotion | cloning | streaming | maxTextLen | 语言 | 说明 |
|---------------|---------:|:-------:|:-------:|:---------:|-----------:|------|------|
| `minimax-tts` | 100      | ✓       | ✗       | ✗         | 5000       | zh / en | T2A-v2 speech-2.8-hd, 4 default voice + emotion |

> 单内置就够. 其他引擎走 example-* 范本接入, 见 [example-elevenlabs.ts](../lib/tts-providers/example-elevenlabs.ts).

---

## 自动发现目录

```bash
TTS_PROVIDERS_DIR=/Users/me/my-tts-plugins
```

orchestrator 启动时扫一遍, 把 .ts/.mjs/.js/.cjs 文件 dynamic import. 文件里自调 `registerTTSProvider(...)` 即可.

---

## 故障排查

| 现象                                          | 可能原因 |
|---------------------------------------------|----------|
| 你的 provider 一直没被选                      | `available()` 同步返回 false / capability flag 不匹配 |
| `tried` 里看到 "invalid audioUrl"              | 返回的 url 不是 http/data:audio 开头 |
| ElevenLabs voiceId 找不到                     | voiceId 是 ElevenLabs voice catalog 的 id, 不是 "narrator_male_cn"; 调用方应该做 voice mapping |
| 语言被 filter                                 | provider 的 `supportedLanguages` 列表里没有 request language; 想接受所有语言留空数组 |

---

## 测试

```bash
npx vitest run tests/v3-2-tts-provider-registry.test.ts
```

17 个 unit 覆盖 register / 5 个 capability filter / 4 种 fallback 路径.
