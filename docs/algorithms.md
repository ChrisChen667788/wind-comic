# 算法说明:确定性启发式 + BYO 真模型升级路径

Wind Comic 里若干「打分 / 判定」是**确定性启发式**(规则 / 信号处理),**不是 ML 推理**。
这是**有意取舍**(非 bug):

- ✅ 可解释、可单测锁死、零额外推理成本、离线可跑、双驱动一致;
- ⚠️ 够用,但**不是模型级精度**;
- 🔌 要更准 → **接真模型**(每条都留了 BYO 升级口子)。

## 各启发式 · 现状 · 升级路径

| 模块 | 主要文件 | 启发式做法 | 局限 | 升级到「模型级」 |
|---|---|---|---|---|
| **口型-音频对齐分** | `lib/lipsync-align.ts` | Web-Audio RMS 包络 vs viseme 轨,pearson 相关 + bestLag 测时延 | 只看能量包络,不解析音素 | 接 forced-aligner(MFA / whisper 时间戳) |
| **本地 2D 口型渲染** | `lib/lipsync-providers/local-2d.ts` | viseme 轨驱动 8 张口型贴图(**示意**) | 非照片级、嘴未贴到脸的真实位置 | 配 `LIPSYNC_API_URL`(wav2lip / SadTalker / MuseTalk)→ 真渲染 |
| **Vision 质检分** | `lib/quality-gate.ts` 等 | 规则维度聚合(画面对剧本 / 一致性 / 口型…)+ 可选 LLM 视觉评分 | 规则维度是固定权重 | 全量交给多模态 LLM 打分 |
| **情绪 / 节奏曲线** | `lib/emotion-curve.ts` | 关键词 / 规则映射到强度值 | 不懂语义细微差别 | LLM 逐镜情绪打分 |
| **节奏 / 冲突审计** | `lib/pacing*` / McKee skill | 规则(冲突分 + 反转标记) | 启发式阈值 | LLM 叙事结构分析 |
| **卡点剪辑(v12.0.0)** | `lib/beat-detect.ts` → `services/video-composer.ts` | ffmpeg 析 BGM 拍点,镜头切点吸附最近拍(±150ms,只收紧不越界源片);durations[] 共用链路自动带动配音 adelay 对齐 | 析拍用 silencedetect 近似 onset;只收紧 | madmom 级 onset/downbeat;能量分段(BeatSync)/ LLM 剪辑计划(CutClaw) |
| **情绪节奏曲线(v12.0.1)** | `lib/edit-rhythm.ts` → `services/video-composer.ts` | 按 emotionTemperature/tensionLevel:情感峰值镜 breathe 满长、高张力镜快切压缩、平淡过场轻压;对白镜不压保配音;**只压不拉** | 数值阈值启发式;无情绪数据则不动 | LLM 一句指令调风格(CutClaw)/ 能量分段细化(BeatSync) |
| **侧重强调(v12.0.2)** | `lib/edit-rhythm.ts` `detectKeyShots` → composer | 标关键镜(开场钩子/集尾悬念/情绪反转/峰值)→ 关键镜不压保满长(注意力倾斜)+ 进关键镜用沉稳 fade 略长转场 | 结构启发式(位置+情绪跳变) | pacing-audit/hook-audit 真关键镜联动 / LLM 重点位 |
| **转场审美(v12.0.3)** | `lib/edit-rhythm.ts` `selectTransitions` → composer | 按镜头关系选转场:张力升→cut/落→dissolve/反转→fade/关键镜→fade/双对白→dissolve;变化性守卫(同转场不连 3 次);显式硬切保留 | 仅用 emotion/tension 数值;无 scene 字段 | 场景边界感知(match-cut)/ 真 j-cut·l-cut 自动选 |
| **一句指令调剪辑风格(v12.0.4,BYO)** | `lib/edit-style.ts` → composer | 用户一句话→风格参数(compressionBias 压缩力度 + cutBias 转场软硬),调制 v12.0.1–.3 管线。规则层关键词字典零配置可跑;可选 LLM 层把自由文本映射成参数(白名单 sanitize 夹紧,失败回退规则层) | 规则层关键词覆盖有限;参数维度仅压缩+转场两轴 | LLM 出更细剪辑计划(分段 pacing 曲线/逐镜强调权重),CutClaw 式三 Agent 复核 |
| **钩子审计三指标** | `lib/hook-audit.ts` | 词典 + 算术:开场 3 秒钩子分 / 集尾悬念分 / BGM 卡点对齐率(ffmpeg 析拍 ±150ms 窗口) | 词典覆盖有限;析拍用 silencedetect 近似 onset | 配 LLM key → 复核开场/集尾两个判断型指标(与规则分取均值);卡点是测量值不交给 LLM |
| **长篇分集** | `lib/story-intake.ts` | 章节标记优先,否则按字数贪心打包 + 句子降级 | 无语义边界感知 | LLM 按情节断点分集 |
| **按名推性别选音色** | `lib/voice-routing.ts` | 名字字符表 + 规则推断性别 → 默认音色 | 中性名 / 外文名不准 | LLM / 性别分类器;**或用户手动覆盖音色(已支持)** |

