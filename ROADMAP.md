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

### A.2 用户脸 → 6 维档案反向抽取
- [ ] `lib/character-traits.ts` 新增 `traitsFromFace(imageUrl): Promise<CharacterTraits>`
  - 走 GPT-4o Vision: "请从这张人脸图抽取性别/年龄段/肤色/发型/眼型/气质 6 维, 返回 JSON"
- [ ] character manager UI 上传脸时自动跑反向抽取, 出 6 维卡片让用户确认/编辑
- [ ] 抽出来的 traits 合并到 `character.visual + character.bible`, 后续 prompt 自动带
- **验收**:上传 5 张不同脸, 6 维输出准确率 ≥80%(人工评估)

### A.3 Character Bible 跨项目持久化
- [ ] `global_assets.metadata` 加 `bible: { traits, visual, sampleFaces[] }` 字段(无 schema 变化, 现有 metadata 是 JSON)
- [ ] 新项目创建时, 用户输入相同角色名 → 自动检测 → 提示"是否复用 Bible"
- [ ] 复用时把 Bible 注入 character description + cref/sref
- [ ] 新增 `app/api/characters/bible/[name]/route.ts` 查询 endpoint
- **验收**:同一角色名跨 3 个项目, 视觉一致性肉眼无差异

### A.4 Cameo 仪表盘嵌入"分镜" tab(决策 #2)
- [ ] 修改 `app/projects/[id]/page.tsx` 的"分镜"tab 渲染
  - 每个分镜卡右上角加 Cameo score 徽章(红 <70 / 黄 70-84 / 绿 ≥85)
  - 点徽章弹 popover 显示该镜每个角色的具体分数 + 重生历史
- [ ] 列表上方加汇总条:`本项目 N 镜 · 平均 86 · ⚠️ 2 镜需重生`
- [ ] 加"批量重生低分镜"按钮 → 触发 A.1 retry 流程
- **验收**:看仪表盘能在 5 秒内判断"哪些镜要重画"

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

### B.1 j-cut / l-cut 音轨真实现
- [ ] 修改 `services/video-composer.ts` 的音轨段处理
  - j-cut: 下一镜台词音轨提前 0.3-0.5s 入(`adelay` 用前镜结尾 - 0.5s)
  - l-cut: 当前镜头台词延后 0.3-0.5s 出(`atrim end` 延伸到下一镜开头 + 0.5s)
- [ ] LLM editing plan 的 `transition` 字段新增 `jcut` / `lcut` 枚举, orchestrator 读 plan 应用到音轨
- [ ] 单测 `tests/composer-jcut.test.ts`:mock ffmpeg 调用参数, 验证 adelay/atrim 计算正确
- **验收**:盲测 5 段含对白的视频, 编辑感"自然/不突兀"占比 ≥70%

### B.2 字幕动效引擎
- [ ] `services/subtitle.service.ts` 当前是 burn-in 静态 → 加三档:
  - `fade-in`(0.3s 淡入)
  - `typewriter`(逐字出现, 与 TTS 时间对齐)
  - `pop`(放大回弹)
- [ ] `subtitleStyle: 'static' | 'fade' | 'typewriter' | 'pop'` 加入 LLM editing plan
- [ ] 字幕 burn-in 用 `drawtext` filter 的 `enable` + `alpha` 表达式实现淡入
- **验收**:用户主观觉得"动起来了"

### B.3 Beat-driven editing(默认开 — 决策 #3)
- [ ] `lib/beat-detect.ts` 用 `ffmpeg silencedetect` + `astats` 找 BGM 的 beat 位置
  - 返回 `beats: number[]`(秒)
- [ ] orchestrator 的 LLM editing plan 增加 `beatAlign: true` 默认开
- [ ] composer 在合成前把每个镜头的 in/out 时间对齐到最近 beat(±0.15s 窗口内)
- [ ] 用户可在 LatestPolishBanner / 项目设置里关闭, 但默认 ON
- **验收**:有 BGM 的视频节奏感"卡上拍点"

### B.4 片头 / 片尾自动生成
- [ ] `services/intro-outro.ts`
  - 片头:封面图 + 标题 + 制作信息 fade-in 1.5s
  - 片尾:角色 roster + "Made by AI Comic Studio" 2s
- [ ] 项目页"导出"按钮新增"含片头片尾"选项, 默认开
- **验收**:成片首尾不再是突兀切入/截断

### Sprint B 总验收
- ✅ 盲测 5 段视频, 用户感觉"专业 / 像短剧"占比 ≥60%
- ✅ j-cut / l-cut 音轨偏移正确率 100%
- ✅ Beat 对齐默认生效, 节奏感肉眼可辨

---

## 4. Sprint C · 平台化(目标版本 v3.0)

> **主题**:商业化 + CI/CD + U2V 独立功能
> **预期周期**:2-3 周(并行 A/B 都行, 不强依赖)
> **决策**:Stripe 接 **4 档全部**(free / pro / studio / enterprise — 决策 #4)

### C.1 U2V 参考图驱动(§3.2 V3 残)
- [ ] 新增 `app/dashboard/u2v/page.tsx` — 上传一张静帧 + 文本提示 → Minimax I2V-01
- [ ] 新增 `app/api/u2v/route.ts` — 走 `services/minimax.service.ts` I2V
- [ ] sidebar 加入口
- **验收**:5 张图各跑一次, 成片率 ≥80%

### C.2 Stripe 订阅 4 档接入(决策 #4)
- [ ] 复用现有 `lib/pricing.ts` 4 档(free / pro / studio / enterprise)
- [ ] 新增 `lib/stripe.ts` 客户端 + `app/api/stripe/checkout/route.ts` Checkout Session
- [ ] 新增 `app/api/stripe/webhook/route.ts` 处理 `checkout.session.completed` / `subscription.updated` / `subscription.deleted`
- [ ] DB 加 `users.subscription_tier` + `users.subscription_status` + `users.stripe_customer_id`
- [ ] 加 plan gate middleware:enterprise 才能用 U2V / Pro 才能用 Pro 润色
- [ ] `app/dashboard/billing/page.tsx` 显示当前 plan + 升级 / 降级 按钮
- [ ] 测试模式跑通完整链:注册 → 选 Pro → Stripe Checkout → webhook → tier 升级
- **验收**:测试模式下 4 档付费链全部跑通

### C.3 GitHub Actions CI/CD(§3.4 V3 残)
- [ ] `.github/workflows/ci.yml`
  - push / PR 触发
  - 跑 `npm install` + `npx tsc --noEmit` + `npx vitest run`
  - 失败阻断 merge
- [ ] 加 README badge
- **验收**:故意 PR 一个 tsc 错误 → CI 红

### C.4 TTS 模型对齐(技术债)
- [ ] `services/tts.service.ts` 从 `speech-02` 升到 `speech-2.8-hd`
- [ ] 与 `services/minimax.service.ts` 共用同一 voice_setting 结构
- [ ] 删 `tts.service.ts` 里重复的 voice profile, 复用 minimax 的
- **验收**:跑 1 段 TTS, 音质对齐 minimax 的输出

### Sprint C 总验收
- ✅ Stripe 4 档付费完整跑通
- ✅ CI 绿, lint+tsc+vitest 三件套自动跑
- ✅ U2V 端到端可用
- ✅ TTS 模型版本统一

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
