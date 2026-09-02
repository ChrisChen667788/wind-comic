# 青枫漫剧 · 后续版本迭代路线图(v12.171 →)

> 制定于 2026-07-11(当前 v12.170)。三源综合:memory 迭代余项 × 竞品联网核实(2026-07)× 代码库审计(20 缺口带证据)。
> 竞品关键结论:Kling 3.0(Elements 3.0/Omni Audio/multi-shot 6镜)、Seedance 2.5(30s+50参考素材)、Vidu Q3(16s 原生音视频,阅文主力)、SkyReels V4(开源第一)、TikTok Drama Center(AI 短剧分账月超 $200 万)、**Sora 2 API 2026-09-24 退役**。

## Batch A · 安全与止血(P0,先行)

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.171 | 安全双修:public/test-buttons.html 明文演示密码移除(该页对外可访问!)+ lib/db.ts 无条件 seed demo 账号加环境开关;.env.example 补 14+ 缺失 env | S |
| v12.172 | 预算护栏全覆盖:assertBudget 现只盖 create-stream/series 两口,**pipeline-worker/regenerate-shot/批量补渲全绕过**;统一进 orchestrator 生成入口 + pendingCostCny 从固定 ¥6 改按「镜数 × 引擎单价表」动态估 | M |
| v12.173 | Sora 退役迁移:veo.service modelChain 含 sora 系(2026-09-24 API 退役),从默认链摘除、文档标注迁移路径(Veo 3.1/Kling 3.0) | S |

## Batch B · 引擎代差补齐(竞品驱动,核心批)

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.174 | Kling 3.0 参数升级:model_name 探测(kling-v1→2.1-master/3.0)、duration 枚举扩展(15s)、4K/60fps 参数透传;live 验收一条片 | M |
| v12.175 | Kling Elements 3.0 Subject Binding:锁角 3-9 图 → elements 参数(现有 KLING_ELEMENTS=1 通道升 3.0 语义,@Element 标注,多角色 3+ 不混脸);与草图锁正交叠加 | M |
| v12.176 | Kling multi-shot 场景序列:同场景连续镜(transition=continuous 链/正反打)合并 1 次 multi-shot 调用(≤6 镜)——省 API 次数 + 模型级空间连续性 | L |
| v12.177 | Seedance 2.5 接入(qingyuntop doubao-seedance-pro 待评通道):50 参考素材全剧锚定 PoC + 30s 长镜;若达标可replace逐镜草图锁的部分场景 | M |
| v12.178 | Vidu Q3 通道(qingyuntop viduq3 待评):16s 原生音视频+口型,作为**对白镜专用引擎**(路由:有 dialogue 的镜优先 Q3);Kling Omni Audio 同批评估 | M |

## Batch C · 一致性与量产工业化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.179 | 口型语种修正:ko/ru lipsync 现错映射到 'en' viseme(口型-发音严重不匹配)→ 短修标 none 诚实降级,长修接多语 lipsync provider | S→M |
| v12.180 | 字幕字体跨平台:subtitle-burn 硬编码 PingFang SC(macOS 专有,Linux 烧韩/俄字幕炸)→ 按语种选 Noto 系 + SUBTITLE_FONT env | S |
| v12.181 | 跨集一致性传播:season onSettle → 当集角色锚/styleBible/末帧写 series 级表 → 下集 CreatePipelineInput 自动注入(对标天工「一处修改全剧同步」) | L |
| v12.182 | 百集并行断点续跑:season-orchestrator 池状态驻内存(崩溃全丢)→ season_batch_jobs 表持久化 + /resume 端点 | L |
| v12.183 | 多模态角色锚:2-3s 已过审视频片段作角色参考(Kling Elements 收 8s 参考视频/Seedance 混合输入),锁「动态特征」(步态/表情习惯) | M |

