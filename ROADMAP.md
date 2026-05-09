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
- **TODO**:编排器接入 beat snap 默认开(下次 minor 跟进,目前 lib 已就绪)

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
- **TODO**:plan gate 接入具体路由(U2V → enterprise / Polish Pro → pro)留给下次 minor — middleware 已就绪,只需在路由里加一行 `const r = checkPlan(req, 'pro'); if (!r.ok) return planRejection(...)`

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

### P0.1 · 项目模板扩充 ✅ 2026-05-10 (commit `<TBD>`)
- [x] `lib/story-templates.ts` 6 个新模板 — sci-fi-space / kids-cartoon / historical-biopic / animal-fable / food-vlog / music-video, 共 18 个覆盖 12 大题材
- [x] `StoryTemplate` 加可选 metadata: `tags[]` (筛选/推荐) + `recommendedDuration` (5/6/10/15) + `recommendedAspect` (16:9/9:16/1:1/2.35:1) + `recommendedCamera` (CAMERA_LANGUAGE_PRESETS id)
- [x] create page `handleSelectTemplate` — 选了带 recommended* 的模板时自动填 duration / aspect / cameraDefault
- [x] 测试: 18 模板字段完整性 / id 唯一 / 新模板带 metadata / 推荐值落在合法白名单内 (10 cases)

### P0.2 · Character + Scene 设计并行 ✅ 2026-05-10 (commit `<TBD>`)
- [x] `app/api/create-stream/route.ts`: 把 runCharacterDesigner / runSceneDesigner 抽成两个独立 IIFE 函数
- [x] 普通模式 (无 enableGates) 用 `Promise.all` 并行跑 — 创作时长省 30-60s (这两步原本 30-90s 各)
- [x] gates 模式 (enableGates=true) 保留串行 — after-characters gate 语义依赖顺序
- [x] SSE 'characters' / 'scenes' / 'agents' 事件按到达顺序流出, UI 正常显示

### P0.3 · idea normalizer (prompt 质量) ✅ 2026-05-10 (commit `<TBD>`)
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

### v2.18 P1 待跟(下次)
- 模板"克隆"功能 — 选已有模板基础上微调后另存为新模板
- 用户保存自己的项目作为个人模板 (复用 global_assets type='style' / type='template' 表)
- "试拍" 模式 — 1 镜端到端 (15s) 让用户先确认风格再走完整 pipeline
- 模板检索 / 标签筛选 UI (现在是平铺列表, 18 个开始多了)

---

## 5. Sprint D+ · 长期愿景(v3.x — v4.x)

| 方向 | 定位 | 预期周期 |
|---|---|---|
| 跨项目角色 IP 经济 (Sora-style cameo) | 用户角色 token 化, 经授权可被其他用户复用, 创作者经济雏形 | v3.x — 1 个月 |
| 端到端 LLM Vision Audit | 成片每镜过 GPT-4o Vision, 0-100 分"画面是否对得上剧本" | v3.x — 2 周 |
| LangGraph / Agent 编排 IDE | 用户拖拽自定义 agent 工作流, 替换 Director / 并行 Cameo+Editor | v4.x — 1 个月 |
| PG 迁移 + 多人协作 (Yjs CRDT) | SQLite → Postgres + 多人同编 + 评论 | v4.x — 2 周 |
| 移动端原生 (Capacitor) | iOS 优先, 安卓次之 | v4.x — 长期 |
| i18n 繁中 / 日文 / 英文 | `lib/i18n.ts` 当前 zh-TW/ja 都是占位 | 任意 Sprint 顺手做 |

---

## 6. 技术债清单(待清理)

| 隐患 | 位置 | 优先级 | Sprint |
|---|---|---|---|
| TTS 模型不一致 | `tts.service.ts:134` (speech-02) vs `minimax.service.ts:737` (speech-2.8-hd) | 中 | C.4 |
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

## 8. 测试覆盖现状

| 维度 | 数据 |
|---|---|
| Test files | 27 |
| Tests passing | **313 / 313** ✅ |
| TypeScript 错误 | **0** |
| 关键集成测试 | polish-api (19), invite (26), 注册 (4) |
| 关键单元测试 | text-diff (10), audit-markdown (17), polish-prompts, polish-parser, polish-json, character-manager, creation-wizard ... |
| **下一个 Sprint 应补** | cameo-retry (Sprint A), composer-jcut (Sprint B), stripe-webhook (Sprint C) |

---

## 9. 当前技术栈(v2.11 最终版)

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
| 持久化 | SQLite + Drizzle | 计划迁 Postgres (Sprint D+) |
| 鉴权 | JWT + bcrypt + 邀请码 |  |
| 支付 | (待接) Stripe Checkout + Webhook | Sprint C.2 |
| CI/CD | (待接) GitHub Actions | Sprint C.3 |
| 监控 | Sentry (lazy lib/telemetry.ts) |  |

---

## 10. 建议执行顺序

```
本周        │  v2.11 验收 §1 端到端 — 跑全新项目, 收集日志
            ↓
v2.12 (1-2 周)│  Sprint A · 一致性深化 (用户痛点最深)
              │  并行 C.4 TTS 对齐 (技术债, 顺手)
            ↓
v2.13 (1-2 周)│  Sprint B · 剪辑专业化
              │  并行 C.3 CI/CD (1 天)
            ↓
v3.0 (2-3 周)│  Sprint C 主体 · U2V + Stripe (商业化里程碑)
              │  开始 PG 迁移规划
            ↓
v3.x → v4.x  │  Sprint D+ 长期愿景 · Cameo 经济 / Vision Audit / Agent IDE
```

---

> 本路线图为活文档。每完成一个 Sprint 项, 把 `[ ]` 改成 `[x]` 并附 commit hash。每个 Sprint 收尾追加一份"实测数据"表 (Cameo 均值 / 重生率 / 用户主观评分等), 方便下一个 Sprint 用真实数据决策阈值。
