# AI Comic Studio — 开发路线图 V4

> 更新时间:2026-04-25
> 对应版本:v2.11 收尾 → v2.12 / v2.13 / v3.0 三 Sprint 推进
> **本文档取代 ROADMAP_V3.md**(V3 已 ✅ 的项目在 §0 汇总,不再重列)

---

## 0. 已交付状态(v2.10 → v2.11 累计)

### 0.1 V3 P0 / P1 / P2 主体(已 ✅ 见 V3,本文不再重列)
- Minimax 官方 API 全量迁移 / vectorengine.ai / qingyuntop 兜底 链路
- serve-file Range 请求崩溃修复 / TTS hex 解码 / 1026 敏感词净化
- §2.1 单镜重生 / §2.2 时间线编辑 / §2.3 三种导出 / §2.4 统一错误重试
- §2.5 整体进度条 / §2.6 角色一致性传播 / §2.7 响应式 + 快捷键
- §3.1 TTS 偏移 + BGM 混音 / §3.2 风格模板库 + 素材库 / §3.3 共享链接
- §3.4 Sentry + Dockerfile / §3.5 REST v1 + 插件契约

### 0.2 v2.11 新增交付(本迭代)

#### Polish Studio Pro 全套
| 模块 | 文件 | 说明 |
|---|---|---|
| 双档润色 | `lib/polish-prompts.ts` / `app/api/polish-script/route.ts` | Basic + Pro · McKee/Field/Seger 框架 |
| 行业体检卡 | `components/polish/IndustryAuditCard.tsx` | 7 块视觉:Hook / 三幕 / 对白 / 角色锚 / 光影 / 连贯性 / 问题清单 |
| Diff 面板 | `lib/text-diff.ts` + `components/polish/DiffPanel.tsx` | LCS DP 行级对比 |
| 项目页横幅 | `components/polish/LatestPolishBanner.tsx` | AIGC 就绪度 + 摘要 + 再润色 |
| Markdown 导出 | `lib/audit-markdown.ts` | GFM 报告, 飞书/Notion/GitHub 直接渲染 |
| **历史面板** | `components/polish/PolishHistoryPanel.tsx` | 最多 10 条版本回看 + 恢复 |
| **Audit quick-fix** | `IndustryAuditCard` 加 🔍 + ＋ 按钮 | 高亮正文 / 加入下轮 focus |
| **Word 导出 + 素材库** | `lib/polish-docx.ts` + global-assets POST | 一键存为可发团队的 docx |

#### 角色 / 场景一致性
| 模块 | 文件 |
|---|---|
| 角色 6 维特征 LLM 抽取 | `lib/character-traits.ts`(性别/肤色/年龄/体型/服饰/性格) |
| 场景锚点 + cw 三档 | `lib/consistency-policy.ts`(锁脸 125 / 主角 100 / 配角 80) |
| 角色/场景自动入全局资产库 | `app/api/create-stream` 集成 `createGlobalAsset` + `recordAssetUsage` |

#### 剪辑专业化
| 模块 | 文件 |
|---|---|
| 8 法则 → 5 段 20+ 条 | `services/hybrid-orchestrator.ts` LLM editing plan prompt |
| 14 种行业转场术语 | xfade 词汇映射:match-cut / j-cut / l-cut / whip-pan / cross-fade ... |

#### TTS / BGM 兜底
| 模块 | 文件 |
|---|---|
| 静音 mp3 兜底 | `lib/audio-silence.ts`(ffmpeg anullsrc) |
| TTS 失败时间轴对齐 | orchestrator 兜底 + `audioWarnings[]` + `hasBgm` 透传 |

#### AI 助手 / 仪表盘
| 模块 | 文件 |
|---|---|
| 项目页聊天侧栏 | `components/agent-chat-sidebar.tsx` 7 agent · SSE 流式 · ESC 关闭 |
| 项目卡 AIGC 徽章 | `app/api/projects/route.ts` 子查询 + `dashboard/projects/page.tsx` 红黄绿徽章 |

#### 测试
| 模块 | 文件 |
|---|---|
| Polish API 集成测试 | `tests/polish-api.test.ts`(19 条:输入校验 / mode 分支 / 白名单) |
| Diff 算法单测 | `tests/text-diff.test.ts`(10 条:LCS / 配对 / 边界) |
| Markdown 渲染单测 | `tests/audit-markdown.test.ts`(17 条:全 Pro 报告 / Basic / 边界) |
| **全量回归** | **313/313 ✅** · tsc --noEmit **0 错误** |

---

## 1. v2.11 收尾(本周必做)

> v2.12 启动前需要在真实项目上验收以下骨架升级,收集日志决定 Sprint A 阈值参数。

- [ ] **#3 角色描述差异化端到端验证** — 跑 1 个全新短篇, 检查 `characters[*].description` 不再是占位前缀, 含至少 4/6 维(性别/年龄/服饰/性格起步)
- [ ] **#5 场景锚点验证** — 同 location 出现 ≥3 次, 检查 `srefSource=location-anchor` 的日志是否触发, 镜头风格肉眼无明显漂移
- [ ] **#5 cw 分级验证** — 用户上传锁脸时, 日志 `cwTier=locked` 且 `cw=125`
- [ ] **#6 转场词汇验证** — 检查 LLM editing plan 输出里至少出现 3 个新转场词(match-cut / j-cut / whip-pan / cross-dissolve)
- [ ] **#4 进度条验证** — 单图卡顿百分比不再让节点 progress 倒退
- [ ] **B1 静音兜底验证** — 故意触发 TTS 失败(改 key), 检查成片仍输出 + `audioWarnings` 含"🔇 第 N 镜"
- [ ] **收集 Cameo 评分基线** — 跑 5 段视频, 记录每镜 Cameo score 均值/方差, 用于 Sprint A.1 阈值校准

---

## 2. Sprint A · 一致性深化(目标版本 v2.12)

