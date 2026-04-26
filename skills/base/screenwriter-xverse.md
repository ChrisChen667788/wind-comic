# 编剧 Skill — XVERSE-Ent 融合

> v2.0 Sprint 0 D7+：将 **XVERSE-Ent-A4.2B / A5.7B** 接入「编剧」环节，
> 与 `lib/mckee-skill.ts`（罗伯特·麦基方法论）深度融合，提升开源链路的剧本质量。

---

## 1. 目标

| 指标 | OpenAI/Claude 主链路 | XVERSE-Ent 链路 |
|------|----------------------|------------------|
| 成本 | $/token | 0（自托管）|
| 延迟 | 30–90s | A4.2B ≈ 6–15s · A5.7B ≈ 18–40s |
| 中文叙事质量 | ★★★★★ | A5.7B ★★★★ ｜ A4.2B ★★★ |
| 离线可用 | ❌ | ✅ |

XVERSE-Ent 系列是 **MoE 架构**（A4.2B 激活 4.2B 参数 / 总 14B；A5.7B 激活 5.7B / 总 19B），
在保持小激活参数的前提下能给出接近 7B-13B 稠密模型的中文叙事能力，特别擅长
**长上下文、多角色对白、风格化场景描写**——和我们的麦基编剧 prompt 高度契合。

---

## 2. 角色分工（双模型）

| 模型 | 用途 | 推理特点 |
|------|------|----------|
| **A5.7B**（创意模型） | 编剧 Pass2 / 导演 Plan / 全量结构化 JSON | 高质量、慢一些 |
| **A4.2B**（快速模型） | 编剧 Pass1（镜头规划） / JSON 修复 / 校验补丁 | 高频小任务、几乎实时 |

实现见 `services/xverse.service.ts`：

```ts
// 编剧主流程：Two-Pass + 校验 + 修补
const { ok, script, passes } = await xverseService.writeScript({
  plan: directorPlan,
  userContext: '...',
  isAdaptation: !!parsedScript,
  characterNames: plan.characters.map(c => c.name),
  characterAppearances,
  sceneCount,
  directorTotalShots,
  onHeartbeat: (msg) => console.log(msg),
});
```

---

## 3. 与 mckee-skill 的融合点

`xverse.service.ts` 中的 `writeScript()` **直接复用** 三个核心函数：

1. `getMcKeeWriterPrompt(genre, style, options)`
   → 把麦基"期望鸿沟 / 角色弧光 / 五感场景描写 / 潜文本对白"等
     全套创作准则注入 system prompt
2. `validateWriterOutput(script)`
   → 字数/镜头数/感官细节/对白潜文本的硬性自检
3. `validateDirectorOutput(plan)`（用于 `runDirector`）

这意味着：**所有 prompt 工程一处维护**，OpenAI 与 XVERSE 共享同一套
方法论，避免出现"两套编剧风格分裂"。

---

## 4. 三段式质量护栏

每次 `writeScript()` 内部跑：

```
Pass1 (A4.2B 纯文本)            ──→ 镜头规划草稿
Pass2 (A5.7B JSON mode)         ──→ 完整 Script JSON
   ├─ JSON 解析失败 → A4.2B 修复
   ├─ shots 数 < min → A5.7B 补镜头
   └─ validateWriterOutput 不过 → A5.7B 修补字段
```

任意一步成功即返回。这种 **大模型出主稿 + 小模型打补丁** 的组合
显著优于"单次大模型一把过"，对小开源模型尤其有效。

---

## 5. 接入方式

### 5.1 部署 XVERSE-Ent

任选其一：

```bash
# vLLM（推荐生产）
python -m vllm.entrypoints.openai.api_server \
  --model xverse/XVERSE-Ent-A5.7B \
  --trust-remote-code \
  --port 8000

# sglang（推荐研发）
python -m sglang.launch_server \
  --model-path xverse/XVERSE-Ent-A4.2B \
  --port 30000

# 魔搭托管推理
# 直接使用 ModelScope inference endpoint
```

### 5.2 配置 .env

```env
XVERSE_ENABLED=true        # true=作为编剧主用 LLM；false=仅作 fallback
XVERSE_FALLBACK=true       # OpenAI/Claude 主链路失败时是否兜底
XVERSE_BASE_URL=http://localhost:8000/v1
XVERSE_API_KEY=
XVERSE_MODEL=xverse/XVERSE-Ent-A5.7B
XVERSE_FAST_MODEL=xverse/XVERSE-Ent-A4.2B
XVERSE_TEMPERATURE=0.85
XVERSE_TOP_P=0.9
XVERSE_MAX_TOKENS=6144
XVERSE_TIMEOUT=180000
```

### 5.3 编排器自动接入

`services/hybrid-orchestrator.ts > runWriter()` 会按以下优先级路由：

1. `XVERSE_ENABLED=true` → 直接走 XVerse 主链路
2. OpenAI Pass2 返回空 → 自动切换 XVerse 兜底
3. 没有 OpenAI key 但配置了 XVerse → 走 XVerse
4. 都不可用 → `fallbackScript()` 智能降级

---

## 6. 性能优化

| 优化项 | 来源 | 说明 |
|--------|------|------|
| 子进程隔离 | `scripts/xverse-call.mjs` | 复用 `llm-call.mjs` 模式，绕开 Next.js Turbopack 阻塞长 fetch 的问题 |
| `response_format=json_object` | OpenAI 兼容字段 | XVERSE vLLM/sglang 部署都支持，强制 JSON-only 输出，省掉 ``` 修剪 |
| 32K 上下文裁剪 | `MAX_USER_CHARS=24000` | 给 6K 输出留足空间，避免 OOM |
| 双模型分工 | A4.2B/A5.7B | 规划用快模型，叙事用大模型，整体延迟下降 35–50% |
| 心跳回调 | `onHeartbeat` | 每 8s 通知前端，避免长任务无反馈 |

---

## 7. 测试

参见 `tests/xverse.test.ts`：

- `hasXVerse()` / `isXVersePrimary()` 配置开关
- `safeJSONParse()` 容错（裸 JSON / 带前后缀文本 / markdown fence）
- `XVerseService.chat()` 在 baseURL 缺失时返回 ok=false
- `XVerseService.writeScript()` 走 mock-fetch 全流程

---

## 8. Roadmap

- [ ] 微调（LoRA）：用「麦基方法论自检不通过 → 修补后通过」的对样本做监督微调，
      在 A4.2B 上即可获得接近 Claude 的中文短剧本能力
- [ ] streaming：服务端 SSE 流式输出，前端实时显示编剧"打字"
- [ ] tool-calling：把 `validateWriterOutput` 暴露为函数，让 XVerse 自己调用并自检
