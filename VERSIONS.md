# Wind Comic · 完整版本历史 (VERSIONS)

> 多智能体 AI 短剧/漫剧生成流水线。本文件汇总从首个公开版本 (v2.12.0) 到当前 (v4.2.1)
> 的全部版本信息。每条含发布日期 + commit + 关键交付。详细验收数据见 `ROADMAP.md`。
>
> 截至 v4.2.1:**vitest 1432/1432 通过,tsc 0 错误**。
>
> 仓库:https://github.com/ChrisChen667788/wind-comic

---

## 版本总览表

| 阶段 | 版本区间 | 主题 |
|---|---|---|
| 公开发布 + 影院化 UI | v2.12 – v2.13.5 | 首发、Cinema 设计语言、安全闸门、Stripe 订阅 |
| 引擎用满 + 质量 | v2.14 – v2.19 | S2V/FLF/长镜头、4K、用量监控、模板、prompt 质量、稳定性收尾 |
| 漫剧核心 + 协作 | v2.20 – v3.1.3 | 风格圣经、节奏 audit、DNA、Yjs 实时协作、Cinema 多轨时间线 |
| 引擎插件化 | v3.2 P1 – P4 | image/video/tts provider 注册表 + 灰度切换 + 遥测 |
| 创作纵深 | v3.3 – v3.5 (+.1) | 时间线终局、成片 Vision 质检、多平台导出 |
| 平台化 | v4.0 – v4.2 (+.1) | Cameo IP 经济、Agent 编排引擎、Postgres 迁移 |

---

## 阶段零 · 公开发布前 (v2.10 – v2.11)

公开发布前的内部迭代(详见 ROADMAP §0):多智能体流水线主体(导演/编剧/角色/场景/分镜/视频/剪辑/制片 8 agent)、资产持久化、邀请码鉴权、Cameo 主角脸锁定 (P0)。

---

## 阶段一 · 公开发布 + 影院化 UI (v2.12 – v2.13.5)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v2.12.0** | 2026-04-26 | `33748bb` | 🎉 Wind Comic 首个公开版本 |
| v2.12 (screenshots) | 2026-04-26 | `d81cfb0` | 6 张真实 UI 截图替换 AI mockup |
| v2.12 multi-char | 2026-04-26 | `203e461` | 多角色锁脸 Phase 1 + Hailuo-2.3-Fast 视频兜底 |
| v2.12 fix | 2026-04-26 | `df9e001` | Hailuo-Fast 升到 Kling 之上 |
| v2.12 Phase 2 | 2026-04-26 | `8b0d531` | 每镜多角色 cref 路由 |
| Sprint A (Cameo) | 2026-04-27 | `7edab04` `b89aaf9` `8f658e6` `4b48188` | 每角色独立评分、分镜仪表盘柱状图、上传脸→6维特征、跨项目 Character Bible |
| Sprint B (剪辑) | 2026-04-27 | `824fa3e` | j-cut/l-cut + 字幕动效 + beat 对齐 + 片头片尾 |
| Sprint C.1 (U2V) | 2026-04-27 | `e3064cc` | 单图→视频独立工具 |
| Sprint C.2 (计费) | 2026-04-27 | `d28ed72` | Stripe 4 档订阅端到端 |
| **v2.13** | 2026-05-02 | `e38d2df` `8c20d9e` | Cinema 影院风重设计(区别于同类),剧本误判 + 视频空态修复 |
| v2.13.1 | 2026-05-02 | `a00389c` | Cinema 主题铺到项目页 + 创建页 |
| v2.13.2 | 2026-05-03 | `754b7c2` | 滚动/JSON 修复 + Cinema 铺到 CameoPanel/列表 |
| v2.13.3 | 2026-05-03 | `b2c1d1e` | Tremor 风 Cameo 仪表盘 + Aceternity 特效(0 新依赖) |
| **v2.13.4** | 2026-05-03 | `61c8067` `d8bb3fa` `397aa4a` | 🔒 Prompt 安全闸门 + scope 感知;MovingBorder/TextGenerate/Spotlight;评分甜甜圈 + 趋势线 |
| v2.13.5 | 2026-05-04 | `6bf814e` `d09a4e6` `ba4d774` | 3 个流水线 bug 修复 + Radix Tabs/Tooltip/Popover + 竞品差距分析 |

---

## 阶段二 · 引擎用满 + 质量 + 稳定性 (v2.14 – v2.19)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v2.14 P0** | 2026-05-04 | `580e4bf` | "已有引擎用满":S2V 多主体 + 镜头语言 + 首尾帧融合 + 5/6/10/15s 时长路由 |
| v2.14 P1 | 2026-05-04 | `537c489` | 创建页镜头默认 + BGM 时长同步 + FLF 集成测试 |
| **v2.15 P0** | 2026-05-09 | `0997755` | G9 剧本草稿对比 + G8 风格 LoRA 库 |
| **v2.16 P0** | 2026-05-09 | `25f7486` | 10s/15s 视频计费 gate + 4K mp4 导出 (ffmpeg scale) |
| v2.16 P1 | 2026-05-09 | `2fd4c49` | 按幕 BGM + 4K Kling Master 重生 + 镜头工坊 tab |
| **v2.17 P0** | 2026-05-10 | `00f6360` | API 用量追踪 + 按 provider 配额耗尽告警 |
| **v2.18 P0** | 2026-05-10 | `6bde0f4` | 6 新模板 + 角色/场景并行 + LLM idea normalizer |
| v2.18 P1 | 2026-05-10 | `7296b99` | 模板库(搜索/筛选/克隆/个人)+ 试拍 1 镜预览 |
| v2.18 P2 | 2026-05-10 | `da5baa9` | 预览限流 + 历史 + 模板分享链接(创作者经济雏形) |
| v2.18.1–.6 | 2026-05-10~16 | `32179d3`…`b9d34ba` | 一连串稳定性修复:JSON 解析、maxTokens 调优、reasoning 模型支持、prompt 瘦身 |
| **v2.19** | 2026-05-16 | `b8ff4e1` | 收尾:prompt slim + 试拍→第1镜复用 + 分享 OG/过期 + 模板 JSON 导入导出 + 图片兜底 |

---

## 阶段三 · 漫剧核心 + 实时协作 + Cinema 时间线 (v2.20 – v3.1.3)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v3.0 P0.1** | 2026-05-17 | `fde1708` | 协作地基:评论 + @提及 + 通知 |
| **v3.0 P0.2** | 2026-05-17 | `95bf241` | Yjs 实时层:WS server + 持久化 + presence |
| **v2.20** | 2026-05-17 | `06be8ce` | 漫剧核心质量:全局风格圣经帧 + 短剧 tropes + 多图参考路由 |
| **v2.21** | 2026-05-17 | `83db38d` | 节奏/反转密度 audit + Character DNA 数字签名 + Lipsync scaffold + 节奏图 |
| v2.22 | 2026-05-17 | `1a91491` | 成片 mp4 404 + Minimax I2V-01 EOL + 图中中文修复 |
| **v2.23** | 2026-05-17 | `dc4c77d` | 风格圣经 Vision 审计 + 单镜重生 + DNA 命中率监控 + 对话正反打 |
| **v2.24 + v3.x + v3.1** | 2026-05-18 | `09d61b5` | 大批量:图表趋势 + 重生支持上传 + 协作 P0.3 + Cinema Timeline MVP + Lipsync providers |
| **v3.1.1** | 2026-05-18 | `3a2aa26` | 多轨道 Cinema 时间线 + 虚拟滚动 + 项目协作邀请 |
| v3.1.2 | 2026-05-18 | `871ef62` | 时间线打磨:拖动语义 + resize 手柄 + 波形 + Yjs 光标 |
| **v3.1.3** | 2026-05-18~19 | `0d4ea69` `3bc0df5` `da51f87` | 真 BGM 波形 + 段碰撞 snap + 跨 tab 光标 + Y.Map 锁 + LLM provider 文档 + README 大改 + 真实截图 |

---

## 阶段四 · 引擎插件化 (v3.2 P1 – P4)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v3.2 P1** | 2026-05-19 | `bcc3b37` | ImageProvider 接口 + 注册表(优先级链 + fallback)+ 营销截图/GIF/ModelScope 工具链 |
| **v3.2 P2** | 2026-05-19 | `b115465` | VideoProvider + TTSProvider 注册表(三套 plugin 模板一致) |
| **v3.2 P3** | 2026-05-19 | `7addd97` | Plugin 灰度开关 (off/shadow/primary) + 跨幕 snap + 多 mp3 波形 + GIF fuzz |
| **v3.2 P4** | 2026-05-20 | `99d1adb` | video/tts 主路径接 plugin chain + SQLite 遥测 + admin 面板 + 切换 runbook |

> 设计核心:`PLUGIN_CHAIN_MODE` env 一键灰度,默认 `off` 行为与老版完全一致,出问题改一个变量即回滚。

---

## 阶段五 · 创作纵深 (v3.3 – v3.5,含 .1 UI 接线)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v3.3** | 2026-05-20 | `24ff3fb` | Cinema 时间线终局 lib:ripple 后段连动 + 左/右/中对齐 hint + undo/redo 栈 |
| **v3.4** | 2026-05-20 | `d8e2099` | 端到端 LLM Vision Audit:每镜成片关键帧对剧本打 0–100 分 |
| **v3.5** | 2026-05-20 | `41f0eee` | 导出/分发:横竖屏转换 + 5 平台字幕预设 + webp/avif 动图 |
| **v3.3.1** | 2026-05-20 | `d6dddee` | 时间线 lib 接进 UI:Ctrl+Z/Ctrl+Shift+Z + 联动开关 + 拖动对齐参考线 |
| **v3.4.1** | 2026-05-20 | `6ba452d` | Vision audit 接项目页:运行质检 endpoint + "成片质检" tab |
| **v3.5.1** | 2026-05-20 | `36e677c` | 平台导出接 composer + 抖音/快手/小红书/YT/方形 一键导出 UI |

---

