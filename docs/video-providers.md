# 🎬 Video Provider Plugin

> v3.2 P2 — 让你写 1 个 `.ts` 文件就能接入新的视频生成引擎.

设计目标和 [image-providers.md](./image-providers.md) 完全一致, 只是这里管的是 video. 因为不同视频 API 形态差异巨大 (Veo: T2V/I2V/multi-ref, Kling: FLF, Minimax: subject-ref, Vidu: I2V-only, Runway: image_to_video, Pika: …) 我们没法纯 env 切换, 必须给个 plugin 接口.

---

## 1-minute 接入: 加个 Runway 引擎

把下面文件丢到 `lib/video-providers/example-runway.ts` (已经在仓库里, 这只是说明这文件本身长啥样):

```ts
import { registerVideoProvider } from './registry';
import type { VideoGenerateInput } from './types';

if (process.env.ENABLE_RUNWAY === '1' && process.env.RUNWAY_API_KEY) {
  registerVideoProvider({
    id: 'runway-gen3',
    name: 'Runway Gen-3 Alpha',
    priority: 65,
    supportsImage2Video: true,
    supportsText2Video: true,
    supportsLastFrame: false,
    supportsSubjectReference: false,
    maxDurationSec: 10,
    available: () => !!process.env.RUNWAY_API_KEY,
    async generate(input: VideoGenerateInput) {
      // POST /v1/image_to_video → poll task → return videoUrl
      // 见 example-runway.ts 完整版.
      return { videoUrl: '<URL from runway>', provider: 'runway-gen3' };
    },
  });
}
```

然后:

```bash
# .env.local
ENABLE_RUNWAY=1
RUNWAY_API_KEY=key_xxx
```

启动后 `orchestrator` 自动注册. 你的视频生成请求会按 priority 顺序在
`Veo (60) → Runway (65) → Kling (70) → Minimax-Video (80) → Vidu (90)` 链上跑.

---

## API contract

### `VideoProvider`

```ts
interface VideoProvider {
  id: string;                      // kebab-case 唯一标识
  name: string;                    // 显示名
  priority: number;                // 数字小先选 (Veo=60 / Kling=70 / Minimax=80 / Vidu=90)

  // ─── Capability flags ────────────────────────────────────
  supportsImage2Video: boolean;    // firstFrameUrl 非空时必需
  supportsText2Video: boolean;     // firstFrameUrl 空时必需
  supportsLastFrame: boolean;      // Kling FLF 同款首尾帧
  supportsSubjectReference: boolean; // Minimax S2V 多主体一致性
  maxDurationSec: number;          // request 超过会被 filter

  available: () => boolean;        // 同步检查, 不要做 I/O
  generate: (input: VideoGenerateInput) => Promise<VideoGenerateResult>;
}
```

### `VideoGenerateInput`

```ts
interface VideoGenerateInput {
  prompt: string;                              // 必填
  firstFrameUrl?: string;                      // 有值 = I2V
  lastFrameUrl?: string;                       // Kling FLF
  durationSec?: number;
  resolution?: string;                         // "1280x720"
  aspectRatio?: '16:9' | '9:16' | '1:1';
  mode?: 'standard' | 'professional';          // Kling
  style?: string;                              // Vidu
  subjectReferences?: { imageUrl: string; name?: string }[];   // Minimax S2V
  referenceImages?: string[];                  // 通用 (Veo, Sora)
  label?: string;
  onProgress?: (pct: number, msg?: string) => void;
}
```

### `VideoGenerateResult`

```ts
interface VideoGenerateResult {
  videoUrl: string;     // 必须 http(s):// 或 data:video/*
  provider: string;
  durationSec?: number;
  upstreamId?: string;
  estCostCny?: number;
}
```

返回的 `videoUrl` 必须以 `http` 或 `data:video` 开头. 任何其他形态都会被 registry 判失败, 跳到下一 provider.

---

## 调度规则 (selectProviders)

```
1. 过滤 available() === true
2. 过滤 capability:
   - hasFirstFrame   → supportsImage2Video
   - !hasFirstFrame  → supportsText2Video
   - hasLastFrame    → supportsLastFrame
   - hasSubjectRef   → supportsSubjectReference
3. 过滤 maxDurationSec >= request.durationSec
4. 过滤 exclude 集合
5. 按 priority 升序
6. prefer 命中则顶到链头
```

`dispatchVideoGenerate(input)` 顺序执行选出来的链, 第一个 result.videoUrl 合法的就返回. 全部失败 → `result: null` + 完整 `tried` 数组便于审计.

---

## 内置 4 个 provider

| id              | priority | I2V | T2V | FLF | S2V | maxSec | 说明 |
|-----------------|---------:|----:|----:|----:|----:|-------:|------|
| `veo`           | 60       | ✓   | ✓   | ✗   | ✗   | 10     | Veo 3.1 / Sora-2 via qingyuntop, multi-ref |
| `kling`         | 70       | ✓   | ✓   | ✓   | ✗   | 10     | Kling v1 + 首尾帧融合 + 4K Master |
| `minimax-video` | 80       | ✓   | ✓   | ✗   | ✓   | 10     | Hailuo-2.3 + S2V-01 多主体一致性 |
| `vidu`          | 90       | ✓   | ✗   | ✗   | ✗   | 8      | Vidu I2V only — 最后兜底 |

---

## 自动发现自定义目录

环境变量 `VIDEO_PROVIDERS_DIR` 指向一个目录, orchestrator 启动时扫一遍, 把每个 `.ts/.mjs/.js/.cjs` 文件 dynamic import:

```bash
# .env.local
VIDEO_PROVIDERS_DIR=/Users/me/my-video-plugins
```

文件里只需自己调 `registerVideoProvider(...)`, 我们只触发副作用. 适合公司内部魔改但不想 fork repo 的场景.

---

## 故障排查

| 现象                                                  | 可能原因                                          |
|------------------------------------------------------|---------------------------------------------------|
| 你的 provider 一直没被选                              | `available()` 同步返回 false / capability flag 不匹配请求 |
| `tried` 里看到 "invalid videoUrl"                     | `generate()` 返回的 url 不是 http/data: 开头      |
| `tried` 全是 timeout                                  | 上游 poll 太慢, 把 `TIMEOUT_MS` 调大              |
| FLF 总命中 kling 但失败                               | Kling FLF 不接受 data: URI, 先把首尾帧落盘成 http URL |

---

## 测试

```bash
npx vitest run tests/v3-2-video-provider-registry.test.ts
```

19 个 unit 全 mock provider 覆盖 register / select 的 5 个 capability filter / dispatch 的 4 种 fallback 路径.
