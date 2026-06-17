# 阶段二十三 · 引擎深化(v12.4.x – v12.7.x)

> 方向:把生成层各引擎的**兜底/选优/成本/健康**做深。
> 6 路并行 reader 实测后定基调:**引擎插件/注册架构已全量建成**(image/video/tts/lipsync 四张 typed registry + plugin-chain 三态 + telemetry + prefer/exclude)——
> 引擎深化 = **管道完整性补全 + 把已建未接的能力硬接上**,**不重建、不新增引擎**。

---

## 一、现状(6 路 reader 实测)

### 已建成(勿重复立项)
- **四阶段 provider 注册表**:`lib/{image,video,tts,lipsync}-providers/registry.ts` —— 共享 `Map<id,Provider>` + `registerXxxProvider`/`selectProviders`/`dispatchXxxGenerate`;按 `available()`→capability→`exclude`→`priority` 升序→`prefer` 顶头 选链;URL 合法性校验。
- **内置引擎**:image mj/minimax(multi/single)/kontext;video veo/kling(独家 FLF)/minimax(独家 S2V)/vidu;tts minimax-tts/vectorengine-tts;lipsync wav2lip-http/local-2d(零配置 ffmpeg 兜底)。
- **PLUGIN_CHAIN_MODE 三态**(off/shadow/primary)+ 采样率 + `withImagePlugin`/`withVideoPlugin`/`withTTSPlugin` 三 HOC,已接 orchestrator;`plugin_chain_events` telemetry + `cutoverReady`(shadowAgreeRate≥0.98 且样本≥50)自动判切换时机。
- **Mock 三件套**(MOCK_ENGINES=1 全封闭)+ `provider-health.ts` 六态分类(纯逻辑)。

### 真实缺口(本阶段补)
| # | 缺口 | 证据 | 影响 | P/工作量 |
|---|---|---|---|---|
| G1 | **视频/图像成本未落库** | `cost-log-repo` 注释「核心管线留后续」;orchestrator video/image 成功分支无 `recordCostLog` | cost-attribution 两大类目永远 0;预算护栏拦不住视频超支 | P0 · M |
| G2 | **assertBudget 主管线盲区** | 只 preview-shot 接;create-stream/u2v/u2v-flf 无 | 硬上限对主创作链零拦截 | P0 · S |
| G3 | **editor TTS 不走注册表** | `hybrid-orchestrator` 硬编码 `minimaxService.generateSpeech`;`dispatchTTSGenerate` 仅 narration 用 | vectorengine-tts(priority 50)永不被选;withTTSPlugin primary 实际仍只 Minimax | P1 · M |
| G4 | **LLM 无 plugin-chain 包装** | `callLLM` 自有 llmAttempts 数组,绕过 router;无 `withLLMPlugin`/`PluginEventKind.llm` | LLM shadow 实验/telemetry/cutover 不可用 | P1 · M |
| G5 | **lipsync 无 HOC** | `dispatchLipSyncGenerate` 已就绪但 orchestrator 口型渲染未经 router | lipsync 切换不可观测 | P1 · S |
| G6 | **health 与 registry 断开** | `provider-health` 纯分类不回写;探针结果只给前端;无熔断 | auth_error 引擎仍被反复选中;失败率失真 | P2 · M |

---

## 二、设计哲学(承袭)
- **复用不重建**:四注册表 + plugin-chain 三态 + telemetry + provider-health 六态全已建成 → 本阶段=接管道、补落库、加熔断,**不动架构、不加引擎**。
- **确定性地板 + BYO + 诚实降级**:成本估算宁高勿低、保守初值上线前对账单校准;TTS 全失败走 `createSilenceMp3` 兜底不 throw;熔断仅同步读内存缓存不拖慢 dispatch。
- **安全/成本红线**(见 §五):assertBudget 必须主管线**首个 await**;shadow LLM 响应不得注入主流程 SSE;熔断 TTL≥60s 防震荡。

---

## 三、版本拆解

### v12.4.0 · 成本落库(video/image)【P0 · M】✅
- video/image 成功后调 `recordCostLog`(engine=`video-<engine>`/`image`,`estimateVideoCostCny`+`videoRateForProvider`/`estimateImageCostCny` 同 `estimateTtsCostCny` 模式);orchestrator 加 `setUserId`(create-pipeline 注入计费用户);mock 模式零成本不记;fire-and-forget 不阻断。
- **验证**:create-stream 后 cost_log 见 `video-*`/`image` 行。`assertBudget` 接主管线拆到 **v12.4.1**(用户本轮插入分镜/语种/demo 清理三事,优先处理)。

### v12.4.1 · assertBudget 接主管线【P0 · S】✅
- create-stream(LLM 扩写**之前**首个 gate)/ u2v / u2v-flf 路由各加 `await assertBudget({ userId, pendingCostCny })`(整片粗估 ¥6 / 单视频 max(1.8, duration×0.3)),超限 402 `code='budget_exceeded'`;无预算上限用户永远放行(no-op)。
- **验证**:tsc 0 + vitest 2429 不回归;`budget_hard_cap_cny` 低于当月花费 → 主管线 402。

