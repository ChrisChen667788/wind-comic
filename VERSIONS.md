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
| **v6.4** | 2026-05-24 | `(本次)` | 导演级全链路编辑(对标火山控片):`lib/pipeline-stages`(4 环节模型 + 按 updatedAt 推 空/就绪/待更新 stale + 下游失效分析,8 单测)+ 项目页「导演台」tab(`director-console`:流水线可视化 + 进度 + 跳节点编辑 + 重跑下游影响);项目 API 补 updatedAt |

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
