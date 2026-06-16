# 阶段二十二 · 分发/发布闭环(v12.3.x)

> 方向:把已经很强的「制作层」接到「上架变现」—— 升级方案列为 P0,商业价值最高。
> 4 路并行 reader 实测后定基调:**散件已大量建成,缺的是「串成闭环 + 真上传」**,不重建。

---

## 一、现状诊断(4 路并行 reader 实测)

### 1.1 已建成(勿重复立项)
- **平台文案包**:`lib/distribution.ts` 6 平台(抖音/快手/视频号/小红书/YouTube Shorts/B站)LLM 出标题×3/标签/钩子/描述/发布建议 → `project_assets`(type='distribution');`/api/projects/[id]/distribution` GET/POST。
- **逐平台成片**:`/api/projects/[id]/export-platform` 把 final_video 重编码到 9:16/16:9/1:1/4:5 + fit(contain/cover/blur-pad)+ 平台字幕烧入 → 本地 mp4(serve-file)。`services/video-export-service.ts` `exportForPlatform`。
- **竖屏 + 封面 + 字幕**:`vertical-composition.withVerticalHints`、`cover-candidates`(3 张 9:16 AI 封面候选 + 主角推断 + 标题安全区)、`subtitle-burn`(5 平台字幕样式预设)、narration `cuesToSrt`(SRT 落资产)。
- **导出格式**:mp4(720/1080/4K,plan-gate 分档)、EDL/FCPXML/AAF(真二进制)、gif/webp/avif planner。
- **发布就绪度门禁**:`/api/projects/[id]/publish-readiness` + `evaluateQualityGate`(vision 审计 + 质量分 + 口型,pass/warn/**block**)—— 但**只是只读徽章,没硬拦**。
- **分享 + 计费**:`projects.share_token`(nanoid-18)+ `project_share_tokens`(协作邀请)、`plan-gate`(导出/4K/视频/Polish 已接)。

### 1.2 真实最后一公里缺口(本阶段补的)
| 缺口 | 证据 | 影响 |
|---|---|---|
| **无统一「发布」动作** | distribution / export-platform / cover / readiness / share 全是**散的、互不串联**的端点;无 `/api/projects/[id]/publish` | 用户得手动拼标题+视频+封面 |
| **无「可直发包」** | 封面/视频/文案是 3 个独立下载,无单包/zip | 体验断裂 |
| **质量门禁只是 advisory** | `gate.ready=block` 也不拦导出/发布 | 烂片也能发 |
| **无发布状态/记录** | projects 无 `published_at`/`published_platforms`,无 publish 记录表 | 发了什么/发到哪 查不到 |
| **无定时发布** | 发布建议文案有,但无 schedule/worker 触发 | 「最佳时段发」只是文字 |
| **无真上传** | distribution 只出文案,无 OAuth/平台 API push | 还得手动下载再上传 |
| **SRT 没自动接进 export-platform** | 路由从不取 narration 的 srtUrl 传 subtitlePath | 平台成片缺字幕 |
| **封面标题只 CSS 叠加** | 浏览器端 overlay,无 server 烧入 | 下载的封面没标题 |
| **export-platform 只吃本地文件** | 远端/云视频 → 400/501 | 部署/云场景不可用 |
| **缺 TikTok** | PLATFORM_SPECS / 字幕预设都无 tiktok | 国际分发缺一角 |

---

## 二、设计哲学(承袭「复用不重建 + 确定性 + BYO + 诚实降级 + 安全」)
- **复用不重建**:文案包 / 逐平台成片 / 封面 / 字幕 / 就绪度门禁 / 分享 / plan-gate 全已建成 —— v22 = **把散件串成闭环 + 补连接缺口 + BYO 真上传**。
- **诚实降级(关键)**:国内平台(抖音/快手/视频号/B站/小红书)**多无公开「发布」API**,且 OAuth 我**不代填**(安全规则)→ 这些平台降级为「**生成可直发包 + 手动上传指引**」,UI 如实标注「该平台无公开发布 API / 需手动上传」。**YouTube Data API** 有公开发布接口 → 作**参考 BYO 真上传适配器**(token 用户自配,我只消费不代授权)。
- **硬门禁**:把 advisory 的 `evaluateQualityGate` 在**发布动作**上变硬拦(level=block → 422),发布是「能交付」的最后一关。
- **安全**:不代填任何平台密码/OAuth;适配器只读用户已配的 token;无 token → 降级导出包。发布是 outward-facing,执行前确认。

---

## 三、版本拆解 · 阶段二十二 · 分发/发布闭环(v12.3.x)

### v12.3.0 — 一键成片打包(Ready-to-post bundle,确定性核心)【M】✅ 已交付(commit 104af7d)
- `lib/publish-package.ts` `buildPublishPackage(spec, pack, media)` 纯函数:把 **distribution 文案 + 成片 + 封面** 组装成「可直发包」(平台规格 + 标题/备选/标签/话题/简介 + 视频(平台成片优先,无则回退原片)+ 封面 + 一键复制文案 + 缺件 warnings + ready)。
- `GET /api/projects/[id]/publish-package?platform=<id>`:取 DB 资产(distribution / final_video / chosen-cover→cover-candidates)喂进纯函数;附 `exportHint`(一键导该平台 aspect 成片)。
- **修 SRT 自动接入**:export-platform 加 `resolveProjectSrtPath`,指定平台字幕样式时从 narration 资产(persistent_url=srtUrl)取 SRT 传 `subtitlePath` → **字幕此前从未真烧(path 从不传)的 bug 修复**;响应加 `subtitled`。
- **验证**:tsc 0 + vitest 2373(+5:齐件 ready / 无平台成片回退 + warning / 缺件不报错 / tags 截上限+标题超限告警 / B站 16:9)+ playwright(publish-package 契约 + 平台校验)。前端发布面板留 v12.3.1 同发布动作一起接。

### v12.3.1 — 发布闸门 + 发布记录 + 发布面板【M】✅ 已交付(commit fddbcf9)
- `POST /api/projects/[id]/publish`:闸门顺序 **登录(401)→ 属主/可编辑(403)→ 计费 gate creator+(402)→ 质量门禁硬拦 `evaluateQualityGate` block→422**(把 advisory 变硬拦)→ 组装可直发包 + 生成/复用 share token + 落 `publish_records`(status='packaged',真上传留 v12.3.3)。GET 列记录。
- `publish_records` 表(SQLite+PG,入 PROJECT_CHILD_TABLES 级联删)+ `publish-record-repo`(recordPublish/listPublishRecords)。
- 发布面板:`DistributionPanel` 每平台卡片加「发布/打包」按钮 → POST /publish,诚实标注「已打包+分享链接(可下载素材手动上传)」,402→去升级 / 422→质量门禁未过 / 401→登录。
- **验证**:tsc 0 + vitest 2376(+3 repo)+ playwright(发布闸门 401→402(free)→200(creator)+ 记录可见,自动 setTier+清理)。

### v12.3.2 — 封面定版 + 标题烧入(可直发包完整度)【S】✅ 已交付(commit 216aee7)
- `lib/cover-title-burn.ts`(纯):`buildCoverDrawtext`(字号随图高 4.5% / 水平居中 / 安全区顶部 y 用 `h` 表达式 / 半透明底框+描边)+ `coverFontCandidates`(env→macOS→Linux CJK 字体)+ `escapeDrawtextPath`。`services/cover-title-service.ts`:`burnCoverTitle`(ffmpeg drawtext;远端图先下载;**无 CJK 字体/无标题 → 保留原图 burned:false 诚实降级**,中文不烧成方块)。
- `POST /api/projects/[id]/covers/choose`(登录+属主):选候选/imageUrl → 烧标题 → 落 `chosen-cover` 资产;**publish-package 已优先用 chosen-cover**(v12.3.0 接口),定版封面自动进可直发包。
- **验证**:tsc 0 + vitest 2380(+4 纯逻辑)+ **真烧入实测**(「霓虹追缉·雨夜信号」CJK 正确渲染入安全区,非方块)。

### v12.3.3 — BYO 平台上传适配器 + 定时发布【M】
- `lib/publish-adapters/`:统一 `PublishAdapter` 接口(`isConfigured()`/`upload(pkg)`/`status(id)`)。实现 **YouTube Data API** 参考适配器(消费用户配的 `YOUTUBE_*` token,resumable upload);抖音/B站/小红书 作**适配器契约 + 诚实降级**(无公开 API / 无 token → 返回「导出包 + 手动上传指引」,不假装能传)。
- 定时发布:`scheduled_publishes` 表 + worker tick(或复用 pipeline-job 队列),到点调 `adapter.upload`。**安全**:执行真上传前需用户确认(outward-facing);OAuth 用户自做。**验证**:tsc + 单测(adapter 选择 / 无 token 降级 / 调度到点触发,全 mock 不真传)。

### v12.3.4 — TikTok + 云视频导出修复 + 收尾【S】
- `PLATFORM_SPECS` + 字幕预设加 **TikTok**(国际 9:16)。
- export-platform 支持**远端/云视频 URL**(先下载到临时文件再 encode,修 400/501)→ 部署/云场景可用。**验证**:tsc + 单测(TikTok spec / 远端 URL 下载分支)+ 全量回归。

> **阶段二十二收官** = 从成片到「可直发包 + 硬门禁 + 发布记录 + 定时 + BYO 真上传(YouTube 参考,其余诚实降级)」的完整分发闭环。

---

## 四、风险与非目标
- **非目标**:不替用户做平台 OAuth/登录(安全规则);不为国内无公开 API 的平台伪造「一键发布」(诚实降级为导出包);不自建平台账号体系。
- **风险**:平台 API 多变/区域限制 → 适配器接口隔离,失败不影响出包;真上传前用户确认。
- **诚实降级**:无平台 token / 平台无公开 API → 退回「成片包 + 手动上传指引」,UI 不假称「已发布」;真发布成功才写 `published_at`。
- **隐私/安全**:平台 token 只存 `.env.local`/用户配置(gitignore,绝不提交/打印);发布是 outward-facing,执行前确认。