## 设计原则

1. **启发式是「零配置默认」**:开箱即跑、可解释、可测。
2. **真模型是「按需升级」**:配 key / 端点即切到模型级(口型已有 `LIPSYNC_API_URL` + 本地 2D 兜底;
   图像/视频/TTS 走 provider 注册表 BYO;LLM 走 OpenAI 兼容端点)。
3. **始终给人工兜底**:音色可手动覆盖、弱镜可一键重拍、分集可手动调 —— 启发式错了用户能纠。

> 结论:这些都是**工程取舍**,不是待修的缺陷。要哪条升到模型级,接对应 BYO 口子即可。

## 资产连续性台账 · 漂移检测(v10.6.1)

- **登记(确定性,零 LLM)**:服装 = 每角色一条(引用镜 = `shot.character` 命中或文本提及);场景 = 每场景一条;道具 = 模板 keyElements / 手动登记词,按镜头描述/台词包含匹配。
- **启发式漂移处理(零配置,当前实现)**:条目描述变更 → 受影响镜头清单(=该条目引用镜)→ 对应 storyboard/video 资产置 `stale`(项目页待重渲徽章/rerun 流程消费)。
- **BYO Vision 升级路径**:配视觉模型 key 后,可对受影响镜头图做「条目描述 ↔ 画面」一致性比对打分(同 Cameo 锁脸 vision-retry 的接入方式),把"待复核"升级为"自动判定漂移分"。有意取舍:无 key 时不假装能看图。
## 钩子审计三指标(v10.6.2)

短剧的生死线在三处,逐一量化并入节奏审计报告(`PacingAuditReport.hooks`,节奏分析 tab 展示):

1. **开场 3 秒钩子分(0-10)** —— 按累计时长截取前 3 秒内的镜头(`OPENING_WINDOW_S`),
   计分:开场冲突底分 ×0.4(复用 `scoreShotConflict`)+ 钩子词命中 ×2(危机/奇观/身份反差词典,上限 4)
   + 疑问/惊叹 +1 + 开场有对白 +1。每项得分附中文 reason,UI 直接呈现得分构成。
2. **集尾悬念分(0-10)** —— 只看末镜:悬念构件命中 ×2(突现/未解/威胁词典,上限 4)
   + 疑问收尾 +2 + 末镜冲突分 ≥5 加 2 + 情绪非中性 +1 + 叙事节拍标注悬念 +1。
3. **BGM 卡点对齐率(0-1)** —— Editor 阶段真 BGM 落盘后,`lib/beat-detect.detectBeats`(ffmpeg
   silencedetect 析拍)→ 每个切镜 out 时刻找最近拍点,±150ms(`BEAT_SNAP_WINDOW_S`)内算踩拍,
   对齐率 = 踩拍切点 / 总切点。**无 BGM / 析不出拍 → `available=false` 诚实标「不可测」,不给假分。**

分层(BYO 哲学):规则层零配置全可跑(mock/无 key);配 LLM key 后 `assistHookAuditWithLLM`
复核开场/集尾两个判断型指标,与规则分取均值(规则分是锚);卡点对齐率是测量值,LLM 不参与。
时序:Writer 后立即算前两项(BGM 未生成,卡点标不可测)→ Editor 生成 BGM 后回填卡点并重推 SSE。
