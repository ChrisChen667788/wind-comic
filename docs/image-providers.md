# 接你自己的 image / video provider · Bring Your Own Image Provider

> v3.2 P1 (本仓库 main 分支已落地). 加一个新 image API = 写 1 个文件 + 1 个 env 变量, **不改 orchestrator**.
>
> *v3.2 P1: Add a new image API = 1 file + 1 env var. No orchestrator changes.*

跟 [`llm-providers.md`](llm-providers.md) 的关系: LLM 切换走 OpenAI-compat endpoint, 改 env 即可; image/video 不一样, 每家 API 形态都不同 (MJ 的 `--cref/--sref`, Minimax 的 `subject_reference[]`, Vidu 的 multi-frame, Kling 的 `image_tail`, Replicate 的 `version+input.prompt`, Replicate 的 webhook 异步, ComfyUI 的 workflow JSON ...). 所以需要一个轻量 plugin 接口.

---

## 1 分钟接入新 provider

```ts
// services/image-providers/my-replicate.ts  (任意路径都行, 只要被 import)
import { registerImageProvider } from '@/lib/image-providers/registry';

if (process.env.MY_REPLICATE_KEY) {
  registerImageProvider({
    id: 'my-replicate',
    name: 'My Replicate Endpoint',
    supportsRefs: true,
    maxRefImages: 4,
    priority: 50,                   // 数字小 = 高优先级. 内置 mj=100 / minimax-multi=90 / kontext=110
    available: () => !!process.env.MY_REPLICATE_KEY,
    async generate({ prompt, aspectRatio, referenceImages, cref, sref }) {
      const r = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          Authorization: `Token ${process.env.MY_REPLICATE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'YOUR_MODEL_HASH',
          input: {
            prompt,
            width: aspectRatio === '9:16' ? 768 : 1024,
            height: aspectRatio === '9:16' ? 1024 : 768,
            // Replicate 支持 image_ref 字段时合并
            reference_images: [...(referenceImages || []), cref, sref].filter(Boolean).slice(0, 4),
          },
        }),
      });
      if (!r.ok) throw new Error(`replicate ${r.status}`);
      const data = await r.json();
      // (省略 poll — 见 lib/image-providers/example-replicate.ts)
      return { imageUrl: data.output[0], provider: 'my-replicate' };
    },
  });
}
```

然后在任意被 server 端 import 的位置加一行 `import 'services/image-providers/my-replicate'` (推荐 `app/api/create-stream/route.ts` 顶上). 注册副作用就把它加进 chain 了.

设环境变量:
```
MY_REPLICATE_KEY=r8_xxxxxxxxxxxx
```

重启 dev → 注册表自动接入 → orchestrator 调度 image 时把它放进 fallback chain.

---

## API contract (`lib/image-providers/types.ts`)

每个 provider 必须实现:

```ts
interface ImageProvider {
  id: string;                       // 唯一短 id (用于 prefer / exclude / 日志)
  name: string;                     // 人类可读
  supportsRefs: boolean;            // 能不能吃 reference images
  maxRefImages: number;             // 上限 (chain 选时排他超限的)
  priority: number;                 // 0..999, 越小越优先. 内置 50-120 区间
  available: () => boolean;         // 立即调一次决定要不要进 chain
  generate: (input) => Promise<ImageGenerateResult>;
}

interface ImageGenerateInput {
  prompt: string;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '2.35:1' | '4:3' | '3:4';
  referenceImages?: string[];       // http(s) URL 数组
  cref?: string;                    // 主角脸参考 (MJ 语义), provider 不区分时合到 referenceImages
  sref?: string;                    // 风格参考 (MJ 语义), 同上
  cw?: number;                      // Cameo weight 0-125 (MJ); 非 MJ 可忽略
  label?: string;                   // 日志用
}