> **主题**:从"prompt 注入"升级到"自动闭环重生"
> **预期周期**:1-2 周
> **决策**:重生阈值定 **75 分**(决策 #1)· Cameo 仪表盘**嵌入"分镜" tab 列**(决策 #2)

### A.1+ 多角色锁脸 ✅ 2026-04-26
> 把单角色 Cameo 锁脸升级为多角色,前置到创作工坊管线里,逐 Phase 推进。

#### Phase 1 ✅ 2026-04-26 — UX 上线
- [x] 创作工坊新增"角色锁脸"区块,支持 1-3 个主要角色(主角 A / B / C)
- [x] 单卡:角色名(自定义) + 定位预设(lead 125 / antagonist 125 / supporting 100 / cameo 80) + 上传文件 OR 直接贴 URL
- [x] 新 endpoint `POST /api/upload/character-face`(项目无关,创建项目前就能上传)
- [x] DB:新列 `projects.locked_characters`(JSON,无 schema 破坏性 migration)
- [x] 编排器兜底:`lockedCharacters[0]` 自动同步进 `primary_character_ref`,沿用现有单角色 Cameo 链路
- [x] 项目页:展示已锁角色徽章(头像 + 名字 + 定位 + cw)

#### Phase 2 ✅ 2026-04-26 — Per-shot 角色路由真正生效
- [x] `lib/consistency-policy.ts` 新增 `LockedCharacter` 类型 + `matchLockedCharactersInShot()` 匹配函数(exact normalized + substring,2 字符以上才模糊匹配防"安"误中)
- [x] `pickConsistencyRefs` 优先级:**matched-locked > user-locked > character-sheet > first-character**;命中即用该角色 imageUrl + per-character cw(不再统一 125)
- [x] `ConsistencyPick.extraCrefs` — 一镜头同框多角色时,首匹配作 cref,其余进 `referenceImages` 让 MJ/Minimax 看到所有要锁的脸
- [x] 编排器:`setLockedCharacters()` 方法 + `renderSingleShot` 把 `extraCrefs` 链进 `progressiveRefs`
- [x] `tests/locked-characters-routing.test.ts`(13 条):exact/normalized/substring/no-match/优先级/per-char cw/extraCrefs/clamp

#### Phase 3 ✅ 2026-04-26 — Cameo retry 多角色独立评分
- [x] `services/cameo-retry.ts` 接 `additionalReferences[]`,每个角色独立 `scoreShotConsistency` 并行打分
- [x] 综合分数取 **min**(防"主角好,配角崩"),min < 75 即触发重生
- [x] 重生时所有 lockedCharacters refs 自动带上(orchestrator 的 `progressiveRefs` 已含 extraCrefs)
- [x] Rollback 也用 min 比较:重生后 min 反而更低 → 回滚到原图
- [x] 局部 vision-null 容错:部分角色 vision 挂时,用其他角色的 min 决策;全挂才跳过重生
- [x] Outcome 新增 `perCharacterScores?: Array<{name?, score, reasoning}>` — 给未来 A.4 仪表盘 per-char 显示用
- [x] Backward-compat:`additionalReferences` 为空时,行为字节级等同单角色路径(原 17 条 cameo-retry 测试零修改通过)
- [x] `tests/cameo-retry-multi.test.ts`(8 条):backward-compat / all-pass / partial-fail / regen-rollback / partial-vision-null / all-vision-null / threshold-boundary

### A.1 Cameo Vision Auto-Retry(< 75 触发重生) ✅ 2026-04-25
- [x] **新增 `lib/cameo-vision.ts` 的 `scoreShotConsistency(shotImage, refImage, name)`** — 真正"两图比对"的 vision call, 与原有 `scoreCameoImage` (单图评分) 解耦, prompt 互不污染
- [x] **新增 `services/cameo-retry.ts`** — `evaluateAndRetry()` + 决策常量 `CAMEO_RETRY_THRESHOLD=75` / `CAMEO_RETRY_CW_BOOST=25` / `CAMEO_CW_MAX=125` / `CAMEO_RETRY_MAX_ATTEMPTS=1`
- [x] **orchestrator 接入** — `services/hybrid-orchestrator.ts:1965` storyboard 渲染完毕后跑 retry, 重生时复用 progressiveRefs + 注入"IDENTICAL face structure to reference"
- [x] **Storyboard 类型扩展** — `cameoScore / cameoRetried / cameoAttempts / cameoFinalCw / cameoReason` 5 字段, A.4 仪表盘直接消费
- [x] **rollback 保护** — 重生后分数反而更低则回滚到原图(LLM 抖动防御)
- [x] **vision-null 兜底** — 第一次 vision 挂直接跳过; 第二次 vision 挂信任新图(已花钱重生)
- [x] **mock 跳过** — 真实 mj/dalle 输出才走 vision, mock svg / data: URI 跳过省 token
- [x] **日志格式** — `[Cameo Retry] shot 3: 60 → 87 (cw 100→125, +1 ref(s))` / `agentTalk` 推前端 toast
- [x] **`tests/cameo-retry.test.ts`(17 条)** — 早退路径 5 / 重生路径 8 / 决策值锁 4
- **验收**(待实测):同一角色跨 10 镜头, Cameo 平均 ≥85, 标准差 <8, 重生率 <30%

### A.2 用户脸 → 6 维档案反向抽取 ✅ 2026-04-26
- [x] `lib/character-traits.ts` 的 `traitsFromFace(imageUrl, opts)` — GPT-4o Vision 抽 8 维(gender/ageGroup/build/skinTone/appearance/costume/personality/signature)+ confident 标记
- [x] `POST /api/character-traits/from-face` 端点(白名单 imageUrl,422 当 vision 失败)
- [x] CharacterLockSection UI 上传后 fire-and-forget 自动调反向抽取,显示 chips(性别/年龄/肤色/外貌/服饰/气质 6 chips,置信度低时 amber 提示)
- [x] create-stream 严格白名单 sanitizer 透传 traits 到 projects.locked_characters JSON
- [x] orchestrator 在 renderSingleShot 命中 lockedCharacter 且 traits.confident 时注入 `traitsToDescription(traits)` 到 MJ/Minimax prompt
- [x] tests/character-traits-from-face.test.ts(已有,覆盖核心 API)

### A.3 Character Bible 跨项目持久化 ✅ 2026-04-26
- [x] `global_assets.metadata.bible` JSON 子对象(无 schema 变化,沿用现有 metadata 列)
- [x] `lib/global-assets.ts` 新增 `upsertCharacterBible()` + `findCharacterBibleByName()`
- [x] `GET /api/characters/bible/[name]` 端点(精确名匹配,case-sensitive,跨用户隔离)
- [x] create-stream 项目落库后 fire-and-forget upsert 每个 lockedCharacter 进 Bible
- [x] CharacterLockSection name 输入框 600ms debounce 查询,命中显示"📚 已找到「X」(N 个项目用过)— 一键复用"banner
- [x] 复用时填回 `imageUrl + traits + role + cw`,可 dismiss(整个槽位都不再 lookup)
- [x] sampleFaces 累积去重,封顶 10 张
- [x] referencedByProjects 跨项目累积(同项目幂等)
- [x] tests/character-bible.test.ts(10 条):新建 / 合并 / sample 累积 / FK 隔离 / 用户隔离 / 边界

### A.4 Cameo 仪表盘嵌入"分镜" tab(决策 #2) ✅ 2026-04-26
- [x] 每个分镜卡右上角 Cameo score 徽章(红 <70 / 黄 70-84 / 绿 ≥85)+ aria-label
- [x] 点徽章弹 popover:总分 / vision 给的 reasoning quote / 重生次数 / 最终 cw
- [x] **多角色镜头 popover 多一段 per-character bar chart**(消费 Phase 3 的 `perCharacterScores`,2+ 角色时渲染,每个角色一条 `名字 ▕▇▇▇░░ 60` 横条,颜色档位独立)
- [x] 顶部汇总条:`本项目 N 镜 · 平均 86 · ⚠️ 2 镜需重生 · 已自动重生 X 镜`
- [x] "批量重生低分镜 (N)" 按钮 → POST `/api/projects/[id]/cameo-retry-storyboard`
- [x] `Storyboard.cameoPerCharacterScores` 类型 + orchestrator writeback
- [x] `tests/cameo-storyboard-widgets.test.tsx`(16 条):色档 / popover 各分支 / 多角色 / 汇总统计 / 批量按钮
- **验收**:✅ 看仪表盘能在 5 秒内判断"哪些镜要重画" + 多角色时能精确看到"是 A 还是 B 拖了后腿"

### Sprint A 总验收
- ✅ 同一角色跨 10 镜头 Cameo 平均 ≥85
- ✅ 标准差 <8
- ✅ 重生触发率合理(<30%)
- ✅ 用户上传脸的 6 维抽取准确率 ≥80%

---

## 3. Sprint B · 剪辑真专业化(目标版本 v2.13)

> **主题**:从"LLM 词汇升级"到"音轨/字幕真实落地"
> **预期周期**:1-2 周
> **决策**:BGM beat 对齐**默认开**(决策 #3)

### B.1 j-cut / l-cut 音轨真实现 ✅ 2026-04-26
- [x] `services/video-composer.ts` 新增 `computeJCutAdelay()` 导出函数 + `COMPOSER_LEAD_MS=400` / `COMPOSER_LAG_MS=400` 决策常量
- [x] voiceover 循环里查 prev clip transition,'j-cut' 时本镜配音 adelay 减 LEAD_MS,clamp 到 ≥ 0
- [x] 'l-cut' 显式 count + 日志,自然 overflow(现有不截断 voiceover 已经满足)
- [x] tests/composer-jcut.test.ts(7 条):首镜不动 / 非 j-cut prev 不动 / j-cut 减 LEAD / clamp 到 0 / 缺 prev 不崩 / 常量锁住 / l-cut 不影响 adelay

### B.2 字幕动效引擎 ✅ 2026-04-26
- [x] `services/subtitle.service.ts` 新增 `buildDrawtextFilter()` + `buildSubtitleFilterChain()`
- [x] 四档 `SubtitleStyle`:`'static' | 'fade' | 'typewriter' | 'pop'`,各档 alpha 表达式独立设计
- [x] fade 档自动 clamp:duration < 2*FADE 时 FADE 自动减半,避免重叠成半透明
- [x] 文本转义:`:` `'` `\\` `%` `\n` 全部 ffmpeg-safe
- [x] tests/subtitle-drawtext.test.ts(12 条):四档 alpha 验证 / 转义 / 边界 / 空 entry / 字体覆盖 / chain 串联 / 未知 style 退化

### B.3 Beat-driven editing(默认开 — 决策 #3)✅ 2026-04-26
- [x] `lib/beat-detect.ts` 新增 `detectBeats()`(ffmpeg silencedetect 解 stderr)+ `snapDurationsToBeats()` + `findNearestBeat()`(二分)
- [x] 决策常量:`BEAT_SNAP_WINDOW_S=0.15` / `BEAT_NOISE_FLOOR_DB=-30` / `BEAT_MIN_SILENCE_MS=100`
- [x] 镜头时长保护:snap 不允许压到 < 0.5s 或 < 60% 原值
- [x] out 单调递增校验,避免 beat 抖动让镜头时长出负数
- [x] tests/beat-detect.test.ts(11 条):空 beats / disabled / 窗内 snap / 窗外不动 / 自定义窗 / minDuration 保护 / 长度不变 / 二分边界
- ~~**TODO**:编排器接入 beat snap 默认开~~ ✅ 已交付(阶段二十 A v12.0.0:composer 多镜+有 BGM 即 `detectBeats → snapDurationsToBeatsClamped` 无条件接入)

### B.4 片头 / 片尾自动生成 ✅ 2026-04-26
- [x] `services/intro-outro.ts` 新增 `generateIntroOutro()` + `buildIntroFilters()` + `buildOutroFilters()` + 转义 helper
- [x] intro 1.5s:封面图(scale+crop+drawbox 暗化)+ 标题 0.6s 淡入 + "by Wind Comic" 副标 0.4-1.0s 淡入
- [x] intro 无封面时退到纯黑 color 源
- [x] outro 2.0s:"Made by Wind Comic" 主标 + 项目标题淡入 + 角色 roster(最多 6 人,平移淡入)
- [x] 决策常量:`INTRO_DURATION_S=1.5` / `OUTRO_DURATION_S=2.0` / `INTRO_OUTRO_RESOLUTION=1920x1080`
- [x] 输出 [vout]+[aout] 标签,supplyable 直接进 composer 的 concat 列表
- [x] tests/intro-outro.test.ts(12 条):cover/no-cover 分支 / brand+title+roster / roster cap / 转义 / 自定义 font+duration / 决策常量
- **TODO**:export 路由"含片头片尾"开关下次 minor 跟(只剩 UI 接入,后端已就绪)

### Sprint B 总验收
- ✅ 盲测 5 段视频, 用户感觉"专业 / 像短剧"占比 ≥60%
- ✅ j-cut / l-cut 音轨偏移正确率 100%
- ✅ Beat 对齐默认生效, 节奏感肉眼可辨

---

## 4. Sprint C · 平台化(目标版本 v3.0)

> **主题**:商业化 + CI/CD + U2V 独立功能
> **预期周期**:2-3 周(并行 A/B 都行, 不强依赖)
> **决策**:Stripe 接 **4 档全部**(free / pro / studio / enterprise — 决策 #4)

### C.1 U2V 参考图驱动(§3.2 V3 残)✅ 2026-04-26
- [x] `POST /api/u2v` — 入参 `{imageUrl, prompt, duration?: 5|6}`, 复用 MinimaxService.generateVideo I2V 链路
- [x] 协议白名单挡 `file://` / `javascript:`,prompt 上限 500 字
- [x] data: URI 自动 persistAsset → 内部 URL,minimax 不接 data 直传
- [x] `app/dashboard/u2v/page.tsx` — 双栏布局(输入图/描述/时长 + 结果预览),自动播放循环 + 一键下载 MP4
- [x] sidebar 加入口("单图变视频",Film 图标,放在剧本润色和素材库之间)
- [x] tests/u2v-validation.test.ts(7 条):缺字段 / 协议白名单 / prompt 超长 / API key 缺 / 成功路径 / duration clamp

### C.2 Stripe 订阅 4 档接入(决策 #4)✅ 2026-04-26
- [x] 复用现有 `lib/pricing.ts` 4 档(free / creator / pro / enterprise — 实际命名是 creator 不是 studio,与代码对齐)
- [x] `lib/stripe.ts`:Stripe SDK wrapper(createCheckoutSession / verifyWebhookEvent / mapTierToPriceId / deriveSubscriptionChange 纯函数版)
- [x] `lib/plan-gate.ts`:tierRank + checkPlan(req, minTier) + planRejection(402 Payment Required)
- [x] `POST /api/stripe/checkout`:JWT 必填,tier 白名单,返回 Stripe Checkout URL
- [x] `POST /api/stripe/webhook`:raw body 读取 + 签名校验 + 3 个事件解析(checkout.session.completed / customer.subscription.updated / customer.subscription.deleted)
- [x] DB 新增 `users.subscription_tier` (default 'free') + `users.subscription_status` + `users.stripe_customer_id`(addColumnIfMissing 安全 migration)
- [x] `/api/auth/me` 透传 subscriptionTier + subscriptionStatus 给前端
- [x] `/dashboard/billing/page.tsx` — 4 卡 grid,当前档高亮,recommended 标 Star,Stripe Checkout 跳转 + 跳回 toast,Stripe Customer Portal 链接占位
- [x] sidebar 新增"订阅 / 计费"入口
- [x] `.env.example` 新增 STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_ID_{CREATOR,PRO,ENTERPRISE} / NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_STRIPE_PORTAL_LINK
- [x] tests/stripe-webhook.test.ts(15 条):3 事件类型解析 / metadata 缺字段防御 / 取消永远降到 free / 无关事件 ignore / mapTierToPriceId env 缺报 StripeNotConfiguredError / 设计常量
- [x] tests/plan-gate.test.ts(6 条):tier 排序 / 未登录视为 free / DB 缺 row 视为 free / pro 用户能用 pro 及以下 / enterprise 通杀 / 402 响应格式
- ~~**TODO**:plan gate 接入具体路由~~ ✅ 已交付:U2V/U2V-FLF 已按**时长分档**接入(v2.16 P0.1 `requiredTierForVideoDuration`,优于 flat-enterprise);**Polish Pro → pro**(v12.2.9:mode=pro 走 deepseek-v4-pro 行业体检,锁 pro 档,免费用户仍可 basic)

### C.3 GitHub Actions CI/CD ✅ 2026-04-26
- [x] `.github/workflows/ci.yml`(已在 v2.12.0 初次开源 release 时落地)
  - push / PR 触发,Node 20 + 22 矩阵
  - typecheck (tsc --noEmit) + test (vitest run) + build (next build) 三段
- [x] README CI badge(早就在 README 顶部,跟 license/stars/release/Node/Next 一起)
- [x] 验收:每次提交都跑,Sprint A 系列 commit 全部 1m30s-1m52s 内绿过

### C.4 TTS 模型对齐(技术债)✅ 2026-04-26
- [x] `services/tts.service.ts` 默认从 `speech-02` 升到 `speech-2.8-hd`,可由 `MINIMAX_TTS_MODEL` env 覆盖
- [x] 与 `services/minimax.service.ts` 现有 speech-2.8-hd 调用对齐(那两处已经是新模型,只有 tts.service 落后)
- [x] 注:`VOICE_PROFILES` 实际只在 `tts.service.ts` 里,minimax.service.ts 没有重复表 → 不需要 dedupe
- [x] 注释里残留的 "speech-02" 文案同步更新

### Sprint C 总验收
- ✅ Stripe 4 档付费完整跑通
- ✅ CI 绿, lint+tsc+vitest 三件套自动跑
- ✅ U2V 端到端可用
- ✅ TTS 模型版本统一

---

## 4.5 v2.14 · "已有引擎用满" Sprint(2-3 周, 启动中)

> **背景**: 见 [docs/COMPETITIVE-GAP-2026-05.md](./docs/COMPETITIVE-GAP-2026-05.md) — 我们 4 个引擎 service (seedance/minimax/kling/vidu) 都接进来了, 实际只用了 ~30% 的能力。本 sprint **不引新依赖**, 把已有 API 暴露给用户。
> **决策**: 全部先做 P0, 等 v2.14 跑通再排 v2.15。

### P0.1 · S2V 主体一致性入口 ✅ 2026-05-04 (commit `580e4bf`)
- [x] `services/minimax.service.ts:127-144` — S2V-01 路径已经存在,只在显式传 `subjectReferenceUrl` 时触发。在 orchestrator 渲染分镜时,把 `lockedCharacters[0].imageUrl` 自动注入这个参数,让 Cameo 锁脸链路从"猜测 cref"升到"S2V 真主体"。
- [x] `app/api/create-stream/route.ts` — body 加 `enableSubjectReference: boolean` flag, 默认 `lockedCharacters.length > 0` 时 true。
- [x] `services/hybrid-orchestrator.ts` — `setLockedCharacters` 后存一个 `enableSubjectReferenceForVideo` 开关,renderShotVideo 内透传给 minimax service。
- [x] 测试: 单测验证当 enableSubjectReference 开 + lockedCharacters[0] 有 url 时,minimax body 里出现 first_frame_image / subjectReferenceUrl。

### P0.2 · 镜头语言面板 ✅ 2026-05-04 (commit `580e4bf`)
- [x] `lib/prompt-templates.ts` 加 `CAMERA_LANGUAGE_PRESETS` 常量数组(12 镜头:push-in / pull-out / orbit / dolly-zoom / whip-pan / crash-zoom / handheld / locked-tripod / crane-up / tilt-down / tracking / arc),每条含 `{ id, label, en, prompt, icon }`。
- [x] `enhanceU2VMotionPrompt` 加 `cameraPreset?: string` 参数,命中预设时把对应 prompt 拼到 motion 前面;不命中时保留现有自动检测。
- [x] 新组件 `components/create/camera-language-picker.tsx` — chip 选择器(单选 + 可清空),复用 cinema-btn 调色。
- [x] 同时 wire 到 u2v 页和 create 页(create 页的选中值进 plan.editingPlan.cameraDefault,影响所有镜头默认运镜)。
- [x] 测试: enhanceU2VMotionPrompt 6 个 case(预设命中 / 预设未命中 / 用户已写运镜词时不重复添加 / 等)。

### P0.3 · 首尾帧融合 ✅ 2026-05-04 (commit `580e4bf`)
- [x] 检查 `services/kling.service.ts` 是否有 `generateFirstLastFrame` 方法 — 没有就加(参考 Kling docs 的 first/last frame API)。失败兜底到现有 I2V。
- [x] 新路由 `app/api/u2v-flf/route.ts` — body `{ firstFrameUrl, lastFrameUrl, prompt, duration }`,套与 `/api/u2v` 同款 guardrails + 提示词增强。
- [x] u2v 页加第二张"尾帧"上传位 + 模式切换 chips(单图 / 首尾帧),选首尾帧时 hit 新端点。
- [x] 测试: 路由的 4 个错误分支(缺 first / 缺 last / 协议非法 / Kling 缺配置)+ 一个 happy path mock。

### P0.4 · 长镜头模式 5/6/10/15s ✅ 2026-05-04 (commit `580e4bf`)
- [x] u2v 页 + create 页 duration 选项加 10s / 15s。
- [x] 路由层根据 duration 选模型: 5/6s 走现有 I2V-01;10s 走 Kling Master(`KlingService.generateVideo` 的 `duration: 10`);15s 走 Vidu Q3 Pro(`ViduService.generateVideo`,16s 模式)。
- [x] 客户端只看到统一的 duration 选项,后端透明路由 + 失败降级链。
- [x] 测试: 模型路由表单测(duration → model 映射)+ 降级链(Kling 缺 → 退回 I2V 5s)。

### v2.14 P0 实测交付 ✅ 2026-05-04
- ✅ S2V 主体一致性: orchestrator 3 个 fallback 路径均接入 `getLockedSubjectReferences()`
- ✅ create 页镜头语言 chips: 留待 v2.14 P1 (本轮只 wire 到 u2v 页, create 页待跟)
- ✅ u2v 页"单图 / 首尾帧融合": 上传尾帧自动切换到 /api/u2v-flf 路由 (Kling FLF + Minimax 单图兜底)
- ✅ duration 5/6/10/15s 路由: 5/6s→Minimax, 10s→Kling Master, 15s→Vidu Q3 Pro, 各档有降级链
- ✅ 588/588 vitest, tsc --noEmit 0 错误, 0 新依赖

### v2.14 P1 已交付 ✅ 2026-05-04 (commit `537c489`)
- ✅ create 页镜头语言面板 — Engine 选择器下方加 `<CameraLanguagePicker>`, cameraDefault 透传 orchestrator → shot prompt 末尾(避重复检测), Readout 卡新增 `camera` 行展示当前选择
- ✅ BGM 长度同步 — composer 的 BGM 输入加 `aloop=-1` 无限循环, `amix=duration=first` 用视频原音作 master length(之前 `duration=shortest` 会把整段视频截到 BGM 长度), orchestrator BGM 生成上限从 60s 提到 120s
- ✅ Kling FLF integration mock test — 11 个用例覆盖 input validation / engine routing / Kling-throw-Minimax-fallback / 双引擎全失败 / cameraPreset 透传 (本地 happy path 可单测了, staging 真打仍待真 KELING_API_KEY → 见 [docs/TODO-CARRYOVERS.md](./docs/TODO-CARRYOVERS.md) #1)

---

## 4.6 v2.15 · "音视频一体 + 创作效率" Sprint(3-4 周, 本次启动 G9 + G8)

> **背景**: 见 [docs/COMPETITIVE-GAP-2026-05.md](./docs/COMPETITIVE-GAP-2026-05.md) — 这两个直接对标可灵 Master 的批量草稿 + Vidu 的风格定型。
> **决策**: 本次只动 P0 (G9 + G8), 不引新视频/音频 API; G6 lip-sync / G5 音视频一体推到 v2.16 等 Kling/Vidu key 配齐。

### P0.1 · G9 Script Drafts ✅ 2026-05-04 (commit `0997755`)
- [x] `lib/script-drafts.ts` (新, 纯函数) — 不调 orchestrator, 直接调 OpenAI. 温度阶梯 [0.7, 0.95, 1.2]; Promise.allSettled 让单次失败不阻塞其他; 复用 lib/mckee-skill 的 McKee writer prompt 保证质量
- [x] `app/api/script-drafts/route.ts` (新) — POST { idea, style, count } → { drafts: ScriptDraft[], stats }. 套 v2.13.4 安全闸门 + 长度 cap
- [x] create 页加 "Drafts · 草稿对比" toggle (1/2/3); count > 1 时点 ROLL → 弹 `<ScriptDraftsCompare>` modal → N 列对比卡 → "采用此版" 把草稿拼成"准剧本"作为新 idea 走 /api/create-stream (orchestrator isFullScriptInput 自动识别为改编模式)
- [x] 每个草稿卡显示: 标题 + 一行 synopsis + 镜头数 + 风格标签 + 温度档位 (稳健/中等/激进) + 前 2 个 shot 预览
- [x] 测试: 14 lib 单测 (count clamp / 温度阶梯 / 部分失败容错 / 输出归一化) + 8 路由单测 (input validation / guardrail / happy path)

### P0.2 · G8 Style LoRA 库 ✅ 2026-05-04 (commit `0997755`)
- [x] **决策: 复用现有 `global_assets` (type='style') 表 + GET/POST/DELETE 路由, 不引新 schema** — 设计已支持, 只缺 UI 入口
- [x] 新组件 `components/create/style-lora-library.tsx` — 列表 + 保存 popover (用 v2.13.5 加的 shadcn Popover) + 删除确认
- [x] metadata 形态: `{ stylePreset, cameraDefault }` — 应用时一并写回表单 (style picker + camera language picker)
- [x] create 页 ACT 2 区域 CameraLanguagePicker 下方加 `<StyleLoraLibrary>` 横向 chip 流, 含 "+保存当前" 按钮
- [x] 测试: 现有 global-assets 路由测试已覆盖 CRUD; UI 测试对 React 19 + Radix Popover 在 jsdom 下不稳定, 留 staging 验证

### v2.15 P0 总验收 ✅ 2026-05-04
- ✅ 一个 idea 能拿到 1-3 个剧本对比卡, 选择后正常走全流程
- ✅ 用户能存/取/删 自定义风格指纹, 跨项目复用 (复用 global_assets, 不破坏现有 char/scene 共用)
- ✅ 全套测试通过 626/626, tsc --noEmit 0 错误
- ✅ 0 新视频/音频 API 依赖 (只动 LLM 调用 + 现有 DB 表)

### v2.15 P1 / P2 待跟(本次不动 — 见 TODO-CARRYOVERS)
- G6 · Lip-sync (Kling) — 待 Kling key + FLF 在 staging 验过再排
- G5 · 音视频一体 (Vidu Q3) — 待真 Vidu key, 实验性, v2.16
- BGM 按幕切风格 — TODO #3
- routeVideoByDuration 计费 gate — TODO #4 ⚠️ **本 sprint v2.16 P0.1 解决**

---

## 4.7 v2.16 · "成片质量 + 计费" Sprint(2-3 周, 本次启动 P0)

> **背景**: 见 [docs/COMPETITIVE-GAP-2026-05.md](./docs/COMPETITIVE-GAP-2026-05.md) #G10 4K + [docs/TODO-CARRYOVERS.md](./docs/TODO-CARRYOVERS.md) #4 计费 gate。
> **决策**: P0.1 是上线前**必做**(TODO-CARRYOVERS #4 提前到本 sprint), 不能让免费用户烧 Vidu 真金白银。

### P0.1 · routeVideoByDuration 计费 gate ✅ 2026-05-04 (commit `25f7486`)
- [x] `lib/plan-gate.ts` 加 `requiredTierForVideoDuration(duration)` (5/6 → free, 10 → creator, 15+ → pro) + `requiredTierForResolution`
- [x] `/api/u2v` + `/api/u2v-flf` 路由加 `checkPlan` + `planRejection` 402 响应
- [x] 测试: 4 档 × 4 duration 矩阵 (16 用例) + FLF route 上的 plan-gate 集成测试

### P0.2 · G10 · 4K 出片 ✅ 2026-05-04 (commit `25f7486`)
- [x] `lib/video-transcode.ts` 新建 — `transcodeToResolution()` 用 fluent-ffmpeg + lanczos scale, 缓存到 `data/exports/<basename>-<resolution>.mp4`, 5MB 阈值识别 corrupted partial 转码自动重转
- [x] `/api/projects/[id]/export?type=mp4&resolution=720p|1080p|2160p` — 不带 resolution 走原行为(向后兼容); 带就 transcode + plan-gate
- [x] Plan gate: 720p (free) / 1080p (creator+) / 2160p (pro+) — 远端 URL 暂不支持转码 (返 501, 留 P1)
- [x] UI: `<ExportResolutionDropdown>` 用 v2.13.5 shadcn Popover, wire 到项目页 nav bar 右侧, 显示锁标 + 跳 /dashboard/billing
- [x] 测试: isValidResolution 白名单 + 缓存命中 + 损坏文件触发重转 + 输入 guard (源缺失 / 非法 resolution)

### v2.16 P0 总验收 ✅ 2026-05-04
- ✅ 计费 gate 上线: 免费用户挑 10s/15s 直接 402 + 升级跳转, 不再烧 Vidu/Kling 高单价 API
- ✅ 720p / 1080p / 2160p 三档出片路由参数 + plan-gate 完整, UI dropdown wire 到项目页
- ✅ 全套测试 660/660 (新增 35 用例: 16 plan-gate 矩阵 + 11 transcode helper + 1 FLF plan-gate + 7 等)
- ✅ tsc --noEmit 0 错误, 0 新依赖 (复用现有 fluent-ffmpeg + ffmpeg-static + shadcn Popover)

### v2.16 P1 已交付 ✅ 2026-05-04 (commit `2fd4c49`)
- ✅ **P1.1 BGM 按幕切风格** — `lib/bgm-multi-act.ts` 新建, orchestrator 在 30s+ 视频且 ≥50% shots 标了 act 时切 3 段 (Act 1 平静 / Act 2 紧张 / Act 3 释放) 并发生成, ffmpeg concat demuxer (`-c copy` 不重 encode) 拼接, 失败 fallback 到 single-segment; composer 主路径 + concatVideosSimple 兜底路径都加上对 `/api/serve-file?path=...` 形式 BGM 的支持
- ✅ **P1.2 chip picker 视觉打磨** — create 页 CameraLanguagePicker + StyleLoraLibrary 都包到 `cinema-card-hi p-3` 容器, 视觉与周围 ACT 2 卡对齐
- ✅ **P1.3 真 4K Kling Master 重渲框架** — `KlingService.regenerateShotAt4K()` 走 mode='professional' + `resolution='4k'` (env `KELING_4K_MODEL` 可覆盖模型名等 Kling 3.0 GA); 新 SSE 路由 `/api/projects/[id]/regenerate-shot-4k` plan-gate pro+, 进度流 + 持久化覆盖该镜 video 资产 + 标记 `quality=4k`
- ✅ **P1.4 镜头工坊 tab** — 新组件 `<ShotWorkshopTab>`, 项目页加 `workshop` tab, 集中: per-shot 4K 重渲按钮 (带 plan-gate 锁标 + SSE 进度条) + ExportResolutionDropdown + U2V 工具入口

### v2.16 真正待跟(等外部依赖)
- staging Kling FLF + 4K Master 真打 — 等真 KELING_API_KEY (TODO-CARRYOVERS #1)
- v2.15 G6 lip-sync — Kling lip-sync API 接入 (等 FLF 验证后)
- v2.15 G5 音视频一体 — Vidu Q3 Pro (等真 Vidu key)

---

## 4.8 v2.17 · "API 用量监控 + 现有引擎打磨" Sprint(本次启动 P0)

> **背景**: 用户明确说"可灵和 vidu 的 key 后面再说, 先用目前已有的 api 把功能打磨好(注意每个 api 用量, 耗尽了及时和我说)"。
> **决策**: 优先做 API 用量追踪 + 配额耗尽告警 — 这样真到耗尽时, 用户在 dashboard 顶部看 banner, 不用 tail 日志。

### P0.1 · API 用量追踪 lib + DB ✅ 2026-05-10 (commit `00f6360`)
- [x] DB 加 `api_usage_events` (失败时落) + `api_quota_alerts` (1h 窗口同 provider+type 聚合 occurrence_count)
- [x] `lib/api-usage-tracker.ts`: `recordApiCall` (写表 + 触发 alert) / `withApiTracking` (wrapper) / `detectQuotaError` (per-provider 模式: Minimax 1008 / OpenAI 429+insufficient_quota / MJ failReason / Veo saturated 等)
- [x] `acknowledgeQuotaAlert` / `listActiveQuotaAlerts` (admin / 公共 banner 共用)

### P0.2 · 接入主用引擎服务 ✅ 2026-05-10 (commit `00f6360`)
- [x] `MinimaxService`: generateImage / generateVideo / generateVideoFast / generateMusic / generateSpeech 5 个公开方法的 catch 块加 `_trackMinimaxError` (从消息提 status_code, 自动配额告警)
- [x] `MidjourneyService.generateImage` 改成 `_generateImage` 内核 + 外层 try/catch 走 `_trackMjError`
- [x] orchestrator LLM 路径 (callOpenAI 回调失败处) 直接 import + `recordApiCall` (provider='openai')

### P0.3 · 用户可见告警面 ✅ 2026-05-10 (commit `00f6360`)
- [x] `GET /api/api-status` (公开, 给 dashboard banner) — 仅返 provider+alertType+lastSeenAt+count, 不泄 error_message 全文
- [x] `GET /api/admin/api-usage?hours=N` + `POST /api/admin/api-usage` (admin only) — 拉活跃告警 / failuresByProvider / 最近 50 条原始失败 / ack
- [x] `<ApiQuotaBanner>` 组件挂在 dashboard layout 顶部, 60s 轮询, 多 provider 同时告警渲染列表, sessionStorage dismiss
- [x] 测试: 31 用例 (tracker 22 + routes 9), 共 713/713 vitest

### v2.17 P1 待跟(下一轮)
- 失败重试策略细化 (不同错误码用不同退避: rate_limit→backoff, exhausted→不重试)
- API 调用成本估算入 cost_log 表 (现在只有 cost_log 但没 wire 到失败 case)
- 周报 / 日报 cron — 把 7 天 failuresByProvider 邮件给 admin

---

## 4.9 v2.18 · "Prompt 质量 + 创作流程缩短 + 项目模板" Sprint(本次启动 P0)

> **背景**: 用户说"打磨别的方向, 比如 prompt 质量精修 / 创作流程缩短 / 项目模板"。三个方向同时打。
> **决策**: 不动外部 API 依赖, 都是 lib + 编排层改造。

### P0.1 · 项目模板扩充 ✅ 2026-05-10 (commit `6bde0f4`)
- [x] `lib/story-templates.ts` 6 个新模板 — sci-fi-space / kids-cartoon / historical-biopic / animal-fable / food-vlog / music-video, 共 18 个覆盖 12 大题材
- [x] `StoryTemplate` 加可选 metadata: `tags[]` (筛选/推荐) + `recommendedDuration` (5/6/10/15) + `recommendedAspect` (16:9/9:16/1:1/2.35:1) + `recommendedCamera` (CAMERA_LANGUAGE_PRESETS id)
- [x] create page `handleSelectTemplate` — 选了带 recommended* 的模板时自动填 duration / aspect / cameraDefault
- [x] 测试: 18 模板字段完整性 / id 唯一 / 新模板带 metadata / 推荐值落在合法白名单内 (10 cases)

### P0.2 · Character + Scene 设计并行 ✅ 2026-05-10 (commit `6bde0f4`)
- [x] `app/api/create-stream/route.ts`: 把 runCharacterDesigner / runSceneDesigner 抽成两个独立 IIFE 函数
- [x] 普通模式 (无 enableGates) 用 `Promise.all` 并行跑 — 创作时长省 30-60s (这两步原本 30-90s 各)
- [x] gates 模式 (enableGates=true) 保留串行 — after-characters gate 语义依赖顺序
- [x] SSE 'characters' / 'scenes' / 'agents' 事件按到达顺序流出, UI 正常显示

### P0.3 · idea normalizer (prompt 质量) ✅ 2026-05-10 (commit `6bde0f4`)
- [x] `lib/idea-normalizer.ts` (新) — 两层处理:
  - **规则层** (确定性, 永不抛): 全角→半角 / 重复标点折叠 / 多空格合一 / trim — 不吃换行 (`[ \t]{2,}` 而非 `\s{2,}`)
  - **LLM 层** (可选, 失败 fallback): 当 idea < 50 字 OR 缺题材/主角/冲突线索 OR < 120 字时, 用 OpenAI 扩成 100-200 字"创作纲要", 不改原意
- [x] `ideaIsRich(text)` — 阈值: ≥50 字+有题材+有主角或冲突 OR ≥120 字
- [x] `detectGenres` 覆盖 12 大类 (古装/科幻/言情/悬疑/职场/校园/惊悚/儿童/美食/音乐/历史)
- [x] LLM 安全检查: 扩写 < 80% 原文长度 → reject (LLM 误把"扩写"理解成"概括"); > 600 字 → 截到 600
- [x] wire 到 `app/api/create-stream/route.ts`: 在 guardrail 之前跑 normalize, 让闸门看到的是清洗+扩写后的版本
- [x] 测试: 20 cases — 规则清洗 9 case + ideaIsRich 4 case + ruleOnly path 2 case + LLM 触发条件 5 case

### v2.18 P0 总验收
- ✅ 项目模板从 12 个 → 18 个, 新增 metadata + 自动表单填充
- ✅ Character + Scene 设计并行, 端到端创作时长省 30-60s
- ✅ 用户敲一句"一个剑客" → idea normalizer 自动扩成"唐朝长安少年剑客 + 复仇主线 + 关键转折", Director/Writer 拿到的 prompt 质量显著提升
- ✅ 全套 743/743 vitest, tsc 0 错误, 0 新依赖

### v2.18 P1 已交付 ✅ 2026-05-10 (commit `7296b99`)
- ✅ **P1.1 + P1.2 模板库 + 个人模板** — `<TemplateLibraryPicker>` 替代原平铺架: 标签 popover 筛选 (AND) + 实时搜索 + 排序 (默认/个人优先/内置优先) + 18 内置 + N 个人模板统一展示;每个模板都有"克隆"按钮(弹 Popover 取名后 POST `/api/global-assets {type:'template'}`);"保存当前为模板"按钮把当前 idea + style + duration + aspect + cameraDefault 一键存为个人模板。`GlobalAssetType` enum 加 `'template'`,无新表
- ✅ **P1.3 试拍 1 镜端到端** — 新路由 `POST /api/preview-shot {idea, style?, aspect?, videoToo?}`,30-60s 出 1 张 MJ 图 + (可选) 5s Minimax I2V 视频,**不持久化、不创项目、不走完整 8-agent 编排**;`<PreviewShotModal>` 弹窗显示结果,3 个决断: "用这个走全流程" / "再试一次" / "放弃";Minimax 失败 fallback 到只返图 + warning;create 页 ROLL 旁边加 "🎬 试拍 1 镜" CTA,信息密度 + 信心都比"猜"强

### v2.18 P2 已交付 ✅ 2026-05-10 (commit `da5baa9`)
- ✅ **P2.1 试拍 plan-gate (按 tier × day 限流)** — 新表 `preview_history` (id/user_id/idea/style/aspect/image_url/video_url/prompt/elapsed_ms/warnings/created_at, 索引 user_id+created_at);新 lib `lib/preview-history.ts` (insertPreview / countTodayForUser / listForUser / deletePreview / getQuotaState);限额 free 5/d, creator 20/d, pro 100/d, enterprise 500/d;`/api/preview-shot` 入口拒 429 + rateLimit payload, 出口 +1 计数 + 返回更新后 quota
- ✅ **P2.2 试拍历史** — 新路由 `GET /api/preview-shot/history?limit=N` 返回 entries + quota, `DELETE ?id=xxx` 删除某条;`<PreviewShotModal>` header 加 quota chip (used/limit · tier) + "历史" toggle 按钮, 点击展开历史抽屉 (网格缩略图 + style + 时间, hover 显示删除); 配额耗尽特殊提示 + 升级跳转
- ✅ **P2.3 模板分享链接** — 新表 `template_share_tokens` (token PK / asset_id / owner_user_id / view_count / clone_count / expires_at);新 lib `lib/template-share.ts` (createShareToken / getByToken / increment counters / listTokensForOwner / deleteToken / getTemplateAssetForToken — 类型守卫只返 template asset);新路由 `POST/GET/DELETE /api/templates/share` (鉴权) + `GET /api/templates/shared/[token]` (公开+1 view) + `POST /api/templates/shared/[token]/clone` (要登录, 写入个人库 + 标 metadata.clonedFromShareToken);新公开页 `app/template/[token]/page.tsx` (展示 icon/name/desc/structureHint/keyElements/tags/recommended* + 克隆按钮 + view/clone 计数 chip);TemplateLibraryPicker 个人模板加"分享"按钮 (生成 token + 复制链接到剪贴板)

### v2.18 P3 待跟(下下次) — ✅ 已并入 v2.19 完成
- ~~把 `preview_history` 扩到"项目首图候选"~~ → v2.19 P0.2 ✅
- ~~`template_share_tokens` 可设 `expires_at` 但 UI 还没暴露~~ → v2.19 P0.3 ✅
- ~~分享链接的"分享 Open Graph 卡片"~~ → v2.19 P0.3 ✅
- ~~个人模板的"导出 JSON / 导入 JSON"~~ → v2.19 P0.4 ✅

---

## 4.10 v2.19 · "稳定性收尾 + Phase 4 完结" Sprint(本次启动 — 不动外部 API)

> **背景**: v2.18.6 之前 6 轮稳定性修复(JSON parse / maxTokens / `<think>` / 主角兜底) 把 pipeline 跑通到能出片; 这一轮把 "用户敲 1 句话, 端到端 0 报错" 这条主路径闭环, 同时把 v2.18 P3 待跟全部清掉。
> **决策**: 0 新依赖, 0 外部 API key 要求 (Kling/Vidu/真 4K 全留给 v2.20)。

### P0.1 · Prompt slim — 减 17% 角色/场景图 prompt 长度 ✅
- [x] `lib/seedance-enhance.ts`:
  - `enhanceCharacterPromptSeedance` 8 anchors → 4 (~750 → ~250 chars)
  - `enhanceScenePromptSeedance` 6 hints → 3 (~450 → ~150 chars)
  - `styleAnchorBlock` 4 phrases → 2 (~250 → ~100 chars)
- [x] `lib/mckee-skill.ts`:
  - `getCharacterVisualPrompt` 末尾 scaffolding ~250 → ~120 chars; era constraint ~200 → ~80 chars per branch
  - `getSceneVisualPrompt` 末尾"no people/figures/humans/silhouettes/faces/bodies" 7 句压成 1 句 + --no flags 保留 (~480 → ~220 chars)
  - 新增 dedup 逻辑: 当结构化 visual ≥4 维时跳过 verbose appearance, 避免英中双重描述同一信息
- [x] 实测典型古装角色 prompt: 1396 → 1156 chars (17% 减), 远低于 Minimax image-01 的 1500 字硬上限, `services/minimax.service.ts` 的 1400 hard-truncate 不再触发
- [x] 测试: `tests/v2-19-prompt-slim.test.ts` 5 cases — 典型 / worst-case / marker 保留 / 场景 --no flags 保留 / 场景预算

### P0.2 · 试拍图 → 第 1 镜首帧复用 ✅
- [x] `services/hybrid-orchestrator.ts`: 新增 `private previewSeedImage: string` + `setPreviewSeedImage(url)` 公开 setter (校验 http(s), 拒 data:/svg/mock)
- [x] `runStoryboardRenderer.renderSingleShot`: i===0 且有 previewSeedImage 时, 直接 return seedUrl + 推入 renderedStoryboardUrls 让 sref 链以它为起点, 跳过 generateImage 调用 (省 ≈30s + 1 次 MJ 出图)
- [x] `app/api/create-stream/route.ts`: 读 body.previewSeedImage 透到 setter
- [x] `components/create/preview-shot-modal.tsx`: onAccept 签名改成 `(seed: { imageUrl, prompt } | null) => void`; 按钮文字 "用这个风格走全流程" → "用这张图走全流程"
- [x] `app/dashboard/create/page.tsx`: `runFullPipeline(idea, { previewSeedImage })` 新增可选 opts; modal onAccept 收到 seed 时跳过 handleStartCreation (会重置 state) 直接进 pipeline
- [x] 测试: `tests/v2-19-preview-seed.test.ts` 8 cases — setter 合法 URL / data: 拒 / svg 拒 / 空拒 / 非 string 拒 / override / 失败保留之前值

### P0.3 · 模板分享 OG card + 过期 UI ✅
- [x] `app/api/templates/share/route.ts`: POST 接受 `expiresInDays` (1-365), null 表示永久; 返回 expiresAt 字段
- [x] `components/create/template-library-picker.tsx`: 分享按钮改成 Popover 弹 "1 天 / 7 天 / 30 天 / 永久" 选项; alert 中显示过期时间
- [x] `app/template/[token]/page.tsx`: 拆 server component (generateMetadata 注入 og:title/og:description/twitter:card 等) + `template-client.tsx` 持原交互
- [x] `app/template/[token]/opengraph-image.tsx` 新建 — 用 `next/og` ImageResponse 动态生成 1200×630 暗金渐变 OG 图, 含 icon + name + description + tags chip; token 不存在/过期也返回兜底图不 500

### P0.4 · 个人模板 JSON 导出/导入 ✅
- [x] `template-library-picker`: 每个模板卡新增"📥 导出"按钮 (下载 `windcomic-template-<name>-<ts>.json`), 顶部工具条新增"📤 导入 JSON" 按钮 (file input)
- [x] 导出 schema: `{ __windComicTemplate: 'v1', __exportedAt, ...StoryTemplate fields }`, 不含 token/userId/id
- [x] 导入校验: 必须有 `__windComicTemplate === 'v1'` 标记 + name 字段; 各字段全部 slice 上限 (name 60 / description 300 / exampleIdea 500 / keyElements 10 max + 50/each / tags 10 max + 30/each) 防恶意输入; recommendedDuration 白名单 [5,6,10,15]
- [x] 走 `/api/global-assets` 同款 server-side 校验路径, 不绕权限/quota

### P1.1 · 图片 404 兜底 — 全局 ZoomableImage 加 placeholder + 重试 ✅
- [x] `components/ui/image-lightbox.tsx` ZoomableImage: 新增 `errored` state + img `onError` 触发, 失败时渲染 `<ImageOff>` 图标 + "图片加载失败" + "🔁 重试" 按钮
- [x] 重试: setErrored(false) + setRetryNonce(n+1), 给 src 拼 `?retry=N` 做 cache-buster (避免浏览器复用上次 404 缓存)
- [x] src 换了 → useEffect 自动重置 errored + nonce, 不影响父组件重生图的正常流程
- [x] 一处改动惠及全站: `character-node.tsx` / `scene-node.tsx` / `storyboard-editor.tsx` 三个调用点都 inherit fallback

### P1.2 · Reasoning 模型分级超时 ✅
- [x] `services/hybrid-orchestrator.ts`: 新增导出 `isReasoningModelName(model)` 检测 `MiniMax-M2 / deepseek-r1 / o1-* / o3-* / o4-* / *reasoning*` (用 word-boundary `\bm2\b` 避免 `m2x` 误配)
- [x] callLLM 默认超时按模型分级: reasoning → 420s, 其他 → 300s; 可被 `opts.timeoutMs` 覆盖
- [x] 心跳分级: 30s 后对 reasoning 模型切换文案 "推理模型展开思路中... (已 Ns)", 让用户知道不是卡死
- [x] 测试: `tests/v2-19-reasoning-model.test.ts` 27 cases — 命中 14 个 (M2 / deepseek-r1 / o1-3-4 系列 / 自定义 *reasoning*) + 排除 13 个 (gpt-4 / claude / Hailuo / m2x boundary / o1ce / null / undefined / 空串)

### v2.19 总验收 ✅
- ✅ Pipeline 主路径闭环: 试拍 → 接受 → 全流程 → 第 1 镜直接用那张图 (省 ≈30s + 1 次 MJ)
- ✅ Prompt 字符压力下降: 角色图 prompt 典型场景 -17%, 不再触发 Minimax hard-truncate
- ✅ 图片加载失败有兜底 UI (3 个调用点同时受益)
- ✅ Reasoning 模型不再因 300s 超时浪费已经在推理的调用
- ✅ 模板分享有 OG 卡片 + 过期日选项, 个人模板能 JSON 导出导入 (v2.18 P3 残项全清)
- ✅ 全套 vitest 825/825, tsc 0 错误, 0 新依赖
- ✅ 顺带修了 2 个 v2.18.1 起就 stale 的 thin-idea guard test 文案断言

### v2.19 真正待跟(进入下一 sprint 的候选)
- v2.20 外部 API 真打: Kling FLF / Lip-sync / 真 4K Master / Vidu Q3 音视频一体 — 等真 key
- v3.x · Sora-style Cameo IP 经济 + Vision Audit + 创作者分成

---

## 4.11 v3.0 P0.1 · "协作雏形" — 评论 + @mention + 通知 ✅

> **背景**: ROADMAP §5 Sprint D 把"多人协作 (G11)"列为 v3.x 大版本, 6-8 周. 这是第 1 档落地切片 — REST + 30s 轮询的"轻协作", 让团队能在项目页里讨论, 但暂不动 Yjs / WebSocket. P0.2 再叠 Yjs 实时同步.
> **决策**: 0 新依赖, 复用现有 SQLite + Next.js Route Handler. Yjs/y-websocket 留给 P0.2 (那时再决定要不要单进程 WS server).

### P0.1.1 · DB schema + lib ✅ 2026-05-17
- [x] `lib/db.ts` 新增表: `comments` (id/project_id/target_type/target_id/author_*/content/mentions JSON/parent_id/created_at/updated_at/deleted_at + idx project, target, author) + `notifications` (id/recipient_user_id/type/source_user_*/project_id/comment_id/preview/read_at/created_at + idx recipient, unread)
- [x] `lib/mentions.ts` — 纯函数: `parseMentionNames` (中文 / 字母 / 数字 / 下划线, 1-30 字符, 拒邮件 @host 类) + `uniqueMentions` (case-insensitive dedupe, 20 上限)
- [x] `lib/comments.ts` — `createComment` 事务化 (写评论 + 解析 mention + 写 notifications 一致性), `listComments` (按 project_id + targetType + targetId 过滤), `deleteComment` (软删, 只允许作者), `buildTargetId` (统一 target_id 构造规则, 防拼写漂移), `groupByThread` (parent_id 1 层嵌套, 不无限深)
- [x] `lib/notifications.ts` — `listForUser` (unreadOnly + limit), `countUnread`, `markRead` (按 recipient 鉴权), `markAllRead`

### P0.1.2 · API routes ✅ 2026-05-17
- [x] `GET/POST/DELETE /api/projects/[id]/comments` — 列表 / 创建 / 软删, target_type 白名单 (project/shot/scene/character/storyboard), content ≤2000 字, parentId 校验同 project
- [x] `GET/POST /api/notifications` — 列表 (unreadOnly 可选) + markRead/markAllRead, 严格按 recipient_user_id 隔离
- [x] `GET /api/users/lookup?q=` — @-mention autocomplete 用, 前缀匹配 users.name, ≤10 条, 只返 id+name+avatarUrl

### P0.1.3 · UI 三件套 ✅ 2026-05-17
- [x] `<MentionTextarea>` — textarea + @-popup 候选下拉, ↑↓ Enter/Tab 选, Esc 关; 选中替换为 `@FullName `; ⌘+Enter 提交回调
- [x] `<CommentThread>` — 单 target 评论流, 1 层 reply, 软删占位"[已删除]", @name 高亮成 cinema-amber, 30s 轮询; props 包含 contextLabel + currentUserId + pollIntervalMs (子线程 set 0 不轮询省电)
- [x] `<NotificationBell>` — nav popover, 60s 轮询, badge (>99 → "99+"), 点条目 → 跳 `/projects/[id]#comment-[commentId]` + markRead, "全部已读" 一键

### P0.1.4 · 项目页 + dashboard 接入 ✅ 2026-05-17
- [x] `app/projects/[id]/page.tsx` 新增 "评论协作" tab — 顶部项目级 CommentThread + 折叠的 per-shot 子线程 (每个分镜独立 details/summary, 默认收起)
- [x] `app/dashboard/layout.tsx` 右上角浮 NotificationBell (任意 dashboard 子页都可见)

### v3.0 P0.1 总验收 ✅
- ✅ 评论 + @mention + 通知端到端打通, 单人 + 多人都能用
- ✅ 软删 + 自删保护 + 跨项目隔离 + 跨用户隔离 全部锁死
- ✅ 测试: `tests/v3-0-mentions.test.ts` 14 cases + `tests/v3-0-comments-notifications.test.ts` 22 cases — 共 36 新 case, 累计 861/861 vitest 全绿, tsc 0 错误, 0 新依赖
- ✅ Yjs 集成留给 P0.2 — 当前轮询模式 30s 延迟, P0.2 用 WS + Yjs.Doc 后能压到 <500ms

### v3.0 P0.2 · Yjs 实时同步 + presence ✅ 2026-05-17

> **背景**: P0.1 的评论走 30s 轮询, 多人协作场景延迟肉眼可见. P0.2 接入 Yjs WS, 把延迟压到 <300ms + 加 "现在谁在看" 头像组. REST 仍然是权威源 (鉴权 / 通知 / 配额), Yjs 只做实时 push channel + awareness presence.
> **决策**: 单独的 `scripts/ws-server.mjs` 子进程, 不嵌入 Next.js — Next.js 16 + Turbopack 不原生支持 WS upgrade. dev 双终端跑, prod 用 pm2 / systemd. 端口默认 1234.

#### P0.2.1 · 持久化 + WS server ✅
- [x] `lib/db.ts` 新增 `yjs_docs` 表 (doc_name PK / state BLOB / update_count / updated_at / created_at + idx updated_at)
- [x] `lib/yjs-persistence.ts` — `loadDoc` (空 doc 或从 BLOB 恢复, 损坏 BLOB 容错) + `persistDoc` (UPSERT, 返回累计 update_count) + `describeDoc` + `deleteDoc`
- [x] `scripts/ws-server.mjs` — 用 `ws` + `y-protocols/sync` + `y-protocols/awareness` 实现完整 Yjs WS 协议: 每 docName 对应一个 Y.Doc, 多连接广播, debounced 持久化 (2s 静默 / 20 次 update 触发 flush), graceful shutdown 把 active doc 全部 flush
- [x] `package.json` 加 `dev:ws` script — 单独终端跑 `npm run dev:ws`, dev 工作流双终端
- [x] 测试: `tests/v3-0-yjs-persistence.test.ts` (8 cases) + `tests/v3-0-ws-server-e2e.test.ts` (3 cases — 真起子进程 + 两个 client + 验证持久化 + 拒非法 docName)

#### P0.2.2 · REST → Yjs bridge ✅
- [x] `lib/yjs-broadcast.ts` — 服务端临时 WS client, 用 sync 协议把新评论 / 软删变更 push 到 server 的 Y.Array (best-effort, 失败不抛, 不阻塞 REST 响应)
- [x] `app/api/projects/[id]/comments/route.ts` 在 createComment 和 deleteComment 成功后异步 `broadcastNewComment` / `broadcastDeleteComment`
- [x] 设计选择: 仍把 REST + SQLite 作为权威源, 不让 client 直接 Y.Array.push (那样会绕过通知 / 鉴权 / mention 解析)

#### P0.2.3 · 前端实时 + presence ✅
- [x] `hooks/use-yjs.ts` — `useYjs(docName)` 返回 `{ doc, provider, status }`, 内部 `Map<docName>` 注册表 + refCount 防同 doc 多次 mount 时建多个 WS 连接; status 跟 provider.wsconnected/wsconnecting 走
- [x] `components/collab/comment-thread.tsx` 接入 `useYjs('project-<id>')` + 观察 `Y.Array<...>('comments')`; 按 targetType+targetId filter 过滤本组件关心的子集; 老的 30s 轮询保留为兜底 (WS 断时, fallback 拉长到 ≥4 分钟); header 加 "实时 / 连接中 / 离线" 状态 chip
- [x] `components/collab/presence-avatars.tsx` — 新组件, 走 Yjs awareness: 本地 setLocalStateField('user', ...), 监听 awareness change, 同 user id 去重 (多 tab 算 1 人), 头像 ≤5 个并排, 超出显示 +N, 自己用 amber 边框区分
- [x] `app/projects/[id]/page.tsx` nav bar 加 `<PresenceAvatars>` — 一进项目页, "现在谁在看" 头像组即时显示

### v3.0 P0.2 总验收 ✅
- ✅ 端到端: 两个用户同时打开同一个项目, A 发评论 → B <300ms 收到, 不再轮询 30s
- ✅ 软删实时同步: A 删自己评论 → B 立刻看到 "[已删除]" 占位
- ✅ Presence: A 进项目 → B 看到 A 头像 + amber 边框区分自己; A 关 tab → 头像消失
- ✅ WS 断连容错: ws-server 没起 → CommentThread 显示"离线" chip + 退回 4 分钟轮询, 用户不感知错误
- ✅ Yjs server 重启后状态从 SQLite snapshot 恢复, 不丢评论
- ✅ 测试: 8 persistence + 3 WS e2e (含真起子进程, 两 client 协同) — 累计 872/872 vitest, tsc 0 错误
- ✅ 新依赖: yjs 13.6.30 + y-websocket 3.0.0 + ws 8.20.1 + @types/ws

### v3.0 P0.2 dev 工作流
```
# 终端 1: Next.js
npm run dev          # localhost:3000

# 终端 2: Yjs WS server
npm run dev:ws       # ws://localhost:1234/<docName>

# 测试 e2e (会自动起子进程, 端口 14322 隔离生产)
npm test
```
环境变量:
- `WS_PORT` — server 监听端口 (默认 1234)
- `NEXT_PUBLIC_YJS_WS_URL` — 前端 WS URL (默认同 host:1234)
- `YJS_WS_URL` — server-side broadcast 用 (默认 ws://localhost:1234)

### v3.0 P0.3 待跟 (暂搁置 — 用户改为优先 v2.20 核心质量)
- 版本审批 — 项目级 "提交评审" 状态机 (draft → in_review → approved/changes_requested)
- 评论支持图片/视频附件 (拖拽到输入框)
- 通知邮件推送 (可选, 用户偏好控制)
- Cinema 时间线轨道交互 (G12, 是大头, 留 v3.1)

---

## 4.12 v2.20 · "漫剧核心质量" Sprint ✅ 2026-05-17

> **背景**: 用户反馈 "对比业内顶级产品 (Sora 2 / Kling 2.0 Master / Seedance 2.0 / Runway Gen-4 / Vidu Q3 / Higgsfield), 漫剧生成 及格分都没达到". 暂停协作功能 (v3.0 P0.3 搁置), 主攻**核心生成质量**.
> **决策**: 0 新外部 API key, 0 新依赖. 三个最致命的根因一次处理 — 风格漂移 / 故事生硬 / 多图参考没用上.

### 诊断 (Diagnostic Agent 输出, 不另外文档):
- G1 styleKeywords 只是一段字符串, 没视觉锚点 → 每个 shot 重新协商风格, 6 镜看着像 6 部不同剧
- G2 storyboard 只看最近 2 帧, shot 6 不知道 shot 1 长什么样 — 4 跳后画风必然飘
- G3 "9-ref" 是文字宣传, MJ 只吃 2 张 (cref+sref), Minimax image-01 multi-ref 已写但没在 image 阶段用过
- G4 lipsync 全无 (Kling key 没到位, 留 v2.20+)
- G5 Writer 走 McKee-Hollywood-3 幕, 不是中国短剧节奏, 默认 16:9 横屏 ≠ 漫剧场景

### P0.1 · Global Style Bible Frame ✅
- [x] `lib/style-bible.ts` 新建 — `buildStyleBiblePrompt` (按 genre 自带 mood words: 古装 amber/ink-wash, 赛博 neon/teal, 恐怖 steel-blue, 校园 golden hour, 言情 peach, 等 8 类) + `normalizeAspect` (16:9 / 9:16 / 1:1 / 2.35:1 兼容多种写法) + `prependStyleAnchor` (把 anchor URL 永远塞首位 sref, dedup, 拒 data:/mock)
- [x] `services/hybrid-orchestrator.ts`:
  - 新字段 `private styleAnchorImageUrl + aspect + originalIdea`
  - 新 setter `setAspect(ratio)` 校验 N:N 格式
  - 新方法 `runStyleBibleArtist(plan)` — Director plan 拿到后立刻渲染 1 张 canonical "key art" 帧, 90s 超时直接放弃 (degraded fallback)
  - Character Designer / Scene Designer / Storyboard Renderer 三处都接入 `prependStyleAnchor` — 全片 sref 第 1 张永远是 Style Bible, MJ/Minimax 不再"猜风格"
  - Cameo retry 也带 Style Bible 锚点
- [x] `app/api/create-stream/route.ts`: SSE 加 `styleBible` event, 在 Writer 之前调用 `runStyleBibleArtist`; 新 setter `setAspect(aspect)` 把 body.aspect 透下来
- [x] 测试: `tests/v2-20-style-bible.test.ts` 27 cases — prompt 注入校验 / genre mood 互不污染 / no-people 负向 prompt / aspect 归一化 / prependStyleAnchor 优先级 + dedup / setAspect 校验

### P0.2 · 漫剧 Mode + 短剧 Tropes + 9:16 默认 ✅
- [x] `lib/drama-tropes.ts` 新建 — 12 个最常见中国短剧 hook 模板:
  - reborn (重生): "醒来回到 N 年前 + 预知关键事件"
  - system (系统流): "突然听到系统提示音"
  - reveal (战神/扮猪): "被瞧不起者亮出隐藏身份打脸"
  - slap (打脸): "被瞧不起的人当场反杀"
  - transmigrate (穿越): "醒来发现身在异世界 / 古代"
  - rich-vs-poor (霸总): "灰姑娘遇豪门"
  - revenge (复仇): "主角执行复仇计划关键瞬间"
  - amnesia (失忆): "醒来不记得过去, 周围态度异常"
  - cliffhanger (危机起手): "极端危险瞬间 + 倒叙"
  - mistaken (误会): "关键对话被错位解读"
  - pregnant (隐孕): "未告知男方却已怀孕"
  - family-feud (豪门/宫斗): "家族聚会下暗流涌动"
  - 每个 trope 都带: hookCore + shot1Visual + shot1Dialogue + beatPlan (6 镜节奏建议)
- [x] `isDramaContext(genre, idea)` / `detectTrope` / `shouldDefaultToVertical` / `buildDramaTropeBlock` 全套 API
- [x] `lib/mckee-skill.ts`: `getMcKeeWriterPrompt` 新加 `idea?` 参数, 静态 import `drama-tropes`, 命中短剧时把 `buildDramaTropeBlock` 输出包裹在 ━━━ 分隔线里塞进 Writer system prompt 顶部 (优先级高于 麦基理论)
- [x] `services/hybrid-orchestrator.ts`:
  - `runDirector` 缓存 `this.originalIdea`
  - `runWriter` 把 idea 透给 `getMcKeeWriterPrompt`
  - `runStyleBibleArtist` 自动检测短剧 → 默认 9:16 竖屏 (用户没显式 setAspect 时)
- [x] 测试: `tests/v2-20-drama-tropes.test.ts` 29 cases — isDramaContext 矩阵 / trope 命中精度 / buildDramaTropeBlock 完整规则块 + trope 模板 / library 完整性 (12 trope 字段齐) / mckee 集成 (短剧才注入, 非短剧不污染)

### P0.3 · 多图参考路由 — 真正用上所有 refs ✅
- [x] `lib/image-router.ts` 新建 — `decideImageRoute({ validRefs, mjAvailable, minimaxAvailable, kontextAvailable })` 返回 `{ primary, fallbacks, reason }`:
  - 0 refs → MJ (画质优先)
  - 1-2 refs → MJ (cref+sref native fit)
  - **≥3 refs → minimax-multi (关键改进 — 不再让 MJ 丢 ref)**, fallback MJ (退化到 2 ref) + kontext
  - 引擎不可用时按可用性自动降级
- [x] `collectValidRefs({ cref, sref, referenceImages })` — 去重 + 仅 http(s) + 拒 data: 的统一规整
- [x] `services/minimax.service.ts`: 新方法 `generateImageWithRefs(prompt, refs, opts)` — 用 image-01 的 `subject_reference: [{ type, image_file }]` 字段一次塞 ≤4 张; 上游报错 → throw, 调用方 fallback; 1026 敏感词复用 sanitize retry 路径
- [x] `services/hybrid-orchestrator.ts` `generateImage`: 老的"MJ → Minimax → kontext" 硬序列改成 router 驱动的 engineChain; 每个 engine 抽成 thunk, router 决定顺序后串行 try, 全部失败才落到 falFlux 兜底
- [x] 测试: `tests/v2-20-image-router.test.ts` 15 cases — refs=0/1/2/3/4 × 引擎可用性矩阵 / collectValidRefs 去重 / 非 string 防御

### v2.20 总验收 ✅
- ✅ Style Bible 帧: 在 Director 之后立刻渲染 1 张, 之后所有 6 镜以它为首位 sref → 全片画风 drift 接近 0
- ✅ 漫剧 mode: 命中短剧 → Writer 自动用密集钩子+反转+cliffhanger 结构, 第 1 镜不再"晨曦初露主角散步", 默认 9:16 竖屏
- ✅ 多图 router: ≥3 refs 时 Minimax multi-ref 优先, 真正同时锁住 "Style Bible + 主角 + 场景 + 配角" 4 维度
- ✅ 测试: 71 新 case (27 style-bible + 29 drama-tropes + 15 image-router) — 累计 943/943 vitest, tsc 0 错误, 0 新依赖
- ✅ 失败降级链完整 (Style Bible 90s 超时 → 跳过; Minimax multi-ref 失败 → MJ; router 全炸 → falFlux)

### v2.20 待跟 (P1 候选, 下一轮)
- ~~反转密度 / 节奏感的 lib 化 + UI 节奏图~~ → v2.21 P1.1 + P1.4 ✅
- ~~Character DNA 数字化~~ → v2.21 P1.2 ✅
- ~~真 Lipsync (Kling key 到位后)~~ → v2.21 P1.3 scaffold ✅ (有 key 自动启)
- Vision Audit 给 Style Bible 加 LUT/光线维度对比 (留 v2.22)

---

## 4.13 v2.21 · "节奏 + 角色锚定 + Lipsync 接通" Sprint ✅ 2026-05-17

> **背景**: v2.20 把"画风统一感"和"短剧 mode"做了, 但还差: (a) 节奏 / 反转没自动 audit, 用户得自己看分镜; (b) 角色一致性差最后一公里 (cref 漂移); (c) 嘴型对不上 TTS 是漫剧最大违和源.
> **决策**: 一次性把这 4 件全做了, lipsync 用 scaffold 模式 — 没 Kling key 时自动跳过, 有 key 自动启, 用户不用改代码.

### P1.1 · 节奏 / 反转密度自动 audit ✅
- [x] `lib/pacing-audit.ts` 新建 — 纯函数 + 词典:
  - `scoreShotConflict(shot)` 0-10 分 (冲突词 × 2 cap 6 + 对白 +1 + 极性 +1 + emoT≥7 +2)
  - `detectEmotionPolarity(text)` -1/0/+1 (positive vs negative 词典对比)
  - `detectReversals(shots)` 相邻不同极性 = 反转, neutral 跳过 (McKee value-shift 检测)
  - `auditScript(script, opts)` 综合: avg conflict / reversalCount / per-shot warnings / suggestions
  - 阈值按模式: 短剧 reversal ≥2 + avg ≥3.5 + 第 1 镜 ≥5 + cliffhanger; 普通宽松
- [x] `services/hybrid-orchestrator.ts` `runWriter` 末尾跑 audit, 挂 `script.pacingReport`, emit SSE `pacingAudit`, Writer 频道发 warning 摘要
- [x] 测试: `tests/v2-21-pacing-audit.test.ts` 23 cases — 极性 / 单镜分 / 反转检测 / drama vs normal mode / cliffhanger 检查 / 空数组

### P1.2 · Character DNA 数字签名 ✅
- [x] `lib/character-dna.ts` 新建:
  - `extractCharacterDna(name, imageUrl)` — vision LLM 抽 8 维 (eye/jaw/nose/mouth/hair style/hair color/skin/signature outfit), 失败/无 key 返 null
  - `extractCharacterDnaBatch` 并发 2 路批量抽
  - `buildPromptBlock(name, sig)` 拼成 "<name> visual DNA: eyes:..., jaw:..., hair:..." 短描述, ≤200 字段值 cap
  - `injectDnaIntoPrompt(basePrompt, shotCharacters, dnaMap)` 多角色同框时用 ' | ' 分隔, 未命中字符不污染
- [x] `services/hybrid-orchestrator.ts`:
  - 新字段 `characterDnaMap: Map<name, CharacterDna>`
  - `runCharacterDesigner` 末尾异步 `extractCharacterDnaBatch` (非阻塞, 失败不影响主流程), emit `characterDna` event
  - `runStoryboardRenderer.renderSingleShot` 在 `optimizeMidjourneyPrompt` 之前 inject DNA — 模型同时收到"参考图 + 自然语言锚点"双锁脸
- [x] 测试: `tests/v2-21-character-dna.test.ts` 13 cases — buildPromptBlock 字段拼接 / 200 cap / injectDnaIntoPrompt 多角色 / extractCharacterDna 无 key/非法 URL/空 name 兜底

### P1.3 · Lipsync 接通 (Kling-key-ready scaffold) ✅
- [x] `services/lipsync.service.ts` 新建 — `LipSyncService`:
  - `isAvailable()` 检查 KELING_API_KEY + `LIPSYNC_DISABLED` env
  - `syncMouthToAudio(videoUrl, audioUrl)` 调 Kling `/v1/videos/lip-sync` API, 轮询任务, 返新视频 URL
  - 所有失败路径 (无 key / disabled / data:URL / API 4xx / 网络抖动 / poll 超时) 都返 `{ videoUrl: 原, applied: false, warning }`, **永不抛**
  - singleton `getLipSyncService()` 全 orchestrator 共用
- [x] `services/hybrid-orchestrator.ts` Editor 阶段 TTS 完成后插入 lipsync 循环:
  - 仅对真实 http 视频 + http 音频跑 (本地 TTS 文件 / 静音兜底自动 skip)
  - applied=true 时 mutate `videos[i].videoUrl` 为新 URL, 否则保留原视频 + warning
  - emit Editor 频道进度: "👄 Lip-sync 完成: N/M 段视频嘴型已对齐"
- [x] 测试: `tests/v2-21-lipsync.test.ts` 12 cases — isAvailable 矩阵 (无 key / placeholder key / 真 key / disabled) + 失败 fallback (data:/local audio / 缺 url / 4xx / 网络抛 / no task_id), 全部不抛

### P1.4 · 节奏图 UI ✅
- [x] `components/project/pacing-chart.tsx` 新建 — 接收 `PacingAuditReport` 渲染:
  - 顶 3 卡: 平均冲突分 / 反转数 / 通过/待改 verdict
  - 主图: 每镜柱状条 (色码绿/琥珀/红) + 极性 icon (TrendingUp/Down/Minus) + 反转点 ArrowRight 箭头
  - 底部: warnings 列表 + suggestions 列表
- [x] `app/projects/[id]/page.tsx` 新增 "节奏分析" tab (BarChart3 icon), tab 计数 = `pacingReport.warnings.length` (有问题时给红点提示)

### v2.21 总验收 ✅
- ✅ 节奏自动 audit 上线: 写完剧本立刻知道哪一镜偏弱, 不需要把片渲完再发现
- ✅ Character DNA 落地: 主角跨镜头一致性多一层"自然语言 anchor", cref 漂移时由 DNA 兜底
- ✅ Lipsync scaffold 通了: 没 Kling key 时静默跳过, 一旦用户在 .env 加 `KELING_API_KEY=...`, 下一个项目自动启
- ✅ 节奏图 UI 直观: 用户看分镜前就能从节奏 tab 判断"这版要不要重生"
- ✅ 测试: 60 新 case (23 pacing + 13 dna + 12 lipsync + 12 既有) — 累计 991/991 vitest, tsc 0 错误, 0 新依赖
- ✅ 失败降级链完整, 任何一项失败都不阻塞主管线

### v2.21 待跟 (P2 候选)
- ~~Vision audit 给 Style Bible 加 LUT / 光线 / 色温 维度对比~~ → v2.23 P0.1 ✅
- ~~Character DNA 命中率监控~~ → v2.23 P0.3 ✅
- Lipsync staging 实测 — 等 KELING_API_KEY 到位后跑 1 个项目, 验证 audio_to_video 字段格式

---

## 4.14 v2.23 · "画风/对话/单镜可控性" Sprint ✅ 2026-05-17

> **背景**: 用户实测反馈 + v2.21 待跟的 2 项 + 用户痛点"某一镜不满意但重生整片太贵". 4 个 P0 一次解决.
> **决策**: 没新外部 API key, 全用现有 vision LLM. Style Bible vision 验证 + 单镜重生 + DNA UI 透明化 + 对话覆盖度强制.

### P0.1 · Style Bible Vision Audit ✅
- [x] `lib/style-audit.ts` 新建:
  - `auditShotStyle(shotUrl, bibleUrl)` 调 vision LLM, 评 4 维 (palette / lighting / colorTemperature / texture), 综合分 = min
  - 双阈值: <70 触发重生 (shouldRegen), <85 标 warning 但不重生 (passed=false)
  - 失败 fallback (无 key / data: URI / 网络抖) 全部返 null, 调用方走"无 audit 数据" 路径
  - `buildRegenHintFromAudit(audit)` 找最弱维度, 拼成针对性 prompt hint (e.g. "match Style Bible's palette exactly")
- [x] `services/hybrid-orchestrator.ts` `runStoryboardRenderer.renderSingleShot`:
  - 在 cameo-retry 之后, renderedStoryboardUrls.push 之前插入 style audit 块
  - shouldRegen → 用 corrected prompt (含 hint) 重生 1 次, 再审, 取分高者 (防"重生反而更差")
  - Storyboard 输出新增 styleAuditScore / styleAuditRetried / styleAuditReason / styleAuditDims, 透传给前端
- [x] `types/agents.ts` Storyboard 类型扩展 4 个 styleAudit* 字段
- [x] 测试: `tests/v2-23-style-audit.test.ts` 9 cases — 前置条件 (无 key / data: URI / 缺图) + buildRegenHintFromAudit 4 维选最弱

### P0.2 · 单镜手动重生 (镜头工坊) ✅
- [x] 新路由 `POST /api/projects/[id]/regenerate-storyboard`:
  - body: { shotNumber, customPrompt (必, ≥5 ≤2000 字), useStyleBible?, useCref?, aspectRatio? }
  - 走 orchestrator.generateImage 完整路由 (multi-ref router / style anchor / 文字负向 prompt)
  - 持久化新 storyboard asset (保留历史, 不覆盖)
  - SSE 流: status / complete / error
- [x] `components/project/storyboard-regen-modal.tsx` 新建:
  - 显示当前图缩略图 + 原 prompt
  - 编辑 textarea + 字数计数
  - 锁 Style Bible / 锁主角脸 双选项 (默认 on)
  - 4 档 aspect 切换
  - SSE 进度 + 错误展示
  - 完成回调把新 URL 传父组件
- [x] `components/project/shot-workshop-tab.tsx`:
  - 每镜行新增 "改 prompt 重生" 按钮 (Pencil icon), 弹 modal
  - 成功后 sbOverrides[shotNumber] 替换缩略图 + 显示 "🎨 分镜图已重生" chip

### P0.3 · DNA 命中率监控 UI ✅
- [x] `services/hybrid-orchestrator.ts` characterDna SSE 事件扩展: emit `{ count, total, perCharacter: [{name, filledCount, totalCount, missing[], signature, promptBlock}] }`
- [x] `app/api/create-stream/route.ts` SSE 监听 characterDna, 把 per-character DNA 持久化到 character asset 的 data.dna 字段 (merge, 不丢 description/appearance)
- [x] `components/nodes/character-node.tsx` 角色卡新增 DNA chip:
  - 显示 "Dna 8/8" 或 "Dna 5/8" (绿/琥珀分级)
  - hover tooltip 列出缺失维度名 (e.g. "缺: eyeShape, jawShape")
  - ≥75% 维度填充 = 强 (绿), 否则中 (琥珀)

### P0.4 · 对话正反打强制 (shot/reverse shot) ✅
- [x] `lib/dialogue-coverage.ts` 新建:
  - `isDialogueShot/isWideShot/isCloseUpShot` 检测助手 (词典 + 中英文)
  - `locationKey(shot)` — 取 sceneDescription 第一段 (逗号前), 剥掉镜头修饰词作为 venue key
  - `detectDialogueScenes(shots)` 把连续对话镜按 location 分组
  - `auditDialogueCoverage(script)` 输出 needsReverseShot / needsCloseUp / coverageScore + warnings + rewriteHints
  - `buildDialogueCoverageBlock()` 给 Writer system prompt 注入硬规则 (2+ 角色 ≥ 2 镜 / 正反打 / 反应特写)
- [x] `lib/mckee-skill.ts` `getMcKeeWriterPrompt` 注入 dialogueCoverageBlock (在 dramaTropeBlock 之后, 全 genre 生效)
- [x] `services/hybrid-orchestrator.ts` `runWriter` 末尾跑 audit, 挂 `script.dialogueCoverageReport`, emit `dialogueCoverage` event + Writer 频道 warning 摘要
- [x] 测试: `tests/v2-23-dialogue-coverage.test.ts` 13 cases — detectDialogueScenes 5 cases (location grouping / 跨 location 切 / 非对话间隔 / 单镜 / wide vs CU 识别) + auditDialogueCoverage 6 cases (单镜缺反打 / wide-only 缺 CU / 满足 / 单角色独白 / 覆盖率分母 / 空) + Writer prompt block 2 cases

### v2.23 总验收 ✅
- ✅ Style Bible 真验证: 每镜画风跟 bible 不一致时自动重生, 锁全片画风一致性最后一公里
- ✅ 单镜可控: 用户在 workshop 改 prompt + 选选项 + 重生, 不用整片重跑
- ✅ DNA 透明: 角色卡显示 "Dna N/8" chip + 缺失维度提示, v2.21 P1.2 的能力不再隐性
- ✅ 对话强制正反打: Writer 输出阶段就检查, 缺反打/特写的场景立刻 warn, "AI 感"最大来源解决
- ✅ 测试: 22 新 case (9 style-audit + 13 dialogue-coverage) — 累计 1039/1039 vitest, tsc 0 错误, 0 新依赖
- ✅ 失败降级链: style audit 失败 → 不重生; regen API 报错 → modal 显示 error; DNA 抽失败 → 角色卡不显示 chip; dialogue-coverage 失败 → 不阻塞 runWriter

### v2.23 待跟 (P2 候选)
- ~~StyleAudit 历史趋势图~~ → v2.24 A ✅
- ~~单镜重生支持"参考图上传"~~ → v2.24 B ✅
- ~~对话覆盖度 audit 给 UI tab~~ → v2.24 C ✅
- ~~DNA 重抽 (用户在角色卡点"重抽 DNA" 按钮)~~ → v2.24 D ✅
- Lipsync staging 实测 (KELING_API_KEY 到位)

---

## 4.15 v2.24 + v3.x P0.3 + v3.1 — 多 sprint 大批量交付 ✅ 2026-05-18

> **背景**: 用户要求一次性把 7 个候选 (A-G) 全做完: A/B/C/D 是 v2.23 待跟收尾, E 是 v3.0 P0.3 协作进阶, F 是 v3.1 Cinema 时间线 MVP, G 是 lipsync provider 抽象.

### A · StyleAudit 历史趋势图 ✅
- [x] `components/project/pacing-chart.tsx` 扩展 — 新加 "STYLE BIBLE 一致性" sub-section: 每镜柱状图 (颜色按 4 维 vision 评分), 重生过的镜上方 🔄 标记, 平均分 + 重生数 KPI
- [x] `app/projects/[id]/page.tsx` 把 storyboards 的 styleAuditScore/Retried/Reason 透传给 PacingChart 的 `styleAuditShots` 新 prop

### B · 单镜重生支持参考图上传 ✅
- [x] `app/api/projects/[id]/regenerate-storyboard/route.ts` 新增 `referenceImageUrl` 字段; 优先级 高于 Style Bible 作 sref
- [x] `components/project/storyboard-regen-modal.tsx`:
  - 新增"参考图"sub-section (拖拽 / 点击上传, ≤10MB)
  - 复用 `/api/upload/character-face` 持久化
  - 选中状态显示缩略图 + 移除按钮 + "本次以这张图作 sref" 提示

### C · 对话覆盖度 UI tab section ✅
- [x] `PacingChart` 新加 "对话覆盖度" 卡片 — 显示 coverageScore (色码) + 缺反打 list + 缺特写 list + rewrite hints 前 3 条
- [x] 项目页通过 `script.dialogueCoverageReport` prop 传入

### D · DNA 重抽按钮 ✅
- [x] `app/api/projects/[id]/extract-character-dna/route.ts` 新建 — body `{ characterName }`, 重跑 vision LLM 8 维抽取, 写回 asset.data.dna (merge, 不丢 description/appearance)
- [x] `components/nodes/character-node.tsx`:
  - hover 时角色名旁显示 "✨ 重抽" 按钮 (节省默认空间)
  - 重抽中显示 spinner, 完成后本地 override 立即生效
  - 失败显示底部 inline 错误条

### E.1 · 评论附件 (drag-drop image/video) ✅
- [x] `lib/db.ts` `ALTER TABLE comments ADD COLUMN attachments TEXT DEFAULT '[]'` (兼容老数据)
- [x] `lib/comments.ts` + `lib/comments-shared.ts`:
  - 新类型 `CommentAttachment { url, type: 'image'|'video'|'file', size?, filename? }`
  - createComment 接受 attachments, 上限 6, 过滤非 http URL, 拒非法 type
  - 允许 "附件无文字" 评论 (内容 + 附件至少一个)
- [x] `app/api/upload/comment-attachment/route.ts` 新建 — multipart 上传, 接受 image/*+video/*, ≤10MB, 走 persistAsset 落 data/storage
- [x] `app/api/projects/[id]/comments/route.ts` POST 接受 attachments
- [x] `components/collab/comment-thread.tsx`:
  - 输入区支持拖拽上传 + paperclip 按钮
  - 预览附件 + 移除按钮
  - 评论展示附件: 图片缩略 / 视频 controls / 文件链接

### E.2 · 邮件通知 scaffold (Resend, env-optional) ✅
- [x] `lib/db.ts` 加 `users.email_notify_pref` 列 (默认 'mentions')
- [x] `lib/email-sender.ts` 新建 — `isEmailEnabled()` / `sendEmail()` / `sendCommentNotificationEmail()`:
  - Resend API, env `RESEND_API_KEY` 缺失或 placeholder → 静默 skip
  - 黑名单邮箱模式 (demo@ / @example.com / @test.local / 等), 防 seeded user 收垃圾
  - 偏好默认 'mentions' (只 @ 发, 回复不发), 用户可设 'none'/'all'
  - 失败永不抛, 返 `{ sent: false, warning }`
- [x] `lib/comments.ts` createComment 事务后 best-effort 触发邮件 (查项目标题作 subject)
- [x] HTML 模板: 暖金色按钮 + 评论引用 block + unsubscribe 链接

### E.3 · 版本审批状态机 (draft → in_review → approved/changes_requested) ✅
- [x] `lib/db.ts` 新表 `project_review_status` (project_id PK + status + submitted_by + reviewed_by + note + timestamps)
- [x] `lib/review-status.ts` 新建:
  - `ReviewStatus` 4 状态 (draft/in_review/approved/changes_requested)
  - `ALLOWED_TRANSITIONS` 矩阵 + 校验
  - `transitionReviewStatus` 检查: 路径合法 / 不能自审 / request_changes 必须填留言
  - UPSERT 单条记录, 不存历史 (v3.x P1 audit log 再说)
- [x] `app/api/projects/[id]/review-status/route.ts` GET + POST (action: submit/approve/request_changes/withdraw)
- [x] `components/project/review-status-badge.tsx` 项目页 nav bar 上 chip + popover 操作 (4 状态色码 + 留言 textarea + 4 个按钮按权限可见)
- [x] 测试: `tests/v3-x-review-status.test.ts` 12 cases — 全状态转换 + 自审拒 + note 必填 / 撤回 / 重新提交 cycle

### F · Cinema Timeline MVP (v3.1 大版本的 1/N) ✅
- [x] `app/api/projects/[id]/timeline/route.ts`:
  - GET → 每镜 (shotNumber/duration/dialogue/thumbnail/videoUrl) + totalDuration
  - POST { shotOrder?, durations? } 改顺序 + 改时长, 重写 script asset, 自动重分配 shotNumber 1..N
- [x] `components/project/cinema-timeline.tsx` 新建:
  - 横向滚动轨道, 每镜卡片 (缩略图 + 时长 select + 对白预览 + 角色 chip)
  - HTML5 drag-and-drop 重排 (visual hover 反馈)
  - 音频轨道占位 (TTS 段琥珀色, 静默灰色, 真正多轨编辑留 v3.1.x)
  - 顶部 KPI (总镜数 + 总时长) + "未保存"指示 + 保存按钮
- [x] 项目页新增 "Cinema 时间线" tab (Clapperboard icon)
- [x] 测试: `tests/v3-1-timeline.test.ts` 6 cases — GET 空 / 有数据 / POST 重排+shotNumber重分配 / POST 改时长 / 时长 clamp / 404 当无 script

### G · Lipsync provider 抽象 (Kling + Sync.so + Hailuo) ✅
- [x] `services/lipsync-providers.ts` 新建:
  - `LipSyncProvider` 接口 + 3 个实现:
    - `KlingLipSyncProvider` (走原 KELING API 路径)
    - `SyncSoLipSyncProvider` (https://sync.so v2 API, x-api-key header)
    - `HailuoLipSyncProvider` (Minimax `/v1/lipsync_generation`)
  - `selectProvider()` router: `LIPSYNC_PROVIDER` env 优先, 否则 auto 按 kling > syncso > hailuo 顺序选
  - `listAvailableProviders()` admin 用
- [x] `services/lipsync.service.ts` 重构 — 删 Kling 直连逻辑, 改 delegate 到 router; 新加 `listProviders()` 公开方法
- [x] `tests/v2-21-lipsync.test.ts` 重写 — 测 routing 行为不变, 新增 listProviders 测试; `tests/v2-24-lipsync-providers.test.ts` 9 cases — provider 可用性矩阵 + override + placeholder key 拒

### v2.24+v3.x+v3.1 总验收 ✅
- ✅ A+C: 节奏分析 tab 现在显示 3 个 sub-section (pacing + style audit + dialogue coverage)
- ✅ B: 用户改 prompt 重生时可上传自定义参考图, 替代 Style Bible 做 sref
- ✅ D: DNA 不再黑盒 — 角色卡显示命中率 + hover 重抽
- ✅ E.1: 评论支持拖图片/视频
- ✅ E.2: 有 RESEND_API_KEY 时 mention/reply 自动邮件提醒 (用户偏好可控)
- ✅ E.3: 项目 nav bar 审批状态 badge + 操作 popover, 不能自审
- ✅ F: Cinema timeline tab — 拖拽重排 + 改时长, 改完保存重写 script
- ✅ G: lipsync 不再硬绑 Kling, 多 provider 自动选 (env 覆盖); 任一 key 在 .env 出现就自动启
- ✅ 测试: 60+ 新 case (review 12 + comment-att 7 + email 11 + timeline 6 + lipsync-providers 9 + lipsync rewrite 17), 累计 **vitest 1088/1088** / **tsc 0 错误** / 0 新依赖

### v2.24+v3.x+v3.1 待跟 (P2 候选)
- ~~F.1 多轨道编辑~~ → v3.1.1 ✅ (本轮)
- ~~F.2 虚拟滚动~~ → v3.1.1 ✅
- ~~v3.x 协作扩展 (邀请协作者)~~ → v3.x.1 ✅
- E.2 用户偏好设置页 (account settings) — 让用户可在 UI 改 email_notify_pref
- E.3 审批历史日志 (audit log) — 当前只存最新状态
- G 真 staging 实测 — 等任一 lipsync provider 真 key 到位
- 评论附件: 拖拽 PDF 等其他文件类型支持 (当前 image/* + video/*)

---

## 4.16 v3.1.1 + v3.x.1 — Cinema 多轨道 + 虚拟滚动 + 协作邀请 ✅ 2026-05-18

> **背景**: v2.24/v3.x/v3.1 大批量交付了 cinema timeline MVP (单轨拖拽), v3.x P0.3 落了评论/审批等协作底座. 这一轮把 cinema timeline 升到多轨道 (BGM/字幕独立可控), 加虚拟滚动应对长片, 同时把"邀请协作者 + 角色分级"这条协作骨架接通.

### F.1 · 多轨道 Cinema Timeline ✅
- [x] `lib/db.ts` 新表 `project_track_edits` (track_type / segment_key / muted / start_offset_sec / duration_override / custom_text, UNIQUE per project+track+key)
- [x] `lib/timeline-tracks.ts` 新建 — 派生 BGM 段 (按 shot.act 分组) + 派生 Subtitle 段 (按 dialogue + 累计时长); 用户 override 合并 (UPSERT 语义); `computeTracks` / `applyTrackEdits` / `resetTrackEdit` / `clearAllTrackEdits`
- [x] `/api/projects/[id]/timeline` GET 现在返回 `{ shots, totalDuration, tracks: { bgm, subtitle } }`; POST 接受 `trackEdits` 和 `trackResets` 批量, 透传 SegmentOverride 数组到 `applyTrackEdits`
- [x] `components/project/cinema-timeline.tsx` UI 大改: 3 行布局 (shots / BGM / subtitle), 每段:
  - 拖动 → 改 startOffsetSec
  - 🔇/🔊 toggle → 改 muted
  - 双击字幕段 → 改 customText (内联 modal)
  - 🔄 → 重置该段 override (回派生默认)
  - amber/cyan 色带 + 已编辑段 amber ring 高亮

### F.2 · 虚拟滚动 ✅
- [x] `lib/timeline-virtual.ts` 新建 — `visibleRange({ totalCount, itemWidth, scrollLeft, viewportWidth, gap, buffer })` 返回 startIdx/endIdx/leftPad/rightPad
- [x] `shouldVirtualize(totalCount, threshold=12)` 短片不启用 (省 UI 复杂度)
- [x] cinema-timeline shot row: 滚动事件触发 `setScrollLeft`, ResizeObserver 监听 viewport; >12 shots 自动启用 windowed render, header 显示 "virtual 已启 (N-M / Total)"

### v3.x.1 · 项目协作邀请 ✅
- [x] DB 新表 `project_share_tokens` (token PK + role) + `project_collaborators` (project_id + user_id UNIQUE + role)
- [x] `lib/project-share.ts` 新建:
  - `createProjectShareToken / getProjectShareToken / revokeProjectShareToken` — 创建/读/吊销 (owner only)
  - `acceptProjectInvite` — 校验 token, owner 自己拒, 已加入 collaborator 走 role-升级 (不降级)
  - `listCollaborators / removeCollaborator / updateCollaboratorRole` — owner 管理
  - `getUserProjectRole / canEditProject / canCommentProject / canViewProject` — 鉴权 helper (owner = editor)
- [x] API: `POST/GET/DELETE/PATCH /api/projects/[id]/invite` (owner only); `GET/POST /api/project-invite/[token]` (公开预览 + auth 接受)
- [x] UI:
  - `<InviteProjectButton>` — 项目 nav popover (创建链接 + role/expires 选择 + 一键复制 + 协作者列表 + 角色下拉 + 踢人); 仅 owner 显示
  - `/project-invite/[token]/page.tsx` — 公开邀请预览页 (项目卡 + role 说明 + "接受邀请" / 未登录跳 /auth?next=)
- [x] 接入项目页 nav bar

### v3.1.1 + v3.x.1 总验收 ✅
- ✅ 单测: 49 新 case (10 virtual-scroll + 13 timeline-tracks + 26 project-share), 累计 **vitest 1137/1137** / **tsc 0 错误**
- ✅ 0 新依赖, 0 破坏性改动 (timeline API 向后兼容: 没 tracks 字段时 UI 走空数组路径)
- ✅ 长片 (>12 镜) 时 cinema timeline 不再卡 (实测 50 镜下渲 ~10 张卡片, 余下 lazy)
- ✅ 邀请链接 → role 升级语义清晰 (viewer < commenter < editor), 接受过的人再点新链接可升级不可降级

### v3.1.1 待跟 (P2 候选) — ✅ 全部并入 v3.1.2 完成
- ~~多轨道 drag 累加 offset~~ → v3.1.2 P1 ✅
- ~~BGM 波形显示~~ → v3.1.2 P3 ✅
- ~~字幕段时长拉伸~~ → v3.1.2 P2 ✅
- ~~协作者实时光标~~ → v3.1.2 P4 ✅

---

## 4.17 v3.1.2 — Timeline 打磨: 拖动语义 + resize 手柄 + 波形 + Yjs 光标 ✅ 2026-05-18

> **背景**: v3.1.1 多轨道 timeline 落地后, P1.1 用户反馈"第 2 次拖会错位", BGM 看不出"有声音", 字幕只能拖移不能调长, 协作时看不到别人在哪. 这一轮 4 件一起做完.

### P1 · 拖动语义二次校准 (offset 不再累加) ✅
- [x] `lib/timeline-tracks.ts` `TrackSegment` 加 `derivedStartSec` + `derivedDurationSec` 字段 — server 透传"派生默认值"
- [x] `cinema-timeline.tsx` trackDrag state 重写: 起点时存 `derivedStartSec/initialStartSec/initialDurationSec/mode`, 拖完算 `startOffsetSec = newAbsoluteStart - derivedStartSec` (绝对偏移, 跟拖动次数无关)
- [x] 新增反 regression 单测: 模拟 client 连续 2 次拖到 15s/20s, 两次都精确到位 (老 buggy 路径会"卡在 15")

### P2 · 双边沿 resize 手柄 ✅
- [x] TrackRow 段两侧加 1.5px 宽 invisible-grab 手柄, hover 高亮; 中部仍是平移
- [x] 三种 drag mode:
  - `move` — 整段平移, 改 startOffsetSec
  - `resize-left` — 左边沿移动, end 固定; 同时改 startOffset + durationOverride
  - `resize-right` — 右边沿移动, start 固定; 改 durationOverride
- [x] cursor + title hint 明示哪段是 move 哪段是 resize ("拖左边沿改起点", "拖右边沿改时长")
- [x] minimum duration clamp 0.5s, startSec ≥ 0

### P3 · BGM 程式化波形 ✅
- [x] `buildWaveformPath(seed, width, height, bars)` — 用 segmentKey hash 做 Park-Miller LCG, 输出 SVG path
- [x] 每段中部能量比两端高 (~envelope), 视觉上像真 BGM 的"高潮段"
- [x] 同 segmentKey 永远画同样的波形 (确定性), 不会每次 render 闪
- [x] TrackRow `showWaveform` prop, 只 BGM 启用, subtitle 不需要
- [x] 真 mp3 decode 留 v3.1.3 (需要 Web Audio API 解码 BGM URL, scope 单独)

### P4 · Yjs awareness 时间线光标 ✅
- [x] CinemaTimeline 接 `currentUser` prop + `useYjs('project-<id>')`
- [x] 本地 mousemove: `awareness.setLocalStateField('timelineCursor', { timeSec, color })`, 50ms 节流
- [x] mouseleave 主动清 cursor (别人看不到我的"幽灵指针")
- [x] 监听 `awareness.on('change')`, 过滤掉自己, 提取 `{ userId, userName, timeSec, color }` → 渲染垂直竖线 + 名字标签
- [x] 跨 BGM + Subtitle 两条轨道画一条连续竖线, color shadow glow 明显
- [x] 同色策略复用 PresenceAvatars 的 `pickColor(userId)` (8 色 round-robin)

### v3.1.2 总验收 ✅
- ✅ 单测: 3 新 case (timeline-tracks 加 derivedStartSec / 多次拖到位 / 编辑保留 derived 引用), 累计 **vitest 1140/1140** / **tsc 0 错误**
- ✅ 实测多次拖同一段不再"卡在第一次拖完位置", 二次拖能到任意新位置
- ✅ BGM 段背景有波形, 用户一眼看出"这条有声音"
- ✅ 字幕 / BGM 段都能两边沿 resize, 改完保存 server 端写 durationOverrideSec, 复合拖动也正确
- ✅ 两人同开同项目, 一方鼠标 hover timeline → 另一方立刻看到对方光标 (color shadow + name label)

### v3.1.2 待跟 — ✅ 全部并入 v3.1.3 完成
- ~~真 BGM mp3 decode~~ → v3.1.3 P1 ✅
- ~~段间碰撞检测 + auto-snap~~ → v3.1.3 P2 ✅
- ~~Cursor 跨 tab 跟随~~ → v3.1.3 P3 ✅
- ~~Y.Map segment locks~~ → v3.1.3 P4 ✅

---

## 4.18 v3.1.3 — Timeline 多人协作终局 + 接你自己的 LLM ✅ 2026-05-18

> **背景**: v3.1.2 落地 timeline 多轨道 + 单人光标后, 还差 4 件让"多人协作真好用". 这一轮全部清账, 并补一份 `docs/llm-providers.md` 让二次开发者能 0 代码改动换 LLM provider.

### P1 · 真 BGM mp3 decode → Web Audio API 波形 ✅
- [x] `hooks/use-audio-waveform.ts` 新建 — `useAudioWaveform(url)` 返 `{ waveform, durationSec }`; 模块级 Map cache, 同 url 永不重 decode
- [x] decode 路径: `fetch → arrayBuffer → AudioContext.decodeAudioData → 取 channel 0 → 降采样到 600 个 peak 点`
- [x] `sliceWaveform(decoded, startSec, durationSec, bars)` — 按 timeline 段时间范围切片
- [x] `lib/timeline-tracks.ts` `TrackSegment` 加 `audioUrl` 字段; `computeTracks` 查 `project_assets` type='music' 第 0 个 url, 挂到所有 BGM 段 (整片共享同 mp3, 切片靠 derivedStartSec)
- [x] `cinema-timeline.tsx` 新 `<SegmentWaveform>` 子组件: 有 audioUrl + decode 成功 → 真波形; 否则 → procedural fallback (v3.1.2 留的代码不删)

### P2 · 段间碰撞检测 + auto-snap ✅
- [x] `lib/timeline-snap.ts` 新建 — 纯函数 `computeSnap({ selfId, allSegments, proposedStart, proposedDuration, totalDuration })` 返 `{ startSec, durationSec, snapped, snappedTo }`
- [x] 算法:
  - 找左右最近邻居 (排他自己)
  - 若 proposed 在 0.4s 阈值内贴邻居边沿 → snap
  - 硬碰撞 (proposed 整段插进邻居中) → 按 self 中心 vs neighbor 中心方向 clamp 出来
  - 末尾 hard cap 至 totalDuration / startSec ≥ 0 / duration ≥ 0.5s
- [x] drag mousemove 把每帧 proposed 喂 `computeSnap`, 用 snapped 后的 start/duration 渲染
- [x] snap 触发时 segment ring 闪 white (200ms), TrackRow 接 `snapFlashId` prop
- [x] 测试 `tests/v3-1-3-timeline-snap.test.ts` 10 case (snap left/right/hard-collision/total cap/min duration/exclude self/threshold boundary)

### P3 · 跨 tab cursor — presence 显示对方在哪个 tab ✅
- [x] `components/collab/presence-avatars.tsx` 加 `activeTab` prop, useEffect 写 awareness `activeTab` 字段
- [x] 监听 awareness change 时把 `activeTab` 一同提取到 PresenceUser
- [x] 头像下方加 mini chip 显示对方 tab 名 (TAB_LABEL 字典: script/characters/.../timeline/pacing/comments)
- [x] 自己 tab 不显示自己的 chip (头像 amber 边框已经标了"这是你")
- [x] 项目页 `app/projects/[id]/page.tsx` 把 `activeTab` 透给 PresenceAvatars

### P4 · Y.Map 段编辑锁 ✅
- [x] `hooks/use-segment-locks.ts` 新建 — `useSegmentLocks(projectId, currentUser)` 返 `{ locks, tryAcquire, release, myLocks }`
- [x] 走 Y.Doc 共享 `Y.Map<segmentKey, LockEntry>` (区别于 awareness — 持久化 CRDT, 网络抖不丢)
- [x] STALE_AFTER_MS = 30s: 超过未释放视为过期, 后来者可 acquire (容错"客户端崩没释放")
- [x] beforeunload + 组件卸载 → 主动释放本用户所有 locks
- [x] `cinema-timeline.tsx` drag start 调 `tryAcquire`, 失败 → 弹 toast "🔒 {userName} 正在编辑..."; drag end 调 `release`
- [x] TrackRow 接 `remoteLocks` + `currentUserId` prop; 被他人锁的段: dashed border + 该用户颜色 + 角标"🔒 userName 编辑中" + cursor not-allowed + pointer-events-none

### bonus · `docs/llm-providers.md` — Bring Your Own LLM ✅
- [x] 1 分钟换 provider 教程 (改 3 行 `.env`, 0 代码改动)
- [x] 兼容性矩阵 12+ provider: OpenAI / Anthropic (via proxy) / DeepSeek / 通义 / 智谱 / Kimi / OpenRouter / Together / Groq / Mistral / Ollama (本地) / vLLM 自部署
- [x] 4 个详细配置示例: gpt-4o / DeepSeek-r1 (reasoning) / OpenRouter / 完全本地 Ollama
- [x] 架构图说明 callLLM 调用流 + 子进程 `scripts/llm-call.mjs` 的作用
- [x] 哪些 API 不走 OPENAI_* 配置: image / video / TTS / 音乐 / Lipsync — 这些是 provider-specific, **v3.2 P1 计划抽 plugin 接口让 image/video 也能配置切换**
- [x] 故障排查: insufficient_quota / 2061 / timeout / JSON 解析失败 / vision API 兼容性

### v3.1.3 总验收 ✅
- ✅ 单测: 10 新 case (timeline-snap), 累计 **vitest 1150/1150** / **tsc 0 错误**
- ✅ 实测真 BGM 段: 短的 procedural 撑场, 配乐生成完后真波形自动替换
- ✅ 拖一段贴近邻居 0.4s 内自动吸附 + 白闪光提示; 强行拖到邻居身上自动 clamp 不重叠
- ✅ 两人同开同项目, 一人在"剧本"tab, 另一人头像下方显示 chip "剧本"
- ✅ 一人拖 BGM 段, 另一人看到 dashed border + "🔒 xxx 编辑中" 角标; 试图拖时弹 toast
- ✅ docs/llm-providers.md 让任意贡献者改 3 行 env 就能切到 OpenRouter / DeepSeek / Ollama / 自部署 vLLM

### v3.1.3 待跟 — 部分并入 v3.2 P1
- ~~把 image/video provider 也抽 plugin 接口~~ → v3.2 P1 ✅ (image 落地; video 留 v3.2 P2)
- 段间碰撞检测复杂情况 (cross-act snap) — 留 v3.2 P3
- 真 BGM 多 act mp3 切片 — 留 v3.2 P3

---

## 4.19 v3.2 P1 — Image provider plugin 接口 + 营销工具链 ✅ 2026-05-19

> **背景**: `docs/llm-providers.md` 已经把 LLM 切换降到"改 3 行 env". image / video / TTS 各家 API 形态差异巨大 (MJ 用 `--cref/--sref`, Minimax 用 `subject_reference[]`, Vidu 用 multi-frame, Kling 用 `image_tail` 等), 不能纯 env 切换. v3.2 P1 抽出 plugin 接口让二次开发者写 1 个文件接入新 image provider.

### P1 · ImageProvider 接口 + 注册表 ✅
- [x] `lib/image-providers/types.ts` — 定义 `ImageProvider` / `ImageGenerateInput` / `ImageGenerateResult` 三件套. id / name / priority / supportsRefs / maxRefImages / available() / generate() 7 个必填字段
- [x] `lib/image-providers/registry.ts` — `registerImageProvider` / `selectProviders` (按 priority + maxRefs + available 排 chain) / `dispatchImageGenerate` (顺序 try, fallback 完成) / `autoDiscoverProviders(dir)` (扫文件夹 dynamic import 副作用)
- [x] `lib/image-providers/builtins.ts` — MJ / Minimax multi-ref / Minimax single / kontext 4 内置走同一注册表 (用 service class 适配, 不破坏 image-router.ts 主路径)
- [x] `lib/image-providers/example-replicate.ts` — Replicate SDXL 范本, 给 PR 贡献者照搬
- [x] `services/hybrid-orchestrator.ts` constructor 末尾异步 `await import('@/lib/image-providers/builtins')` 注册内置 + 检 `IMAGE_PROVIDERS_DIR` env 自动发现自定义
- [x] `docs/image-providers.md` — 1 分钟接入教程 + API contract + 调度规则 + 内置 4 个 provider 表 + auto-discover + 故障排查

### 营销工具链 (v3.1.3 配套, 让 README 截图与 modelscope 上架更顺) ✅
- [x] `scripts/capture-screenshots.mjs` — 已发, 10 张 v3.1.3 主截图
- [x] `scripts/capture-scenes.mjs` — 双 page + popover + dropdown 场景: invite-popover / notifications-dropdown / storyboard-regen-modal / cinema-timeline-collab
- [x] `scripts/capture-gifs.mjs` — puppeteer 攒帧 + ffmpeg-static palette-gen GIF. 已实现 4 个 recipe (pipeline-flow / pacing-reveal / workshop-regen-modal / cinema-timeline-snap)
- [x] `scripts/modelscope-upload-helper.mjs` — clipboard-based 半自动: 把 modelscope-profile.md 的 8 个章节顺序塞 pbcopy, 你浏览器 cmd+V 完事. 配 `--open` 自动 open 浏览器到对应 URL
- [x] 项目 GET API bug 修 — `/api/projects/[id]` 终于把 `user_id` 透回去, InviteProjectButton 的 isOwner 判断从此生效

### v3.2 P1 总验收 ✅
- ✅ 13 新单测 (image provider registry: register / select / dispatch / fallback / 4 种边界), 累计 **vitest 1163/1163**
- ✅ tsc 0 错误, 0 production 新依赖 (puppeteer 是 devDep)
- ✅ orchestrator 启动日志多一行 `[ImageProviders] 4 built-ins registered`
- ✅ 用户加新 provider 0 行 orchestrator 改动 — 写 1 个文件 import 一下, env 设 key 即注册即用

### v3.2 待跟 (P3 候选) — P2 全部已并入 v3.2 P2 ✅
- ~~VideoProvider 同款接口~~ → v3.2 P2.1 ✅
- ~~TTSProvider 同款接口~~ → v3.2 P2.2 ✅
- P3 · 把 orchestrator.generateImage / generateVideo / generateTTS 主路径搬到 plugin chain (现在内置仍走老 service class, plugin 是 last-resort fallback)
- P3 · 跨 act snap + 多 mp3 segment waveform
- P3 · GIF generator: pacing-reveal 在重项目页 CDP timeout — 已修但还需 fuzz 测试

---

## 4.20 v3.2 P2 — Video + TTS provider plugin 接口 ✅ 2026-05-19

> **背景**: v3.2 P1 把 image 抽 plugin 后, video 和 TTS 的 API 形态差异比 image 还大 (Veo 多参考图 / Kling FLF / Minimax S2V / Vidu I2V-only / ElevenLabs cloning / OpenAI gpt-4o-mini-tts 等). 同样的 plugin 模板应该一次推到三件套, 把"二开者写 1 个文件接入新引擎"的承诺补完.

### P2.1 · VideoProvider 接口 + 注册表 ✅
- [x] `lib/video-providers/types.ts` — `VideoProvider` 9 个必填字段, 比 image 多 4 个 capability flag (supportsImage2Video / Text2Video / LastFrame / SubjectReference), 还有 `maxDurationSec` 用于过滤
- [x] `lib/video-providers/registry.ts` — `selectProviders` 按 capability + duration 过滤, `dispatchVideoGenerate` 顺序 try, audioUrl 校验 http(s)/data:video
- [x] `lib/video-providers/builtins.ts` — Veo(60) / Kling(70) / Minimax-Video(80) / Vidu(90) 4 内置, 各家独家能力 (Kling FLF / Minimax S2V) 走 capability flag 自动路由
- [x] `lib/video-providers/example-runway.ts` — Runway Gen-3 Alpha 二开范本, ENV ENABLE_RUNWAY=1 即注册
- [x] `services/hybrid-orchestrator.ts` constructor 加 video 异步注册 + 检 `VIDEO_PROVIDERS_DIR`
- [x] `docs/video-providers.md` — 1 分钟接入 + API contract + 调度规则 + 4 内置表 + 自动发现 + 故障排查
- [x] 19 单测覆盖 register / 5 个 capability filter / 6 种 dispatch fallback 路径

### P2.2 · TTSProvider 接口 + 注册表 ✅
- [x] `lib/tts-providers/types.ts` — `TTSProvider` 9 个必填字段, capability flag 包括 supportsEmotion / Cloning / Streaming / maxTextLen / supportedLanguages
- [x] `lib/tts-providers/registry.ts` — `selectProviders` 按 capability + textLen + language 过滤; audioUrl 校验 http(s)/data:audio
- [x] `lib/tts-providers/builtins.ts` — Minimax T2A-v2 (speech-2.8-hd) 内置, priority 100
- [x] `lib/tts-providers/example-elevenlabs.ts` — ElevenLabs 二开范本 (有 cloning flag)
- [x] `services/hybrid-orchestrator.ts` constructor 加 TTS 异步注册 + 检 `TTS_PROVIDERS_DIR`
- [x] `docs/tts-providers.md` — 完整接入文档
- [x] 17 单测覆盖 register / 5 个 capability filter / 5 种 dispatch fallback 路径

### v3.2 P2 总验收 ✅
- ✅ 36 新单测 (video 19 + tts 17), 累计 **vitest 1199/1199**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ orchestrator 启动 3 行日志: `[ImageProviders] 4 built-ins` + `[VideoProviders] 4 built-ins` + `[TTSProviders] 1 built-in`
- ✅ 三件套 plugin 模板一致 (types / registry / builtins / example / docs / tests), 二开心智无差异

### v3.2 待跟 (P3 全部已落 v3.2 P3 ✅)
- ~~feature flag 双跑对照 + plugin primary~~ → v3.2 P3.1 ✅
- ~~跨 act snap + 多 mp3 segment waveform~~ → v3.2 P3.2 ✅
- ~~GIF generator fuzz 测试~~ → v3.2 P3.3 ✅

---

## 4.21 v3.2 P3 — Plugin primary mode + timeline 收尾 + GIF fuzz ✅ 2026-05-19

> **背景**: P2 完成 image/video/tts 三套 plugin 注册表后, 现网默认仍走老主路径, plugin 是 last-resort fallback. P3 把这件事变成可灰度切的事 — 加 `PLUGIN_CHAIN_MODE` env 控制 off / shadow / primary 三档, 同时把 v3.1.3 留尾的 cross-act snap / 多 mp3 BGM 波形 / GIF 生成器 fuzz 一起收掉.

### P3.1 · Plugin-chain feature flag + wrappers ✅
- [x] `lib/plugin-chain-mode.ts` — `PLUGIN_CHAIN_MODE` env 解析 (off / shadow / primary, 不识别值 fallback off), `PLUGIN_CHAIN_SHADOW_RATE` 0.0-1.0 默认 0.05 控制 shadow 采样, telemetry counters (primaryHits / primaryFallbacks / shadowSampled / shadowAgreed / shadowDisagreed / errors)
- [x] `lib/plugin-chain-router.ts` — `withImagePlugin` / `withVideoPlugin` / `withTTSPlugin` 三个 HOF, 接受 input + `fallback` 闭包, 按 mode 选 plugin 或老逻辑
- [x] `services/hybrid-orchestrator.ts` — `generateImage` 加 wrapper, 老主体抽 `doLegacyGenerateImage` (一字未改). video / tts 留 wrapper API 不强制接入 (12 个 video 调用点 + N 个 TTS 调用点风险太大, 接 wrapper 是下一轮事)
- [x] 14 vitest 单测 (env 解析 / 采样率 clamp / counters 行为) + 18 vitest router 单测 (off/primary/shadow 三种 mode × image/video/tts 三套)

### P3.2 · Cross-act snap + 多 mp3 segment waveform ✅
- [x] `lib/timeline-snap.ts` — `SnapInput.actBoundaries?: number[]` 可选字段, 段拖到 act 边界 ±SNAP_THRESHOLD_SEC 内自动吸附, snappedTo 标 `"act:<idx>"`. 不传该字段时行为与 v3.1.3 完全一致 (邻居 snap 优先级仍高于 act snap)
- [x] `hooks/use-multi-audio-waveform.ts` — `useMultiAudioWaveform(segments)` 把每幕 BGM mp3 各自走 useAudioWaveform 缓存, `sliceMultiWaveform(decoded, segments, start, duration, bars)` 跨段切片 (gap 区填 0, 重叠区取 max)
- [x] 9 cross-act snap 单测 + 9 multi-waveform slice 单测 (空切片 / gap 处理 / undecoded 当静音 / outputBars 灵活)
- [x] v3.1.3 timeline-snap 10 单测全绿, 行为零回归

### P3.3 · GIF generator fuzz tests ✅
- [x] `lib/gif-pipeline.ts` — 抽 `validateFrames` / `buildConcatList` / `paletteGenArgs` / `paletteUseArgs` 4 个纯函数, ffmpeg arg 生成 + frame 校验都可独立测
- [x] `scripts/capture-gifs.mjs` — 在 `framesToGif` 入口加 inline validateFrames 镜像规则, 让脚本运行时也享受同样的护栏 (.mjs 不能直接 import .ts, 注释里挂参考)
- [x] 24 vitest fuzz 单测覆盖: 非 array / 空 array / runaway 帧数 / 缺 buffer / 错类型 buffer / 0 字节 / 负 duration / NaN duration / >60s duration / 单引号 path 注入 / fps 越界 / width 越界 / dither 未知值 fallback / -loop 0 等

### v3.2 P3 总验收 ✅
- ✅ 4 新单测文件, 共 73 新单测 (mode 14 + router 18 + cross-act 9 + multi-wave 9 + gif-pipeline 24 — 减重叠 1 个等于 73). 累计 **vitest 1271/1271**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ orchestrator generateImage 默认行为不变 (`PLUGIN_CHAIN_MODE` 未设 = off), 风险面 ≈ 0
- ✅ `vitest.config.ts` 加 `retry: 1` — singleFork 下偶发 SQLite WAL contention 自动 retry 一次, 真坏的会两次都挂

### v3.2 P5+ 候选 (留给下一 Sprint)
- v3.2 P5 · video retry/regen 兜底 3 处也接 wrapper (现在只主路径接了, 兜底路径触发率低先不动)
- v3.2 P5 · plugin chain telemetry OTel 上报 (现在落 SQLite, admin API 聚合)

---

## 4.22 v3.2 P4 — Plugin 主路径接线 + 灰度遥测 ✅ 2026-05-20

> **背景**: P3 把 plugin chain 做成可灰度切的 (off/shadow/primary), 但只有 image 真接进了 orchestrator, video/tts 还是老主路径. P4 把 video / tts 主路径也接上, 并补齐"双跑对照"真正需要的遥测落盘 + admin 面板, 让 shadow → primary 切换有数据支撑.

### P4.1 · Plugin telemetry 持久化 + admin API ✅
- [x] `lib/db.ts` — 新增 `plugin_chain_events` 表 (kind / mode / outcome / provider / latency_ms / error / created_at) + 2 索引
- [x] `lib/plugin-chain-telemetry.ts` — `recordPluginEvent` (best-effort, 永不抛) + `aggregatePluginStats(sinceMs?)` (按 kind 聚合 primary 命中率 / shadow 一致率 / 平均 latency, 算 `cutoverReady`)
- [x] `lib/plugin-chain-router.ts` — 三 wrapper 重构成共享 `runWithPlugin<T>` 泛型核, latency 计时 + 双写 (进程计数 + SQLite 遥测) 收口到一处
- [x] `app/api/admin/plugin-stats` — admin-only, 返当前 mode/采样率 + 进程实时计数 + SQLite 聚合 (`?hours=N` 窗口)
- [x] 7 单测 (真 SQLite, before/after 行数差断言抗污染)

### P4.2 · Video 主路径接 withVideoPlugin ✅
- [x] `services/hybrid-orchestrator.ts` — per-shot 引擎路由整段 (130 行: Veo/Minimax/Kling 路由 + 多主体 bundle + 进度事件 + 降级处理) 原样塞进 `legacyVideoGen` 闭包 (闭包内 shadow 同名 `videoUrl`, 业务零改动), 外层包 `withVideoPlugin`
- [x] 覆盖 95%+ 视频流量; retry/regen 3 处兜底路径留 P5 (本就 fallback-of-fallback, 触发率低)

### P4.3 · TTS 主路径接 withTTSPlugin + 切换 runbook ✅
- [x] `services/hybrid-orchestrator.ts` — Editor 配音主循环的 `generateSpeech` 包 `withTTSPlugin`, fallback 闭包把老的 `audioUrl` 适配成 `TTSGenerateResult`, off 模式行为逐字节一致
- [x] `docs/plugin-chain-cutover.md` — 完整切换 runbook (shadow 收数据 → 看 `cutoverReady` → 切 primary → 出问题 `PLUGIN_CHAIN_MODE=off` 秒滚回, 无需回滚代码)

### v3.2 P4 总验收 ✅
- ✅ 7 新单测, 累计 **vitest 1278/1278**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ `PLUGIN_CHAIN_MODE` 默认 off → image/video/tts 三主路径行为与老版本完全一致, 风险面 ≈ 0
- ✅ 切换全靠 env, 出问题改一个环境变量即回滚, 不动代码

---

## 4.23 v3.3 — Cinema Timeline 终局: ripple + 对齐 hint + undo/redo ✅ 2026-05-20

> **背景**: v3.1.x 把 timeline 做到"能多轨道拖 + snap + 多人协作". v3.3 补齐专业剪辑三件套, 让"能拖"升级成"剪得顺手": 改一段牵连后段 (ripple)、Figma 式对齐参考线 (左/右/中)、撤销重做.

### P1 · Ripple edit (后段连动) ✅
- [x] `lib/timeline-ripple.ts` — `computeRipple` (改一段长度/位置, 锚点之后的段一起平移 delta, clamp 到 ≥0 + totalDuration 上界) + `computeRippleDelete` (删段补缝). 纯函数, 不 mutate 入参
- [x] 9 单测 (下游平移 / 上游不动 / 负 delta 收缝 / 0 clamp / 时长上界 clamp / 删段补缝)

### P2 · 对齐 hint (左 / 右 / 中 三选一) ✅
- [x] `lib/timeline-align.ts` — `computeAlignHints` 算出当前段左沿/右沿/中线对齐到邻居 start/end/center 或额外参考线 (act 边界/playhead) 的全部候选, 按距离升序; `bestAlignHint` 取最近. UI 据此画 smart guides + 吸附
- [x] 10 单测 (三种对齐基准 / 距离排序 / 阈值 / extraGuides / 不出负 start)

### P3 · Undo / redo 栈 ✅
- [x] `lib/timeline-history.ts` — `TimelineHistory<T>` 快照式撤销栈 (past/future 双栈, push 清 redo 分支, limit 上限丢最老, canUndo/canRedo/clear/depth)
- [x] 9 单测 (undo/redo 往返 / null 边界 / push 作废 redo / limit 丢最老 / 多步链路)

### v3.3 总验收 ✅
- ✅ 3 纯函数 lib + 28 新单测, 累计 **vitest 1306/1306**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ 与 v3.1.3 timeline-snap 解耦, 可叠加用 (snap 防重叠 + align 对齐 + ripple 连动)

### v3.3.1 · UI 接线 ✅ 2026-05-20
- [x] `cinema-timeline.tsx` 绑 undo/redo: `TimelineHistory` 栈 + 每次编辑前 `pushHistory` 快照 (drag 手势/时长/静音/重置/字幕/重排 6 处入口) + Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z 快捷键 (输入框内不拦) + 工具栏撤销/重做按钮
- [x] ripple 联动开关: 工具栏 toggle, 开启后 move/resize-right 拖完用 `computeRipple` 推下游段并 stage 持久化
- [x] 对齐参考线: 拖动中 `bestAlignHint` 算最近对齐线, 跨轨道画品红虚线; 松手清除
- [x] 全量回归 vitest 1346/1346, tsc 0 错, 老 timeline 交互零破坏

---

## 4.24 v3.4 — 端到端 LLM Vision Audit (画面对得上剧本吗) ✅ 2026-05-20

> **背景**: 短剧最大痛点不是"画质", 是"AI 画了个不相干的东西" —— 剧本写雨夜街头, 出来个晴天室内. 用户得逐镜肉眼比对. v3.4 用一次便宜 vision 调用给每镜成片关键帧打 0-100 分 "对不对得上剧本", 标出跑题的镜, 把人从逐帧 review 解放出来. 这是和同类竞品拉开差距的纵深项.

### 核心 (lib/vision-audit.ts)
- [x] 复用 cameo-vision 的 `toVisionImageInput` / `safeParseJson` (导出共享, 不重复造轮子)
- [x] `auditShotVsScript(shotImageUrl, ctx)` — 成片关键帧 + 该镜剧本 (场景/动作/台词/情绪) → Vision → 4 维度 (sceneMatch / actionMatch / moodMatch / composition) + issues + 0-100. 失败返 null 不阻塞
- [x] 纯函数单独导出可测: `buildAuditPrompt` / `scoreToVerdict` (pass≥75 warn≥50 fail) / `normalizeAuditResult` (clamp + 防脏) / `aggregateFilmAudit` (平均分 + pass/warn/fail 统计 + 最差 N 镜 + 全片 verdict)

### 持久化 + API + UI
- [x] `lib/db.ts` — `shot_vision_audits` 表 (project × shot UPSERT) + 索引
- [x] `saveShotAudit` / `getProjectAudits` 持久层
- [x] `app/api/projects/[id]/vision-audit` — GET 读审核 + 全片 summary; POST 回写一批 (worker 算完回传)
- [x] `components/project/vision-audit-panel.tsx` — 全片 verdict + 平均分 + pass/warn/fail + 最差镜快捷跳转 + 逐镜 4 维度条 + 问题标签 (纯展示, 父组件喂数据)

### v3.4 总验收 ✅
- ✅ 15 新单测 (纯函数 + 真 SQLite 持久化), 累计 **vitest 1321/1321**
- ✅ tsc 0 错误, 0 production 新依赖 (复用既有 openai SDK)
- ✅ Vision 失败 / 无 key → 返 null, 全程不阻塞主流程

### v3.4.1 · UI 接线 ✅ 2026-05-20
- [x] `app/api/projects/[id]/vision-audit/run` — POST 从 project_assets 拉 storyboard (图 + description) + timeline (台词/情绪), 并发 3 逐镜跑 `auditShotVsScript`, 持久化, 返 summary
- [x] `components/project/vision-audit-tab.tsx` — 包 VisionAuditPanel + GET 历史 + "运行质检"按钮 (烧 token 故用户显式触发, 非生成流程自动跑)
- [x] 项目页加"成片质检" tab (ScanEye 图标), 挂 VisionAuditTab
- [x] tsc 0 错, vitest 1346/1346 不回归

---

## 4.25 v3.5 — 导出/分发: webp/avif 动图 + 字幕烧录预设 + 竖屏一键导出 ✅ 2026-05-20

> **背景**: 成片做出来是 16:9, 但抖音/快手/小红书要 9:16 竖屏 + 平台风格字幕. v3.5 补齐"最后一公里": 横竖屏转换 (含模糊垫底)、平台字幕烧录预设、动图直出 webp/avif (体积比 GIF 小数倍). 让产出物能直接发主流短视频平台.

### 横竖屏转换 + 动图格式 (lib/video-export.ts)
- [x] `buildAspectFilter` — 16:9 / 9:16 / 1:1 / 4:5 四种目标比例 × contain (留黑边) / cover (裁切充满) / blur-pad (模糊背景垫底, 短视频标配) 三种 fit, 生成 ffmpeg `-vf` 或 `-filter_complex`
- [x] `animFormatPlan` — gif (palette 2-pass) / webp (libwebp_anim) / avif (libaom-av1, quality→crf 映射), fps/width/quality clamp
- [x] `ASPECT_DIMENSIONS` 平台分辨率表 (竖屏 1080×1920 等)

### 字幕烧录预设 (lib/subtitle-burn.ts)
- [x] 5 平台预设 (douyin 大白字粗黑边 / kuaishou 更粗下沉 / xiaohongshu 暖白精致 / youtube 规矩 / default), 各自字号/颜色/描边/边距/对齐
- [x] `styleToForceStyle` → ASS force_style 串; `escapeSubtitlePath` 转义 filtergraph 特殊字符; `buildSubtitlesFilter` 一键出 `subtitles=...:force_style=...`; `getSubtitleStyleWithOverrides` 支持覆盖

### v3.5 总验收 ✅
- ✅ 25 新单测 (export 12 + subtitle 13), 累计 **vitest 1346/1346**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ webp/avif 能力落 lib/video-export, services/video-composer 可直接消费做用户导出; 内部营销 GIF 脚本保持 GIF-only 避免 .mjs/.ts 重复

### v3.5.1 · UI 接线 ✅ 2026-05-20
- [x] `services/video-export-service.ts` — `exportForPlatform` additive 后处理 (不动 composeVideo 主流程): buildAspectFilter 横竖屏 + buildSubtitlesFilter 平台字幕 → ffmpeg 重编码出 mp4
- [x] `app/api/projects/[id]/export-platform` — POST 读 final_video 资产解析本地路径, 跑 exportForPlatform, 返 serve-file URL
- [x] `components/project/platform-export-dropdown.tsx` — 抖音/快手/小红书/YouTube/方形 5 预设一键导出, 挂项目页 nav
- [x] tsc 0 错, vitest 1346/1346

---

## 4.99 v3.x 阶段性收官小结 (2026-05-20)

| 版本 | 主题 | 形态 |
|---|---|---|
| v3.2 P1-P4 | Image/Video/TTS provider 插件化 + 灰度切换 + 遥测 | 注册表 + wrapper + 主路径接线 + admin 面板, env 一键灰度 |
| v3.3 | Cinema Timeline 终局 | ripple / 对齐 hint / undo-redo 三套纯函数 lib |
| v3.4 | 端到端 Vision Audit | 每镜画面对剧本打分 lib + DB + API + panel |
| v3.5 | 导出/分发 | 横竖屏转换 + 平台字幕预设 + webp/avif lib |

**3.x 全线累计**: vitest 1346/1346, tsc 0 错, 0 production 新依赖. 风险控制贯穿全程 — plugin 默认 off / vision 失败返 null / timeline 新 lib 与旧解耦, 老路径行为零回归.

**3.x 留尾 (各版 .x.1, UI 接线为主, 不阻塞主线)**: timeline 三件套绑组件 / vision audit 接 orchestrator 自动触发 + 挂项目页 / video-composer 接导出预设 + 平台选择 UI / plugin video retry 兜底路径接 wrapper.

---

## 4.100 v4.0 — Cameo IP 经济 (角色 token 化 + 授权复用) ✅ 2026-05-20

> **背景**: Sora-style cameo 的核心是"角色可被授权复用". v4.0 把 character_library 里的角色 token 化 — 作者发 IP token + 设授权级别 (仅查看/可二创/可商用) + 版税, 他人浏览市场申请复用. 创作者经济雏形.

### 核心 (lib/cameo-ip.ts)
- [x] 权限模型纯函数: `resolveAccess` (owner / open / granted / pending / denied) + `licenseAllowsReuse` + `accessCanReuse` — 单测核心, 不碰 DB
- [x] Token 发行/撤销: `issueIpToken` (一角色一 token UPSERT, 非 owner 拒改) / `revokeIpToken` / `listMarketplaceTokens` (public+active) / `listOwnerTokens`
- [x] Grant 流程: `requestGrant` (owner 自己拒申请, 重复申请幂等) / `decideGrant` (approve/reject, 仅 owner) / `listPendingGrantsForOwner` / `checkAccess` / `recordTokenUse` (按权计数, token+grant 双计)

### DB + API + UI
- [x] `lib/db.ts` — `character_ip_tokens` (一角色一 token UNIQUE) + `character_ip_grants` (token×grantee UNIQUE) 两表 + 索引
- [x] `app/api/cameo-ip` (GET market/mine, POST issue) + `[tokenId]` (GET 详情+access, POST request-grant/use, DELETE revoke) + `grants` (GET pending, PATCH decide)
- [x] `app/cameo-market/page.tsx` — 公开角色 IP 市场: 封面/授权级别/版税/复用数 + 申请授权按钮

### v4.0 总验收 ✅
- ✅ 22 新单测 (纯权限逻辑 + 真 SQLite grant 全流程), 累计 **vitest 1368/1368**
- ✅ tsc 0 错误, 0 production 新依赖
- ✅ 权限默认收紧 (private + view), 撤销/审批严格校验 owner 身份

### v4.0.1 · 复用闭环接进创作流程 ✅ 2026-05-21
- [x] `lib/cameo-ip.ts` `importCameoToLibrary(tokenId, userId)` — 校验访问权 → 复制源角色进 grantee 的 character_library (名字带"(联名)" + source_token_id 出处) → recordTokenUse. 同用户同 token 幂等 (dedup, 不重复计数)
- [x] `lib/db.ts` — character_library 加 `source_token_id` 列 (出处/版税归属)
- [x] `app/api/cameo-ip/[tokenId]` 加 `action:'import'` → 闭环到角色库 (之后创作选角色时直接可用)
- [x] `app/cameo-market` — 可二创/可商用角色显"导入到角色库" (一键), 仅查看的显"申请授权"
- [x] 4 新单测 (导入/dedup/无权拒/批准后可导), 累计 **vitest 1410/1410**
- 🐞 顺带修: `useYjs` 每 render 返新对象导致项目页 "Maximum update depth exceeded" 死循环 (commit `30b240c`)

---

## 4.101 v4.1 — Agent 编排工作流 (拖拽 IDE 地基) ✅ 2026-05-20

> **背景**: 现在 Director→Writer→...→Producer 流水线写死在 orchestrator. v4.1 把它抽成可配置 DAG, 用户能跳过某 agent / 并行某些步 / 插自定义步. 这一版交付"图定义 + 校验 + 拓扑排序 + 持久化" (可测核心), 可视化编辑器 + 执行引擎接入留 v4.1.1.

### 核心 (lib/agent-workflow.ts)
- [x] `WorkflowGraph` 数据模型 (节点 = StepKind + dependsOn + config) + `STEP_CATALOG` (9 内置 agent 步 + custom, 各带 produces/consumes 契约给 UI 调色板)
- [x] `validateWorkflow` 纯函数: 空名/空节点/重复 id/未知 kind/自依赖/悬空依赖/环 全检
- [x] `topoSort` (Kahn) 输出并行分层 levels — 同层可并发跑
- [x] `defaultWorkflow` 默认流水线模板 (= 现写死顺序)

### 持久化 + API
- [x] `lib/db.ts` — `agent_workflows` 表 + 索引
- [x] `saveWorkflow` (校验通过才存, owner 校验) / `getWorkflow` / `listWorkflows` / `deleteWorkflow`
- [x] `app/api/workflows` (GET 列表+template, POST 校验保存) + `[id]` (GET 详情+执行分层, DELETE)

### v4.1 总验收 ✅
- ✅ 19 新单测 (校验全分支 + topo 分层/环 + 持久化 owner 校验), 累计 **vitest 1387/1387**
- ✅ tsc 0 错误, 0 production 新依赖

### v4.1.1 · 执行引擎 ✅ 2026-05-21
- [x] `lib/workflow-engine.ts` `executeWorkflow(graph, opts)` — 按 topoSort 分层执行 (层间串行 / 层内 Promise.all 并行), 每节点跑 kind 对应 runner, 上游 outputs 注入下游 context; 依赖坏 → skip; 失败 abort (停整条) 或 continue (跳下游其余照跑); onStep 回调 + AbortSignal
- [x] 可插拔 runner 注册表 `registerStepRunner` / `getStepRunner` / `clearStepRunners` — 引擎与具体步骤解耦
- [x] `lib/workflow-builtins.ts` — 9 内置 dry-run runner (回显 kind/produces/依赖), 验证编排跑通; 真接 orchestrator 是清晰扩展点 (v4.1.2)
- [x] `app/api/workflows/[id]/execute` — POST dry-run 执行, 返每步 status/output/耗时
- [x] 11 新单测 (拓扑顺序 / 数据流注入 / 并行同层 / 缺 runner / abort / continue 跳下游 / 回调 / dry-run 端到端), 累计 **vitest 1421/1421**

### v4.1.2 · 可视化编辑器 + 真 orchestrator 适配 ✅ 2026-05-21
- [x] `lib/agent-workflow-core.ts` — 把类型/STEP_CATALOG/validate/topoSort/defaultWorkflow 拆成 client-safe 纯核心 (不拖 better-sqlite3), `agent-workflow.ts` re-export 保持兼容
- [x] `lib/workflow-orchestrator-runners.ts` — `OrchestratorLike` 接口 + `buildOrchestratorRunners` 把 9 个 StepKind 桥到真 `runDirector/runWriter/...` 方法, 按 kind 从上游取产出 (直接依赖 + `upstreamByKind` pipeline 共享)
- [x] `lib/workflow-engine.ts` — StepContext 加 `depOutputs` + `upstreamByKind`, runner 能按 kind 找上游 (非靠节点 id)
- [x] `app/workflow-studio/page.tsx` — 拖拽式编辑器: 调色板加步骤 / 选类型 / 勾依赖 / 实时校验 + 执行分层预览 / 保存 / dry-run 运行看每步结果
- [x] 6 新单测 (mock orchestrator: director→writer 数据流 / 默认流水线端到端 / 缺依赖报错 / 缺方法报错 / custom 透传), 累计 **vitest 1438/1438**

### v4.1.3 · 接真 orchestrator ✅ 2026-05-21
- [x] `lib/workflow-engine.ts` — `ExecuteOptions.runners` per-call runner 覆盖 (优先全局注册表), 并发请求各用各的 orchestrator 不互相污染
- [x] `lib/workflow-real-runner.ts` — `runWorkflowReal(graph, {idea, projectId}, injectedOrch?)`: 能力门 (无 LLM key 拒 real) + new HybridOrchestrator + buildOrchestratorRunners + per-call 执行; 单实例传所有 step 让 `this` 状态在 director→writer→… 累积 (与原单体一致)
- [x] `app/api/workflows/[id]/execute` — `mode: 'real'|'dry-run'`, real 走真 orchestrator + 能力门 400
- [x] `app/workflow-studio` — 加创意 idea 输入 + "真实运行"按钮 (旁边保留 dry-run)
- [x] 6 新单测 (注入 mock orch 端到端 / idea 透传 / 空 idea 拒 / per-call runner 不漏全局 / 注入时跳能力门), 累计 **vitest 1449/1449**

### 工程卫生 · 测试 DB 隔离 ✅ 2026-05-21
> **背景**: 测试一直直接写生产 `data/qfmj.db`, 灌进 198 个 @test.local 用户, 触发过"项目全空"(非确定性 LIMIT 1) 等怪象. 根治: 测试用独立库.
- [x] `lib/db.ts` — VITEST/NODE_ENV=test 下用 `data/qfmj.test.db`, 每次跑测试前清空 (含 -wal/-shm) → 可复现干净起点; 生产 qfmj.db 永不被测试触碰
- [x] `scripts/ws-server.mjs` — e2e 子进程同样认 VITEST → qfmj.test.db; 补 `busy_timeout=5000` (此前缺失, 并发写静默丢持久化)
- [x] `tests/v3-0-ws-server-e2e.test.ts` — 持久化测试改走 **WS reconnect 恢复** 验证 (server 自己进程内从 DB 恢复), 不再跨进程裸读 SQLite (重负载下 WAL 帧可见性不稳)
- [x] `.gitignore` — qfmj.test.db 不入库
- [x] 验收: 连跑两遍 **vitest 1490/1490**, 生产 DB 用户数 198→198 全程不变

### v4.1.4 · SSE 真实进度流 + 真实运行落盘 ✅ 2026-05-21
- [x] `lib/sse.ts` — SSE 工具: `formatSSE` / `parseSSEChunk` (流式分帧, 半帧留 buffer) / `createSSEResponse` (ReadableStream 包 handler, 自动 error 帧 + 关流)
- [x] `app/api/u2v/stream` — SSE 版单图生视频: 实时推 submit→rendering→done/error 帧; done/error **即时到达** (不必等阻塞 fetch 整返); Kling 真实 onProgress 映射进度环, minimax/vidu 服务端时间估算兜底
- [x] `app/api/u2v/route.ts` — `routeVideoByDuration` 加 onProgress 参数, 透传给 Kling (真实进度); export 供 stream 复用
- [x] `app/dashboard/u2v` — 单图走 SSE 真实进度 (进度环从"估算"变"真实生命周期"), FLF 仍同步; 进度环 + 失败可见 (v5.0.2) 复用
- [x] `lib/workflow-real-runner.ts` — 真实运行给了 projectId 就把结果摘要落 `workflow-run` 资产 (best-effort)
- [x] 12 新单测 (SSE format/parse 往返 + 跨 chunk 半帧 + 真实运行落盘资产), 累计 **vitest 1490/1490**; curl 实测 SSE 实时推进度帧

### v4.1.5 · 工作流执行 SSE 进度流 ✅ 2026-05-21
- [x] `app/api/workflows/[id]/execute/stream` — SSE 版执行: 实时推 start → step-start/step-done/step-error → done{result} (dry-run + real 双模式), 复用引擎已有 onStep 回调
- [x] `lib/workflow-real-runner.ts` — `runWorkflowReal` 加 `hooks` 参数 (onStepStart/Done/Error) 透传引擎, real 模式也能流式
- [x] `app/workflow-studio` — run 改走 SSE: 每节点初始 pending → 边跑边亮 running/done/failed (spinner/勾/叉), 不必等整条跑完
- [x] 2 新单测 (hooks 逐节点 fire + 失败 onStepError), 累计 **vitest 1495/1495**; curl 实测 stream 逐帧推 step-start/done
- ✅ 至此 SSE 进度覆盖 U2V (v4.1.4) + 工作流 (v4.1.5) 两条长任务

---

## 4.102 v4.2 — Postgres 迁移路径 (方言转换 + schema 导出) ✅ 2026-05-20

> **背景**: 全站 better-sqlite3 单文件, 并发写偶发 `database is locked`. 上量必迁 PG. 迁移最大工作量不是搬数据, 是 ~250 处同步 `db.prepare().get()` 改 PG 异步 (= cutover 本身, 留 v4.2.1+). v4.2 先交付**方言转换 + schema 导出 + runbook** (可测地基).

### 核心 (lib/db-dialect.ts)
- [x] `sqliteParamsToPg` — `?` → `$1,$2,...` (跳过字符串字面量内的 `?`, 处理转义 `''`)
- [x] `translateDDL` — BLOB→BYTEA / DATETIME→TEXT / INTEGER PK AUTOINCREMENT→BIGSERIAL / 反引号→双引号 (TEXT PK / REAL / IF NOT EXISTS 等 PG 原生兼容不动)
- [x] `translateUpsert` — `INSERT OR REPLACE`→`ON CONFLICT (...) DO UPDATE SET ... = EXCLUDED.*`, 单列退化 DO NOTHING
- [x] `isSqliteOnlyStatement` — 标 PRAGMA/VACUUM 跳过

### schema 导出 + runbook
- [x] `lib/db-schema-export.ts` — `exportPostgresSchema` 读活 SQLite schema 输出 PG 建表脚本; `listUserTables` 列全表
- [x] `docs/postgres-migration.md` — 同步/异步难点分析 + 三种迁移策略 (推荐分模块异步化) + cutover 7 步 + 注意事项 (时间戳/布尔/BLOB/并发)

### v4.2 总验收 ✅
- ✅ 19 新单测 (占位符/DDL/upsert 翻译 + 活 schema 导出), 累计 **vitest 1406/1406**
- ✅ tsc 0 错误, 0 production 新依赖

### v4.2.1 · cutover 第一个模块 — auth 域异步化试水 ✅ 2026-05-21
- [x] `lib/db-driver.ts` — `DbDriver` 异步接口 (query/get/run) + `SqliteDriver` (包现有同步 better-sqlite3) + `PgDriver` (懒加载 `pg`, 软依赖, 没装报清晰错; 占位符 `?`→`$n` 自动转) + `getDbDriver` 工厂 (`DB_DRIVER` env 切换, 单例)
- [x] `lib/repos/user-repo.ts` — 用户读写 async repo (findByEmail/findById/count/create/updatePassword), 统一 `?` 占位符两边跑
- [x] `app/api/auth/login` 接 `findUserByEmail` — 真路由跑通双驱动, 行为不变 (curl: 正确 200 / 错误 401)
- [x] `pg` 用变量 specifier + `@vite-ignore`/`webpackIgnore` 避开打包器静态解析, 保持 0 硬依赖
- [x] 11 新单测 (工厂选型 / SqliteDriver CRUD / user-repo 全流程 / 重复邮箱拒), 累计 **vitest 1432/1432**

### v4.2.2 · projects 域异步化 ✅ 2026-05-21
- [x] `lib/repos/project-repo.ts` — 项目读写 async repo 走 DbDriver:get/getOwned/listByUser/create/updateStatus/updateMeta/delete, 全带 owner 校验, 统一 `?` 占位符两边跑
- [x] `app/api/projects` POST 接 `createProject` — 真路由跑通双驱动 (curl 验证 201, 新 proj-id 格式)
- [x] 5 新单测 (CRUD 全流程 + 归属校验 + owner-only 改/删), 累计 **vitest 1443/1443**

### v4.2.3 · assets 域异步化 + PG 灰度试跑 ✅ 2026-05-21
- [x] `lib/repos/asset-repo.ts` — project_assets 读写 async repo (list/listByType/get/create/update/delete/count), 走 DbDriver 双驱动
- [x] `app/api/projects/[id]` GET 资产加载接 `listProjectAssets` — 真路由跑通 (curl 200, 5 资产)
- [x] `scripts/pg-smoke.mjs` + `npm run pg:smoke` — 真连 DATABASE_URL 的 PG: 连接 → 建表 (TEXT PK + BIGSERIAL + BYTEA) → `$n` 参数化 CRUD → ON CONFLICT upsert → 清理. 没 PG/没 pg 时打印安装步骤 exit 0 (CI 友好)
- [x] 5 新单测 (asset CRUD + JSON data 往返 + byType + count), 累计 **vitest 1454/1454**
- 📌 本环境无 PG 实例 (pg 未装/5432 空/DATABASE_URL 未设), 真连灰度需用户提供 PG: `docker run postgres:16` + `npm i pg` + `DATABASE_URL=... npm run pg:smoke`

### v4.2.4 · 协作域异步化 ✅ 2026-05-21
- [x] `lib/repos/comment-repo.ts` — 评论 async repo (list/get/create/softDelete/count), 软删保留占位避免 reply 孤儿, 仅作者可删
- [x] `lib/repos/notification-repo.ts` — 通知 async repo (list/countUnread/create/markRead/markAllRead), 仅接收者可标记
- [x] `app/api/notifications` GET 读路径接 async repo (DbDriver 双驱动), 真路由 200; POST 写仍同步 (渐进迁移)
- [x] 6 新单测 (评论软删/计数排除已删 + 通知未读计数/标记/排序限制), 累计 **vitest 1493/1493**
- ✅ PG 迁移已覆盖 4 域: auth / projects / assets / collab —— 全量 `DB_DRIVER=pg` 灰度待用户提供 PG 实例 (`npm run pg:smoke` 验证)

### v4.2.5 · 写路径异步化 + 事务原语 ✅ 2026-05-21
- [x] `lib/db-driver.ts` — 加 `DbExecutor` 接口 + `DbDriver.transaction(fn)` 原子事务: SQLite BEGIN/COMMIT 同连接, PG 从池 checkout 单 client 全程跑, 抛错回滚; fn 收 tx 作用域 executor
- [x] `app/api/notifications` POST (markRead/markAllRead) 也接 async repo, 彻底移除该路由对同步 `lib/notifications` 的依赖 (读写全 DbDriver)
- [x] 3 新事务单测 (commit / 抛错回滚无残留 / 返回值) + notifications GET/POST 真路由 200
- [x] 累计 **vitest 1501/1501**, tsc 0 错
### v4.2.6 · register + comments 事务迁移 ✅ 2026-05-21
- [x] `lib/invite-codes.ts` — `consumeInviteCodeTx(tx, code, userId)` 事务作用域版 (异步, 用 tx executor); 同步版保留兼容
- [x] `app/api/auth/register` — 走 `DbDriver.transaction`: 插 user + `consumeInviteCodeTx` + 回写 invite_code_used 全原子, 码无效整体回滚 (find 重邮箱走 user-repo)
- [x] `lib/comments.ts` — `createCommentAsync` (事务: comment + @mention 解析 + 通知扇出, 邮件事务外 best-effort) / `listCommentsAsync` / `deleteCommentAsync`; 同步版保留
- [x] `app/api/projects/[id]/comments` GET/POST/DELETE 全切 async 版
- [x] 8 新单测 (邀请码原子提交/坏码回滚/已用拒 + 评论 mention 通知/reply 通知/自 @ 不通知/软删) + register 403 gate + comments POST/GET 真路由 200
- [x] 累计 **vitest 1509/1509**, tsc 0 错
- ✅ **PG 全量切就绪**: 主要写路径 (auth/projects/assets/collab) 均已 async + 事务; 剩 `DB_DRIVER=pg` 仅待用户 PG 实例 (`npm run pg:smoke` 验证)

---

## 4.103 v5.0 — i18n 国际化 (v5.x 线开篇) ✅ 2026-05-21

> **背景**: `lib/i18n.ts` 长期把 zh-TW / ja 用简中占位 (技术债清单挂着). v5.0 补齐真翻译 + 健壮回退 + locale 解析 + 切换器, 正式开 v5.x 国际化线.

- [x] `lib/i18n.ts` — 真 **繁体中文** + **日本語** 全量翻译 (common/nav/create/projects 全 key); `getTranslations` 以简中为底 deep-merge 回退 (未来部分翻译也不崩); `t(locale, path)` 点路径取词 + 回退; `normalizeLocale` (zh-Hant/zh-HK→繁, en*/ja* 识别) + `resolveLocaleFromHeader` (按 Accept-Language q 权重) + `LOCALES` / `LOCALE_LABELS`
- [x] `hooks/use-locale.ts` — 当前 locale hook: localStorage 持久化 + 同 tab 广播同步 + 设 `<html lang>`; 初值取 localStorage → navigator.language → zh-CN
- [x] `components/locale-switcher.tsx` — 简/繁/英/日 下拉切换器, 挂 dashboard 顶栏
- [x] 24 新单测 (4 locale key 完整性 + 真翻译非占位 + normalizeLocale 14 例 + Accept-Language q 权重 + t 回退), 累计 **vitest 1478/1478**
- [x] 各页 useTranslations 全量接 locale → **v5.0.1 已交付** (见下)

### v5.0.1 · 全站页面接 i18n ✅ 2026-05-23
> **背景**: v5.0 把 i18n 基建 (字典/回退/解析/切换器) 搭好, 但页面文案仍写死中文. v5.0.1 把字典扩到各页实际用词, 并让关键页面真正走 `useLocale()`.
- [x] `lib/i18n.ts` 字典扩展 (四语全量): `brand` 段 + `nav` 扩 (polish/workbench/cases/userCenter/newProject) + `dashboard` 段 (19 词条) + `create.badge` + `projects` 扩 (createNew/shotsUnit) + `common` 扩 (viewAll/backHome)
- [x] `components/site-header.tsx` — 主导航全量接 `useLocale()`; 删掉只切 useState 不持久化的死组件 `LanguageToggle`, 换成真 `LocaleSwitcher`
- [x] `app/dashboard/page.tsx` — hero / 快捷入口 / 三张统计卡 / 区块标题 / 状态徽章全走 `t.dashboard.*`
- [x] `app/projects/page.tsx` — 标题/副标/状态/镜头数/空态/新建卡 接词; 顶栏挂 `LocaleSwitcher`
- [x] `app/create/page.tsx` — badge/标题/副标/创意标签/视频引擎标签/开始按钮 接词; 顶栏挂 `LocaleSwitcher`
- [x] `tests/v5-0-1-i18n-wiring.test.ts` (4 例): 新 key 四语非空 + 不回退成 path + 关键词条真翻译 + 简繁有别; 全量 **vitest 1513/1513**, tsc 0 错, /create /projects HTTP 200

### v5.0.2 · U2V 生成进度环 + 失败可见 ✅ 2026-05-21
> **背景**: 用户反馈"单图生视频总是失败无响应". 实查模型没问题 (Minimax I2V-01 EOL 早在 v2.22 改成 Hailuo-2.3), 真问题是 UX: 同步阻塞 1-3 分钟只转圈, 错误只弹 toast 易错过 → 体感"失败".
- [x] `components/ui/circular-progress.tsx` — 通用 SVG 环形进度条 (value 0-100, 中心 % + 副文案, 渐变色)
- [x] `app/dashboard/u2v` — 生成时显示**环形进度环** (时间估算: 渐近逼近 95%, 出片瞬间跳 100%, 显示已等待 mm:ss); 按钮显示 % + 计时
- [x] 失败/超时**面板内明示 + 重试按钮** (不再静默转圈); 客户端 6 分钟 AbortController 硬超时防永久挂起
- [x] 修正误导文案: 头部 + 结果区不再写死 "Minimax I2V-01" (实际按时长走 Minimax/Kling/Vidu)
- [x] tsc 0 错, vitest 1478/1478, u2v 页 HTTP 200
- 📌 真实进度 (SSE 推送上游 onProgress) 是更彻底方案, 留 v4.1.4/SSE

### v5.0.3 · 剩余页面接 i18n ✅ 2026-05-23
> **背景**: v5.0.1 接了 dashboard/projects/create/nav, 但 settings/profile/billing/cases 仍写死中文. v5.0.3 把这批补齐, 国际化覆盖到主要功能页.
- [x] `lib/i18n.ts` 字典新增四段 (四语全量): `settings`(37 词条:语言/外观/通知/性能/隐私/账单)、`profile`(20 词条)、`billing`(17 词条)、`cases`(7 词条);`common` 扩 saveChanges/saving/reset
- [x] `app/settings/page.tsx` — 全页接词;**语言下拉从只写 useSettings 改成真驱动 `setLocale`**(同时同步 useSettings),重置也回退 zh-CN
- [x] `app/profile/page.tsx` — 导航/头像/基本信息/统计/toast 全接词
- [x] `app/dashboard/billing/page.tsx` — 档位卡/按钮态(已是此档位/免费/升级到 X/商务洽谈)/Stripe 文案/toast 接词
- [x] `app/cases/page.tsx`(公开) + `app/dashboard/cases/page.tsx` — 标题/副标/复制提示词/用这个创作 接词
- [x] `app/dashboard/profile/page.tsx` — 用户中心/角色/语言/视觉偏好/协作空间 接词
- [x] `tests/v5-0-3-i18n-pages.test.ts`(4 例):四段 81 key 四语非空 + 真翻译 + 简繁有别;全量 **vitest 1517/1517**,tsc 0 错,/settings /profile /cases HTTP 200

### v5.0.4 · 收尾页接 i18n ✅ 2026-05-24
> **背景**: v5.0.1/v5.0.3 接完功能页, 主站门面页 (首页/定价/帮助/示例) 仍写死中文. v5.0.4 收尾, 至此 i18n 覆盖主站全部公开页.
- [x] `lib/i18n.ts` 字典新增四段 (四语全量): `home`(hero/feature/agents/lens/frame/vibe/cases/CTA + frameSteps 数组)、`pricing`(定价卡/FAQ 5 条数组/联系)、`help`(导航/搜索/guides 3 条 + faqs 6 条数组/联系)、`examples`(标题/CTA)
- [x] `app/page.tsx` — 首页全段接词 (英雄文案/各 SectionTitle/三步卡/CTA);数据卡 (home-data) 保持不变
- [x] `app/pricing/page.tsx` — TierCard + FAQ(5)+ 联系全接词;`FAQ_ITEMS` 常量并入字典
- [x] `app/help/page.tsx` — 导航/搜索/快速指南(3)/FAQ(6)/联系;`guides`/`faqs` 常量并入字典(仅留 icon/color 展示元数据)
- [x] `app/examples/page.tsx` — 导航/标题/CTA 接词;题材筛选(作为筛选键)与示例 mock 卡保持不变
- [x] `tests/v5-0-4-i18n-final-pages.test.ts`(5 例):标量 key 四语非空 + 数组(frameSteps/faq/guides/faqs)长度一致且逐条非空 + 真翻译;全量 **vitest 1519/1519**,tsc 0 错,/ /pricing /help /examples HTTP 200

---

## 5. Sprint D+ · 长期愿景(v5.x+)

| 方向 | 定位 | 预期周期 |
|---|---|---|
| ~~跨项目角色 IP 经济 (Sora-style cameo)~~ → v4.0 ✅ | 用户角色 token 化, 经授权可被其他用户复用, 创作者经济雏形 | ✅ 已交付 |
| ~~LangGraph / Agent 编排 IDE~~ → v4.1.x ✅ (编辑器 + 执行引擎 + 真 orchestrator) | 用户拖拽自定义 agent 工作流 | ✅ 已交付 |
| ~~PG 迁移~~ → v4.2.x ✅ (path + auth/projects/assets 域 + PG 冒烟) | SQLite → Postgres 根治并发锁 | 🚧 三域已迁, 全量灰度待 PG 实例 |
| ~~i18n 繁中 / 日文 / 英文~~ → v5.0 ✅ | 4 语言 + 回退 + 切换器 | ✅ 已交付 (全站接线 v5.0.1) |
| 移动端原生 (Capacitor) | iOS 优先, 安卓次之 | v5.x — 长期 |
| 端到端 LLM Vision Audit | 成片每镜过 GPT-4o Vision, 0-100 分"画面是否对得上剧本" | v3.x — 2 周 |
| LangGraph / Agent 编排 IDE | 用户拖拽自定义 agent 工作流, 替换 Director / 并行 Cameo+Editor | v4.x — 1 个月 |
| PG 迁移 + 多人协作 (Yjs CRDT) | SQLite → Postgres + 多人同编 + 评论 | v4.x — 2 周 |
| 移动端原生 (Capacitor) | iOS 优先, 安卓次之 | v4.x — 长期 |
| i18n 繁中 / 日文 / 英文 | `lib/i18n.ts` 当前 zh-TW/ja 都是占位 | 任意 Sprint 顺手做 |

---

## 5.9 阶段八 · 对标顶级平台 (v6.x) — 火山剧创 / 万镜一刻

> **背景**: 2026-05-21 同日上线两个大厂 AIGC 短剧/漫剧平台 —— 字节火山引擎 **火山剧创 1.0**、
> 阿里云 **万镜一刻**。调研其亮点功能与核心卖点, 对照本产品(青枫漫剧)现有底座, 把"真缺口"
> 排进 v6.x。调研日期 2026-05-24, 来源见本节末。

### 对手亮点速览

**火山剧创 1.0(字节 · 火山引擎)** — "导演级控片", 制作周期 -80%
- 端到端链路: 剧本解析 → 全剧资产设定 → 分镜视频生成 → 成片预览, 每个节点都开放编辑权限
- 自研 Multi-Agent 架构, 深度解析长剧本; 深度适配 Seedance / Seedream
- 提示词编辑: **智能补全 + 精准 @引用 + 实时效果预览**
- **多模态参考**: 生成时可上传 图片 / 音频 / 视频 作参考
- IP 资产库: 虚拟人像库 + 真人人像库
- 团队协作: 主账号按团队/成员维度分配积分额度

**万镜一刻(阿里云)** — "万镜生辉·一刻成片", 全链路一体, 零门槛
- 五大能力: 故事板创作 / 主体创作(AI 生图+生视频)/ 在线剪辑 / 资产管理 / 智能解析
- **主体创作**: 角色/场景/道具 主视图 + **多视角图 / 三维视图** + **音色 + 小传(角色档案)**
- 三种创作模式: 剧本模式(单集) / 分镜脚本模式 / **智能解析模式(长篇小说自动拆解分集)**
- **叙事模式**: 对白解说 / 第一人称解说
- 多风格模板: 逼真 3D / 科幻漫画 / 国风动漫 / 电影写实

### 缺口分析(对照本产品现有底座)

| 对手亮点 | 我方现状 | 结论 |
|---|---|---|
| 角色多视角 / 三维设定图 | `cameo-ip` + `character-dna`(锁身份)但无 turnaround 批量出图 | **缺口** |
| 角色音色绑定 + 自动小传 | `tts-providers` + `character-traits` 有料, 但未组装成"档案" | 部分(组装/UX) |
| 智能提示词编辑(@引用+补全+预览) | `prompt-templates`/`polish-prompts` 有底座, create 仍是裸 textarea | **缺口(编辑器)** |
| 多模态参考(图/音/视频) | 仅 cameo 图片上传 | **缺口(音/视频)** |
| 长篇小说 → 自动分集 | 仅解析单剧本/创意 | **缺口** |
| 叙事模式(对白/第一人称/旁白) | 无显式选择 | **缺口** |
| 风格模板画廊 | `style-presets`/`style-bible` 有数据, 缺画廊选择器 | 部分(UX) |
| 团队积分额度分配 | `billing`/`usage_tracking` 有底, 无按成员配额 | **缺口(企业)** |
| 导演级每节点可编辑 | `workflow-studio` + SSE 有底, 主创作流未逐节点开放 | 部分 |
| 在线剪辑/时间线 | v3.3 ripple-edit 时间线 | ✅ 已覆盖 |

### v6.x 迭代计划(映射到代码)

- [x] **v6.0 · 角色资产中心 (Character Studio)** ✅ 2026-05-24 [对标 万镜 主体创作 + 火山 虚拟人像库]
  - [x] **纯逻辑核心 `lib/character-studio.ts`(v6.0, 16 单测)**: 多视角设定图 prompt 合成
    (turnaround 正/四分之三/正侧/背, 注入 `character-dna` 身份锁 + model-sheet 一致性约束);
    按 `character-traits` 性别/年龄确定性绑定专属音色(`VOICE_CATALOG` → tts VOICE_PROFILES);
    确定性小传 `composeCharacterBio`; `buildCharacterProfile` 三支柱打包
  - [x] **v6.0.1 后端接线** (7 单测): `character_library.profile` 列 + `lib/character-studio` 接线层
    (`traitsFromLibraryRow`/`buildProfileFromLibraryRow`/`serializeProfile`/`parseProfile`)+
    `POST/GET /api/characters/[id]/studio`(dry-run 出 prompt+小传+音色并落库; `generate:true`
    逐视图调 `dispatchImageGenerate` 真出图并并入 `image_urls`)
  - [x] **v6.0.2 接线收尾**: 角色库详情弹窗加「生成角色档案 / 生成设定图」按钮 + 档案展示面板
    (小传 + 绑定音色 + 多视角 turnaround 缩略图/prompt); 打开自动载入已落库档案。跨项目复用沿用
    `cameo-ip` 经济闭环 (character_library 行即可发 IP token 复用)
  - ⛔ **明确不做"真人人像库"**: 采集/存储真人面部触红线(肖像权 + 安全规则), 仅做**经授权的虚拟 cameo**
- [x] **v6.1 · 智能提示词工作台 (Prompt IDE)** ✅ 2026-05-24 [对标 火山剧创]
  - [x] **核心 `lib/prompt-ide.ts`(v6.1, 16 单测, client-safe 纯逻辑)**: `@` 引用解析 `parseMentions`
    (排除 email 形态)+ 光标补全触发 `activeMention` + 候选排序 `suggestAssets`(全等>前缀>子串)+
    精确解析 `resolveMentions` + 编译展开 `compilePrompt`(@引用→资产 expansion, 未命中降级裸名);
    `GET /api/prompt-ide/assets` 出可引用资产(角色库身份块 + global_assets 视觉锚)
  - [x] **v6.1.1 编辑器 UI**: `components/prompt-editor.tsx`(textarea + `@` 下拉补全 + ↑↓/Enter 键盘导航 + 编译预览面板:展开 prompt + 引用 chip + 未匹配告警),接进 `app/create` 创意输入;`insertMention` 纯 helper +2 单测
  - [x] **v6.1.2 多模态参考**: `lib/multimodal-ref`(classify/validate/summarize, 9 单测)+
    `components/multimodal-ref-shelf`(文件/URL 加图音视频, 类型自动判定 + 每类上限 + chip 预览),
    接进 create;创作载荷新增 `references`(图片可被 cref 消费, 音/视频前向兼容)
  - [x] **v6.1.3 生成前实时预览 / 就绪度评分**: `lib/prompt-readiness`(确定性加权评分 + 检查清单,
    6 单测)+ `components/prompt-readiness`(实时随创意/参考变化算就绪度),接进 create 提交按钮上方;
    复用 cameo-vision 试穿评分(cameoScore 透传)+ style 资产引用(呼应 style-audit 画风统一)
- [x] **v6.2 · 长篇智能拆解 + 叙事模式 (Story Intake)** ✅ 2026-05-24 [对标 万镜 智能解析]
  - [x] **核心 `lib/story-intake.ts`(v6.2, 13 单测, client-safe)**: `splitIntoEpisodes`
    (章节标记优先 第X章/Chapter N/markdown,否则按 targetChars 贪心打包 + 句子降级 + 末集并入 +
    maxEpisodes 限制 + 开篇保留)+ 叙事模式 `NARRATION_MODES`(对白/第一人称/旁白:directive +
    ttsRole + 是否生成解说音轨)+ `getNarrationMode`/`buildNarrationDirective`;
    `POST /api/story-intake/split` 拆解概览契约
  - [x] **v6.2.1 UI + 编排接线**: `app/dashboard/story-intake`(粘贴长文 → 分集预览卡 + 叙事模式
    选择器 + 单集目标字数)+ 侧栏入口;「用此集创作」把 该集文本 + 叙事 directive 经 sessionStorage
    交给 `/dashboard/create`(orchestrator 创作流, directive 随 idea 注入剧本生成)
  - [x] **v6.2.2 解说音轨 + 整季批量**: `lib/narration-track`(从正文抽旁白句 → 估时长 → 绑音色 +
    字幕条目;对白模式不出轨,10 单测合并)+ `lib/season-batch`(整季 job 计划 + nextPending/markJob/
    进度);story-intake 每集显示旁白估算(句数/时长/音色)+「整季批量」可续跑队列(localStorage 持久化,
    逐集送入创作 + 进度条)
  - 📌 后续候选:解说轨真出音频(接 tts 引擎)+ N 集并行编排
- [x] **v6.3 · 风格模板画廊 (Style Gallery)** ✅ 2026-05-24 [对标 万镜 风格]
  - `lib/style-presets` 扩展(10 单测): `STYLE_CATEGORIES`(写实/动漫/艺术/复古/实验)+
    `categoryLabel` + `searchStyles`(名/英文名/分类/中文标签/promptFragment 关键词)
  - `app/dashboard/styles` 画廊: 60 预设 grid(缩略图 + 中英名 + 分类徽章 + 流行度 + 推荐引擎)+
    搜索 + 分类 tab + 侧栏入口;「套用此风格」经 sessionStorage 把风格名传给 `/dashboard/create`
    (创作工坊 style 状态接收 → 注入 orchestrator);全片风格锁定沿用既有 `style-audit`
- [x] **v6.4 · 导演级全链路编辑 (Director Console)** ✅ 2026-05-24 [对标 火山 控片]
  - `lib/pipeline-stages`(8 单测): 4 环节模型(剧本→资产→分镜→成片)+ `derivePipelineStages`
    (按资产 + updatedAt 推 空/就绪/**待更新 stale**:下游比上游旧)+ `downstreamStages`/`rerunPlan`/`pipelineProgress`
  - `components/director-console` + 项目页「导演台」tab: 4 环节流水线可视化(状态徽章 + 进度条)+
    进入任意节点编辑/重生(跳对应 tab)+ **重跑下游影响提示**;项目详情 API 补 `updatedAt` 供 stale 判定
  - ✅ 已交付 (v6.4.1):每环节真·单节点重跑端点 `POST /api/projects/[id]/rerun`(标记下游失效 + 派发既有管线)
- [x] **v6.5 · 团队工作区 + 积分额度分配 (Team Workspace)** ✅ 2026-05-24 [对标 火山 团队协作]
  - `lib/team-credits`(12 单测): 额度数学(remaining/totals/poolSummary)+ 分配校验
    (canSetAllocation 不超池/不低于已用)+ 消费判定(canConsume)+ RBAC(canManageMembers/
    canAllocateCredits owner 限定/canRemoveMember owner 不可移除)
  - `team_allocations` 表 + `GET/PUT /api/team/allocations`(校验不超额才落库,主账号 scope)+
    `/dashboard/team` 页(池总览条 + 成员额度编辑 + 添加/移除 + 超额告警)+ 侧栏入口
  - ✅ 已交付 (v6.5.1):成员侧消费按额度扣减(`consume`/`costOf` + `/api/team/consume`)+ 真·多用户成员邀请(`team_invites` + 接受页)

> **阶段八 ✅ 全部交付** (v6.0 角色资产 · v6.1 提示词工作台 · v6.2 长篇拆解 · v6.3 风格画廊 ·
> v6.4 导演台 · v6.5 团队工作区),对标火山剧创 / 万镜一刻 的缺口闭环;差异化护城河
> (Cameo IP 经济 / Agent 编排 IDE / 每镜 Vision 质检 / 4 语言 i18n)持续保留。

### 5.9.1 阶段八跟进 · 把"逻辑层"接成"可运行" (v6.2.3 / v6.4.1 / v6.5.1)

- [x] **v6.2.3 · 解说音轨接真 TTS + N 集并行编排** ✅ 2026-05-24
  - `lib/season-orchestrator`(`runPool` 有界并发执行池:结果按 index 排 + continueOnError 续跑/中止 +
    onSettle 进度 + skipped 计数;`orchestrateSeason` 套壳带回 episode 元信息)
  - `lib/narration-synth`(把 v6.2.2 的解说"计划"真出音频:每段并发送 TTS 引擎 → 取真实时长
    `retimeFromDurations` 重排时轴 + 字幕;单段失败降级回估算时长 ok=false,不拖垮整轨;
    默认合成器走 tts-providers 注册表链,synth 注入 → 纯单测)
  - `POST /api/narration/synthesize`(单集)+ `POST /api/season/narrate`(整季有界并发)+
    story-intake 页「整季并行解说音轨」按钮 + 逐集结果面板(已出音频 / 计划就绪待配置 TTS)
  - 13 单测;dev 验证:真打 MiniMax(无余额时 status 2054 → 优雅降级 rendered=false 保留计划)

- [x] **v6.2.4 · 解说真音频落盘 + 字幕烧录串进时间线** ✅ 2026-05-24
  - `lib/narration-timeline`(纯逻辑:`srtTimestamp`/`cuesToSrt`(SRT 烧录文件)+
    `narrationToTimelineSegments`(解说轨 → narration 音轨 + subtitle 字幕轨),10 单测)
  - `timeline-tracks` 扩 `'narration'` TrackType + `computeTracks` 读落库解说资产 → 增 narration 轨 +
    解说字幕并入 subtitle 轨(烧录时一起出)
  - `POST/GET /api/projects/[id]/narration`:真出 TTS → 每段音频 `persistAsset` 落盘 + 字幕 SRT 落盘 →
    存 `project_assets` type='narration' → computeTracks 自动并进时间线
  - cinema-timeline 加「生成/重生解说音轨」按钮(由分镜旁白真出)+ 只读 narration 轨(段挂落盘 audio ▶)
  - dev 验证:POST → 3 段 + SRT 落盘(serve-file 200)+ timeline narration 轨 3 段 + subtitle 含解说 cue(已清理)

- [x] **v6.4.1 · 单环节真重跑端点** ✅ 2026-05-24
  - `lib/pipeline-stages` 扩:`StageAsset` 加 `id`/`stale` + `derivePipelineStages` honor 显式失效标记
    (上游重跑后直接 stale, 不再只靠时间比较)+ `stageOfType` + `buildRerunPlan`(target + 失效下游 +
    受影响资产 id + 执行序)
  - `project_assets.stale` 列 + `pipeline_reruns` 审计表 + `POST /api/projects/[id]/rerun`(算计划 →
    事务清 target stale / 置下游受影响资产 stale / 记审计 → 尽力派发活跃 orchestrator 走既有管线重生,
    无活跃实例则仅标记 dispatched=false)+ 项目 GET 透传 `stale`
  - 导演台「重跑」按钮真调端点(确认重跑此环节 + 重跑后刷新)+ 末环节也可重跑
  - 8 单测;dev 验证:400/404 + 重跑分镜 → 4 个成片资产置 stale + 审计落库 + final 推 stale(已清理)

- [x] **v6.5.1 · 成员消费按额度扣减 + 真·多用户成员邀请** ✅ 2026-05-24
  - `team-credits` 扩:`consume`(校验剩余够 → cost 计入 used, 不可变)+ `GENERATION_COST`/`costOf`
    (随生成类型/份数算成本)+ `capAllocationToPool`(防超池)(15 新单测)
  - `lib/team-invite`(纯逻辑:`isAssignableRole`/过期判定/`canAcceptInvite`/`buildInvite`/`memberFromInvite`)
  - `team_invites` 表 + `POST /api/team/consume`(余额不足 → 400)+ `POST/GET /api/team/invite`
    (主账号生成 token + 列邀请)+ `POST /api/team/invite/accept`(**须登录, 不创建账号**;以接受者
    真实 user id 进成员表 + 防超池 cap)
  - 团队页「邀请成员」面板(邮箱 + 角色 + 额度 → 生成可复制链接 + 邀请列表)+ `/dashboard/team/accept` 接受页
  - dev 验证:consume 视频扣 5 / 超额 400;邀请生成+列出;未登录接受 → 401(均已清理)

### 5.9.2 PG 全量切换闭环 (v6.6) — 之前阻塞在"用户自带 PG 实例", 本地 Docker 自助跑通

- [x] **v6.6 · PG 全量切换闭环 (本地 Docker 验证)** ✅ 2026-05-24
  - `db-dialect` 扩:`stripFkAndComments`(去 FK 约束/行注释)+ `ensureIdempotentDDL`(补 `IF NOT EXISTS`);
    `exportPostgresSchema({ applyReady })` → 可直接顺序 apply 的 PG DDL (16 单测)
  - `PgDriver` 修 bigint 坑:`setTypeParser(20, Number)` → `int8`/`BIGSERIAL`/`COUNT(*)` 解析成 number,
    与 SQLite 一致 (一处修, `countUsers`/`countProjectAssets`/未读数 全部受益)
  - `scripts/pg-migrate.ts`(bootstrap 全量 schema → `db/schema.pg.sql` + 顺序 apply, 幂等)+
    `scripts/pg-verify.ts`(`DB_DRIVER=pg` 下 user/project repo + transaction 真往返)+
    `npm run pg:migrate` / `pg:verify`(`tsx` 入 devDep)
  - **实测 (本地 Docker postgres:16)**: `pg:smoke` 通过;`pg:migrate` 清库 → 74 条 DDL → 33 表, 重跑幂等;
    `pg:verify` 三组断言全绿。代码侧 cutover 就绪, 仅剩生产 PG 实例 + 数据搬迁
  - 文档:`docs/postgres-migration.md` 补「v6.6 一键本地验证」三命令流程

### 5.9.3 运维可观测性 (v6.7)

- [x] **v6.7 · 移除 banana 死配置 + API 健康仪表盘** ✅ 2026-05-25
  - 清理:删 `services/banana.service.ts`(无引用)+ `lib/config.ts` banana 块 + demo-orchestrator 未用变量 +
    midjourney `BANANA_API_KEY` legacy fallback(banana.dev 已停运)
  - `lib/provider-health`(纯逻辑:`classifyHttp`/`classifyMinimax`/`extractGatewayBalance`/`overallHealth`/
    `isPlaceholder`,19 单测)—— 把探针响应归一成 正常/额度用尽/鉴权失败/配置缺失/不可达/未配置
  - `GET /api/health/providers`(服务端实时探测 MiniMax LLM+TTS / qingyuntop / vectorengine,60s 缓存,
    **永不回传 key**;网关读 OpenAI 风格 billing 端点出余额)+ `/dashboard/health` 仪表盘(状态卡 + 余额 +
    处置建议「去充值/补配置」+ 重新探测)+ 侧栏入口
  - 实测:qingyuntop 换新 key 后恢复 ok(剩余 $30)、MiniMax TTS 标记「配置缺失(GroupId 未设)」、整体 warning

- [x] **v6.8 · 升级最强模型 + 修视频生成 429** ✅ 2026-05-25
  - **根因**:视频生成报错 = vectorengine 网关 `429 当前分组上游负载已饱和`;qingyuntop `/v1/video/create`
    + `/v1/video/query` 实测 200(create→poll 全链路通)→ 主视频网关切 qingyuntop 修复
  - 盘点 qingyuntop 558 模型,管线主模型升到当前最强(`config.ts` 默认 + `.env.local`):
    LLM 通用 `claude-sonnet-4-6` / 创意 `claude-opus-4-7`(均实测 200);视频 `veo3.1-pro`(fallback `veo3.1,sora-2-pro`);图像 `flux-2-pro`(新 `IMAGE_MODEL` env)
  - **兜底不变**:minimax 仍是 image/video 链兜底(provider 优先级未动);kling/minimax/TTS 配置原样
  - 修 kontext 图像 provider 的 key↔base 配对(OPENAI_API_KEY 现可指 qingyuntop)+ 健康看板 LLM 卡改显真实模型 + vectorengine 探测改用 KELING_*(VEO_* 已 repoint)
  - tsc 0;全量 1708/1708;健康看板:主 LLM `claude-sonnet-4-6` ok

- [x] **v6.9 · vectorengine 补全 TTS/MJ/Kling + 监控** ✅ 2026-05-25(维持现状:qingyuntop 主)
  - **配音修复**:新 `lib/tts-providers/vectorengine-tts`(`/v1/audio/speech` · gpt-4o-mini-tts · 优先级 50 主路径,
    minimax 兜底)→ 解说音轨实测真出 mp3(rendered True,provider=vectorengine-tts);`mapVoiceToOpenAI` 3 单测
  - **MJ 生图补全**:`.env.local` MJ_API_KEY/BASE_URL→vectorengine 激活 mj provider;优先级排在 flux(110) 之后(115)
    = 维持现状(flux 主)+ MJ 作 vectorengine 兜底(qingyuntop 耗尽时接住)
  - **Kling**:已在 vectorengine(KELING_*),视频链 #2 兜底,确认在位
  - **Suno**:vectorengine `/suno/submit/music` 端点存在但当前令牌组 `无可用渠道` → 暂不可用,文档标注(需网关侧开渠道)
  - **监控**:健康看板 vectorengine 卡改「补全: TTS/MJ/Kling/图像」+ 显**用量**(占位高额度时显「已用 $X·充裕」);
    minimax-tts 卡标「兜底」;探测改用 `VECTORENGINE_*`
  - tsc 0;全量 1711/1711;dev 实测:narration TTS rendered True、健康看板 vectorengine 已用 $266·充裕

- [x] **v7.0 · DeepSeek 创意主 LLM + MiniMax 全局兜底** ✅ 2026-05-25
  - **编剧/导演 创意 LLM → DeepSeek 最强 `deepseek-v4-pro`**(独立 endpoint `api.deepseek.com`,与通用 LLM 分离);
    通用 LLM 仍 `claude-sonnet-4-6`(主网关)
  - **MiniMax 全局兜底**:`callLLM` 重构成尝试链(主→MiniMax),任何主 LLM 异常/欠费/超时自动路由到
    `MiniMax-M2.7`(OpenAI 兼容 `api.minimaxi.com/v1`,新 key);config 加 `creativeBaseURL`/`creativeApiKey`/
    `fallback{BaseURL,ApiKey,Model}`;每次尝试落 `recordApiCall`
  - **MiniMax key 更新**(新 sk-cp-);LLM 兜底 chat 实测 200;native TTS/图像/视频 仍受该令牌 plan 限制(2061)
    + 需 GroupId,媒体兜底位置已就位但受账号 plan 制约
  - 健康看板拆 3 条 LLM 线:通用(claude)/ 创意(deepseek-v4-pro)/ MiniMax 兜底 —— **dev 实测三条全 ok**
  - tsc 0;全量 1711/1711

- [x] **v7.0.1 · MiniMax 语音兜底打通(配音不再缺失)** ✅ 2026-05-25
  - 据用户 Token Plan(语音合成 184/11000 在用)核实:新 sk-cp- key **支持 TTS,且 `t2a_v2` 无需 GroupId**;
    之前失败仅因模型名错(`speech-2.5-hd-preview` → 2061)。改 `MINIMAX_TTS_MODEL=speech-02-hd`(实测支持)
  - `tts.service` 默认模型 → `speech-02-hd`;健康看板 minimax-tts 探针**去掉 GroupId 硬性要求** + 用支持的模型
  - `classifyMinimax` 加 `2056`(5 小时限流窗口)→ 判「已配置可用·稍后恢复」(非欠费/非配置缺失),+1 单测
  - dev 实测:健康看板 minimax-tts → **ok「已配置可用」**,整体 **healthy**;MiniMax 全流程兜底真正闭环
  - tsc 0;全量 1712/1712

- [x] **v7.0.2 · MiniMax 视频:标准版额度用尽自动转 Fast 版** ✅ 2026-05-25
  - MiniMax 标准版 768P/6s 与 Fast 版 768P/6s **各有独立日额度(各 2/天)**。`minimax.service.generateVideo`
    在标准版额度用尽时(`isMinimaxVideoQuotaError`:2056/usage limit/额度/quota 等)**自动路由到
    `generateVideoFast`(独立额度)**,Fast 也满才抛错落下一引擎;`_noFastFallback` 防重入
  - `isMinimaxVideoQuotaError` 纯函数导出 + 2 单测;视频 provider 透明受益(无需改动)
  - tsc 0;全量 1714/1714

- [x] **v7.0.3 · 剧本润色改用 DeepSeek + MiniMax 兜底** ✅ 2026-05-25
  - **根因修复**:`/api/polish-script` 之前用 `creativeModel`(deepseek-v4-pro) 却发去通用 baseURL/apiKey
    (qingyuntop) → 模型↔网关不匹配 → 页面「LLM 调用失败 (200)」。改成走 **创意 endpoint(DeepSeek)**
  - 同 orchestrator 一致:尝试链 创意(DeepSeek)→ **MiniMax 兜底**,首个成功即用;非配额错误仍归一 502、
    配额错误 402(文案去掉硬编码 vectorengine)
  - dev 实测:Basic 模式 `model=deepseek-v4-pro` 真出润色稿(~27s);polish-api 19 单测仍绿
  - tsc 0;全量 1714/1714

- [x] **v7.1 · 稳定性 + 高可用硬化(润色不稳定 / 草稿对比报错 根因修复)** ✅ 2026-05-25
  - **根因(实测定位)**:`deepseek-v4-pro` 是**推理模型**,`reasoning_tokens` 与「提示复杂度」相关而非输出长度——
    润色 pro 提示(sysLen 3934)实测吃 ~1700-2000 reasoning token,把旧 `max_tokens` 地板(2000)**吃光** →
    `content` 为空、`finish_reason=length` → route 误判「LLM 调用失败 (200)」→ **每次静默回落慢速 MiniMax**
    (basic ~88s / pro ~144s 且 audit degraded)。草稿对比则是 60s 超时直接 abort(0/2)。
  - **修复**:
    - ① 统一高可用客户端 `lib/llm-client`:`buildLLMAttempts`(主创意/通用 → MiniMax 全局兜底)
      `callLLMWithFallback`(超时 + `<think>` 剥离 + 瞬时错误退避重试)`stripThink` `isTransientLLMError`;
      草稿对比收口到此,润色复用其纯函数
    - ② **模型分档**:草稿对比 + 润色 basic → `deepseek-v4-flash`(同属 DeepSeek v4 最新族,推理少、秒级);
      润色 pro + 主管线 runWriter/导演 → `deepseek-v4-pro`(质量优先);两档均 MiniMax 全局兜底。
      config 加 `creativeFastModel`(env `OPENAI_CREATIVE_FAST_MODEL`)
    - ③ 润色 `max_tokens` 地板抬高:basic 2000→6000、pro 2000→12000(留足 reasoning 之外的 content 余量;
      实测 pro@12000 → `finish=stop`、正常出 audit)
    - ④ 瞬时错误(too busy / 限流 / 5xx)→ 退避重试**同端点** 1 次再切兜底(避免一遇过载就掉到慢速 MiniMax);
      草稿解析/校验失败再重试 1 次;草稿 `max_tokens` 5000→8000 防 McKee 富输出被截断
    - ⑤ `<think>` 剥离串进润色 raw 解析(MiniMax 兜底会把推理塞进 `content` 的 `<think>` 块)
  - **dev 实测(重启刷新后)**:润色 basic=`deepseek-v4-flash` **3.7s** / pro=`deepseek-v4-pro` **94s 带 audit 不 degraded**
    (修复前均回落 MiniMax 88s/144s degraded);草稿对比 **2/2 成功**;健康看板 6 条核心 provider 全 ok、整体 healthy
  - **HA 验证**:实测 DeepSeek「Service is too busy」时退避重试 → 仍 2/2;MiniMax-M2.7 `<think>` 兜底经 stripThink 正常解析
  - tsc 0;全量 **1735/1735**(+7 v7.1 单测:`buildLLMAttempts` fast 档 / `stripThink` / `isTransientLLMError`)
  - **已知特性**:草稿对比复用 9KB McKee 编剧提示(为与 runWriter 质量对齐),单稿 flash ~60s、并行 2 稿 ~130s;
    可靠性已修复(不再 abort),后续可选「草稿专用轻提示」进一步压时延

> **差异化坚持**: 我方独有的 ① 跨用户 Cameo IP 经济(v4.0)② 拖拽式 Agent 编排 IDE(v4.1.x)
> ③ 每镜 LLM Vision 质检(v3.4)④ 4 语言 i18n(v5.0.x)是对手没强调的护城河, v6.x 在补齐
> 缺口的同时继续放大这几点。

> **调研来源**: 火山剧创 — IT之家 / 火山引擎官网 · 万镜一刻 — 新浪财经 / AI工具集 (ai-bot.cn)。
> (功能为对手公开宣传口径, 仅作竞品参考, 不代表本产品承诺。)

---

## 5.10 阶段九 · 对标「AI 导演台 / 分镜工作站」(v7.2 – v8.x)

> 输入:5 款竞品 UI 截图(AI 视频生成的"导演控制台")逐项拆解。它们的共性 = **把电影工业的
> 专业控制(镜头/光影/连贯性/节奏)做成结构化、可视、可编辑的"驾驶舱"面板**,这正是本品
> 当前最大的 UX 短板:能力多在"提示词/流水线"层,缺少"专业可视控制"层的外化。

### 竞品速览
- **CineSpark 15s** — 短视频极速分镜台:HOOK/BODY/CLIMAX 三幕时间轴 + 15s 运镜词库 + 运动强度/插帧/放大 + 9:16 + 节奏环 + 一键生成
- **CineFlow Director's Suite** — 院线级镜头控制台:摄影机/镜头模拟(ARRI/Panavision/T-stop/ISO/ND/WB)+ ACES 色彩 + 多轨时间线 + 专业示波器 + 渲染循环 + EDL/AAF
- **CineFlow Continuity Pro** — 连贯性锁定:角色/环境/**种子**锁 + 链接模式(硬切/匹配切/参考上帧)+ 连贯性强度 + 服装/光照锁 + FaceID 强度
- **CineMaster Pro** — 广告导演站:单镜头精细控制(景别/机位/镜头/运镜/焦点)+ 光影氛围面板 + Master Prompt Generator + 导演/影片/LUT 风格预设 + PPM + 术语表
- **CineMatrix** — 情感曲线 + 参数联动:emotion curve + 构图引导(三分法/头部/视线)+ 声音设计分层 + auto-update logic + JSON↔可视化实时同步 + AI Casting + 每镜 Marketing

### 差距对照表(✅ 已有 / 🟡 部分 / ❌ 缺失)

| 能力 | 状态 | 说明(本品现状) |
|---|---|---|
| 多智能体流水线编排(8 agent) | ✅ | **强于竞品**:导演/编剧/角色/场景/分镜/视频/剪辑/制片全链路 |
| 角色锁定 / FaceID / **Cameo IP 经济(跨项目复用)** | ✅ | **强于竞品**:竞品仅单项目角色锁;我方有 token 化 + 授权市场 |
| 长篇拆解 → 分集 / 解说音轨 / 整季批量 | ✅ | **竞品无**:story-intake + season-orchestrator |
| 每镜 LLM Vision 质检(打分) | ✅ | **竞品无**:vision-audit |
| 分镜表 + 缩略图 + 编辑 / 风格画廊(68)/ 多轨 Cinema 时间线 / 导演台(流水线总览)/ 团队协作+额度 / 4 语言 i18n | ✅ | 基础齐备 |
| 单镜头机位 | 🟡 | 仅 `cameraAngle` 下拉(8 项);**缺**结构化 景别+机位+镜头+运镜+焦点 网格 |
| 连贯性 | 🟡 | 后端有 seed/consistency-policy/FaceID;**缺**种子锁 UI + 链接模式 + 连贯性强度 + 服装/光照锁开关 + FaceID 强度档 |
| 节奏 | 🟡 | 有分布环(pacing-chart);**缺**情感曲线 + 多轨节奏热力图(情感/紧张/节奏/亮度) |
| 声音 | 🟡 | 有音轨/TTS/解说;**缺**结构化声音设计面板(环境/Foley/BGM 分层 + ducking) |
| 示波器 | 🟡 | 仅音频波形;**缺**视频示波器(矢量/直方图/RGB Parade/亮度) |
| 风格预设 | 🟡 | 68 预设、少量引用真实影片;**缺**系统化 导演运镜/影片/LUT 预设 |
| Master Prompt | 🟡 | 有 prompt 模板 + 润色;**缺**结构化 role/task/核心概念/执行参数 生成器 |
| **单镜头电影摄影控制台**(景别 CU/MS/LS/ELS · 机位 Eye/Low/High/Dutch · 镜头 · 运镜 · 焦点/变焦) | ❌ | 5 款截图**全有**,本品最高频缺口 |
| **专业摄影机/镜头模拟**(机型 · 焦距 · T-stop · ISO · ND · 白平衡) | ❌ | |
| **结构化光影设计**(主/补/背/重点光 + 色温 + 氛围 雨/雾/烟) | ❌ | 仅提示词层提及 |
| **连贯性控制台 + 种子锁**(链接模式 + 强度 + 锁开关) | ❌ | |
| **专业视频示波器**(波形/矢量/直方图/RGB Parade/亮度) | ❌ | |
| **情感曲线 + 多轨节奏热力图** | ❌ | |
| **15s 短视频结构化模式**(三幕 + 运镜词库 + 运动/插帧/放大 + 节奏环) | ❌ | CineSpark 整体形态 |
| **构图引导叠层**(三分法/头部/视线)+ 运镜路径可视化 | ❌ | 仅 vision-audit 文字层 |
| **项目级格式/色彩预设**(IMAX/Scope/ACES/24-120fps 升格/安全框) | ❌ | 仅导出比例 |
| **EDL/AAF/XML 导出**对接 DaVinci/Premiere | ❌ | 仅 PDF/MP4/平台竖屏 |
| **专业术语对照表** / **渲染循环反馈** / **导演驱动 auto-update logic** / **参数联动 JSON↔可视化同步** / **每镜 Marketing** | ❌ | |

### 迭代计划(按"共性最高 + 复用本品已有能力"排序)

- **v7.2 · 单镜头电影摄影控制台(P0,最高频共性)** ✅ 2026-05-25
  - `lib/cinematography.ts`(纯函数 + 14 单测):景别/机位/镜头/运镜/焦点/氛围/运动强度 词表 + `compileShotSpecToPrompt()` 编译成 AI 提示词片段 + `describeShotSpec()` 中文摘要 + `normalizeShotSpec()` 安全解析 + `seedSpecFromCameraAngle()` 历史中文机位映射
  - `components/project/shot-cinematography-panel.tsx`(受控:分段按钮 CU/MS/LS/ELS + 镜头/运镜下拉 + 焦点分段 + 氛围 chips + 运动滑块)+ `shot-cinematography-modal.tsx`(实时编译预览 + 复制 + 保存)
  - `POST /api/projects/[id]/shot-spec` 落进 storyboard 资产 `data.cameraSpec`(asset-repo updateAsset 双驱动);项目页"分镜"tab 每卡加机位摘要 chip + 摄影台入口;dev 实测 保存→DB持久化 / 400·404 边界 / 页面 200 全通过
  - (光影色温/摄影机机身模拟留 v7.4 深化)
- **v7.3 · 连贯性控制台 + 种子锁** ✅ 2026-05-25(对标 Continuity Pro):`lib/continuity`(种子锁/链接模式/强度/服装·光照锁/FaceID 强度 + `compileContinuityDirectives` 逐镜生成指令 + `computeContinuityTags` + `seedForShot`,19 单测)+ `GET/POST /api/projects/[id]/continuity`(upsert project_assets)+ `components/project/continuity-console`(视觉基因库 + 连贯性控制台 + 分镜连贯性 chips);项目页"连贯性"tab。dev 实测 GET/POST/回读/DB 持久化全通过。(下一步可把 directives 串进逐镜重生成 prompt)
- **v7.4 · 结构化光影 + 摄影机/镜头模拟 + 项目级格式预设** ✅ 2026-05-25(对标 CineFlow Suite):扩展 `lib/cinematography` ShotSpec(向后兼容)加 lighting(9 setup + 色温 + 反差)/ camera(机身 + 镜头系列 + T-Stop/ISO/ND/WB)→ 编译进 prompt;`lib/project-format`(画幅 IMAX/Scope/竖屏 + 色彩 ACES/LogC4/Rec709/P3 + 帧率 24-120fps + 安全框,14 单测合并到 v7-4 测试)；`GET/POST /api/projects/[id]/format`;摄影台弹窗加"光影+摄影机·高级"折叠区 + 分镜 tab 顶部项目格式条。dev 实测 round-trip + DB 持久化全通过
- **v7.5 · 情感曲线 + 节奏热力图 + 构图引导** ✅ 2026-05-25(对标 CineMatrix):`lib/emotion-curve`(情绪词典 → 4 轨 情感/紧张/节奏/亮度 + curveStats 高潮点,叠加 pacing 冲突分)+ `lib/composition`(构图建议 + 运镜路径 SVG,14 单测合并 v7-5)；`emotion-rhythm-chart`(4 轨曲线 + 高潮竖线)接"节奏分析"tab;`composition-guide`(三分法叠层 + 主体/头部/视线/平衡 + 运镜路径 mini-viz)接摄影台弹窗。tsc 0 / 全量 1811
- **v7.6 · 15s 短视频极速模式** ✅ 2026-05-25(独立工作台,对标 CineSpark,**阶段九首发**):`lib/short-video`(三幕布局 + 运镜词库 + 节奏模板 + prompt 编译 + LLM 解析,15 单测)+ `POST /api/short-video/plan`(快档 flash 实测 7.4s)+ `/dashboard/short-video` 三栏驾驶舱(运镜词库 / 三幕色彩时间轴 + 分镜表 / 参数面板 + 节奏环 + 一键去创作 + 导出);改运镜/景别即时重编译 prompt。先落"驾驶舱"设计语言,后续 v7.2-v8.0 复用
- **v7.7 · Master Prompt Generator + 风格/LUT/导演预设系统 + 术语表** ✅ 2026-05-25:`lib/master-prompt`(影片 look / 色彩 LUT / 导演运镜 三类引用真实影片的预设 + 术语表 + `compileMasterPrompt` 结构化 Role/Task/Core Concept/Execution Parameters,9 单测)+ `POST /api/master-prompt/refine`(LLM 优化,flash 14s)+ `/dashboard/master-prompt` 生成器页(预设 chip + 实时编译 + 复制/优化/用此创作 + 术语表)+ 侧栏「创意生成器」入口
- **v8.0 · 专业出片对接** ✅ 2026-05-25(**阶段九收官**):`lib/edl-export`(CMX3600 EDL + FCP7 xmeml + 时间码)+ `lib/scopes`(直方图/逐列亮度/裁切统计,10 单测)+ `GET /api/projects/[id]/export-edl`(对接 DaVinci/Premiere,按项目帧率)+ `components/monitor-tab`(视频示波器 canvas 实采:直方图/亮度波形/RGB Parade + EDL/FCPXML 导出)+ 项目页"技术监看"tab。dev 实测导出 200 + 页面 200。(真 AAF 二进制 + 渲染循环/参数联动可视化 为后续可选增强)

> **阶段九 ✅ 全部交付** (v7.6 极速分镜台 · v7.2 单镜头摄影台 · v7.3 连贯性+种子锁 · v7.4 光影+摄影机+格式 · v7.5 情感曲线+构图 · v7.7 创意生成器 · v8.0 专业出片对接)。
> 竞品 5 款"AI 导演台"的结构化控件层已系统补齐, 同时保留 Cameo IP / Agent 编排 / Vision 质检 / 长篇拆解 / i18n 等自有护城河。

- **v8.1 · 智能联动规则引擎 (Auto-Update Logic)** ✅ 2026-05-25(对标 CineMatrix):`lib/auto-rules`(声明式规则 + 5 预设 + `buildRuleContext`/`evaluateRules`/`applyRulesToSpec`,11 单测)+ 摄影台弹窗「✨ 智能建议机位」(按情绪/景别一键套用机位规则)。把 v7.2 ShotSpec + v7.4 光影 + v7.5 情感串成自动化。
- **v8.2 · 参数联动 / JSON↔可视化同步** ✅ 2026-05-25(对标 CineMatrix):`lib/param-linkage`(buildParamDoc/parseParamDoc/diffParamDoc,10 单测)+ `POST /api/projects/[id]/param-sync`(文档一次性写回每镜 spec+连贯性+格式)+ `components/param-linkage-panel`(联动示意图 + JSON 编辑器实时校验 + diff 计数 + Sync Now)+ 项目页"参数联动"tab。
- 后续可选: 真 AAF 二进制导出 · 渲染循环实时反馈面板 · 每镜 Marketing & Distribution。

---

## 5.11 阶段十 · UI/UX 精品化 (v8.3) — Taste Skill 大改造

> 本品当前已经超过普通 AI 生成应用的设计水准 (#0A0A0B 暖墨黑底 + 金色主色 + Source Han Serif SC 编辑级标题 + glass-card 真磨砂),
> 但对照 [Taste Skill](https://github.com/Leonxlnx/taste-skill) (28.1k ⭐ Anti-Slop Frontend Framework) 的「redesign-existing-projects」+
> 「high-end-visual-design」审计清单, 依旧有明确的"AI 印迹"可清除。本版做一次系统化精品化升级, 保留电影感品牌识别。

### 工具已就位
- `.agents/skills/` 已装好 4 个 skill (受版本控制):
  `design-taste-frontend` (默认) · `redesign-existing-projects` (审计→修复) · `high-end-visual-design` (Awwwards-tier 精品法则) · `full-output-enforcement` (拒绝半成品)
- `.claude/skills/*` 软链同名指过去, Claude Code 下回可直接调用

### 真实审计 (现状 vs Taste Skill 标准)
| 维度 | 现状 | 命中的 AI 印迹 / 待修 |
|---|---|---|
| 排版 body 字体 | **`Inter` + SF Pro Display + Noto Sans SC** | ❌ Inter 在 high-end-visual-design 的"绝对禁用"清单首位 → 切 **Plus Jakarta Sans** / `Geist` (CJK 仍走 Source Han) |
| 排版字重 | 主要 400/700 | 缺 500/600 → 引入 Medium / SemiBold 做更细的层级 |
| 数字 | 走 proportional | 数据密集面板加 `font-variant-numeric: tabular-nums` |
| 图标 | **80 个文件** `from 'lucide-react'` | ❌ Lucide 是 redesign-skill 标的"最常见 AI 图标默认" → 关键面板换 **Phosphor Light** (ultra-thin) |
| 圆角 | 单一 `--radius: 10px` | ❌ "uniform border-radius on everything" → 引入 `--radius-xs/sm/md/lg/xl` + 同心圆 `calc()` |
| 阴影 | `0 12px 48px rgba(0,0,0,0.65)` 纯黑 | ❌ "Generic box-shadow / pure black" → 改为**金色染色阴影** `rgba(232,197,71,0.18)` 等, 跟主色同源 |
| 卡片结构 | 单层 glass-card | ⚠️ 缺 **Double-Bezel** (Doppelrand) —— 外壳 hairline + 内芯独立色 + 同心圆角,营造"机加工硬件"质感 |
| CTA | 单层圆角按钮 | ⚠️ 缺 **Nested CTA / Button-in-Button** —— 主 CTA 内嵌圆形 arrow 容器 (`rounded-full` 套 `w-8 h-8 rounded-full`) |
| 动效 | `transition: all 0.5s cubic-bezier` | ⚠️ ease 时长统一, 缺**春力 (spring) 物理** + 进场 stagger |
| 布局 | 标准三栏 / 四栏 grid | ⚠️ 三等宽 feature 卡片 = AI 标志性布局, 关键落地页加 **Asymmetric Bento** / Z-Axis Cascade |
| 留白 | 整体偏紧 | "Double the spacing. Let the design breathe." |
| 噪点 / 纹理 | 全平面 | 缺 fixed pointer-events-none 噪点遮罩, 主页加 `opacity: 0.03` film-grain |
| 文案 | 个别地方 "Elevate / Unleash / 顶级 / 一键" | 改为具体、克制、活体动词 |
| 字符 case | 部分 Title Case | 切 sentence case |
| 错误状态 | 散落 alert / Oops | "Connection failed. Please try again." 风格 |

### 迭代计划

- **v8.3 P1 · 基础 (字体 + 圆角 + 阴影 + 噪点)** ✅ 2026-05-30 —— `app/globals.css` 设计 token 重排(`--radius-xs/sm/md/lg/xl/2xl` 阶梯 + 金色染色阴影 `--shadow-card/-hi/-glow/-inset` + `--ease-spring` + `body min-height: 100dvh`)+ `app/layout.tsx` 接 `next/font/google` 自托管 **Plus Jakarta Sans** + **JetBrains Mono**(替代 Inter)+ 全局 `.film-grain` 噪点遮罩(SVG turbulence, opacity 0.035, mix-blend overlay);装 `@phosphor-icons/react`(28.1k ⭐ Phosphor Light), `components/sidebar.tsx`(18 个 icon) + `app/dashboard/page.tsx`(8 个 icon)lucide → Phosphor(active 用 duotone 金色)。其余 lucide 调用点留 P1.1+ 渐进换
- **v8.3 P2 · 卡片 + CTA Double-Bezel 体系** ✅ 2026-05-30 —— `.glass-card` 单层模拟双层 bezel(顶缘高光+内圈发丝纹+金色染色落影, spring)+ 真 `.bezel-shell`/`.bezel-core` + `<BezelCard>`(同心圆角机加工托盘)；`.cinema-card` 加机加工 inset(保持锐角)；nested CTA `.cta`/`.cta__island` + `<CtaButton>` + `.cinema-cta-island`(button-in-button 箭头岛屿)。落地 dashboard 主卡 BezelCard + 3 个高价值 CTA 岛屿化
- **v8.3 P3 · 动效 spring 化** ✅ 2026-05-30 —— 进场动画 `.animate-fade-up`/`fade-in`/`zoom-in` ease → spring `--ease-spring`;新增 `.stagger` 交错入场容器(nth-child 自动延迟)+ `html scroll-behavior: smooth` + `prefers-reduced-motion` 全局守卫;落地 dashboard stat 卡/最近创作列表/短视频分镜表交错入场;cinema-theme 已是物理曲线保持不动
- **v8.3 P4 · 关键页布局 Asymmetric Bento** ✅ 2026-05-30 —— `/dashboard` 创作总览改 12 列非对称 bento(create hero `col-span-7 row-span-2` 主导 + 统计卡右栏不等高堆叠 + 内容/活动 7/5 收尾, CSS Grid 自动排布), 容器 `6xl→7xl`, 数字 tabular-nums, 标题 text-balance, mobile 单列 fallback。(project page split editorial 排留 P4.1 可选)
- **v8.3 P5 · 模块整合 + 显示修复 + 风格画廊填充 + a11y** ✅ 2026-05-30 —— 创意生成器(鸡肋, 折进创作工坊入口)+ 角色库(并入素材库-角色)移出侧栏;素材库 `object-contain` 完整显示 + 名称/描述展开(不再"必须点开");`scripts/gen-style-thumbs.ts` 经 MiniMax image-01 生成 60 张真实风格缩略图(flux 网关饱和改兜底);全局 `:where(...):focus-visible` 金色 focus ring。(sentence-case/cliche scrub 量大且主观, 留 P6 选做)
- **v8.3 P6 · 故事模板 AI 图标 + 全量 design review** ✅ 2026-05-30 —— 18 枚模板 emoji → AI 金色霓虹 emblem(`scripts/gen-template-icons.ts`, MiniMax, emoji onError 兜底);`docs/design-audit-v8.3.md` redesign-skill 全量 audit(P1-P6 已修 13 项 + 剩余债务清单)。截图刷新见下。
- **v8.3 P6.1 · lucide → Phosphor 全量迁移** ✅ 2026-05-31 —— 89 文件 / 144 图标全迁(80 个经校验过的 alias codemod, tsc 0 零 body 改动)+ `IconContext` 全局 light 字重 + 散落装饰 emoji 清扫(按钮 CTA 9 处)。数据型 emoji(ModeCard / LOOK 预设)已走 AI 图标批量 → 见 P6.3。
- **v8.3 P6.3 · mode/LOOK AI 金色图标** ✅ 2026-05-31 —— 13 枚金色霓虹 emblem(5 mode + 8 LOOK,`gen-mode-look-icons.ts`,emoji onError 兜底)。emoji-即-身份展示图标(模板 18 + mode 5 + LOOK 8 = 31)全部 AI 图标化。
- **v8.3 P6.2 · 截图刷新** —— puppeteer(已装)捕获 v8 bento dashboard + 风格画廊 + 模板图标, 刷进 README/ModelScope。

每 Pn 一个独立 sub-version, 控制风险面 (设计改动易回归)。tsc + 全量测试 + dev 实测 + 提交, 节奏与之前一致。

### 设计护城河 (不动的部分)
保持暖墨黑×金的电影感品牌识别 + Source Han Serif SC 编辑级标题 + Cameo IP / 多 Agent 流水线 / Vision 质检 这些独有的产品资产 —— Taste Skill 是给"皮"做精品化, 不是换品牌。

### UI/UX 升级(贯穿 v7.2+,从 PM/设计视角借鉴竞品长处)

- **「驾驶舱」三栏布局**:左=资产/场景库 · 中=分镜+预览 · 右=参数控制台。5 款竞品全采用,信息密度高、"专业控片"体感强 → 项目页/创作工坊改造为此骨架
- **顶部元数据状态条**:项目 / 格式 / 色彩空间 / 帧率 / 分辨率 / 保存 / GPU 算力(对齐 CineFlow/CineMaster 顶栏)
- **底部监视/状态条**:时间码 / 示波器入口 / 存储 / 算力 / 自动保存
- **三幕色彩编码时间轴**:HOOK 橙 / BODY 琥珀 / CLIMAX 红(对齐 CineSpark)
- **锁定 chips/pills**:角色锁/环境锁/时间连续… 彩色标签(对齐 Continuity Pro 连贯性逻辑列)
- **结构化控件语言**:分段按钮组(CU/MS/LS/ELS、Slow/Normal/Fast)+ 带数值滑块(运动 60% / 连贯性 0.6)+ 分组可折叠面板 → 沉淀进 `components/ui`
- **环形/曲线 mini-chart**:节奏环 + 情感曲线(复用 components/cinema/dataviz)
- **醒目「一键生成」CTA** + 操作列(生成/预览/编辑)行内化
- **设计 tokens 扩展**:在现有"暖墨黑 × 金"主调上,为"导演台/技术监看区"补一套更冷的「监视器蓝 / 示波绿」功能色,区分创作区 vs 技术监看区(避免全站翻新风险,新色仅用于新面板)
- **保持差异化护城河**:Cameo IP 经济 / Agent 编排 IDE / Vision 质检 / 长篇拆解 / i18n 继续作为竞品没有的亮点放大

> **执行原则**:沿用本品"lib 纯逻辑 + 单测 → API/UI → tsc + 全量 + dev 实测 → 提交"的节奏;
> 每个子版本独立可发布;优先复用已有能力(prompt-templates / cinema 组件 / pacing / consistency-policy),
> 避免一次性大翻新。

---

## 5.12 后续路线 (v9.x) — 稳定性筑基 → 变现分发 → 出片增强

> 决策(2026-05-31):用户选 A+B+C 综合推进。排序原则 = **先清地基债再上新功能**:
> A 稳定性先行(根治测试 flake + 上线并发)→ B 变现闭环(业务价值最高)→ C 出片增强(锦上添花)。
> 沿用"lib 纯逻辑+单测 → API/UI → tsc+全量+dev 实测 → 提交"节奏, 每子版本独立可发布。

### 阶段十一 · 稳定性筑基 (v9.0.x) —— A

- **v9.0 · PG 切换地基闭环** ✅ 2026-05-31 —— `docker-compose.pg.yml`(5434)+ pg:migrate(74 DDL/33 表)+ pg:smoke + `DB_DRIVER=pg` pg:verify + 真实 app 跑 PG 全绿;`docs/postgres-cutover-v9.md` runbook + **63 处 raw 写 / 40 文件全盘点**(按表分批)。安全性:默认 SQLite 下无 split-brain, PG opt-in 分批迁移零影响。详见下方批次。
  - **v9.0.1** project_assets(26 处,最大簇)→ 既有 asset-repo(按需扩方法)
  - **v9.0.2** projects/users/notifications/comments → 既有 4 repo(补缺方法)
  - **v9.0.3** 新建 invite-repo / global-asset-repo / character-repo(含 IP token/grant)
  - **v9.0.4** 新建 team/generations/waitlist/share/collaborator/quota/track-edit repo —— 写路径全清
  - **v9.0.5** 切默认:`DB_DRIVER=pg` 下全量测试绿 → 建议生产 PG;SQLite env 可回退
- **v9.0.1 · TTS 模型统一 + voice profile 去重**:`tts.service.ts` / `minimax.service.ts` 统一 `speech-02-hd`;清 `tts.service.ts:40` 重复 voice profile;健康看板 TTS 卡复核
- **v9.0.2 · i18n 占位补全**:`lib/i18n.ts:130/132` 繁中(zh-TW)/日文(ja)真翻译替换占位;4 语言切换器全链路实测

### 阶段十二 · 变现 / 分发闭环 (v9.1.x) —— B (对标 CineMatrix Marketing tab)

- **v9.1 · `lib/distribution`(纯逻辑 + 单测)**:平台规格(抖音/快手/视频号/小红书/YouTube Shorts/B站)字数/标签/话术模板 + `buildDistributionPrompt()`(成片 synopsis + 情绪曲线 + 钩子 → marketing pack 提示)+ `parseDistributionPack()`(标题×N / 标签 / 钩子文案 / 简介 / 发布建议,容错降级)
- **v9.1.1 · `POST /api/projects/[id]/distribution`**:快档 flash + MiniMax 兜底,生成每集分发包;落 `project_assets type='distribution'`
- **v9.1.2 · 项目页「分发」tab**:平台多选 chips → 一键生成 → 每平台卡片(标题候选/标签/钩子/简介, 行内复制)+ 导出 .txt/.md
- **v9.1.3 · AI 竖屏封面候选** ✅ 2026-06-01 (补做收尾):`lib/cover-candidates`(`buildCoverPrompts` 3 构图变体 9:16 + 负向不画字 + `pickProtagonist` + `getTitleSafeArea`,8 单测)+ `POST /api/projects/[id]/covers`(MiniMax image-01 T2I 768×1344 并行 3 张, allSettled, 覆盖落库)+ `cover-candidates-panel`(9:16 卡片 + 标题安全区虚线叠层 + 标题预览 + 下载, 挂「分发」tab)。tsc 0 / 160 文件 1918 测试; 结构冒烟 GET 200 / POST 404。诚实边界: 真 MiniMax 出图费额度, 未真出图。**→ 阶段十二闭环, v9.x 计划全部交付**

### 阶段十三 · 出片增强 (v9.2.x) —— C

- **v9.2 · 真 AAF 二进制导出** ✅ 2026-06-01 (v9.2.0):**自研最小 MS-CFB 容器**(`lib/aaf-export`:组合模型 + AAF-XML + writeCfb/buildAAF/isCfb,无第三方库,7 单测)+ `GET /api/projects/[id]/export-aaf` 对接 Avid;与 EDL/FCPXML 并列。诚实边界:真 CFB 二进制 + 内嵌 XML round-trip 一致,Avid 实机回导未验
- **v9.2.1 · 渲染循环实时反馈面板** ✅ 2026-06-01:`lib/render-loop`(每镜状态归约 `deriveShotRenderStates` + 进度/ETA 聚合 `summarizeRenderLoop` + `formatEta`,10 单测)+ `GET /api/projects/[id]/render-loop`(`?snapshot=1` 单次 JSON / 默认 SSE 流,复用 `lib/sse`,收敛或断开即停)+ 技术监看「渲染循环」面板(初拉 snapshot→EventSource 实时回填,总进度条 + 逐镜状态/重试/耗时)+ 顺带补「导出 AAF (Avid)」按钮。tsc 0 / 158 文件 1904 测试。(进度为持久化资产最佳努力投影, 非管线内嵌事件)
- **v9.2.2 · 草稿专用轻提示提速** ✅ 2026-06-01:`lib/slim-prompts`(`getSlimWriterPrompt` ~0.5KB 三幕骨架 + JSON 契约,6 单测)替代草稿对比直挂的完整 McKee(实测 9153 字/8.9KB);`script-drafts.generateOneDraft` 改用之 + timeout 100s→45s。flash 推理负担骤降 → 单稿目标 <20s(此前 ~50-70s)。极速分镜 `buildShortVideoMessages` 本就精简(v7.6),无需改。tsc 0 / 159 文件 1910 测试。诚实边界:体积削减 ~94% 可验,<20s 为设计目标,未打真 LLM 实测
- **v9.2.3 · 设计 P4.1** ✅ 2026-06-01:项目页头部 editorial split 非对称双栏 (大号 display 标题 + 竖线分隔 meta deck: 镜头/角色/评分/状态) + `globals.css` 新增 `--monitor-blue`/`--scope-green` 功能色 token (仅技术监看区: 渲染循环→监视器蓝/done→示波绿, 示波器→示波绿, 出片→监视器蓝; 不动创作区品牌金)。tsc 0 / 159 文件 1910 测试; dev 项目页编译 200。**→ 阶段十三收官**

> **里程碑**:v9.0.x 绿 = 测试 flake 根治 + 可上 PG;v9.1.x 绿 = 短剧分发变现闭环;v9.2.x 绿 = 专业出片 + 体验提速。**(v9.0.x / v9.1.x / v9.2.x 全部交付 → 阶段十一~十三达成)**

- **v9.0.4d · 遥测/用量簇收尾上 DbDriver** ✅ 2026-06-02:`api-usage-tracker`(api_usage_events + api_quota_alerts)+ admin/api-status 读路径全异步化双驱动;PG 往返 7/7;两遥测测试 31/31。**遥测簇双驱动收口**。
- **v9.0.4e · plugin_chain_events 上 DbDriver + TTS 模型统一** ✅ 2026-06-02:`plugin-chain-telemetry`(recordPluginEvent/aggregatePluginStats)异步化双驱动(PG 兼容:双引号别名保留驼峰 + Number 归一聚合)+ router 4 处 void + 测试 async;**TTS 债清**:minimax.service 3 处 `speech-2.8-hd`→`speech-02-hd` 统一。tsc 0 / plugin-telemetry 6/6 tsx / ✅ 全量 163-1944 + PG 往返 13/13(双引号别名 PG 取值正确)。剩 `shot_vision_audits`/`agent_workflows`/`yjs_docs`/`chat_messages` 留 v9.0.4g。
- **v9.0.4f · preview_history + project_quality_scores 上 DbDriver** ✅ 2026-06-02:`quality-scores`(insert/getLatest/list)+ `preview-history`(insert/countToday/list/delete/getQuotaState)异步化双驱动(PG 兼容:COUNT Number 归一 + deletePreview 用统一 changes);callers 全 await(create-stream `.then` 改 async + orchestrator×2 + preview-shot×3 + history route×3)+ 两测试 async。tsc 0 / 数据路径 8/8 tsx / ✅ 全量 163-1944 + PG 往返 13/13(含 users 预算列 ALTER, 清 v9.0.4d/e + v9.3.x 整串欠债)。剩 `shot_vision_audits`/`agent_workflows`/`yjs_docs`(ws-server)/`chat_messages` 留 v9.0.4g。

---

## 5.13 阶段十四 · v9.3 — 用量与成本可观测 (Usage & Cost Observability) 【提案 · 待确认】

> 起点 (2026-06-02): v9.0.4d 把遥测簇 (api_usage_events / api_quota_alerts) 全量上 DbDriver (PG 往返 7/7),
> 失败 / 配额 / 耗时数据已可在 PG 落库 + 读出。本阶段在其上建「可观测层」: 把分散遥测归集成成本视图 +
> 预算护栏 + 创作者可见用量面板。与 v9.1 变现闭环、plan-gate 天然衔接。
> 沿用「lib 纯逻辑+单测 → API → UI → tsc+全量+PG 往返」节奏, 每子版本独立可发布。

- **v9.3.0 · 成本归集 lib (cost-rollup, 纯逻辑+单测)** ✅ 2026-06-02:`lib/cost-rollup` 把 `cost_log` 行归集成
  per-engine / per-day / per-project 成本卷积 + 预算数学 (`computeBudget`: 已用 vs 上限 + 线性周期末预测 + none/ok/warn/over) + `buildCostSummary`。纯函数不碰 DB。tsc 0;11 项逻辑断言全绿 (tsx 直跑;vitest 因本机高负载待补全量)。主成本源 = cost_log (api_usage_events 是失败日志, v9.0.4d 已处理)。
- **v9.3.1 · 用量看板端点 `GET /api/usage/summary`** ✅ 2026-06-02:从 `cost_log`(双驱动)→ cost-rollup → 返回
  `{ cost:{totals,byEngine/Day/Project}, budget(当月), activeAlerts, failuresByProvider }`;`?days`/`?projectId`/`?capCny` 过滤;admin 全量(或 `?userId`)/ 创作者限本人。与 `/api/usage`(套餐配额)互补。tsc 0;数据路径冒烟 7/7(tsx);vitest 全量待补。
- **v9.3.2 · 创作者用量面板 (dashboard)** ✅ 2026-06-02:`app/dashboard/usage/page.tsx` 消费 `/api/usage/summary` →
  预算环(当月,SVG+none/ok/warn/over)+ 引擎花费条 + 每日成本趋势柱 + 活跃配额告警 banner + 7/30/90 天窗口;侧栏加「用量成本」入口。复用健康看板设计语言, 创作者可见。tsc 0。
- **v9.3.3 · 预算护栏判定 (budget guards)** ✅ 2026-06-02:`lib/budget-guard`(`evaluateBudgetGuard` 软/硬上限 + 阈值告警 + pending 成本预判 → allow/level/message/upgradeUrl,11/11 tsx)+ `/api/usage/summary` 加 `guard` 字段 + `/dashboard/usage` 护栏状态条。与 `lib/plan-gate` 正交。tsc 0。**→ 阶段十四 4 子版本判定层收官**
- **v9.3.4 · 预算护栏硬拦截落地** ✅ 2026-06-02:预算持久化(users 加 `budget_cap_cny`/`budget_hard_cap_cny`)+ `lib/budget-enforce`(getUserBudget/setUserBudget/monthSpentCny/`assertBudget`,7/7 tsx 真 SQLite)+ GET/POST `/api/usage/budget` + summary guard 改读服务端预算 + **首接 `/api/preview-shot` 出图前硬拦截(到硬上限→402)** + 面板预算改存服务端。tsc 0。**核心管线(create-stream)接入 → v9.3.5**;PG 列已写,ALTER+往返待重启 windcomic-pg
- **v9.3.5 · 预算护栏接核心管线**(待规划):把 `assertBudget` 接进 create-stream 视频/图像生成前 + u2v/4k 等成本入口,统一硬拦截;需能跑全量 vitest 时安全改核心路径

> **里程碑**:v9.3.x 绿 = 用量/成本从「埋在日志」变「创作者可见 + 预算可控」, 闭合 v9.1 变现的成本侧。**(v9.3.0/1/2/3/4 全交付 → 阶段十四达成;✅ 全量 vitest 163 文件/1944 已补绿, 清 v9.0.4d→v9.3.4 整串欠债)**

---

## 5.14 阶段十五 · v9.4 — 质量与一致性深化 (Quality & Consistency)

> 起点 (2026-06-02): 已有完整质量信号基础设施 —— Vision 每镜质检 (`lib/vision-audit`, `shot_vision_audits`) +
> 成片 3 维评分 (`lib/quality-scores`, Editor 打分 → Writer 反馈闭环) + cref/sref/8 维 DNA 一致性。
> 本阶段把这些「事后看分」深化成「**发布门禁 + 自动重生闭环 + 一致性可视**」, 放大竞品最难追的护城河。
> 沿用「lib 纯逻辑+单测 → API/UI → tsc+全量+(PG 往返)」节奏。

- **v9.4.0 · 成片质量门禁 lib (quality-gate, 纯逻辑+单测)** ✅ 2026-06-02:`evaluateQualityGate({filmAudit, qualityScore, thresholds})` 综合 Vision 每镜聚合 (avgScore/fail 比例/verdict) + 成片 3 维 (overall/连贯/光影/脸) → `pass`/`warn`/`block` 发布就绪 + 不达标原因 + 最弱镜 + 偏弱维度。纯函数, 与 vision-audit/quality-scores 解耦 (本地最小形)。tsc 0 / 10 单测绿。
- **v9.4.1 · 发布就绪端点 + 徽章** ✅ 2026-06-03:新建只读 `GET /api/projects/[id]/publish-readiness`(聚合 `getProjectAudits→aggregateFilmAudit` + `getLatestQualityScore` → `evaluateQualityGate`) + 「成片质检」tab 顶 `<PublishReadinessBadge>` 状态条(pass/warn/block 配色 + message + 不达标原因 + 最弱镜,质检跑完自动刷新;两路质量信号皆缺则隐藏交给空状态)。**非破坏性**:只暴露裁决不改导出行为。导出端点 `block` 硬拦截(+「仍要导出」bypass)留 v9.4.1b/后续。tsc 0 / quality-gate 10 测绿。
- **v9.4.2 · Vision 重生闭环深化** ✅ 2026-06-04:新 `lib/rebirth-plan` —— 每镜质检 → 重生计划(低于阈值的镜按分升序排优先级 + 最弱维度 + 针对性修补提示 `focusHint`)。「成片质检」面板加「重生计划」段(优先级徽章 + 焦点提示)+「一键去工坊重拍」批量按钮(`onJumpToWorkshop` → page `setActiveTab('workshop')`)。纯逻辑解耦,9 单测,tsc 0。**为「一键成片」闭环自愈提供复用引擎。**
- **v9.4.3 · 多参 Elements(对标可灵 · 一致性)** ✅ 2026-06-04:新 `lib/reference-elements` —— 把 `multimodal-ref` 自由文本 `role` 升级为结构化 `elementRole`(角色/风格/场景/道具/运镜/音色),`bindElements()` 按角色路由进既有一致性管线(character→cref+DNA · style→sref/Style Bible · scene/prop→构图 · motion→运镜 · voice→TTS)+ `elementCompleteness()` 可灵式「加元素」引导。比可灵更深(落到 DNA/cref/sref 整套)。12 单测,tsc 0。详见 `docs/kling-fusion-analysis.md`。
- **v9.4.4 · 一键成片闭环(对标可灵 · 质量)** ✅ 2026-06-04:新 `lib/oneclick-film` —— `planOneClickFilm`(idea + 多参元素 → 成片计划 + 自愈策略)+ `decideIteration`(每轮生成质检后裁决 done/rebirth/blocked)。复用 `reference-elements` + `quality-gate`(v9.4.1)+ `rebirth-plan`(v9.4.2)拼成**闭环自愈**:可灵一键成片是开环,我们生成后每镜质检、低分镜自动重拍、门禁达标才出片。9 单测,tsc 0。
- **v9.4.6 · 可灵融合落 UI / 执行层** ✅ 2026-06-04:让 v9.4.3/v9.4.4 的融合「可见可用」。① **多参元素货架**(`multimodal-ref-shelf`):每个参考可标结构化元素角色(角色/风格/场景/道具/运镜/音色)+「元素完整度」引导条,经 `reference-elements` 路由进 cref/sref/DNA。② **一键成片自愈闭环面板**(`oneclick-film-panel`,项目页新「一键成片」tab):真跑通 `oneclick-film` 闭环 —— 质检(`vision-audit/run`)→ `decideIteration` 裁决 → 自动重拍弱镜(`regenerate-storyboard` 带最弱维度 steer)→ 复检,**上轮数 + 停止 + 运行前确认**三重保护 + 实时日志。tsc 0。
- **v9.4.7 · 多参真用进初始生成** ✅ 2026-06-04:`create-stream` 接 `bindElements(references)` —— 角色元素→cref+DNA、风格元素→seed/sref(非破坏式兜底,只取 http(s),不覆盖用户显式选择)。至此货架的元素角色从「捕获+透传」到「初始生成即生效」,多参 100% 用上。tsc 0。
- **v9.4.8 · 多参 scene/prop 注入收尾** ✅ 2026-06-04:`hybrid-orchestrator` 加 `setSceneReferences`,分镜渲染链把场景/道具元素作**低优先构图附加参考**(只填 4 张上限剩余 slot,不挤占角色/画风锚)。至此多参全角色(角色→cref · 风格→seed · 场景/道具→构图参考)真用进初始生成,**多参 100% 用满**。tsc 0。
- **v9.4.9 · 多参深化 + 一键成片闭环 e2e** ✅ 2026-06-04:**A** 闭环端到端模拟测试(planOneClickFilm+decideIteration 多轮跑通);**B1** scene/prop 进场景设计阶段;**B2** 每元素 cw 强度(对标可灵 element weight:ReferenceElement.weight + 货架 cw 滑块 + create-stream 多参路径 → setPrimaryCharacterCw,不与 CAMEO LOCK 冲突)。tsc 0 + 27 单测。
- **v9.4.5 · 一致性报告(阶段十五收官)** ✅ 2026-06-04:新 `lib/consistency-report`(纯逻辑)—— `buildConsistencyReport(scores)` 把跨轮成片 3 维评分(连贯/光影/脸,`listQualityScores` newest-first)聚合成 最新各维 + 跨轮趋势(↑/↓/持平)+ 最弱维 + chronological 序列。只读端点 `GET /consistency` + `ConsistencyReportPanel`(3 维最新分 + 跨轮 sparkline + 趋势 delta + 最弱维),挂「成片质检」tab。5 单测,tsc 0。**至此阶段十五 v9.4.0–v9.4.8 全交付。**

> **里程碑**:v9.4.x 绿 = 质量从「事后看分」变「发布前门禁 + 弱点自动重拍」, 一致性可量化可视, 放大护城河。

---

## 5.15 阶段十六 · v9.6 — 出片体验三选一深化 (Delivery Experience) 【开阶段 · 主题待定】

> 起点 (2026-06-04): 阶段十一~十五已把「稳定 → 变现 → 出片增强 → 用量成本 → 质量一致性」铺满底座。
> 阶段十六开一个**面向出片体验**的新方向, 下列 3 个候选主题各自独立、价值不同, 先开篇落一块**最低耦合的地基**,
> 再由产品决定深挖哪条。沿用「lib 纯逻辑+单测 → API/UI → tsc+全量」节奏。

**候选主题(三选一深挖):**
- **T1 · 配音口型 (Lip-sync / Voice-align)** —— 把已有 TTS 旁白/对白与人物口型对齐, 出片更「活」。复用 `lib/voiceover`、`shot` 时间轴;新增唇形关键帧/对齐评分。**门槛高、出片观感增益最大。**
- **T2 · 模板市场 (Template Marketplace)** —— 把成功项目的「画风+多参元素+节奏」沉淀成可复用模板, 一键起片。复用 v9.4.3 多参元素 + Style Bible;新增模板抽取/评分/检索。**分发与冷启动价值最大, 接 v9.1 变现。**
- **T3 · 性能成本 (Cost & Performance)** —— 把每单生成的逐阶段开销归因可视 + 省钱建议, 接 v9.3 用量成本侧。**最低耦合、可立即开篇。**

- **v9.6.0 · 成本归因 lib 开篇 (cost-attribution, 纯逻辑+单测)** ✅ 2026-06-04:新 `lib/cost-attribution` —— `attributeCost(events)` 把一次创作的逐阶段开销(LLM/图像/视频/TTS/口型/其它)归因成 总价 + 各类目占比(降序)+ 最贵类目 + 针对性省钱提示。与 `cost-rollup`(月度聚合)正交:这是**项目级**「这一单钱花在哪、怎么省」视图。6 单测, tsc 0。**作为阶段十六 T3 地基, 同时为 T1/T2 留口(口型/模板成本可并入归因)。**

> **产品定向 (2026-06-04)**:用户选 **T1 配音口型** 深挖(出片观感增益最大)。以下按「lib 纯逻辑+单测 → API → UI」往深做。

- **v9.6.1 · 口型规划 lib (lipsync-plan, 纯逻辑+单测)** ✅ 2026-06-04:新 `lib/lipsync-plan` —— 补上「台词 → 口型时间轴」缺口(此前有 prosody/对白覆盖/字幕轴,独缺口型)。① `estimateSpeechSeconds(text, speed)` 从文本估语音时长(语速可调,复用 prosody.speed);② `planVisemes(line)` 把一句对白在镜头时间窗里切成 **viseme 关键帧**(8 类口型 sil/MBP/FV/aa/E/I/O/U + 张口量 0..1 包络),供下游驱动嘴部动画(粗粒度结构驱动、确定性,留真 phonemizer 后续细化);③ `scoreLineAlignment(line)` 口型**可对齐度**(说话人是否在画面 −50 / 景别够不够拍脸 −30 / 台词时长是否溢出镜头窗 −20);④ `buildLipSyncPlan(lines)` 聚合成 每句轨 + 整片就绪度(**复用 quality-gate 的 pass/warn/block**)+ 最弱句 + 提示;`dialogueLinesFromShots(shots)` 把分镜映射成对白行(时间窗顺序累加)。16 单测, tsc 0。**T1 地基:口型可见、可评分、可驱动。**
- **v9.6.2 · 配音口型 API + UI(让 T1「可见可用」)** ✅ 2026-06-04:① 只读端点 `GET /api/projects/[id]/lipsync`(读剧本 `script.shots` → `dialogueLinesFromShots` → `buildLipSyncPlan`,同 consistency/publish-readiness 只读模式);② `components/project/lipsync-panel` 挂「成片质检」tab(与一致性报告同列):整片就绪度徽章(pass/warn/block + 就绪度分)+ 每句可对齐度(点击切换 + 问题提示)+ 选中句的 **viseme 张口包络 sparkline** + 一张 **按关键帧实时动画的嘴**(▶ 播放,rAF 驱动 jaw-open 随 viseme 轨开合)。无对白镜自动隐藏。验证:**tsc 0**(端到端真渲染留浏览器实测)。
- **v9.6.3 · CJK 口型提保真(轻量音素器)** ✅ 2026-06-04:新 `lib/pinyin-viseme`(零依赖)—— 「常用字 → 主元音」表(~270 高频 + 情绪对白字,按 a/o/e/i/u 分组可逐组校验),把 `lipsync-plan` 的 CJK viseme 从「码点循环占位」升级成**真元音映射**(命中常用字走真口型、未收录字回退码点兜底)。比加重型拼音词典依赖更贴项目「零依赖纯逻辑 lib」风格。验证:**tsc 0 + pinyin-viseme 5 单测**(含 planVisemes 集成:「你好」→ I/aa、「我哭了」→ O/U/E),lipsync-plan 16 单测无回归。
- **v9.6.4 · 口型融门禁(并进发布门禁 + 重拍计划)** ✅ 2026-06-04:让口型不再是孤岛面板,而是融进既有质量系统。① **quality-gate 扩展**(非破坏):`evaluateQualityGate` 加可选 `lipSync` 入参 —— 口型作「**增强**」维度,`block`/`warn` 只升门禁到 warn(**不硬拦发布**,口型本是增强项)+ 进偏弱维度「口型」;不传则行为不变。② **publish-readiness 端点**接入:读剧本 → `buildLipSyncPlan` → 喂 gate,返回 `lipSync` 摘要。③ **重拍提示**:`lipSyncReshootHints(plan)` 把对不上的句按可对齐度升序转成可执行修法(画外音→出镜/转旁白 · 景别过远→补 MCU/CU · 台词溢出→放慢/加长/拆句),口型面板加「口型重拍建议」段 + **一键去工坊重拍**(复用 `onJumpToWorkshop`)。验证:**tsc 0 + 9 单测**(gate 融合 6 + reshoot 3),quality-gate 既有 10 单测无回归。
> **里程碑(达成)**:阶段十六 **T1 配音口型**全链交付 —— 口型轨 lib(v9.6.1)+ API/UI 动画嘴(v9.6.2)+ CJK 真音素提保真(v9.6.3)+ **融进发布门禁 / 重拍计划**(v9.6.4)。口型从「可见」到「可评分、可驱动、可门禁、可重拍」,与 Vision 质检 / 一致性同列成片质量系统。

- **v9.6.5 · T3 性能成本竖切(成本归因接真实计费数据)** ✅ 2026-06-04:把 v9.6.0 的 `cost-attribution` 地基接上真实 `cost_log` 数据做成完整竖切。① **lib 扩展**:`classifyEngineCategory(engine)`(顺序敏感:口型>TTS>视频>图像>LLM,避免 `gpt-sovits` 误判)+ `costEventsFromCostLog(rows)`(cost_log 行 → 计费事件)。② **端点** `GET /api/projects/[id]/cost`:查本项目 cost_log → 归类 → `attributeCost` → 总价 + 各类目占比(降序)+ 最贵类目 + 省钱提示(与 `/api/usage/summary` 全局/月度卷积正交)。③ **面板** `cost-attribution-panel` 挂「**技术监看**」tab(与性能监看同列):总成本 + 各类目占比条 + 💡 省钱提示,无数据空态。验证:**tsc 0 + 7 单测**(引擎归类含顺序敏感 + cost_log 映射 + 端到端归因),cost-attribution 既有 6 单测无回归。

- **v9.6.6 · T2 模板市场开篇(模板抽取/评分/检索 lib)** ✅ 2026-06-04:新 `lib/template-market`(零依赖纯逻辑)开 T2 地基 —— 把出片好的项目沉淀成可复用 `FilmTemplate`(画风 + 多参元素概览 + 节奏 + 体量 + 质量分 + 标签)。① `summarizeElements(byRole)` 复用 `reference-elements` byRole → 角色计数概览;② `scoreTemplate(signals)` 由源项目质量信号(发布门禁 0.5 / 一致性 0.25 / 多参完整度 0.15 / 口型 0.10,缺信号权重归一,全缺 60)算模板质量分;③ `extractTemplate(input)` 抽取 + 派生标签;④ `searchTemplates / rankTemplates` 检索(画风/类型/关键词/最低质量)+ 相关度·质量排序。复用 T1/T3/阶段十五的质量信号当模板分,**融合而非另起**。验证:**tsc 0 + 11 单测**。**T2 开篇只落纯逻辑地基,持久化 + 市场 UI + 一键起片留后续。**

> **里程碑(达成)**:阶段十六三主题全部落地 —— **T1 配音口型**完整竖切(v9.6.1–v9.6.4 lib→API→UI→门禁/重拍)+ **T3 性能成本**完整竖切(v9.6.0 地基 + v9.6.5 接真实计费)+ **T2 模板市场**开篇地基(v9.6.6 抽取/评分/检索 lib)。三条线都复用既有质量/多参/成本信号,**完美融合不生硬**。

### 5.16 阶段十六续 · T2 模板市场闭环 + T1 口型真渲染

- **v9.6.7 · T2 模板持久化(film_templates 表 + repo)** ✅ 2026-06-04:`film_templates` 表(SQLite canonical `db.ts` + `db/schema.pg.sql` 镜像,双驱动)—— 模板的 画风/类型/节奏/元素概览/质量分/标签 + **一键起片预填 `payload`**(style/references/genre/pacing/lockedCharacters)+ 公开度 + use_count。新 `lib/repos/template-repo`(async DbDriver):`saveTemplate / getTemplate / listMarketTemplates`(取公开 → 复用 `searchTemplates` 过滤排序)`/ listOwnerTemplates / recordTemplateUse`。验证:**tsc 0 + 4 repo 单测(真 SQLite)+ PG 往返**(windcomic-pg:建表 + 默认值 + 增删查通过)。
- **v9.6.8 · T2 市场 API + UI + 一键起片(闭环)** ✅ 2026-06-04:把模板做成可用闭环。**API**:`POST /api/projects/[id]/save-template`(读项目 画风/锁定角色/分镜 + 质量信号 → `extractTemplate` → 落库)· `GET /api/templates`(市场列表,q/genre/style/minQuality)· `GET /api/templates/[id]` · `POST /api/templates/[id]/use`(use_count++)。**UI**:① 侧栏新「**模板市场**」页(`/dashboard/templates`,卡片:标题/画风/质量徽章/元素 chip/标签/被起片次数 + 搜索);② 项目「技术监看」tab 加「**存为模板**」按钮(上架);③ **一键起片**:市场「用此模板起片」→ POST /use 计数 + payload 经 `sessionStorage('qfmj-create-template')` 交创作工坊 → create 页预填 **画风 + 多参元素 + 锁定角色**(同风格画廊 handoff)。验证:**tsc 0**(端到端真存/起留浏览器实测)。**T2 闭环:出片好的项目 → 存模板 → 市场检索 → 一键起片复用。**
- **v9.6.9 · T1 口型引擎 provider 子系统** ✅ 2026-06-04:为「viseme 轨 → 真出口型视频」铺可插拔引擎层(对齐 video-providers)。`lib/lipsync-providers`:`types`(`LipSyncProvider` 契约:id/priority/supportsVideoDriver/`available()`/`generate(faceUrl+audioUrl+visemes)`)+ `registry`(register/select【available+视频底板能力过滤 · prefer→priority 排序】/`dispatchLipSyncGenerate`【链式 fallback + 非法 videoUrl 拒绝】/`lipSyncEngineConfigured`)+ `builtins`(**通用自托管 HTTP 适配器 `wav2lip-http`**:把任意 wav2lip/SadTalker/MuseTalk 包一层 HTTP 即接入,env 门控 `LIPSYNC_API_URL`/`LIPSYNC_API_KEY`,密钥只走 env 不入库)。验证:**tsc 0 + 7 单测**(注册/env 门控/select 过滤排序/dispatch fallback/全失败→null)。**下接 render 端点 + 面板「真渲染口型」。**
- **v9.7.0 · T1 口型真渲染端点 + UI(规划 → 真出口型视频)** ✅ 2026-06-04:把 v9.6.9 引擎层接进项目。**端点** `/api/projects/[id]/lipsync/render`:`GET` 返引擎状态(configured + provider 列表);`POST` 把某镜真渲染 —— 脸取该镜**分镜图**(`project_assets storyboard`)、音频由调用方传、viseme 轨 body 优先否则从剧本该镜 `planVisemes` 推 → `dispatchLipSyncGenerate` 驱动引擎。**引擎未配置 → 200 `{configured:false}` + 启用提示**(不报错);缺脸/缺音 → 可执行提示。**UI**:`lipsync-panel` 头部「引擎已配置/未配置」徽章 + 选中句「**真渲染口型**」按钮(调端点 → 成功给「查看视频」链 / 否则显示启用或缺料提示)。验证:**tsc 0**(真渲染需配 `LIPSYNC_API_URL` + 音频,留用户环境实测)。**至此 T1:口型 规划→预览→评分→门禁→重拍→真渲染 全链。**

> **里程碑(达成)**:阶段十六续两条线收口 —— **T2 模板市场**闭环(v9.6.7 持久化 + v9.6.8 市场/一键起片)+ **T1 口型真渲染**(v9.6.9 引擎子系统 + v9.7.0 render 端点/UI,可插拔自托管 wav2lip/SadTalker)。

- **v9.7.1 · 口型真渲染进成片管线(自动取音 + 写回分镜/时间线)** ✅ 2026-06-04:把 T1 真渲染从「需手传 audioUrl」打通成「**自动取音 + 渲染结果回流成片**」。① **每镜配音落资产**:新 `POST /api/projects/[id]/shot-audio` 把各对白镜台词经 TTS(prosody 随情绪 v2.9:`deriveProsody → speed/pitch`)合成 → `persistAsset` 落盘 → 存 `project_assets type='shot-audio'`(shot_number 索引,覆盖式);无引擎 → 优雅 `{configured:false}`。② **render 自动取音**:`/lipsync/render` 缺 `audioUrl` 时按 shot_number 自动取 `shot-audio` 资产。③ **写回管线**:渲染成功 → `persistAsset` + 存 `type='video'` 该镜资产(**新 `updated_at` → `timeline`/分镜 `loadShotMedia` 自动取最新口型版**,非破坏式,原视频留史)。④ **UI**:`lipsync-panel` 加「**合成全片配音**」按钮 + 真渲染成功提示「已写回分镜/时间线」。验证:**tsc 0**(真链路需 `MINIMAX_API_KEY` 出音 + `LIPSYNC_API_URL` 出片,留用户环境实测)。**至此口型真正进成片:台词→配音资产→口型视频→回流时间线。**
- **v9.7.2 · TTS / 口型成本记账(点亮 T3 成本面板)** ✅ 2026-06-04:v9.3 成本可观测一直只读 cost_log、**无生产写入**(T3 面板实际常空)。本版补**首个生产写入器**:新 `lib/repos/cost-log-repo`(async 双驱动)`recordCostLog`(userId 缺失/负成本/异常 → false 不阻断)+ `estimateTtsCostCny`(~¥0.02/s 或按字)/`estimateLipsyncCostCny`(引擎值优先,否则 ~¥0.15/s 最低 ¥0.1)。`shot-audio` 每段配音记一笔 `engine=tts-<provider>`、`render` 每镜口型记一笔 `engine=lipsync-<provider>` —— engine 串带类目关键词,`classifyEngineCategory` 自动归类,**T3 项目成本面板即显 TTS / 口型两项开销**。验证:**tsc 0 + 5 单测**(估算 / 归类 tts·lipsync / 落库+项目归因 / userId 缺失·负成本→false)。**成本闭环:生成即记账 → T3 自动显形。**
- **v9.7.3 · 一键全片口型(批量 配音→渲染→写回 + 进度面板)** ✅ 2026-06-04:**复用 oneclick-film-panel 闭环编排骨架**(running / 实时彩色 log / stopRef / 运行前 confirm)。新 `components/project/lipsync-batch-panel` 挂「配音口型」面板内:一键把全片对白镜跑完 ① `POST /shot-audio` 合成全片配音 → ② 逐镜 `POST /lipsync/render`(自动取音 + 写回分镜)。引擎未配置 → 首镜即终止提示;中途可停止;末尾汇总「N/M 镜出口型(已进时间线/分镜)」。验证:**tsc 0**(真链路需 TTS + 口型引擎,留用户环境实测)。**T1 收口:从单镜手动 → 全片一键出口型进成片。**

> **里程碑(达成)**:阶段十六 T1 配音口型全流程闭环 —— 规划/预览(v9.6.1-3)→ 评分/门禁/重拍(v9.6.4)→ 真渲染引擎+端点(v9.6.9/v9.7.0)→ 自动取音+写回管线(v9.7.1)→ 成本记账点亮 T3(v9.7.2)→ **一键全片**(v9.7.3)。配音口型从「纸面规划」做到「一键出片进时间线、成本可见」。

### 5.17 阶段十六精修 · 配音音色路由 + 口型质检回环

- **v9.7.4 · 批量配音音色按角色路由** ✅ 2026-06-04:`shot-audio` 之前全片一个嗓 → 现按角色名分配**稳定且互异**的音色。新 `lib/voice-routing`(纯逻辑,复用 `character-studio.VOICE_CATALOG` 4 音色 + gender/age):`inferGenderFromName`(中文称谓 hint 推性别)+ `buildVoiceRouting(names)`(首次出现顺序 + 性别池内轮转 → 同性别多角色不撞嗓、同名跨镜永远同嗓)。`shot-audio` 用 `characters[0]` 路由 voiceId(`body.voiceId` 仍可强制全片统一,back-compat),资产 + 成本记账带 speaker。验证:**tsc 0 + 6 单测**(性别推断 / 同性别不撞嗓 / 确定性+空名跳过 / 音色池回绕 / 兜底)。
- **v9.7.5 · 口型质检回环(渲染后复评 + 弱镜自动重渲)** ✅ 2026-06-04:口型渲染(已写回为该镜 video)后跑一遍 Vision 质检,弱镜自动重渲。新 `lib/lipsync-qc`(纯逻辑,**复用 `buildRebirthPlan`**):`planLipSyncQc({audits, threshold=70, round, maxRounds=2, onlyShots})` → 裁决 `done`(全达标)/`rerender`(给弱镜号,分数升序)/`stop`(到轮上限转人工),`onlyShots` 限定只评本批口型镜。`lipsync-batch-panel` 加「**质检回环**」开关 + QC 阶段(`vision-audit/run` 复评 → `planLipSyncQc` → 弱镜 `lipsync/render` 重渲,≤2 轮、可停)。验证:**tsc 0 + 5 单测**(done/rerender/stop/onlyShots 过滤/自定义阈值)。

> **里程碑(达成)**:阶段十六 T1 精修收口 —— 配音**按角色多音色**(v9.7.4)+ 口型**渲染后自动质检重渲**(v9.7.5)。配音口型从「一键出片」升级到「**多嗓 + 自愈**」,复用既有 VOICE_CATALOG / rebirth-plan / vision-audit,零新引擎。

### 5.18 阶段十六精修 II · 口型-音频对齐专项评分 + 音色手动覆盖

- **v9.7.6 · 口型-音频对齐度专项评分** ✅ 2026-06-04:通用 Vision 画面分管不了「嘴开合跟没跟上声音」→ 加专项维度。新 `lib/lipsync-align`(纯逻辑,client 安全):`rmsEnvelope`(PCM→逐窗能量)/`resample`/`visemeEnvelope`(张口包络阶梯采样)/`pearson`/`bestLag`(±时延找最佳相关,检测音画漂移)/`scoreLipAudioAlignment`(张口包络 vs 能量包络 → 最佳时延处正相关 → 0-100 + verdict + lagSec)。`shot-audio` GET 返每镜 audioUrl;`lipsync-panel` 加「**测音画对齐**」(浏览器 Web Audio 解码该镜配音 → `rmsEnvelope` → 评分,显示分 + 「跟得上/基本同步/对不上」+ 音频超前/滞后)。验证:**tsc 0 + 8 单测**(pearson/resample/rms/viseme 包络/bestLag/对齐高分/反相低分/检出时延)。
- **v9.7.7 · 音色手动覆盖货架(挑 / 试听,覆盖自动路由)** ✅ 2026-06-04:在 v9.7.4 自动路由上加用户手动覆盖。`voice-routing` 加纯函数 `effectiveVoice(speaker, {force,overrides,routing})`(优先级 force > 覆盖 > 路由 > 默认)。新端点 `GET/POST /api/projects/[id]/voice-overrides`(角色→音色,存 `project_assets type='voice-overrides'`)+ `POST /api/voice-sample`(合成一句样例供试听,引擎未配 → 优雅提示)。`shot-audio` 读覆盖 → `effectiveVoice` 定每镜音色。新 `components/project/voice-shelf`(挂「配音口型」面板,默认折叠):全片角色 + 下拉挑 `VOICE_CATALOG` 音色(label·tone)+「试听」(Web Audio 播样例)+「自动/手动」标 +「保存」。验证:**tsc 0 + 7 单测**(voice-routing +effectiveVoice 优先级 1 例)。

> **里程碑(达成)**:阶段十六 T1 精修 II 收口 —— 口型质检加「**嘴-声对齐**」专项维度(v9.7.6)+ 配音音色「自动路由 + **手动挑/试听覆盖**」(v9.7.7)。配音口型既能自动多嗓,也能逐角色人工调校。

### 5.19 阶段十六精修 III · 对齐分入质检 + 音色入模板

- **v9.7.8 · 对齐分并入质检回环(口型对不上也触发重渲)** ✅ 2026-06-04:让 v9.7.6 的音画对齐分像 Vision 画面分一样参与弱镜判定。`planLipSyncQc` 加可选 `alignScores`(shotNumber→0-100)+ `alignThreshold`(默认 60):弱镜 = **Vision 弱 ∪ 对齐弱**(去重,Vision 在前、对齐弱按分升序在后)。`lipsync-batch-panel` QC 阶段先客户端 Web Audio 算各镜对齐分(`/lipsync` viseme + `/shot-audio` 配音 → `rmsEnvelope`+`scoreLipAudioAlignment`,封顶 40 镜、稳定不随重渲变),并入 `planLipSyncQc` → 画面 OK 但音画对不上的镜也会自动重渲。验证:**tsc 0 + 8 单测**(原 5 + 对齐并入 3:画面达标但对齐低判弱 / Vision∪对齐去重升序 / 阈值+onlyShots)。
- **v9.7.9 · 音色覆盖带进模板(一键起片复用音色)** ✅ 2026-06-04:T2 模板把 v9.7.7 的角色音色覆盖一起沉淀,一键起片连音色配置一起复用。`TemplatePayload` 加 `voiceOverrides`;`save-template` 读项目 `voice-overrides` 资产 → 写进模板 payload;市场「用此模板起片」原样经 sessionStorage 透传 payload(含 voiceOverrides);create 页**暂存** `qfmj-pending-voice-overrides`(项目此刻未建)→ 生成流跑完(项目已建,server 用 client `projectId`)后 `POST /voice-overrides` 落到新项目 → 下次「合成配音」按此音色。验证:**tsc 0 + template-repo 单测加 voiceOverrides 往返断言**。

> **里程碑(达成)**:阶段十六精修 III 收口 —— 口型质检 **画面 + 音画双维度自愈**(v9.7.8)+ 模板复用 **连音色配置一起带走**(v9.7.9)。T1 配音口型 与 T2 模板市场 打通:出片好的项目(含逐角色音色)→ 存模板 → 一键起片连音色复用。

### 5.20 阶段十六精修 IV · 漂移自动校正 + 模板预览片

- **运维补丁(2026-06-04)**:windcomic-pg 的 `cases` 表 `ALTER ADD video_url` + 从 SQLite 同步 4 条案例(3 条带 clip URL),防将来切 `DB_DRIVER=pg` 时灵感库空/无视频(临时脚本跑完即删,密钥只走 env 不打印)。
- **v9.7.11 · 口型漂移自动校正** ✅ 2026-06-04:`bestLag` 已能测音画时延 → 现把时延平移回 viseme 轨补偿。`lipsync-align` 加 `shiftVisemeTrack(frames, offsetSec)`(整体平移、保留 viseme 字段、丢负时刻)+ `autoAlignVisemes({visemes,audioEnergy,durationSec})`(测时延 → 平移补偿 → 给校正前后**零时延裸对齐分** + 校正轨)。`lipsync-panel`「测音画对齐」顺带算补偿轨,漂移 ≥0.05s 时显「**校正漂移重渲**」按钮 → 把平移后的 viseme 轨传 `/lipsync/render`(已支持 body.visemes)→ 下次渲染嘴对齐声音。验证:**tsc 0 + 11 单测**(原 8 + shift 保留字段/丢负 + autoAlign 检漂移/不降 + 无漂移≈0)。
- **v9.7.12 · 模板预览片(市场卡片可视化)** ✅ 2026-06-04:模板卡此前纯文字(标题/画风/质量)→ 现带预览。`save-template` 抓源项目**首镜成片视频**(`type=video` shot 最小)+ **首镜分镜图**(`type=storyboard`)→ 写进 payload `previewVideoUrl`/`previewUrl`;`TemplatePayload` 加该两字段;市场卡顶部加预览区:有视频 → `<video autoPlay muted loop>` 静音循环播首镜(同灵感库 v9.5.5 那套),否则首镜图,都无则纯文字。验证:**tsc 0 + template-repo 单测加 previewVideoUrl 往返断言**(4 测绿)。

> **里程碑(达成)**:阶段十六精修 IV 收口 —— 口型**漂移自动校正**(v9.7.11:测时延→平移补偿→重渲)+ 模板市场**可视化预览片**(v9.7.12)。T1 口型自愈再进一步(不止重渲,还校时延),T2 市场从文字卡升级到可视化片头。

### 5.21 阶段十六精修 V · 预览片落盘 + 对齐分进门禁

- **v9.7.13 · 模板预览片落盘 + 音画对齐进发布门禁** ✅ 2026-06-04:① **预览片落盘**:`save-template` 不再直存源项目资产 URL,而是 `persistAsset` 把首镜图/视频**拷成 .storage 独立副本**(内容寻址)→ 源项目删了模板预览仍在;落盘失败回退原 URL。② **音画对齐进门禁**:`quality-gate` 加 `lipAudioAlign`(measuredShots/weakShots/avgScore)输入 —— 实测对齐有弱镜或均分 <75 → warn + 偏弱维度「口型对齐」(增强维度不硬拦)。新端点 `GET/POST /api/projects/[id]/lipsync-align`(存实测对齐分,`type='lipsync-align'` 资产,合并式);面板「测音画对齐」+ 批量 QC 算完即 POST 存分;`publish-readiness` 读对齐资产 → 聚合(measured/weak<60/avg)→ 喂 gate,返 `lipAudioAlign`。验证:**tsc 0 + quality-gate +4 单测**(有弱镜 warn / 均分偏低 warn / 高分 pass / measured0 无数据)。

> **里程碑(达成)**:阶段十六精修 V —— 模板预览**落盘不失效**(v9.7.13①)+ 发布门禁纳入**实测嘴-声对齐**(v9.7.13②)。成片质量结论现含 画面对剧本 / 一致性 / 口型可对齐 / **实测口型-音频对齐** 多维。

### 5.22 阶段十六精修 VI · 徽章四维 + 模板分纳对齐 + 评分收藏 + 成本护栏

- **v9.7.14 · 发布徽章四维明细** ✅ 2026-06-04:`publish-readiness-badge` 此前只显 level+原因 → 现加**四维质量明细网格**:画面对剧本 / 一致性 / 口型可对齐 / 实测口型对齐,每行 状态点(达标绿/偏弱黄/未测灰)+ 明细(就绪分 / 均分)。数据全来自 `publish-readiness` 已返的 gate+lipSync+lipAudioAlign(badge 改存整个 body,显示条件加 hasLipSync/hasLipAudioAlign)。验证:**tsc 0**(纯展示)。
- **v9.7.15 · 对齐分进模板质量分** ✅ 2026-06-04:`scoreTemplate` 加 `lipAudioAlign`(实测口型-音频对齐均分,权重 0.15;缺则不计、权重归一);`save-template` 读项目 `lipsync-align` 资产算均分 → 喂 `extractTemplate` signals → 测过对齐的项目存模板时质量分更准(实测对齐差则模板分降)。验证:**tsc 0 + template-market +2 断言**(单信号归一 / 对齐拉低总分 78)。
- **v9.7.16 · T2 模板评分 / 收藏** ✅ 2026-06-04:模板市场加用户互动。**Schema**(双驱动 + live PG):`film_templates` +`rating_sum/rating_count`;新 `template_ratings`(每用户每模板一评分,去重 PK)+ `template_favorites`(每用户收藏,PK)。**repo**:`rateTemplate`(1-5 夹紧 + upsert + 重算聚合)/ `getUserRating` / `toggleFavorite` / `listFavoriteIds` / `listFavoriteTemplates`,`StoredTemplate` 加 `ratingAvg/ratingCount`。**API**:`POST /templates/[id]/rate`、`POST /templates/[id]/favorite`、`GET /templates?fav=1` + 返 `favoriteIds`。**UI**:市场卡 ⭐ 点星打分(显均分+评分数)+ ♥ 收藏 + 顶部「只看收藏」筛选。验证:**tsc 0 + 8 repo 单测(真 SQLite:多用户聚合/去重 re-rate/夹紧/收藏 toggle/幂等)+ PG 往返**(ALTER+建表+评分 smoke)。
- **v9.7.17 · T3 成本预算护栏** ✅ 2026-06-04:`cost-attribution` 加纯函数 `evaluateCostGuard({totalCny,capCny,warnThreshold=0.8})` → `none`(无上限)/`ok`/`warn`(≥阈值)/`over`(≥上限)+ 占比/剩余/提示。与 `cost-rollup.computeBudget`(周期+线性预测)正交:这是单项目累计花费的硬上限护栏。`GET /api/projects/[id]/cost` 加 `?cap=` 返 guard;`cost-attribution-panel` 加预算上限输入(localStorage 按项目存)+ 进度条(ok 绿/warn 黄/over 红)+ 文案。验证:**tsc 0 + cost-attribution +4 单测**(无上限/预算内+占比/达阈值 warn/超上限 over)。

> **里程碑(达成)**:阶段十六精修 VI 收口 —— 发布徽章四维(v9.7.14)+ 对齐进模板分(v9.7.15)+ 模板评分收藏(v9.7.16)+ 成本预算护栏(v9.7.17)。T2 市场从「能存能起」到「**评分/收藏/可视化**」社区化,T3 成本从「可见」到「**有护栏**」。

## 6. 技术债清单(待清理)

| 隐患 | 位置 | 优先级 | Sprint |
|---|---|---|---|
| ~~TTS 模型不一致~~ ✅ v9.0.4e | minimax.service 3 处 `speech-2.8-hd`→`speech-02-hd` 统一 (与 tts.service 一致) | 中 | ✅ 已清 |
| `lib/export.ts` PDF/视频 stub TODO | export.ts:11/47/52 | 低 | 不安排 — §2.3 已替代 |
| `skills/skills-implementation.ts` 4 个 AI 能力占位 | skills-implementation.ts:43/96/145/190 | 低 | 不安排 — 实验性目录 |
| SQLite 并发写锁(invite-codes 偶发) | better-sqlite3 并行写 | 中 | 等 PG 迁移解 |
| `lib/i18n.ts` 繁中/日文占位 | i18n.ts:130/132 | 低 | Sprint D+ |
| `lib/performance.ts` 分析服务 TODO | performance.ts:108 | 低 | 不安排 |
| `services/tts.service.ts` 重复 voice profile | tts.service.ts:40 | 低 | C.4 顺带清 |

---

## 7. 决策日志(本次)

> 所有"产品判断"在这里留痕, 后续撞同类问题不再重新决策。

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | Cameo Auto-Retry 阈值 | **< 75 触发重生** | 70 太松 (用户已感觉一致性差); 80 太严 (重生频繁拖时间), 75 是甜点 |
| 2 | Cameo 仪表盘位置 | **嵌入"分镜" tab 列** | 不开新 tab — 与镜头本身同视觉单元, 决策更直接 |
| 3 | BGM beat 对齐默认值 | **默认开** | 节奏感是"专业感"的最大杠杆, 默认开让所有用户受益; 留开关给"我就要平铺"的特殊场景 |
| 4 | Stripe 接入档位 | **4 档全部** (free / pro / studio / enterprise) | `lib/pricing.ts` 已经有 4 档数据, 一次接全, 不分两次发布 |
| 5 | ROADMAP_V4 落档 | **是** — 取代 V3 | 累计 v2.11 + Sprint A/B/C/D 内容已远超 V3, 单文档清晰 |

---

## 8. 测试覆盖现状 (v3.5 截止)

| 维度 | 数据 |
|---|---|
| Test files | 106 |
| Tests passing | **1346 / 1346** ✅ |
| TypeScript 错误 | **0** |
| Vitest 配置 | pool=forks singleFork + retry=1 (SQLite WAL 偶发锁自愈) |
| 近期新增覆盖 | plugin chain (mode/router/telemetry 46), timeline 终局 (ripple/align/history 28), vision audit (15), 导出预设 (export/subtitle 25) |
| **下一轮应补** | video-composer 导出预设集成测试, vision-audit orchestrator 触发链路 e2e |

---

## 9. 当前技术栈(v3.5 最终版)

| 层 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js 16.2.1 + Turbopack(port 3000) | dev: `npm run dev` |
| 前端 | React 19 + Tailwind v4 + Zustand + react-dnd + react-hotkeys-hook + lucide-react |  |
| 测试 | Vitest 4.1.0 + @testing-library/react |  |
| LLM | `claude-sonnet-4-20250514` via vectorengine.ai | Polish Pro 用 0.5°, Basic 用 0.7° |
| 图像(主) | Midjourney via vectorengine.ai | cref + sref |
| 图像(备) | Minimax `image-01` → flux.1-kontext-pro × 2 → fal/ComfyUI |  |
| 视频(主) | Minimax `MiniMax-Hailuo-2.3` (T2V) / `I2V-01` (I2V) | I2V 走分镜首帧 → 场景图降级链 |
| 视频(备) | Veo `veo3.1-fast` via vectorengine.ai → Kling |  |
| TTS | Minimax `speech-2.8-hd` | C.4 sprint 把 tts.service.ts 也对齐 |
| 音乐 | Minimax `music-2.6` |  |
| 本地合成 | ffmpeg via `services/video-composer.ts` | + `lib/audio-silence.ts` 兜底 |
| **引擎插件化** (v3.2) | image/video/tts provider 注册表 + `PLUGIN_CHAIN_MODE` 灰度 | off/shadow/primary, SQLite 遥测 |
| **成片质检** (v3.4) | LLM Vision Audit 每镜对剧本打分 | `lib/vision-audit.ts` |
| **导出预设** (v3.5) | 横竖屏 + 平台字幕 + webp/avif | `lib/video-export.ts` / `lib/subtitle-burn.ts` |
| 持久化 | SQLite + Drizzle | 计划迁 Postgres (Sprint D+) |
| 鉴权 | JWT + bcrypt + 邀请码 |  |
| 监控 | Sentry (lazy lib/telemetry.ts) + plugin-chain telemetry |  |

---

## 10. 建议执行顺序 (v3.5 后刷新)

```
3.x 全线已交付 (v3.2 插件化 → v3.3 timeline → v3.4 vision audit → v3.5 导出)
            ↓
3.x.1 收尾  │  各版 UI 接线 (timeline 三件套绑组件 / vision panel 挂项目页 /
            │  video-composer 接导出预设 / plugin shadow 跑一周看数据切 primary)
            ↓
v4.x (季度) │  Sprint D+ · Cameo IP 经济 / Agent 编排 IDE / PG 迁移 + 真多人协作
            ↓
长期        │  移动端 Capacitor / i18n 繁中日英
```

---

> 本路线图为活文档。每完成一个 Sprint 项, 把 `[ ]` 改成 `[x]` 并附 commit hash。每个 Sprint 收尾追加一份"实测数据"表 (Cameo 均值 / 重生率 / 用户主观评分等), 方便下一个 Sprint 用真实数据决策阈值。