## Batch D · 成片质量与本土化深化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.184 | 类型化 BGM 自动选择 + BPM 卡点:beat-detect 补 BPM 估算、BGM 卡点对齐率(现 0%)治理、用户自定义 BGM 上传口 | M |
| v12.185 | 速度曲线(speed ramp):六档固定变速 → Clip.speedCurve 关键帧 + timeline 速度控件 + ffmpeg setpts 表达式插值 | M |
| v12.186 | UI i18n 扩语种:Locale 仅 4 种而管线支持 9 种;补 ko/ru 文案包,normalizeLocale 未知语种回退 en(现回退 zh-CN,非中文用户看全中文 UI) | M |
| v12.187 | 一键多语版:成片级「出海翻译管线」(剧本翻译 → 字幕重排 → TTS 重配 → recompose),对标行业 2.7 元/集翻译成本 | L |

## Batch E · 发布与商业化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.188 | 出海发布包深化:TikTok Drama Center 打包(分集+元数据+封面+定价建议;Q1 AI 短剧分账月超 $200 万)+ YouTube Shorts 直发完善 | M |
| v12.189 | 国内平台 OAuth 直发:抖音开放平台 video.create / B站 preupload(现除 YouTube 全是 manual 降级适配器);OAuth PKCE 用户授权存 token | L |
| v12.190 | 成本下钻:/api/projects/[id]/cost(cost_log × rollupByEngine)+ 项目页成本折叠面板 + 团队按 userId 聚合导出 CSV | M |

## Batch F · 工程债清理与平台化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.191 | 媒体清理与仓库瘦身:data/ 已 3.5GB 无定时清理 → cron cleanup(media 30d/composed·exports 7d);tracked 二进制 ~101MB → LFS/CDN 迁移 | M |
| v12.192 | 门面与死代码:README H1 版本号 postversion 脚本自动同步(治本);performance.ts 空 stub 处置;email SES 静默失败改 fail-fast | S |
| v12.193 | genre shot-pack Skills 化:ad-factory 模式泛化为「题材镜头包」(悬疑/甜宠/古装各一套 shot 语法+BGM+节奏模板),对标 Miora Skills | M/L |
| v12.194 | 小说长文本摄取增强:story-intake 升级「AI 问书」式抽取(人物关系/技能设定/高光情节),对标阅文「5 分钟理解百万字」 | L |

## v13 方向(批次外,需产品决策)

- **专属 LoRA 一致性档**:行业顶尖 97% 一致性 = IP-Adapter FaceID v2 + 专属 LoRA(30-50 图微调);做「角色 LoRA 训练」付费档,与草图锁/Elements 组成三级一致性体系
- **SkyReels V4 本地渲染档**:开源第一(T2V with Audio),接为低成本批量引擎,与 Kling/Vidu 分层
- **ControlNet 硬锁**:草图锁从软参考升级 Canny/IP-Adapter 硬约束(fal.ai 托管 ComfyUI 端点)
- **团队协作**(阅文已有):项目多人编辑/审批流
- **平台化 vs 工具**:阅文 ToonScroll 证明「工具→平台」是终局,分发/分账模块是否自建待定

> 执行约定:每版本照旧 tsc 0 + 单测 + live 验收(涉引擎必真跑)+ VERSIONS.md + push;每批次末跑一轮对抗评审;大版本同步 GitHub/ModelScope 门面。

---

# 增补 · Batch K:2026-08-31 竞品分析落账(v12.401 落账本身,v12.402 → 起执行)

> 来源:[`docs/COMPETITIVE-GAP-2026-08.md`](./COMPETITIVE-GAP-2026-08.md)(6 路并行联网调研 + 关键数值二次复核)。
> 排序依据:**先修可能已经坏掉的 → 再把已接入的用满 → 再补真实缺口 → 最后才是新供应商**。
> 之所以是这个顺序:第二类不需要新供应商、不增加成本,只是把已经付过接入成本的能力调用起来 ——
> 竞品对比表第三列「我们用了多少」全是 0 的那几行,是当下性价比最高的一块。