interface ImageGenerateResult {
  imageUrl: string;                 // 必须 http(s) 或 data:; 别返空字符串 / mock svg
  provider: string;                 // 实际 provider id (审计)
  upstreamId?: string;              // task/request id (可选)
  estCostCny?: number;              // 估算成本 ¥ (cost_log 用, 可选)
}
```

返 `Promise.reject(new Error(...))` 表示该 provider 失败, dispatch 会自动 fallback 到 chain 里下一个.

---

## 调度规则

`selectProviders(input)` 给一个调用场景排出 chain. 顺序:

1. `available()` 返 false 的全踢
2. `refCount > maxRefImages` 的全踢 (你 4 张 ref, MJ maxRef=2 → 跳过 MJ)
3. `exclude` set 里的踢 (调用方刚某 provider 崩了时用)
4. 剩下按 `priority` 升序
5. 如果指定了 `prefer`, 命中那个提到第一位

`dispatchImageGenerate(input, selection)` 用上面 chain 顺序 try; 第 1 个返合法 imageUrl 的赢. 全炸返 `{ result: null, tried: [...errors] }`.

---

## 内置 providers (`lib/image-providers/builtins.ts`)

| id | name | refs | priority | env requirement |
|---|---|---|---|---|
| `mj` | Midjourney via gateway | yes (2) | 100 | `OPENAI_API_KEY` (vectorengine) or `QINGYUNTOP_API_KEY` |
| `minimax-multi` | Minimax image-01 (multi-ref) | yes (4) | 90 | `MINIMAX_API_KEY` |
| `minimax-single` | Minimax image-01 (text-to-image) | no | 120 | `MINIMAX_API_KEY` |
| `kontext` | flux.1-kontext-pro | yes (4) | 110 | `OPENAI_API_KEY` or `QINGYUNTOP_API_KEY` |

想让你的 provider 抢首位 — 设 priority < 90.

想让 v3.2 plugin 全替代内置 — 不要 import `lib/image-providers/builtins.ts`, 或在 chain start 之前 `clearImageProviders()`.

---

## Auto-discover 目录 (可选)

如果你想"放进某文件夹就自动注册":

```ts
import { autoDiscoverProviders } from '@/lib/image-providers/registry';

// 例如 server 启动入口:
await autoDiscoverProviders('./custom-providers/');
```

`./custom-providers/` 下任何 `.mjs` / `.js` / `.cjs` 都会被 dynamic import — 触发其中的 `registerImageProvider()` 副作用.

注意:
- 仅 server 端有效 (typeof window !== 'undefined' 时 no-op)
- 没做沙箱, 加载的代码 = 完整 Node 权限. 别从不可信来源拉

---

## 故障排查

### ❌ Plugin 没生效 / 列表里找不到
- 确认 import 真发生了 (orchestrator 启动日志有 `[ImageProviders] registered <id>`)
- `available()` 返了 false? 检查 env key 是否真的设了
- maxRefImages 是不是被实际请求的 refCount 超过 → 那次调用就不会选你这个

### ❌ 注册了但内置仍然抢
- 你的 priority 数字 > 内置. 设 50 比 mj 的 100 优先
- 或者 input.prefer 不是你, 但内置数字本身就小

### ❌ generate() 一直返同一张图
- 你内部缓存了响应没改 — 注意每次 generate 都应当生成新的

### ❌ "all engines failed" 但日志看 chain 里其实没你
- 内置 image-router (`lib/image-router.ts`) 仍在 orchestrator 主路径里跑, 你的 plugin 是它之后的 fallback
- v3.2 P2 计划把主路径也搬到 plugin chain, 那时你的 priority 数字才会真打过内置. 当前仅作 4 个内置都炸时的 last-resort

---

## v3.2 之后 (P2)

- 把 `services/hybrid-orchestrator.ts:generateImage` 主路径也搬到 plugin chain (现在内置走老 image-router, plugin 是 fallback)
- video provider 同款接口 (`lib/video-providers/types.ts` + `registry.ts`) — Minimax/Veo/Kling/Vidu 同样适配
- TTS provider plugin — 跟 LLM 一样的 BYO 力度

PR 欢迎.
