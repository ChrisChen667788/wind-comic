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

## 引擎链(`VIDEO_ENGINE_ORDER`)里的网关引擎

上面的插件注册表之外,主管线与单镜重生还有一条按 `lib/engine-order.ts` 排序的引擎链
(默认 `veo → minimax → kling`)。新引擎**不进默认链序**:只有在 `VIDEO_ENGINE_ORDER`
显式列出或用户显式选择时才参与,配了 key 也不会改变既有用户的出片结果。

### ModelHub(modelhub.cc)

一把 key 调 Seedance 2.0 / 2.5。实现:`services/modelhub.service.ts`(建任务 → 轮询 → 返回 URL)。

```bash
# .env.local
MODELHUB_API_KEY=...
MODELHUB_MODEL=seedance-2.0          # 可选,模型 id 见 GET https://modelhub.cc/v1/models(公开)
VIDEO_ENGINE_ORDER=modelhub,kling,veo
```

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `MODELHUB_API_KEY` | — | 必填,`Authorization: Bearer <key>` |
| `MODELHUB_BASE_URL` | `https://modelhub.cc` | 末尾 `/v1` 自动剪掉;控制台写的 `https://api.modelhub.cc/v1` 同样可用 |
| `MODELHUB_MODEL` | `seedance-2.0` | 时长按模型夹取:Seedance 2.0 系 4–15s,2.5 系 4–30s |
| `MODELHUB_RESOLUTION` | `720p`(推荐) | `480p` / `720p` / `1080p` / `2k` / `4k`(以所选模型支持为准)。1080p 及以上需调大 `ASSET_MAX_REMOTE_BYTES`,见下 |
| `MODELHUB_GENERATE_AUDIO` | 关 | `1` 让上游同时生成音频(实测设 false 也会带音轨,composer 对非原生音频镜照常丢弃) |
| `MODELHUB_DISABLE` | — | `1` 停用 |

- 首帧 + 尾帧(单镜重生显式尾帧)→ `functionMode: first_last_frames` + `image_file_1`(首)/ `image_file_2`(尾)。
  上游要求首尾帧模式**正好 2 张图**,且此模式下输出尺寸跟随输入图而非 `ratio`。
- 其余情况走**全能参考** `functionMode: omni_reference`:首帧(若有)作 `image_file_1`(人物/场景保持,但不是逐像素首帧,画幅按 `ratio`),
  后面接本镜的角色 / 场景 / 风格参考图(去重);分镜参考视频(与 MiniMax H3 同一份,`refVideoOptsForShot`)作 `video_file_1`。
  有参考视频时不走首尾帧。参考视频用没用上,经 `onRefOutcome` 报到进度流。
- 全能参考素材上限按模型:Seedance 2.0 系(含 fast / mini)图 9 / 视频 3 / 音频 3;2.5 图 30 / 视频 10 / 音频 10;
  2.5 Flash 图 10 / 视频 5 / 音频 5。参考图按上限截断。**参考视频的时长会并入计费**。
  公网 https 图发 JSON;站内图(经 `toEngineImage` 转成 data:)上游**拒收 data: URI 字段**(400),
  所以这种情况整个请求改发 `multipart/form-data`,图片 / 视频作文件分片。
- 画幅:`21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16`;上游不传 ratio 默认 9:16,所以其他比例不登记该引擎。
- 上游视频链接会过期(host 不固定:有时是 `media.modelhub.cc/api/proxy/video?...`,有时直接是上游 CDN) —— 返回值与其他引擎一样走既有本地持久化
  (`persistAsset`),不把外链当持久地址。媒体 CDN 需要浏览器式 User-Agent,`persistAsset` 出站下载现在统一带
  `PERSIST_USER_AGENT`(不按域名区分,因为结果链接的 host 不固定)。
- **文件大小 / 耗时(实测,seedance-2.0-mini)**:480p 4s ≈ 0.9–1.1MB,生成约 3 分钟;**1080p 15s(1920×1088)≈ 95MiB,
  生成约 20 分钟**。后者超过 `persistAsset` 默认 64MB 单文件上限(`ASSET_MAX_REMOTE_BYTES`),超限时不落盘、只剩会过期的外链。
  默认 720p;用 1080p 及以上请设 `ASSET_MAX_REMOTE_BYTES=268435456`(服务启动时若未调大会告警)。轮询默认上限 30 分钟。
- 建任务返回 5xx / 超时视为**结果未知**(上游可能已建任务),不自动重提,直接交给下一个引擎。
  失败 / 审核拦截的任务上游不计费。

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