## K-P0 · 已经落后或可能已失效的

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.402 | **MiniMax 升 H3(V2)**:默认 `MiniMax-Hailuo-2.3` **已被官方降为 legacy**,继续用等于随时可能像 Music API 那样被无预告停掉;H3 还自带免费音频输入 + 口型对齐 | S |
| v12.403 | **Vidu 钉住版本**:`qyt-vidu.service.ts` 钉 `viduq3`,而 `vidu.service.ts`(经 `builtins.ts:48` 与 `app/api/u2v/route.ts` 走活路径)**不传任何模型字段**、跑供应商默认 —— 与 MJ 未钉版本同病。钉到 Q3 Pro/Turbo 才谈得上用上短剧特效包 + 7 参考图多主体锁定 | S |
| v12.404 | **MJ `--cref` → `--oref`**:V7 起 Omni Reference 取代 cref,而 `midjourney.service.ts:81` 仍在发 `--cref` 且**全仓未指定 MJ 版本**(走网关默认)——角色锁脸可能已在 MJ 路径静默失效。做法:显式声明版本 + 按版本切参数 + 加「vision retry 触发率突增即报警」的可观测信号。⚠️ **需实测确认**(本轮无 MJ 额度) | S |

## K-P1 · 把已接入的用满(不需要新供应商)

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.405–406 | **Kling 多镜连贯**:一次调用出 6 个连贯镜头,替代「逐镜生成 + 靠 DNA 拼一致性」 | M |
| v12.407 | **Veo Scene Extension**:把成片接到 60s+(注意**单次生成上限仍是 8–10s**,这是拼接不是单次长镜),缓解短剧「镜头太碎」 | M |
| v12.408 | **Kontext 指令式局部重绘**:分镜审计 <70 分时**只重绘出问题的区域**,而非整张重生 —— 省钱且更稳 | M |
| v12.409 | **Kling 自带多语对白 + 口型**:与自研 TTS 链做 A/B,择优或按语种分流 | M |

## K-P2 · 补真实缺口

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.410–411 | **音乐能力**:主选 ElevenLabs Music v2($0.15/min,授权语料商用最干净);同时把 YuE / ACE-Step 1.5(均 Apache-2.0)注册为**自托管备选** —— 契合本项目定位,也避免再被单一供应商停服卡死(MiniMax Music 的教训) | M |
| v12.412 | **独立 grader**:Vision Audit 现在是同一 agent 既生成又打分,存在自我合理化;借鉴 Anthropic Outcomes 改为独立评分 context(其实测成功率 +8–10pp) | M |
| v12.413 | **token 预算上限**:借鉴 Devin ACU —— 每个 Agent 任务注入预算,**超限暂停待人工确认**而非硬失败;里程碑 checkpoint 契合「导演→编剧→分镜→视频」的天然断点 | M |

## K-P3 · 新供应商 / 新能力

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.414 | **Grok Imagine 1.5**:7 路视觉参考同帧锚定(我们现在只有 cref+sref 两路)+ 语音克隆,注册进 provider 注册表 | M |
| v12.415 | **Seedream 4.5**:中文文字渲染领先,用于**片头/字卡**这类必须画中文的场景 | S |
| v12.416 | **ElevenLabs v3 audio tags**:与现有「情绪→韵律」模块对接,情绪标签直接注入 audio tag,省掉一层推理 | S |
| v12.417+ | **降低上手门槛**(最大战略劣势):一行 Docker 起 / 预置 demo 工程 / 模板库。Coze 3.0 那类零代码平台 5 分钟出片,而市场 YoY +214% —— 这个差距会被快速放大 | L |

## 本轮明确**不做**的

- **不自研生成模型** —— 生成层是红海(榜首已被 Wan 3.0 拿下),我们在制作层竞争;
- **不追 Adobe 的商业授权牌** —— 无公开 API,BYO 架构接不进来;
- **不做多平台自动投放**(Manus 那类)—— 越过「制作工具」的边界,且合规风险高。

## 机制:让这件事不再靠人记

- `docs/competitive/claims.json` —— **可证伪假设台账**,每条写清「怎样才算被推翻」;
- `scripts/competitive-scan.mjs` —— 超过 14 天报警,并把上轮结论摊成本轮任务书;
- `ai.qfmanju.competitive`(launchd,每周一 10:00)—— 查得比约定勤,超期能早一周被发现。

> 为什么定时任务不直接产出分析:真正的竞品分析需要联网检索 + 判断,脚本做不到;
> 硬做只会得到一份**看起来像分析的空壳**,那正是这个项目一直在消灭的假绿。
> 所以它只做自己真能负责的三件事:到期检查、把结论摊成待验假设、生成可直接执行的任务书。