## 阶段六 · 平台化 (v4.0 – v4.2,含 .1 深化)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v4.0** | 2026-05-20 | `ad69cd5` | Cameo IP 经济:角色 token 化 + 授权模型(owner/open/granted/pending/denied)+ grant 流程 + 市场页 |
| **v4.1** | 2026-05-20 | `66c629d` | Agent 编排工作流:WorkflowGraph DAG + 校验(环/悬空/重复)+ topoSort 并行分层 + 持久化 |
| **v4.2** | 2026-05-20 | `f532347` | Postgres 迁移路径:SQLite→PG 方言转换(占位符/DDL/upsert)+ schema 导出 + cutover runbook |
| **v4.0.1** | 2026-05-21 | `2b10deb` | Cameo 复用闭环:授权角色一键导入自己角色库(带出处 + 幂等),接进创作流程 |
| 🐞 collab fix | 2026-05-21 | `30b240c` | 修 `useYjs` 每 render 返新对象导致项目页 "Maximum update depth" 死循环 |
| **v4.1.1** | 2026-05-21 | `85c1e80` | 工作流执行引擎:topoSort 分层执行(层间串行/层内并行)+ 可插拔 step runner + 失败 abort/continue + dry-run builtins |
| **v4.2.1** | 2026-05-21 | `77747ad` | PG cutover 第一模块:DbDriver 抽象 + SQLite/PG 双驱动 + async user-repo + login 路由接通(auth 域试水) |
| 📄 version doc | 2026-05-21 | `509d52a` | 完整版本历史 VERSIONS.md |
| **v4.1.2** | 2026-05-21 | `1fd47a8` | Agent 编排可视化编辑器(`/workflow-studio`)+ 真 orchestrator runner 适配器(OrchestratorLike + upstreamByKind)+ 核心拆 client-safe |
| **v4.2.2** | 2026-05-21 | `2db0089` | projects 域异步化:async project-repo(get/list/create/update/delete + owner 校验)+ projects POST 接通双驱动 |
| **v4.1.3** | 2026-05-21 | `e857495` | 工作流接真 orchestrator:execute `mode:'real'` + runWorkflowReal(能力门 + per-call runner 并发安全)+ studio 真实运行按钮 |
| **v4.2.3** | 2026-05-21 | `48f6d23` | assets 域异步化:async asset-repo + 项目详情 GET 接通;`npm run pg:smoke` 真连 PG 灰度试跑脚本 |

| **v4.1.4** | 2026-05-21 | `14f1c1a` | SSE 真实进度流:`lib/sse` + `/api/u2v/stream` 实时推 submit→rendering→done/error;U2V 进度环从估算→真实;真实运行落盘 project 资产 |
| **v4.1.5** | 2026-05-21 | `b978f4c` | 工作流执行 SSE 进度流:`/execute/stream` 推 step-start/done/error;workflow-studio 边跑边亮每个节点状态(pending→running→done/failed) |
| **v4.2.4** | 2026-05-21 | `2b20b5c` | 协作域异步化:comment-repo + notification-repo(DbDriver 双驱动);notifications GET 接通。PG 迁移已覆盖 auth/projects/assets/collab 四域 |
| **v4.2.5** | 2026-05-21 | `c1649a5` | 写路径异步化 + 事务原语:`DbDriver.transaction`(SQLite/PG 双实现,抛错回滚);notifications POST 接 async repo。解锁 register/comments 事务迁移(v4.2.6) |
| **v4.2.6** | 2026-05-23 | `c6bc422` | register(插 user + 消费邀请码原子事务,`consumeInviteCodeTx`)+ comments(create/list/delete async,mention/reply 通知扇出)全迁 DbDriver。**写路径全清**,PG 全量切就绪,仅待 PG 实例 |
| 🔧 fix | 2026-05-21 | `eae56af` | 历史项目全空修复(兜底用户解析非确定性 + 列表页未带 auth) |
| 🔧 fix | 2026-05-21 | `b58d268` | 测试 DB 隔离(`qfmj.test.db`,根治测试污染生产库) |

## 阶段七 · 国际化 (v5.x)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v5.0** | 2026-05-21 | `567e68b` | i18n:真繁体中文 + 日本語全量翻译 + deep-merge 回退 + normalizeLocale/Accept-Language 解析 + useLocale hook + LocaleSwitcher(挂 dashboard) |
| **v5.0.1** | 2026-05-23 | `e2c83c1` | 全站页面接 i18n:字典四语扩展(brand/nav 扩/dashboard 段/create.badge/projects 扩/common 扩)+ dashboard/projects/create/nav(site-header)全走 useLocale;死的 LanguageToggle → 真 LocaleSwitcher;projects/create 顶栏挂语言切换 |
| **v5.0.2** | 2026-05-21 | `04b8529` | U2V 环形进度条 + 失败/超时面板内可见 + 重试(修"单图生视频失败无响应"体感) |
| **v5.0.3** | 2026-05-23 | `29eff9f` | 剩余页面接 i18n:字典新增 settings/profile/billing/cases 四段 + common 扩(四语全量);settings/profile/billing/cases(公开+dashboard)全走 useLocale;**settings 语言下拉真驱动 setLocale** |
| **v5.0.4** | 2026-05-24 | `815bf34` | 收尾页接 i18n:字典新增 home/pricing/help/examples 四段(含 frameSteps/faq/guides 数组,四语全量);首页/定价/帮助/示例全走 useLocale;**i18n 覆盖主站全部公开页** |

## 阶段八 · 对标顶级平台 (v6.x,对标火山剧创 / 万镜一刻)

