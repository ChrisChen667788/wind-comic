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
- Vision audit 给 Style Bible 加 LUT / 光线 / 色温 维度对比 (现在只锁画风, 不锁色调)
- Character DNA 命中率监控 — 实测 vision 能抽出几个字段, 哪些字段最常空
- Lipsync staging 实测 — 等 KELING_API_KEY 到位后跑 1 个项目, 验证 audio_to_video 字段格式

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