> 阶段二十三剩余:v12.5.x TTS 注册表统一 / v12.6.x LLM+LipSync plugin-chain / v12.7.x 软熔断(版本号因用户插入 #1-#4 已占用 12.5/12.6,顺延)。

### v12.7.0 · TTS 注册表统一【P1 · M】✅(版本号顺延,原 v12.5.0)
- `hybrid-orchestrator` editor TTS 段 `withTTSPlugin` fallback 从硬编码 `minimaxService.generateSpeech` 改走 `dispatchTTSGenerate`(注册表 priority:vectorengine-tts 50 → minimax-tts 100);注册表全失败再退回直连 minimax(保旧行为),都没有 → 抛错走既有 `createSilenceMp3` 静音兜底。
- 外层守卫从 `if (this.minimaxService)` 放宽为 `if (this.minimaxService || ttsEngineConfigured())` → **vectorengine-only / 无 minimax 也能出配音**(衔接 #2 英文路径)。
- **验证**:tsc 0 + vitest 2434(+5:ttsEngineConfigured 可用性/异常 + dispatch 按 priority 选 vectorengine 优先 + 无效 audioUrl 落下一个/全失败 null)。

### v12.6.0 · LLM + LipSync plugin-chain 接入【P1 · M】
- 新增 `withLLMPlugin`/`withLipSyncPlugin`(复用 `runWithPlugin`)+ `PluginEventKind` 加 `llm`/`lipsync`;callLLM 外层包 withLLMPlugin;口型渲染走 withLipSyncPlugin→dispatchLipSyncGenerate。
- **验证**:`PLUGIN_CHAIN_MODE=shadow` 跑含口型+LLM 流程 → `plugin_chain_events` 出现 `kind=llm`/`kind=lipsync`;50 条后 cutoverReady 正确。

### v12.8.0 · provider 软熔断【P2 · M】✅(版本号顺延,原 v12.7.0)
- 新 `lib/provider-health-cache.ts`:`markProviderDown(id,ttl)` / `isProviderHealthy(id)`(同步,TTL 过期自动恢复,TTL 夹 ≥60s 防震荡)/ `markProviderDownIfFatal(id,errMsg)`(auth/401·403→5min、配额/余额/池饱和→5min、限流/429→1min、超时/未知→不熔断)/ `markProviderHealthy` / `listUnhealthy`。
- image/video/tts 三 registry `selectProviders` 在 `available()` 后加 `isProviderHealthy(p.id)` 过滤;三 dispatch catch 调 `markProviderDownIfFatal`。
- **orchestrator 视频引擎循环**(真实痛点:pool 饱和反复 503):try 前 `isProviderHealthy(engine)` 跳过冷却中引擎;catch 里 `markProviderDownIfFatal(engine,errMsg)` → **后续镜头不再重打已知 down 的引擎**,直走下一个。
- **验证**:tsc 0 + vitest 2439(+5:TTL 冷却+自动恢复 / ≥60s 夹取 / 致命错误判定 / 显式恢复+listUnhealthy)。

> 阶段二十三剩 G4(LLM plugin-chain `withLLMPlugin`)/ G5(lipsync `withLipSyncPlugin`)—— 主要是可观测性(shadow 采样/telemetry),P1 但非紧急。

---

## 四、衔接「多集生成」(阶段二十四)
| 依赖产物 | 来源 | 衔接 |
|---|---|---|
| video/image cost 落库 | v12.4.0 | 整季 N 集 assertBudget 月花费 SUM 才准 |
| assertBudget 接 create-stream | v12.4.0 | `orchestrateSeason` 每集投递前预检预算直接复用 |
| dispatchTTSGenerate 统一 | v12.5.0 | 多集并行 TTS 与单集 editor 共享注册表,无双轨 |
| withLLMPlugin telemetry | v12.6.0 | 整季高频 LLM,shadow 实测支撑 cutover 决策 |
| 软熔断 health-cache | v12.7.0 | 多集并发若引擎 auth_error,熔断后绕开,其余路继续 |

**多集 schema 衔接(留阶段二十四)**:`pipeline_jobs.payload` 加 `seriesId`/`episodeIndex`/`prevProjectId`(payload 已 JSON,不改 enqueue/claim);`projects` 加 `series_id`/`episode_number`(addColumnIfMissing,不破现有行)。

---

## 五、非目标 + 红线
**非目标**:不新增引擎(Seedance/Wan/Sora);不动 `lib/plugins.ts` v0 骨架(与 typed registry 断开但不影响生产,清理留技术债专项);不处理多集 DB schema;不优化 Ken Burns animatic;不上 Redis 分布式限流。
**成本红线**:`estimateVideoCostCny` 保守初值(Veo ¥0.60/s、Kling Master ¥0.20/s、Minimax ¥0.10/s),上线前对账单校准;assertBudget 必须 create-stream **首个 await**(否则 LLM 费用已发生)。
**安全红线**:`markProviderDown` TTL≥60s 防震荡;shadow LLM 响应**不得**注入主流程 SSE(隔离已在 runWithPlugin shadow 分支,接 LLM 时勿改);TTS 全失败必走 `createSilenceMp3` 不 throw;health-gate 过滤必须**同步**读内存,不得异步探针拖慢 dispatch。