| 版本 | 日期 | commit | 交付 |
|---|---|---|---|
| **v6.0** | 2026-05-24 | `64cf36d` | 角色资产中心纯逻辑核心 `lib/character-studio`:多视角设定图 prompt 合成(turnaround 正/四分之三/正侧/背,注入 character-dna 身份锁)+ 按 traits 性别/年龄绑定专属音色 + 确定性小传 + `CharacterProfile` 打包。明确不做真人人像库 |
| 🔧 fix | 2026-05-24 | `0ad39ac` | **历史项目图片/视频无法查看根治**:v4.2.3 异步化 asset-repo 时 SELECT 漏选 `persistent_url`,致项目详情回退到已过期外链/`tmp` 路径 → 404。补回该列 + 回归测试(4 例);项目详情 28/38 资产恢复本地持久副本 |
| 🔧 test | 2026-05-24 | `90c3268` | 合入 `fix/test-db-init-race`:测试库改每文件独占随机库 + globalSetup 一次性清理 + ws-server 子进程复用库路径,根治全量跑偶发 disk I/O / database is locked / port wait timeout(连续 4 次全绿) |
| **v6.0.1** | 2026-05-24 | `1eddaf9` | 角色资产中心后端接线:`character_library.profile` 列 + character-studio 接线层(行↔档案 + 序列化)+ `GET/POST /api/characters/[id]/studio`(dry-run 出档案落库 / `generate` 真出图)。UI 收尾留 v6.0.2 |
| **v6.0.2** | 2026-05-24 | `a751555` | 角色资产中心 UI 收尾:角色库详情弹窗加「生成角色档案 / 生成设定图」按钮 + 档案展示面板(小传 + 绑定音色 + 多视角 turnaround 缩略图);打开自动载入已落库档案。**阶段八 v6.0 角色资产中心收官** |
| **v6.1** | 2026-05-24 | `77d0916` | 智能提示词工作台核心 `lib/prompt-ide`(client-safe,16 单测):`@` 引用解析(排 email)+ 光标补全 + 候选排序 + 解析 + 编译展开(@→资产 expansion,未命中降级裸名)+ `GET /api/prompt-ide/assets`(角色库身份块 + global_assets 视觉锚)。编辑器 UI / 多模态参考 / 实时预览留 v6.1.x |
| **v6.1.1** | 2026-05-24 | `082de1e` | 智能提示词编辑器 UI `components/prompt-editor`:textarea + `@` 下拉补全(↑↓/Enter/Esc 键盘导航)+ 编译预览(展开 prompt + 引用 chip + 未匹配告警),接进 create 创意输入;`insertMention` 纯 helper +2 单测 |
| **v6.1.2** | 2026-05-24 | `aa77e0b` | 多模态参考:`lib/multimodal-ref`(类型判定/校验/上限,9 单测)+ `multimodal-ref-shelf`(文件/URL 加 图音视频,chip 预览),接进 create;创作载荷新增 `references`(图可被 cref 消费,音/视频前向兼容) |
| **v6.1.3** | 2026-05-24 | `54162f3` | 生成前就绪度预览:`lib/prompt-readiness`(确定性加权评分 + 检查清单,6 单测)+ `prompt-readiness` 组件(实时算就绪度,接 create 提交按钮上方);复用 cameo-vision 试穿评分 + style 引用。**v6.1 智能提示词工作台收官** |
| **v6.2** | 2026-05-24 | `576ac0a` | 长篇智能拆解 + 叙事模式核心 `lib/story-intake`(client-safe,13 单测):`splitIntoEpisodes`(章节标记优先,否则按字数贪心打包 + 句子降级 + maxEpisodes)+ `NARRATION_MODES`(对白/第一人称/旁白:directive + ttsRole + 解说音轨)+ `POST /api/story-intake/split`。UI + 编排接线留 v6.2.1 |
| **v6.2.1** | 2026-05-24 | `a8a000f` | 长篇拆解 UI + 编排接线:`/dashboard/story-intake`(粘贴长文 → 分集预览 + 叙事模式选择 + 目标字数)+ 侧栏入口;「用此集创作」经 sessionStorage 把 该集 + 叙事 directive 交给创作工坊。**v6.2 收官** |
| **v6.2.2** | 2026-05-24 | `86ebc49` | 解说音轨 + 整季批量:`lib/narration-track`(正文抽旁白句 → 估时长 → 绑音色 + 字幕,对白模式不出轨)+ `lib/season-batch`(整季 job 计划 + 进度,10 单测);story-intake 每集旁白估算 +「整季批量」localStorage 续跑队列(逐集送入 + 进度条) |
| **v6.3** | 2026-05-24 | `66d949c` | 风格模板画廊(对标万镜风格):`style-presets` 扩 `STYLE_CATEGORIES`/`categoryLabel`/`searchStyles`(10 单测)+ `/dashboard/styles` 画廊(60 预设 grid + 搜索 + 分类 tab + 侧栏入口);「套用此风格」经 sessionStorage 传风格名给创作工坊。**阶段八 v6.3 收官** |
| **v6.4** | 2026-05-24 | `386f22a` | 导演级全链路编辑(对标火山控片):`lib/pipeline-stages`(4 环节模型 + 按 updatedAt 推 空/就绪/待更新 stale + 下游失效分析,8 单测)+ 项目页「导演台」tab(`director-console`:流水线可视化 + 进度 + 跳节点编辑 + 重跑下游影响);项目 API 补 updatedAt |
| **v6.5** | 2026-05-24 | `ea346b7` | 团队工作区 + 积分额度分配(对标火山团队协作):`lib/team-credits`(额度数学 + 分配校验 + RBAC,12 单测)+ `team_allocations` 表 + `GET/PUT /api/team/allocations`(超额拒绝)+ `/dashboard/team`(池总览 + 成员额度编辑 + 添加/移除)+ 侧栏入口。**阶段八对标六版全交付** |
| **v6.2.3** | 2026-05-24 | `1bd634e` | 解说音轨接真 TTS + N 集并行编排:`lib/season-orchestrator`(`runPool` 有界并发池 + `orchestrateSeason`)+ `lib/narration-synth`(解说计划真出音频 → 按真实时长重排时轴 + 字幕,单段失败降级,synth 注入可单测,13 单测)+ `POST /api/narration/synthesize` + `POST /api/season/narrate`(整季有界并发)+ story-intake「整季并行解说音轨」按钮 + 逐集结果面板 |
| **v9.3.2** | 2026-06-02 | `bd4f72b` | 阶段十四·**创作者用量面板 `/dashboard/usage`**:新页 `app/dashboard/usage/page.tsx`(client)消费 `GET /api/usage/summary` → **预算环**(当月已用/上限/百分比 SVG 环 + 预计月末 + `none`/`ok`/`warn`/`over` 配色)+ **引擎花费条**(byEngine 水平条,宽度 ∝ 成本,带次数)+ **每日成本趋势**(byDay 柱状)+ **活跃配额告警 banner**(provider/类型/出现次数,近 1h)+ 近 7/30/90 天窗口切换 + 总览(窗口花费/生成次数/引擎数)。侧栏 `components/sidebar.tsx` 加「用量成本」入口(`ChartLineUp`,插「API 健康」与「订阅/计费」间)。复用 API 健康看板设计语言;**创作者可见(非仅 admin)**。验证:6 图标全确认包内导出(grep `@phosphor-icons/react` dist)+ `cost-rollup` 类型(`CostSummary`/`BudgetStatus`)导出齐全 + 手工 type-review 修掉 `React.ReactNode`→import `ReactNode`(本仓库约定);**纯增量**(新页 + 侧栏 1 项 + 1 图标 import,不动既有)。**tsc 0 已补验**(停掉 windcomic-pg 卸载内存后,单进程 tsc 在 load 171 下跑通——之前是内存紧被 OOM)。**全量 vitest / dev 页面编译仍待机器空闲**(需 worker 池,本机被用户另一套 colima 栈 + macOS 存储扫描压在 load 150+)。创作者侧成本可见落地;预算护栏 → v9.3.3 |
| **v9.3.1** | 2026-06-02 | `0a5ab92` | 阶段十四·**用量看板端点 `GET /api/usage/summary`**:从 `cost_log`(双驱动)取生成成本 → `lib/cost-rollup` 归集 → 返回 `{ cost: {totals, byEngine/Day/Project}, budget(当前自然月), activeAlerts, failuresByProvider }`。scope:admin 全量(或 `?userId=`)/ 创作者限本人(demo 无登录回退首用户,与 `/api/usage` 一致);过滤 `?days=`(默认 30,1..365)/ `?projectId=` / `?capCny=`(预算上限);**预算单独按当前自然月算**(线性预测月末才有意义,与展示窗口分离)。运维侧附 `listActiveQuotaAlerts`(1h)+ `api_usage_events` 按 provider 失败计数。与既有 `/api/usage`(套餐配额计数)**互补不重叠**。验证:tsc 0;**数据路径冒烟 7/7**(经 tsx:种 3 行 cost_log → 读回 → totals 4.8/count 3 · byEngine kling3=4 · byProject 4.8 · 当月预算 spent4.8/cap10/ok · failures 查询 OK · 空路径合法)—— vitest 全量仍待机器空闲补跑。端点就绪;创作者用量面板 → v9.3.2 |
| **v9.3.0** | 2026-06-02 | `ef0bb53` | 阶段十四(用量与成本可观测)首发·**成本归集 lib `lib/cost-rollup`(纯逻辑+单测)**:把 `cost_log` 行(引擎/分辨率/时长/成本)归集 —— `rollupByEngine`(分组+计数+成本/时长求和,成本降序)/ `rollupByDay`(`createdAt` 前 10 位 YYYY-MM-DD 桶,日期升序)/ `rollupByProject`(跳过无 projectId,成本降序)/ `totalCostCny`(2 位舍入)+ **预算数学 `computeBudget`**(已用 vs 上限 + **线性周期末预测** `projected = spent / min(1, elapsed/period)`;status `none`/`ok`/`warn`(默认阈 0.8)/`over`;remaining/pctUsed)+ `buildCostSummary`(一次出 totals + byEngine/Day/Project + 可选 budget,`spentCny` 自动取总成本)。纯函数不碰 DB、client 可直引;主成本源 `cost_log`(`api_usage_events` 是失败日志,v9.0.4d 已处理)。验证:tsc 0;**11 项逻辑断言全绿**(经 tsx 直跑纯函数:total/舍入/三视图/预算各态/projection 半周期→2×·满→1×/summary 自动 spent)—— 对应 8 例 vitest `tests/v9-3-0-cost-rollup.test.ts`(本机持续高负载 vitest worker 起不来,改用等价 tsx 验证纯逻辑,待机器空闲补跑全量)。**v9.3 提案落地第一刀**;端点 `GET /api/usage/summary` → v9.3.1 |
| **v9.2.3** | 2026-06-01 | `43f5af2` | 阶段十三·**设计 P4.1(收官阶段十三)**:① **项目页头部 editorial split 排版** —— `app/projects/[id]/page.tsx` 头部从"平铺梗概卡"改为杂志感**非对称双栏**(`lg:grid-cols-[minmax(0,1fr)_auto]`):左栏大号 display 标题(text-3xl/4xl)+ PROJECT eyebrow + 梗概 + 主题;右栏**竖线分隔的 meta deck**(镜头 / 角色 / 评分 / 状态,小标签 + tabular-nums 数值);nav 内标题降级 h1→div(消除双 h1,editorial header 成页面唯一 h1)。② **「监视器蓝 / 示波绿」功能色 token** —— `globals.css` 新增 `--monitor-blue #4DA3E0` / `--scope-green #2BE6B0`(+ muted 变体),**仅技术监看区**落地:渲染循环面板(FilmStrip / LIVE / 进度条 / active 图标)→ 监视器蓝、done → 示波绿;示波器(eyebrow / 选帧高亮)→ 示波绿;出片对接 → 监视器蓝。**不动创作区品牌金 `--primary`**。tsc 0 / 159 文件 **1910 测试**(设计改动无新单测,既有全绿);dev 项目页编译 **200**(头部 + 新 CSS token 渲染无错)。**至此阶段十三(v9.2.x 出片增强 + 体验提速)收官** |
| **v9.2.2** | 2026-06-01 | `edd3721` | 阶段十三·**草稿专用轻提示提速**:新增 `lib/slim-prompts.ts`(纯逻辑+单测)—— `getSlimWriterPrompt(style,{minShots,maxShots,note})` 给一份 **~0.5KB 精简编剧提示**(三幕骨架:钩子前 3 秒 / 中段反转 / 结尾悬念 + 每镜动作情绪 + 短促潜台词 + 严格 JSON 契约 `DRAFT_JSON_CONTRACT`),替代草稿对比此前直挂的**完整 McKee(实测 9153 字 / 8.9KB)**。`lib/script-drafts.ts` 的 `generateOneDraft` 改用精简提示(import mckee-skill→slim-prompts;配套 maxTokens 8000→6000、单尝试 timeout 100s→45s)。**flash 推理负担骤降 → 单稿目标 <20s**(此前 McKee 重提示 ~50-70s)。极速分镜(`buildShortVideoMessages`)经核查本就是 ~0.6KB 精简提示(v7.6 结构码控),无需改。**6 单测全绿**(骨架要素 / JSON 契约字段 / 体积 <McKee 15% 且 <1000 字 / 画风注入+默认 cinematic / 镜头范围 clamp / note 附加);既有草稿 22 测试不破(断言锁温度/计数/解析,不锁提示内容)。tsc 0 / 159 文件 **1910 测试(+6)**。**诚实边界**:体积削减 ~94% 可验证(即此前延迟主因),<20s 为设计目标——本环境未打真 LLM 实测(省额度 + 非确定) |
| **v9.2.1** | 2026-06-01 | `43df07f` | 阶段十三·**渲染循环实时反馈面板**:新增 `lib/render-loop.ts`(纯逻辑+单测)—— 把"剧本镜头 + 已落库分镜/视频资产"投影成每镜渲染状态(`deriveShotRenderStates`:有视频媒体=done / 有分镜媒体无视频=video active / 有分镜行无图=storyboard active / 无=pending;`data.error`=failed;attempts 取资产 version;耗时取 updated−created)+ 整体进度/ETA 聚合(`summarizeRenderLoop`:done/total percent + 平均镜头耗时 × 剩余=ETA,无样本→null、全完→0)+ `isRenderLoopSettled` + `formatEta`(client 可直引)。新端点 **`GET /api/projects/[id]/render-loop`**:`?snapshot=1` 单次 JSON(初绘/测试,确定性)/ 默认 **SSE 流**(复用 `lib/sse` `createSSEResponse`,每 tick 推快照、收敛或达 maxTicks 推 `done` 关流,`request.signal.aborted` 断开即停轮询,与生成请求解耦)。技术监看 tab 加 **「渲染循环」面板**(`components/project/monitor-tab.tsx`):初拉 snapshot → 开 EventSource 实时回填(`done` 即 close 防重连风暴)+ 总进度条 + done/total/percent/ETA/均耗时 + 逐镜行(状态图标/阶段/重试数/耗时)。**顺带补 v9.2.0 UI 缺口**:出片对接区加「导出 AAF (Avid)」按钮(export-aaf 此前无前端入口)。**10 单测全绿**(每镜归约各态 / 进度聚合 / ETA=均×剩余 / 无样本→null / 全完→0 / settled / formatEta);tsc 0 / 158 文件 **1904 测试(+10)**;真实项目数据路径冒烟(4 镜→active/video、空项目→settled etaMs 0)。**注**:进度为持久化资产的"最佳努力"投影(轮询 DB),非生成管线内嵌事件流 |
| **v9.2.0** | 2026-06-01 | `4000c25` | 阶段十二·**真 AAF 二进制导出(对接 Avid Media Composer)**:新增 `lib/aaf-export.ts`(纯逻辑+单测)—— AAF 组合模型 `buildAafComposition`(镜头按 fps 累积排布成 clips:`startFrame`/`lengthFrame` 帧算,时长/名称兜底)+ `buildAafXml`(AAF-XML 序列化:`<MobName>` + 每镜 `<SourceClip>` + `<EditRate>fps/1</EditRate>` + 源链)+ **真 MS-CFB 二进制容器写入器** `writeCfb`(512B 扇区:header + FAT 扇区 + Directory 扇区 + stream 扇区;签名 `D0CF11E0A1B11AE1` / `FATSECT`·`ENDOFCHAIN`·`FREESECT` 链 / 目录项 128B / mini-stream cutoff 4096;`size` 记真实长度、扇区尾零补)+ `buildAAF`(XML 补齐 ≥4096 避开 mini-stream → 包进 CFB 流 `WindComicAAF`)+ `isCfb`。新端点 **`GET /api/projects/[id]/export-aaf`**:读剧本镜头(同 export-edl:`script.shots` + video/storyboard 持久链 + 项目级 fps)→ `buildAAF` → `application/octet-stream` attachment `.aaf` 下载;无剧本 → 404。与 EDL/FCPXML 并列(**AAF 给 Avid**,EDL/FCPXML 给 DaVinci/Premiere)。**7 单测全绿**(模型帧算 / XML SourceClip / CFB 签名+512 对齐+header 字段:major v3·扇区位移 9·mini 4096·首目录扇区 1 / 内嵌流 round-trip 抽回 AAF-XML 与原文一致 / 短流补齐 / 空分镜仍合法 CFB);tsc 0 / 157 文件 **1894 测试(+7)**。真实项目数据路径冒烟:4 镜 → **6656B 合法 CFB**(magic 对、%512=0、内嵌 4×SourceClip+MobName+EditRate、流名 `WindComicAAF`)、无剧本 404。**诚实边界**:产出为真二进制 CFB 容器(可被通用 CFB 解析器识别)+ 内嵌 AAF-XML round-trip 一致;Avid 实机回导未在本环境验证(无 Avid),EDL/FCPXML 仍为经测主交付路径 |
| **v9.1.3** | 2026-06-01 | `5ef8c0a` | 阶段十二·**AI 竖屏封面候选(补做、收尾阶段十二)**:新增 `lib/cover-candidates.ts`(纯逻辑+单测)—— `buildCoverPrompts({title,protagonist,style,count})` 按 片名+主角+画风 产 **3 种构图变体**(主角特写 / 冲突场面 / 意象象征)的 9:16 图像提示词(**负向"不画字"**:标题不烧进图,沿用主管线剥字思路)+ `pickProtagonist(shots)`(分镜里出现最多的角色=主角,并列取首现)+ `getTitleSafeArea()`(标题安全区几何:中上 12%/高 20% 安全带、左右各 8% 安全边)。新端点 **`POST /api/projects/[id]/covers`**:读剧本(片名/主角)+ 项目画风 → buildCoverPrompts → **MiniMax image-01(T2I, 9:16=768×1344)** 并行出 3 张(`Promise.allSettled` 单张失败不拖累)→ 覆盖落 `project_assets type='cover-candidates'` → 返回 `{candidates, safeArea, degraded}`;GET 回填;无片名 400 / 项目不存在 404 / MiniMax 未配 422 / 全挂 502。新面板 `components/project/cover-candidates-panel.tsx`(client):一键生成 → 3 张 9:16 卡片 + **标题安全区虚线叠层 + 标题文字预览**(可显隐)+ 逐张下载;挂在「分发」tab 内(发布前置:文案 + 封面)。**8 单测全绿**(3 构图变体 / count clamp / 主角+画风注入 / 片名进 mood + 9:16 + 不画字 + 留安全区 / 主角推断各态 / 安全区几何);tsc 0 / 160 文件 **1918 测试(+8)**;结构冒烟(GET 200 `{candidates:[],safeArea}` / POST 不存在项目 404,均不触发出图)。**诚实边界**:出图走真 MiniMax image-01(费额度 / 非确定),本环境只冒烟结构路径、未真出图。**至此阶段十二闭环 → v9.x 计划全部交付** |
| **v9.1.2** | 2026-06-01 | `773500d` | 阶段十二·**项目页「分发」tab**:新增 `components/project/distribution-panel.tsx`(client)—— 6 平台多选 chips → 一键生成/重新生成 → 每平台卡片(标题首选+备选/标签带#/钩子/简介/建议,**逐行复制** + 复制态反馈)+ **导出 .txt**(`distributionPackToText`)+ degraded 提示;挂载即 GET 回填已落库分发包。项目页 11→12 tab(`Megaphone` 图标,插「评论协作」与「完整播放」间)。`lib/distribution` 为纯逻辑可被 client 直引(`PLATFORM_SPECS`/`distributionPackToText`)。tsc 0;项目页 HMR 编译 200。AI 竖屏封面候选 v9.1.3 暂缓(优先 v9.2.0) |
| **v9.1.1** | 2026-06-01 | `e8744a9` | 阶段十二·**分发包生成端点 `POST /api/projects/[id]/distribution`**:读项目剧本资产(synopsis/题材/钩子,缺则退 project meta)→ `buildDistributionPrompt` → `callLLMWithFallback`(fast,严格 JSON system)→ `parseDistributionPack` → **覆盖式落 `project_assets type='distribution'`**(走 asset-repo,双驱动)→ 返回 pack + 纯文本 + degraded。GET 读已落库分发包(无 → null)。无剧本/梗概 → 400 引导先出剧本;项目不存在 → 404;LLM 失败 → 502。tsc 0;HTTP 冒烟(GET 200 `{pack:null}` / POST 不存在项目 404)。分发 tab → v9.1.2 |
| **v9.1** | 2026-06-01 | `cdec4c9` | 阶段十二·**变现/分发闭环地基 `lib/distribution`(纯逻辑+单测)**:6 平台规格 `PLATFORM_SPECS`(抖音/快手/视频号/小红书/YouTube Shorts/B站,各自标题字数/标签数/简介上限/画幅/话术风格)+ `buildDistributionPrompt`(成片 synopsis+题材+钩子+情绪峰值 → 各平台分发包提示词,强制 JSON 输出)+ `parseDistributionPack`(JSON 优先 → 文中提取 `{...}` → 降级兜底;按平台规格 clamp 标题字数、标签去#去重限量、`title`/`titles` 兼容、扁平/`platforms` 包裹两种结构)+ `distributionPackToText`(按平台分段可复制)。9 单测全绿(规格/提示词/解析各态/导出);tsc 0。API + 分发 tab → v9.1.1/v9.1.2 |
| **v9.0.5** | 2026-06-01 | `8edbd5a` | 阶段十一·**PG 生产就绪声明(阶段十一收官)**:核心读写路径 **17 张表/簇**(project_assets · projects · users · notifications · comments · invite_codes · global_assets · character_library · character_ip_tokens/grants · team_allocations · team_invites · generations · waitlist · project_share_tokens · project_collaborators · template_share_tokens · project_track_edits)全走 DbDriver(SQLite/PG 双驱动),**逐 repo PG 往返累计 ~90 项断言全绿**(v9.0.1b→4c)+ **真实 app 跑 PG**(v9.0)。→ **生产建议 `DB_DRIVER=pg` + `DATABASE_URL`**;dev/test 默认 SQLite。`docs/postgres-cutover-v9.md` 补「为什么 vitest 仍默认 SQLite」(测试隔离靠每文件独占库,共享 PG 无此模型,全量 PG-native 需重构隔离=独立工程,后置)+ 生产切换指引。剩 `api_quota_alerts` + 低频内部表(yjs_docs 等)留 v9.0.4d 机会主义——默认无 split-brain。**多实例并发写锁:根治。** tsc 0 / 1878 测试全绿 |
| **v9.0.4d** | 2026-06-02 | `1cccf0d` | 阶段十一·**遥测/用量簇收尾上 DbDriver(机会主义 PG 收口)**:`lib/api-usage-tracker.ts`(`api_usage_events` + `api_quota_alerts`)就地异步化(`db.prepare`→`getDbDriver()` 双驱动)—— `recordApiCall` / `upsertQuotaAlert`(1h 窗口同 provider+type 聚合 `occurrence_count`)/ `listActiveQuotaAlerts` / `acknowledgeQuotaAlert` / `getRecentFailureRate` 全 async;`withApiTracking` catch 内 `await recordApiCall`(失败遥测落库后再重抛)。调用方全 await:`hybrid-orchestrator`(2 处 LLM 遥测)+ `api-status` route + `admin/api-usage` route(后者 2 处 `api_usage_events` **读**也迁 DbDriver,确保 PG 下看板读得到)。验证:**PG 往返 7/7**(失败→event+alert / 3 次聚合 occ=3 / 成功不写 / 跨 provider 分开 / failure-rate / ack 移出活跃);tsc 0;两遥测测试文件改 async **31/31 绿**(`v2-17-api-usage-tracker` + `v2-17-api-status-route`,后者补 6 处 await——本会话初遗漏、已修)。**环境注**:本机持续高负载(并发应用 + macOS 存储扫描,load 30-60),全量 160 文件套件本次未能干净跑完(`pipeline.test.ts` setup hook 10s 超时 = 环境性,非本改动:改动模块未现于任何栈、历次健康全量皆绿);改动隔离遥测簇,前次部分全量已把这两个(现已修)遥测测试文件单列为唯一真失败。**至此遥测簇双驱动**;剩 `yjs_docs`(ws-server 运行时另议)/`agent_workflows`/`preview_history`/`shot_vision_audits`/`plugin_chain_events` 等更低频内部表留后续机会主义——默认 SQLite 无 split-brain,不阻塞 |
| **v9.0.4c** | 2026-06-01 | `d64ced7` | 阶段十一·**timeline-tracks(project_track_edits)写路径异步化**:`lib/timeline-tracks.ts` 全量异步化(走 DbDriver 双驱动)—— `computeTracks`(及内部 `readEdits`/`findProjectMusicUrl`/`loadNarration` 读链)+ `applyTrackEdits`(批量 UPSERT 改 `getDbDriver().transaction` 跨编辑原子)+ `resetTrackEdit`/`clearAllTrackEdits`。timeline 路由 4 处调用补 await(原 tsc 漏报:`NextResponse.json(Promise)` 不报错,实为运行时 bug——本次根治)。`tests/v3-1-timeline-tracks.test.ts`(16 例)改 async。tsc 0 / 155 文件 1878 测试全绿。剩 `api_quota_alerts`(遥测)+ 若干低频内部表(yjs_docs/agent_workflows/plugin_chain_events 等)留 v9.0.4d 机会主义收尾 —— 默认 SQLite 无 split-brain,不阻塞 PG opt-in |
| **v9.0.4b** | 2026-06-01 | `5046aa2` | 阶段十一·**share / collab 写路径异步化**:`lib/project-share.ts`(分享 token CRUD + accept 邀请 + collaborator 增删改 + 权限 `getUserProjectRole`/`canEdit/Comment/View`)+ `lib/template-share.ts`(token CRUD + `getTemplateAssetForToken` 改走 global-asset-repo)**全量异步化**(走 DbDriver 双驱动)。涉及表 `project_share_tokens`/`project_collaborators`/`template_share_tokens`。7 个调用方(2 项目邀请路由 + 5 模板分享路由/页/og-image)全 await,2 个测试(v3-x-project-share / v2-18-p2-template-share,~50 例)改 async。tsc 0 / 155 文件 1878 测试全绿(PG 由 v9.0.5 统一全量验) |
| **v9.0.4** | 2026-06-01 | `dccb947` | 阶段十一·**team / waitlist / generations 写路径异步化**(写路径全清第一簇):**就地异步化**(非新建 repo,这些 lib 模块即单一真源,无重复)—— `lib/waitlist.ts` 全异步(create/find/list/approve/reject,approve 改走 `invite-repo.createInviteCode`,**顺带清 v9.0.3 defer 的 waitlist 发码**);`app/api/team/lib.ts`(ownerId/loadTeam/saveTeam)异步,`team/allocations` 去重改用 team/lib,`team/invite`(team_invites INSERT)、`team/invite/accept`(team_invites UPDATE + saveTeam **跨表原子**改 `getDbDriver().transaction`)、`team/consume` 全 await;`generations` 路由内联 driver。涉及表 `waitlist`/`team_allocations`/`team_invites`/`generations`。`tests/invite-codes.test.ts` 的 waitlist 块改 async。验证:PG 往返 **8/8**(waitlist approve 走 invite-repo + **team ON CONFLICT upsert** + accept 跨表事务);tsc 0 / 155 文件 **1878 测试**(SQLite 不变) |
| **v9.0.3d** | 2026-06-01 | `a02ec40` | 阶段十一·**新建 cameo-ip-repo(character 域 + IP 经济全清)**:新建 `lib/repos/cameo-ip-repo.ts`(async/DbDriver,双驱动)—— token issue(upsert)/revoke/list(market/owner)/get + grant request/decide/get/listPending + checkAccess + recordTokenUse(token+grant 双计数,保留原非事务两写)+ importCameoToLibrary(写 character_library 联名副本 + recordTokenUse)。纯权限逻辑(resolveAccess/accessCanReuse)仍引自 `lib/cameo-ip`(单测核心不重复),旧同步 DB 版留给 tests/v4-0-cameo-ip。cameo-ip **3 路由**(route / [tokenId] / grants)全改走 repo + await。验证:PG 往返 **13/13**(issue upsert / market+owner / 各 access 级别 / grant 全流程 / recordTokenUse 双计数 / import 联名+dedup+revoke 后拒);tsc 0 / 155 文件 **1878 测试(+4)**;HTTP 冒烟(`/api/cameo-ip` market 200 真数据 / 404)。**至此 character 域(library + IP token/grant)全清** —— 完成 v9.0.3 整块(invite/global-asset/character-repo)目标 |
| **v9.0.3c** | 2026-06-01 | `4a9bf59` | 阶段十一·**新建 character-repo(character_library 全清)**:新建 `lib/repos/character-repo.ts`(async/DbDriver,双驱动)—— create/get/listByUser/update(全字段)/updateProfile(profile + 可选 image_urls 合并)/delete;**返回原始行**让 3 个路由保留各自 snake→camel + JSON.parse 映射(迁移改动最小)。**3 路由**(`/api/characters` POST、`[id]` PUT/DELETE、`[id]/studio` POST 的 2 个 UPDATE 变体)全改走 repo + await;POST 改用 repo 返回行作 201 响应(DB 真值),顺手去掉散落的 `nanoid`/`now`。`update`/`delete` 保留原 demo 行为(按 id 无 owner 守卫)。验证:PG 往返 **8/8**;tsc 0 / 154 文件 **1874 测试(+5)**;HTTP 冒烟 4/4(list 200 `[]` / POST 400 Missing name / 404×2)。Cameo IP 经济(`character_ip_tokens`/`grants` + `importCameoToLibrary`)留 **v9.0.3d** 收尾 |
| **v9.0.3b** | 2026-06-01 | `8143c5d` | 阶段十一·**新建 global-asset-repo(global_assets 全清)**:新建 `lib/repos/global-asset-repo.ts`(async/DbDriver,双驱动)—— create/get/list(type+q)/update/delete/recordAssetUsage + Character Bible 跨项目持久化(`upsertCharacterBible`/`findCharacterBibleByName`,存为 `type='character'` 的 global_asset.metadata.bible)。**6 个路由(global-assets CRUD/use、templates share/clone、characters/bible)+ create-stream(角色/场景全局登记 + bible upsert,9 处调用)** 全改走 repo + await;旧 `lib/global-assets.ts` sync 版仅留给其 3 个单测。验证:PG 往返 **12/12**(JSON 字段序列化 / list / owner 守卫 / recordUsage 去重幂等 / bible 合并 sampleFaces+referenced_by / 清理)+ tsc 0 / 153 文件 **1869 测试(+6)**。**忠实迁移**保留一处原行为:首次 upsertCharacterBible 走 createGlobalAsset、referenced_by 留空(创建项目不计入,仅二次起累加),已在测试注释标注留作日后单独修。HTTP 冒烟:`GET /api/global-assets` 200(经 repo 返回真数据)/ `?type=bogus` 400 / `characters/bible` 200 `{found:false}` ✅(其间 dev server 因本会话多次重启 + 删 `.next/dev` 触发冷编译慢,等编译完即通,纯环境插曲) |
| **v9.0.3** | 2026-05-31 | `3d656af` | 阶段十一·**新建 invite-repo(invite_codes 路由写全清)**:PG 迁移进入「新建 repo」批次。新建 `lib/repos/invite-repo.ts`(async/DbDriver,双驱动)—— create/generate/get/list/validate/revoke + `consumeInviteCodeTx`(tx 作用域版,从 `lib/invite-codes` 迁来,是 register「插 user + 消费邀请码」同事务原子的关键)+ `isInviteRequired`;三条路由(admin `/api/invite-codes`、`/validate`、`/auth/register`)全部改走 repo。旧 `lib/invite-codes.ts` sync 版保留(仅其单测 + `lib/waitlist.ts` 审批发码在用,后者随 v9.0.4 waitlist 收口)。验证:PG 往返 **12/12**(含 consumeInviteCodeTx 事务 + FK 真用户 + revoke/validate 各状态 + 清理);tsc 0 / 152 文件 **1863 测试(+6)**;validate HTTP 冒烟(400 NOT_FOUND/INVALID)。注:全量测试期间遇残留 vitest 进程持锁 flake,清进程后复跑全绿(非本改动问题) |
| **v9.0.2b** | 2026-05-31 | `f9ed5d4` | 阶段十一·**share + stripe webhook → repo(projects/users 写路径全清)**:需 schema 补列的两处收尾。**schema**:`share_token`/`share_created_at` 原由 share route `ensureShareSchema()` 运行时 SQLite ALTER 热加(PG 不兼容 PRAGMA)→ 纳入 canonical(`lib/db.ts` 两条 `addColumnIfMissing`),SQLite 新旧库 + PG export 都带;`db/schema.pg.sql` 重新生成;dev PG 用 `ALTER … ADD COLUMN IF NOT EXISTS` 补列(pg:migrate 只建不改,既有库需 ALTER)。**share**:删 `ensureShareSchema`,POST/DELETE 两 UPDATE→`updateProjectById`(白名单 +`share_token`/`share_created_at`)。**stripe webhook**:→`user-repo.updateUserSubscription`,**顺带修历史 bug**——旧 SQL 写 `users.updated_at`,该列 SQLite/PG 都不存在,整条 UPDATE 一直报错(订阅状态从未落库),去掉后才生效。PG 往返 8/8(updateUserSubscription COALESCE 保留 customer + findUserById 无报错 + share 设清)+ tsc 0 / 1857 测试(+3)+ HTTP 冒烟(share DELETE 实跑 SQLite 写无 "no such column")。**至此 projects/users/notifications/comments/project_assets 五表写路径全清** |
| **v9.0.2** | 2026-05-31 | `6cdb33c` | 阶段十一·**projects / users 写路径迁 repo**(notifications/comments 早已在 repo):盘点修正——register 早已走 `getDbDriver().transaction`、comments route 早已用 `createCommentAsync`、notifications route 早已用 `notification-repo`,`lib/{notifications,comments}.ts` 同步版为 legacy,`lib/db.ts` 的 users/projects 写是一次性 demo seed(非运行时)。project-repo 补 2 个可复用方法:`insertProjectFull`(客户端 id + style/cameo/locked 创作列)+ `updateProjectById(id, patch)`(列白名单动态 SET、无 owner 守卫、自动 updated_at、挡 key 注入),+3 单测。**create-stream**(6 projects + 1 users):upsert 存在性读→`getProject`、INSERT→`insertProjectFull`、两条 UPDATE 合一→`updateProjectById`(`style_id` COALESCE 语义用条件展开保留)、5 处后续 UPDATE(director_notes×2/完成)→`updateProjectById`、demo 兜底用户→`createUser`。**cameo**(2 projects):设/清 `primary_character_ref`→`updateProjectById`。PG 往返 10/10(含 COALESCE 语义 + 白名单守卫)+ tsc 0 / 1854 测试(+3)+ HTTP 冒烟(400/404 无写)。**defer v9.0.2b**:share(2,需 PG 加 `share_token`/`share_created_at`)+ stripe webhook(1,需 PG users 加 `updated_at`)|
| **v9.0.1b** | 2026-05-31 | `25b87f2` | 阶段十一·**project_assets 写路径全清**(收尾最大簇):迁完 v9.0.1 defer 的两块——**create-stream**(`saveAsset`/`updateAssetMedia` 同步 helper + DNA `onProgress` UPDATE 共 7 处 raw 写 → `createAsset`/`updateAsset`/`updateAssetBySelector`/`listAssetsByType`,11 处调用点全 `await`、`.forEach`→`for...of`,后台 `persistent_url` 落盘仍 fire-and-forget 不拖 SSE)+ **rerun**(`db.transaction` 的 2× project_assets stale UPDATE + `pipeline_reruns` INSERT → `getDbDriver().transaction(tx⇒…)` 用 `tx.run` 跨两表原子,读也走 driver);至此 **`app/` 内 raw `project_assets` 写 = 0**(grep 实证)。PG 实测 11/11 往返(saveAsset/DNA/updateMedia + 事务 **COMMIT 与 ROLLBACK** + 清理)✅;Next dev SQLite 三路 HTTP 冒烟(create-stream 400 / rerun 400·404,均无写)。tsc 0 / 151 文件 1851 测试全绿(SQLite 行为不变) |
| **v9.0.1** | 2026-05-31 | `dea9200` | 阶段十一·project_assets 写路径迁 asset-repo(部分):asset-repo 扩 8 个可复用方法(`updateAssetBySelector`/`updateAssetDataInProject`/`deleteAssetsByType`/`setAssets(Stale\|Confirmed)ByTypes`/`setAsset(Stale\|Confirmed)`,create/update 加 `id`/`persistentUrl`/`bumpVersion`);**10 个路由文件 / ~14 处 raw project_assets 写改走 repo**(assets-confirm/projects[id]/timeline/assets/extract-dna/regenerate-shot×2/4k/regenerate-storyboard/cameo-retry/narration,narration 去 better-sqlite3 事务→repo);PG 实测 10 个新方法全往返 ✅。defer v9.0.1b:create-stream(后台 promise 持久化 helper)+ rerun(与 pipeline_reruns 同事务)。tsc 0 / 1851 测试全绿(SQLite 不变) |
| **v9.0** | 2026-05-31 | `5fba468` | 阶段十一·PG 切换地基闭环(本地 Docker 自助验证):新增 `docker-compose.pg.yml`(postgres:17-alpine,端口 5434 避开他项目)→ `pg:migrate`(74 DDL / 33 表)+ `pg:smoke`(dual-driver SQL/参数化/upsert/事务)+ `DB_DRIVER=pg pg:verify`(user/project repo + 事务往返)+ **真实 app 跑 PG**(`DB_DRIVER=pg npm run dev` 关键页 200 + 注册走 PG 邀请码校验)全部 ✅;`docs/postgres-cutover-v9.md` runbook + **写路径全盘点**(63 处 raw `db.prepare` / 40 文件,按目标表分 v9.0.1-4 批次:project_assets 26 → asset-repo 最大簇先行)。**关键安全性**:默认 `DB_DRIVER=sqlite` 下 raw db 与 DbDriver 同文件无 split-brain,PG 为 opt-in,写路径分批迁移、默认用户零影响。tsc 0 / 1851 测试全绿(SQLite 默认不变) |
| **v8.3 P6.3** | 2026-05-31 | `cae4022` | 阶段十 P6.3 · mode 卡 + LOOK chips AI 金色图标(emoji 收尾):新脚本 `scripts/gen-mode-look-icons.ts` 经 MiniMax image-01 生成 **13 枚**金色霓虹 emblem(5 mode + 8 LOOK,同 templates 风格,0 失败)→ `public/mode-icons/*.jpg` + `public/look-icons/*.jpg`;ModeCard(5 模式 text-4xl)/ CreationWizard 模式摘要 / 创作工坊 LOOK chips 兜底 全部图标层叠在 emoji 之上, onError 露出 emoji。至此 emoji-即-身份 的展示图标(故事模板 18 + mode 5 + LOOK 8 = 31 枚)全部 AI 金色图标化。tsc 0 / 151 文件 1851 测试全绿 / create 200 + 图标核对 |
| **v8.3 P6.1** | 2026-05-31 | `366df96` | 阶段十 P6.1 · lucide → Phosphor **全量迁移**(彻底落实"不要用默认图标"):**89 个文件** `from 'lucide-react'` → `@phosphor-icons/react`;144 个唯一图标里 64 个同名直用、80 个经 codemod 用 **alias 别名**(`Sparkle as Sparkles` / `Lightning as Zap` / `MagnifyingGlass as Search`…, 80 个目标全部先校验存在于 3045 个 Phosphor 导出再落地 → **零 body 改动, tsc 0 错误**);新增 `components/icon-provider.tsx` 用 Phosphor `IconContext` 全局设 `weight='light'`(89 文件图标统一细线 premium 观感, P1 手设的 duotone/bold 显式 prop 仍覆盖);**散落装饰 emoji 清扫**——创作工坊试拍/开机/创意生成器入口(🎬▶✎✨→FilmSlate/Play/Pencil/Sparkle)· 我的项目新建/开始(▶ 去除)· 创建向导启动(🚀→Rocket)· 风格筛选(🔥 去除)· 落地页播放钮(▶→Play fill)。tsc 0 / 151 文件 1851 测试全绿 / 6 页 200 + 真机截图核对图标渲染正常 |
| **v8.3 P6.2** | 2026-05-31 | `b0cdb3b` | 阶段十 P6.2 · v8 观感截图刷新:新 `scripts/capture-v8.mjs`(puppeteer 登录 demo → 捕获)生成 `assets/v8/dashboard-bento.png`(非对称 bento 总览)/ `style-gallery.png`(60 张 AI 缩略图填满)/ `template-icons.png`(18 枚 AI 金色霓虹题材图标);README.md / README.zh-CN.md 顶部加「🎨 v8.3 精品化设计」展示块(2 图表格 + 全宽模板图标)+ docs/modelscope-profile.md 同步 |
| **v8.3 P6** | 2026-05-30 | `5c2123e` | 阶段十 P6 · 故事模板 AI 图标 + 全量设计 review:**18 枚故事模板 emoji(⚡🌸🔍🐉🤖…)→ AI 金色霓虹 emblem**——新脚本 `scripts/gen-template-icons.ts` 经 MiniMax image-01 生成统一风格母题图标(暖墨黑底 + 金色描边, 与品牌同源, 0 失败)落 `public/template-icons/*.jpg`;模板卡图标层叠在 emoji 之上, 自定义模板无图 `onError` 露出 emoji 兜底;**P6 全量设计 review**——`docs/design-audit-v8.3.md` 用 redesign-skill 清单记录 P1-P6 已修 13 项 + 剩余债务(最大项: **78 文件仍 lucide → P6.1 分批迁 Phosphor** / transition-all 130 / 散落 emoji ~20)。tsc 0 / 1851 测试全绿(pipeline 偶发 DB-lock 隔离复跑 17/17) |
| **v8.3 P5** | 2026-05-30 | `00aa14c` | 阶段十 P5 · 模块整合 + 素材完整显示 + 风格画廊填充 + 全局 focus ring:**模块精简**——创意生成器(鸡肋)+ 角色库(与「素材库-角色」重叠)移出侧栏(路由保留不 404);创意生成器折进创作工坊一个入口链接;**素材库**卡片 `object-cover`(裁切)→ `object-contain`(完整显示, 高度 140→180)+ 名称 truncate → 2 行 + 描述 2→3 行,告别"必须点开才看全";**风格画廊填充**——新脚本 `scripts/gen-style-thumbs.ts` 经 MiniMax image-01(flux 网关 429 饱和,改用兜底)批量生成 **60 张**真实风格缩略图落 `public/styles/*.jpg`(统一主体「天台少女 × 各风格 promptFragment」可对照,0 失败);**P5 a11y**——全局 `:where(...):focus-visible` 金色 focus ring(键盘可达,鼠标不扰)。tsc 0 / 151 文件 1851 测试全绿 / styles+assets+create 200 |
| **v8.3 P4** | 2026-05-30 | `ef50424` | 阶段十 P4 · 创作总览 Asymmetric Bento(Taste Skill: 打破"三等宽卡片"的 AI 标志布局):dashboard 由 thin banner + 三等宽 stat 行 + 5 列内容栅格 → **12 列非对称 bento**:create hero 占 `col-span-7 row-span-2`(主导左上, 暖金径向光晕 + blur 球背景 + 大标题 + nested CTA 岛屿)、主统计 projects `col-span-5`、次级 generations+cases `col-span-5` 2-up、最近创作 `col-span-7` (BezelCard)、状态+活动 `col-span-5` —— CSS Grid 自动排布出 7/5 不等高节奏;容器 `max-w-6xl → 7xl` 给足留白;数字加 `tabular-nums`;标题 `text-balance`;mobile 全部 fallback 单列。tsc 0 / 151 文件 1851 测试全绿 / 首页+dashboard 200 |
| **v8.3 P3** | 2026-05-30 | `9152c80` | 阶段十 P3 · 动效 spring 化 + 交错入场(Taste Skill: "Never mount everything at once"):进场动画 `.animate-fade-up`/`fade-in`/`zoom-in` 缓动 ease → **spring-like** `--ease-spring`(距离略增更有重量);新增 `.stagger` 交错入场容器(直接子元素依次 fadeUp,每个 +55ms,nth-child 自动延迟,免逐个写 inline animationDelay);`html { scroll-behavior: smooth }`;**无障碍** `@media (prefers-reduced-motion: reduce)` 全局关动画/过渡;stat 卡 hover 改 spring lift(-translate-y + scale)。落地:dashboard stat 卡行 + 最近创作列表 + 短视频分镜表 → `.stagger`。cinema-theme 已是 `cubic-bezier(.2,.8,.2,1)` 物理曲线,保持不动。tsc 0 / 151 文件 1851 测试全绿 / 首页+dashboard+短视频 200 |
| **v8.3 P2** | 2026-05-30 | `4a10ba3` | 阶段十 P2 · Double-Bezel 卡片体系 + nested CTA(Taste Skill 机加工质感):**glass-card** 单层 DOM 用分层阴影模拟双层 bezel(顶缘高光 + 内圈发丝纹 + 金色染色落影 `--shadow-card/-hi/-inset`, spring 缓动);新增**真 Double-Bezel** `.bezel-shell` + `.bezel-core`(外壳机加工托盘套内芯玻璃面板, 同心圆角 `calc(2xl - 6px)`, 金色发丝边)+ `<BezelCard>` 组件;**cinema-card** 加机加工面板 inset(保持 pro-tool 锐角 4px);**nested CTA**(button-in-button): `.cta` + `.cta__island`(全圆角胶囊 + 尾随箭头嵌入独立圆形岛屿, hover 右移)+ `<CtaButton>` 组件 + `.cinema-cta-island`(cinema 主题版)。落地:dashboard 主卡 → BezelCard + quick-action 箭头岛屿;短视频「用此方案去创作」+ 创意生成器「用此创作」CTA → cinema 岛屿。tsc 0 / 151 文件 1851 测试全绿 / 4 高曝光页 200 |
| **v8.3 P1** | 2026-05-30 | `2126d0a` | 阶段十 P1 · 设计 token + Phosphor + grain overlay(Taste Skill 精品化第一刀):**字体** Inter → **Plus Jakarta Sans**(via `next/font/google` 自托管, 0 运行时 Google Fonts 请求)+ JetBrains Mono 也接进;**圆角** 单一 10px → `--radius-xs 4 / sm 6 / md 10 / lg 14 / xl 20 / 2xl 28`(concentric calc, 给 v8.3 P2 Double-Bezel 备用);**阴影** 纯黑 → 金色染色 `--shadow-sm/md/card/card-hi/glow/inset`(与 `--primary #E8C547` 同源, 暖墨黑底叠出印刷感);**噪点** 全局 `.film-grain`(fixed, pointer-events none, SVG turbulence, opacity 0.035, mix-blend-mode overlay);**spring 缓动** `--ease-spring: cubic-bezier(.22,1,.36,1)`;**body** `min-height: 100dvh`(修 iOS Safari);**Phosphor** 装 `@phosphor-icons/react@2.1.10`, sidebar 18 个 lucide → Phosphor Light(active 用 duotone 金色), dashboard 创作总览 8 个同步换。tsc 0 / 全 4 个高曝光页(/dashboard, 极速分镜台, 创意生成器, 项目详情)200 / 测试全绿。其余 lucide 调用点留 P1.1+ 渐进换 |
| **v8.2.2** | 2026-05-30 | `5141ba8` | 阶段十规划 · 装入 Taste Skill (28.1k ⭐ Anti-Slop Frontend Framework):`.agents/skills/` 落 4 个 skill —— `design-taste-frontend`(默认精品 frontend)/ `redesign-existing-projects`(审计→修复)/ `high-end-visual-design`(Awwwards-tier 法则)/ `full-output-enforcement`(拒半成品);`.claude/skills/*` 软链入项目, Claude Code 可直接调用。ROADMAP 写入「阶段十 · UI/UX 精品化 (v8.3)」: 真实审计(Inter 在禁用首位 / Lucide=AI 默认 / 统一 10px 圆角 / 纯黑阴影 / 缺 Double-Bezel / 缺 nested CTA / 缺 spring 动效…)+ P1-P6 子版本迭代规划。设计护城河(暖墨黑×金电影感 + Source Han Serif SC + Cameo IP 等)不动, Taste Skill 只换"皮" |
| **v8.2.1** | 2026-05-30 | `f6c785c` | Marketing refresh · 真 UI 截图替换 mockup:新增 `assets/v8/` 五张产品级实景截图——polish-pro-audit (v7.1 Pro 行业级诊断)/ creation-canvas (创作工坊 多 Agent 流图)/ final-film-control (项目 11-tab 控片台 + 90/100 成片)/ script-shotlist (剧本 tab 镜头+节拍)/ character-studio (三视图 + DNA prompt);README.md / README.zh-CN.md 在 v6/v7 亮点区**新增 3 个真截图块**(Polish Studio Pro / Character Studio / Finished film + 11-tab director station)+ 底部 Screenshots 区**替换 2 张 v3.1.3 老 mockup**(creation-canvas / script-shotlist);docs/modelscope-profile.md 卡片网格加 2 张 + 全宽成片 1 张 |
| **v8.2** | 2026-05-25 | `47e37f8` | 阶段九增强 · 参数联动 / JSON↔可视化同步(对标 CineMatrix「Parameter Linkage / JSON to Visual Sync」):新增 `lib/param-linkage`(纯逻辑 + 单测 10)—— `buildParamDoc`(每镜 ShotSpec + 连贯性 + 项目格式 收成一份归一化 JSON 文档)+ `paramDocToJson`/`parseParamDoc`(JSON↔文档, 语法/类型容错)+ `diffParamDoc`(算镜级/格式/连贯性变化面);`POST /api/projects/[id]/param-sync`(把编辑后的文档一次性写回:每镜 spec→storyboard.cameraSpec + upsert continuity/project-format);`components/param-linkage-panel`(联动示意图 时间线↔分镜卡↔参数 + 实时同步状态 + JSON 编辑器实时校验 + 待同步 diff 计数 + Sync Now);项目页新增"参数联动"tab。dev 实测同步 1 镜+连贯性+格式 → DB 持久化全通过;tsc 0 / 全量 1851 测试(+10) |
| **v8.1** | 2026-05-25 | `1fb37b4` | 阶段九增强 · 智能联动规则引擎(对标 CineMatrix「Auto-Update Logic」):新增 `lib/auto-rules`(纯逻辑 + 单测 11)—— 声明式规则(条件 tension/intensity/shotSize/atmosphere × gte/lte/in → 给 ShotSpec 打补丁)+ 5 条预设(高紧张→低调高反差 / 特写→浅景深大光圈 / 强情感→提运动 / 平静→高调低反差 / 霓虹夜→霓虹黑色冷色温)+ `buildRuleContext`(情绪词→tension/intensity, 串 v7.5 emotionScore)+ `evaluateRules`(多规则命中合并)+ `applyRulesToSpec`;摄影台弹窗加「✨ 智能建议机位」一键按情绪/景别套用规则 + 命中清单提示;项目页打开摄影台时透传该镜情绪。tsc 0 / 全量 1841 测试(+11) |
| **v8.0** | 2026-05-25 | `04b518e` | **阶段九收官** · 专业出片对接(对标 CineFlow 底部监视器 + EDL/AAF 导出):新增 `lib/edl-export`(纯逻辑 + 单测)—— `framesToTimecode`/`secondsToTimecode`(CMX 时间码)+ `buildEDL`(CMX3600 EDL,事件/累计 record 时间码/片段名/素材路径)+ `buildFCPXML`(FCP7 xmeml,DaVinci/Premiere 可导入,XML 转义);`lib/scopes`(像素纯计算:`computeHistogram`/`computeColumns`/`scopeStats` 亮度/裁切);`GET /api/projects/[id]/export-edl?format=edl|fcpxml`(读剧本镜头 + 每镜素材 URL + 项目帧率 → attachment 下载);`components/monitor-tab`(视频示波器:直方图/亮度波形/RGB Parade canvas 实采 + EDL/FCPXML 导出按钮);项目页新增"技术监看"tab。dev 实测 EDL/FCPXML 导出 200(11 clipitems)+ 页面 200;tsc 0 / 全量 1830 测试(+10)。**阶段九 v7.2-v8.0 七版全部交付** |
| **v7.7** | 2026-05-25 | `9fd6e3e` | 阶段九 · Master Prompt 生成器 + 风格/LUT/导演运镜预设 + 专业术语表(对标 CineMaster Pro):新增 `lib/master-prompt`(纯逻辑 + 单测 9)—— 影片 look 预设(Blade Runner 2049/Dune/Joker/王家卫/Fincher/Nolan/A24/Wes…)+ 色彩 LUT(柯达印片/Vision3 500T/富士 Eterna/青橙/漂白…)+ 导演运镜(维伦纽瓦慢推/斯皮尔伯格长镜/库布里克对称/芬奇固定…)+ 专业术语表(PPM/VO/Anamorphic Flare/Rack Focus…)+ `compileMasterPrompt`(结构化 Role/Task/Core Concept/Execution Parameters Markdown)+ normalize;`POST /api/master-prompt/refine`(LLM 优化, 快档 flash, 实测 14s);新页 `/dashboard/master-prompt`(role/task/核心概念 + 三类引用预设 chip + 实时编译 prompt + 复制/优化/用此创作 + 术语表);侧栏「创意生成器」入口。tsc 0 / 全量 1820 测试(+9) |
| **v7.5** | 2026-05-25 | `c3077cf` | 阶段九 · 情感曲线 + 多轨节奏热力图 + 构图引导(对标 CineMatrix Emotion Curve / CineFlow 节奏热力图 / Composition Guide):新增 `lib/emotion-curve`(纯逻辑 + 单测)—— 中文情绪词典 → 每镜 4 轨(情感强度/紧张感/节奏/亮度,紧张叠加 pacing 冲突分、亮度由光影+氛围推断、节奏由时长+运动算)+ `curveStats`(高潮镜/峰值/均值);`lib/composition`(构图法预设 + `computeCompositionHints` 由景别/机位推断 主体位置/头部空间/视线空间/平衡 + `cameraPathPoints` 运镜→SVG 路径);`components/emotion-rhythm-chart`(4 轨 SVG 曲线 + 高潮竖线 + 图例可切显隐)接进"节奏分析"tab;`components/composition-guide`(三分法取景叠层 + 构图建议 + 运镜路径 mini-viz)接进摄影台弹窗(随景别/机位/运镜实时更新)。tsc 0 / 全量 1811 测试(+14) |
| **v7.4** | 2026-05-25 | `49cf0ec` | 阶段九 · 结构化光影 + 摄影机/镜头模拟 + 项目级格式预设(对标 CineFlow Director's Suite):扩展 `lib/cinematography` ShotSpec(向后兼容)加 `lighting`(光影 setup 9 种 高调/低调/伦勃朗/轮廓/霓虹/黄金时刻… + 色温 2800-6500K + 反差)与 `camera`(机身 ARRI Alexa 65/Mini LF/RED/Venice/BMPCC + 镜头系列 Panavision变形/Cooke/Zeiss/Master/复古 + T-Stop/ISO/ND/白平衡)→ 编译进 prompt + 摘要;新增 `lib/project-format`(画幅 IMAX 1.43/Scope 2.39/竖屏… + 色彩空间 ACES/LogC4/Rec709/P3 + 帧率 24-120fps升格 + 安全框 → `aspectRatioOf`/`compileFormatPrompt`/`describeFormat`);`GET/POST /api/projects/[id]/format`(upsert project-format 资产);摄影台弹窗加"光影+摄影机模拟·高级"折叠区;项目页"分镜"tab 顶部加项目格式条。dev 实测 format/shot-spec(含光影+摄影机)round-trip + DB 持久化全通过;tsc 0 / 全量 1797 测试(+14) |
| **v7.3** | 2026-05-25 | `be55214` | 阶段九 · 连贯性 + 种子锁控制台(对标 CineFlow Continuity Pro,放大本品 FaceID/Cameo 护城河):新增 `lib/continuity`(纯逻辑 + 单测 19)—— 种子锁(主/辅种子 + 锁定:锁定时全链路复用主种子、未锁按镜号质数步进可复现)+ 链接模式(硬切/匹配切/参考上一帧)+ 连贯性强度(0-1)+ 服装锁/光照锁 + FaceID 强度(off/low/med/high)→ `compileContinuityDirectives`(逐镜生成指令:prompt 片段 + seed + faceWeight + strength,首镜跳过衔接语)+ `computeContinuityTags`(分镜彩色 chips)+ `seedForShot` + `normalizeContinuitySettings`;`GET/POST /api/projects/[id]/continuity`(upsert 到 project_assets type='continuity');`components/project/continuity-console`(视觉基因库:角色/环境/种子锁 + 连贯性控制台:链接模式/强度滑块/服装·光照锁/FaceID 强度 + 分镜连贯性逻辑 chips 预览);项目页新增"连贯性"tab。dev 实测 GET 默认/POST/GET 回读/DB 持久化全通过;tsc 0 / 全量 1783 测试(+19) |
| **v7.2** | 2026-05-25 | `9900b4d` | 阶段九 · 单镜头电影摄影控制台(把"驾驶舱控件"铺到主项目页每个分镜,对标 CineMaster/CineMatrix「单镜头精细化控制」):新增 `lib/cinematography`(纯逻辑 + 单测 14)—— 景别(ELS/WS/LS/MS/CU/ECU)/ 机位(平视/仰/俯/荷兰角/顶)/ 镜头(18-100mm + 变形宽银幕)/ 运镜(9 种)/ 焦点(深/浅/移焦/柔)/ 氛围(雨雾烟夜霓虹…)/ 运动强度 → `compileShotSpecToPrompt`(英文摄影 prompt 片段)+ `describeShotSpec`(中文摘要)+ `normalizeShotSpec`(安全解析)+ `seedSpecFromCameraAngle`(历史中文机位映射);`components/project/shot-cinematography-panel`(受控分段按钮 + 下拉 + 滑块 + chips)+ `shot-cinematography-modal`(实时编译预览 + 复制 + 保存);`POST /api/projects/[id]/shot-spec` 落进 storyboard 资产 `data.cameraSpec`(asset-repo updateAsset,双驱动);项目页"分镜"tab 每张卡加机位摘要 chip + 摄影台入口。dev 实测:保存→DB 持久化✓ / 400·404 边界✓ / 项目页 200✓;tsc 0 / 全量 1764 测试(+14) |
| **v7.6** | 2026-05-25 | `2ee2921` | 阶段九首发 · 15s 短视频极速分镜台(对标 CineSpark,竞品 UI 差距分析后选定切入):新增 `lib/short-video`(纯逻辑 + 单测 15)—— 三幕(HOOK/BODY/CLIMAX)时长布局 + 15s 运镜词库(开场钩子/叙事推进/结尾爆发 各 3)+ 节奏模板(悬疑反转/视觉大片/情绪氛围)+ SSS+ prompt 编译 + LLM 消息构造/解析(结构由系统掌控、LLM 只产画面内容);`POST /api/short-video/plan`(创意闸门 + 快档 deepseek-v4-flash + MiniMax 兜底,实测 7.4s 出 3 镜计划);新页 `/dashboard/short-video` —— 三栏"驾驶舱"(运镜词库 / 三幕色彩时间轴 + 分镜表 / 短视频参数面板:运动强度滑块·相机速度·插帧·放大·分辨率/比例/帧率 + 节奏环 + 一键去创作 + 导出);改运镜/景别前端即时重编译 prompt。tsc 0 / 全量 1750 测试(+15)。**同次写入 ROADMAP「阶段九」竞品差距对照 + v7.2-v8.0 迭代计划 + UI/UX 升级方向** |
| **v7.1** | 2026-05-25 | `a3c6c41` | 稳定性 + 高可用硬化(根因修复「润色不稳定 / 草稿对比报错」):**根因**=`deepseek-v4-pro` 是推理模型,`reasoning_tokens` 与提示复杂度相关(pro 审计提示实测吃 ~2000 token),把旧 `max_tokens` 地板(2000)吃光 → `content` 为空 → 误判失败、每次静默回落慢速 MiniMax(basic 88s / pro 144s 且 degraded);草稿对比则卡在 60s 超时 abort。**修复**:① 统一高可用客户端 `lib/llm-client`(`buildLLMAttempts`/`callLLMWithFallback`/`stripThink`/`isTransientLLMError`),草稿对比 + 润色收口;② 模型分档——草稿对比 + 润色 basic → `deepseek-v4-flash`(秒级、推理少),润色 pro + 主管线 runWriter → `deepseek-v4-pro`(质量优先),均 MiniMax 全局兜底;③ 润色 `max_tokens` 地板抬高(basic 6000 / pro 12000)→ DeepSeek 真出稿不再空回落;④ 瞬时错误(过载/限流/5xx)退避重试同端点 1 次再切兜底 + 草稿解析失败重试 1 次;⑤ `<think>` 剥离串进润色。**实测**:润色 basic=flash 3.7s / pro=pro 94s 带 audit 不 degraded(原 MiniMax 88s/144s degraded);草稿 2/2;健康看板全 ok。tsc 0 / 1735 测试(+7 v7.1 单测) |
| **v7.0.3** | 2026-05-25 | `7d4e88e` | 剧本润色改用 DeepSeek + MiniMax 兜底:修复 `/api/polish-script` 用 creativeModel 却发通用网关的 mismatch(页面 LLM 调用失败 200),改走创意 endpoint(deepseek-v4-pro)+ MiniMax 兜底尝试链;非配额错误归一 502、配额 402。dev 实测 model=deepseek-v4-pro 真出稿;polish-api 19 单测绿 / 全量 1714 |
| **v7.0.2** | 2026-05-25 | `b79f693` | MiniMax 视频标准版额度用尽自动转 Fast 版:标准/Fast 768P 各有独立日额度,`generateVideo` 在配额错误(2056/usage limit/额度)时自动路由 `generateVideoFast`(独立额度),Fast 也满才落下一引擎;`isMinimaxVideoQuotaError` 纯函数 + 2 单测。tsc 0 / 1714 测试 |
| **v7.0.1** | 2026-05-25 | `672416a` | MiniMax 语音兜底打通:核实新 key 支持 TTS 且 `t2a_v2` 无需 GroupId(之前仅模型名错),`MINIMAX_TTS_MODEL=speech-02-hd` + `tts.service` 默认改之 + 健康看板去 GroupId 硬要求 + `classifyMinimax` 加 2056 限流窗口判定(已配置可用);健康看板 minimax-tts → ok、整体 healthy。tsc 0 / 1712 测试 |
| **v7.0** | 2026-05-25 | `6c9ddd6` | DeepSeek 创意主 LLM + MiniMax 全局兜底:编剧/导演创意 LLM → `deepseek-v4-pro`(独立 endpoint),通用仍 `claude-sonnet-4-6`;`callLLM` 重构成尝试链(主→MiniMax `MiniMax-M2.7` 兜底,任何异常/欠费/超时自动路由);config 加 creative/fallback endpoint;MiniMax key 更新(LLM 兜底实测 200);健康看板拆 3 条 LLM 线(通用/创意/兜底)全 ok。tsc 0 / 1711 测试 |
| **v6.9** | 2026-05-25 | `75e3938` | vectorengine 补全 TTS/MJ/Kling + 监控(维持 qingyuntop 主):新 `vectorengine-tts`(gpt-4o-mini-tts,主路径,minimax 兜底)修复配音(实测真出 mp3)+ `mapVoiceToOpenAI`(3 单测);MJ 经 vectorengine 激活(优先级 115,flux 后兜底);Kling 已在位;Suno 端点存在但令牌无渠道(文档标注);健康看板加 vectorengine 用量+余额(占位额度显「已用·充裕」)+ minimax-tts 标兜底。tsc 0 / 1711 测试 |
| **v6.8** | 2026-05-25 | `cda8b21` | 升级最强模型 + 修视频生成 429:根因=vectorengine 网关 429「上游负载饱和」→ 主视频切 qingyuntop(create+query 实测 200);管线主模型升 LLM `claude-sonnet-4-6`/创意 `claude-opus-4-7`、视频 `veo3.1-pro`、图像 `flux-2-pro`(`config.ts` 默认 + `.env.local`);minimax 兜底不变;修 kontext key↔base 配对 + 健康看板模型显示。tsc 0 / 1708 测试 |
| **v6.7** | 2026-05-25 | `81b0239` | 移除 banana 死配置 + API 健康仪表盘:`lib/provider-health`(响应归一成 正常/额度用尽/配置缺失/不可达,19 单测)+ `GET /api/health/providers`(实时探测 MiniMax/qingyuntop/vectorengine,读余额,不回传 key,60s 缓存)+ `/dashboard/health` 仪表盘 + 侧栏入口;删 banana.service + config/midjourney legacy 引用 |
| **v6.2.4** | 2026-05-24 | `3aa780f` | 解说真音频落盘 + 字幕烧录串进时间线:`lib/narration-timeline`(`cuesToSrt` + `narrationToTimelineSegments`,10 单测)+ `timeline-tracks` 加 `'narration'` 轨 + `computeTracks` 并入解说音轨/字幕 + `POST/GET /api/projects/[id]/narration`(TTS → 音频 `persistAsset` 落盘 + SRT 落盘 → 存 narration 资产)+ cinema-timeline「生成解说音轨」按钮 + 只读 narration 轨 |
| **v6.4.1** | 2026-05-24 | `8509b99` | 单环节真重跑端点:`pipeline-stages` 扩 `buildRerunPlan`/`stageOfType` + `derivePipelineStages` honor 显式失效(8 单测)+ `project_assets.stale` 列 + `pipeline_reruns` 审计表 + `POST /api/projects/[id]/rerun`(事务标记下游失效 + 记审计 + 尽力派发活跃 orchestrator 走既有管线)+ 导演台「重跑」按钮真调端点 |
| **v6.6** | 2026-05-24 | `76af39c` | PG 全量切换闭环(本地 Docker 验证):`db-dialect` 扩 `stripFkAndComments`/`ensureIdempotentDDL` + `exportPostgresSchema({applyReady})`(16 单测)+ `PgDriver` 修 bigint→Number 坑 + `scripts/pg-migrate.ts`/`pg-verify.ts` + `npm run pg:migrate`/`pg:verify`(tsx)。实测 Docker postgres:16:74 DDL→33 表幂等 + async repo 真往返全绿;代码侧 cutover 就绪 |
| **v6.5.1** | 2026-05-24 | `af2f311` | 成员消费扣减 + 真·多用户邀请:`team-credits` 扩 `consume`/`costOf`/`capAllocationToPool` + `lib/team-invite`(token 校验/过期/接受,15 新单测)+ `team_invites` 表 + `POST /api/team/consume`(超额 400)+ `POST/GET /api/team/invite` + `POST /api/team/invite/accept`(须登录不创建账号)+ 团队页邀请面板 + `/dashboard/team/accept` 接受页 |

---

## 当前技术栈 (v4.2.1)

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16.2.1 + Turbopack + React 19 + Tailwind v4 |
| 测试 | Vitest 4.1.0(forks singleFork + retry=1),**1432/1432** |
| LLM | claude-sonnet-4 via vectorengine.ai(可经 `docs/llm-providers.md` 换任意 OpenAI 兼容 API) |
| 图像 | MJ → Minimax → flux.1-kontext → fal/ComfyUI(v3.2 起插件化注册表) |
| 视频 | Veo / Minimax Hailuo / Kling(v3.2 起插件化) |
| TTS / 音乐 | Minimax speech-2.8-hd / music-2.6(v3.2 起插件化) |
| 引擎灰度 | `PLUGIN_CHAIN_MODE` off/shadow/primary + SQLite 遥测 |
| 成片质检 | LLM Vision Audit 每镜对剧本打分 |
| 导出 | 横竖屏 + 平台字幕 + webp/avif |
| 创作者经济 | Cameo IP token 化 + 授权复用市场 |
| Agent 编排 | 自定义 DAG 工作流 + 执行引擎 |
| 持久化 | SQLite(better-sqlite3),DbDriver 抽象就绪,Postgres 迁移进行中 |
| 协作 | Yjs CRDT(WS :1234)+ awareness presence + 评论/通知 |

---

## 后续留尾 (v4.x.3+)

- **v4.1.3** 工作流执行默认换真 orchestrator(需 project 上下文 + API key)+ 自定义步脚本
- **v4.2.3+** projects GET 子查询 + assets / 协作域照 auth/projects 域异步化,接 PgDriver 真连 PG 灰度
- **v5.x** 移动端原生 (Capacitor)、i18n 繁中/日/英、LangGraph 深度编排

---

*本文档由 v4.2.1 收尾时自动整理。后续版本请在对应阶段追加行。*
