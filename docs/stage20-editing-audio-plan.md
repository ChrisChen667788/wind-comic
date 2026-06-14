# 阶段二十 · 智能剪辑(节奏/侧重/审美)+ 预览音频(v12.x)

> 触发:用户反馈「最新版剪辑不够专业和有审美,只是把片段拼接,没有节奏感、侧重性和审美」+
> 「片段预览和成片预览都没有声音」。要求:去 GitHub/HuggingFace 找漫剧/电影/短篇剪辑的
> 开源算法/skills 适配本项目 → 写进迭代计划;预览无声一并修复。

---

## 一、现状诊断(全部实测,非猜测)

### 1.1 剪辑 = 纯拼接,节奏算法躺着没接

- `services/video-composer.ts` 目前按 `shot.duration` 顺序 concat + xfade 转场 + amix 混音 —— **镜头时长是 Writer 给的静态值,切点不跟音乐节拍、不随情绪起伏**。
- **关键发现**:项目早有 `lib/beat-detect.ts` 的 `snapDurationsToBeats`(把镜头 out 时刻吸附到 BGM 拍点,±150ms 窗口)+ `findNearestBeat` —— 但**全仓只有 hook-audit 用它「量个卡点对齐分」(v10.6.2),从未接进 composer 真正调整剪辑**。算法现成、零新依赖,白白闲置。
- `lib/emotion-curve.ts` 有 `computeEmotionCurve / rhythmFor / emotionScore`(情绪强度→节奏值),也没驱动剪辑。
- 结论:**节奏/侧重的积木全有,只是没拼成「节奏剪辑」管线**。

### 1.2 预览音频(实测 ffprobe)

| 对象 | 实测 | 结论 |
|---|---|---|
| `data/composed/*.mp4` 真合成成片 | **77/77 全有音轨** | composer 混音**正常**,不是 bug |
| 裸生成片段(type='video') | 部分无音轨 | 生成模型出片无音(音频只在合成阶段混入)→ **逐镜预览自然没声** |
| 部分老 final_video | 无音轨 | 生成时缺 TTS/BGM key,成片只剩静音 |

- 真实缺口 = **(a) 片段预览无音轨**(设计上音频后置到合成);**(b) 成片音频不保证**(缺 key 时静音,且无体检/自愈)。不是「composer 不混音」。

---

## 二、研究综述:GitHub / HuggingFace 开源剪辑算法

| 项目 | 是什么 | 对本项目的可借鉴点 |
|---|---|---|
| **CutClaw**(GVCLab,arxiv 2603.29664,已开源)| 多 Agent 音乐同步剪辑:**Playwriter**(读音乐节拍/能量/段落定剧本)→ **Editor**(对齐拍点切镜)→ **Reviewer**(质检:剧情相关/审美/指令贴合,弱帧剔除)| **架构蓝图**——三 Agent 恰好对应本项目已有:beat-detect(拍点)+ pacing-audit/emotion-curve(能量/段落)/ 既有逐镜生成 / vision-audit+quality-gate(质检)。一句指令调风格(快剪 vs 慢叙) |
| **BeatSync Engine**(Merserk)| 拍点网格 + 能量分段:**平缓段拉长镜头、高能段快切**,可选 Qwen3-VL 语义选镜 | 「能量驱动节奏」公式直接可移植到 composer |
| **montage-ai**(mfahsold)| 本地优先:转录驱动剪辑 + 卡点切 + OTIO/EDL 导出 | EDL 导出已有(v9.2 AAF/EDL);卡点切是我们要补的 |
| **videoclipgenerator / Vibe Music Engine**(lazniak)| Whisper + 拍点检测 → EDL,切点同步音乐 | 印证「拍点→切点」主流做法 |
| **PySceneDetect** / HF **fffiloni/scene-edit-detection** | 内容/运动感知场景切分 + 时码 | v11.1.1 外部拆条已用 ffmpeg scene detect;可升级 minShotSec/运动感知 |

**采纳策略(与项目「确定性启发式 + BYO」哲学一致)**:
- **不引 Python/ComfyUI/madmom 重依赖** —— 这些是独立 Python 工具链;**把算法 PORT 进既有 ffmpeg composer**。
- madmom 的拍点检测 → 用项目已有的 `detectBeats`(ffmpeg silencedetect)替代;CutClaw 三 Agent → 用项目已有 beat-detect/emotion-curve/pacing-audit/vision-audit 拼成确定性管线;LLM「一句指令调风格」作为可选 BYO 增强层。

---

## 三、阶段二十 A · 智能剪辑(v12.0.x)

### v12.0.0 — 卡点剪辑接入(确定性,把闲置算法接上)【S】
- composer 的镜头 out 时刻经 `snapDurationsToBeats(durations, detectBeats(bgm))` 吸附到 BGM 拍点(±150ms);无 BGM/析不出拍 → 原样(诚实降级)。
- 验收:有 BGM 的成片切点对齐拍点率↑(复用 hook-audit 的 bgmSync 指标前后对比);无回归。

### v12.0.1 — 情绪节奏曲线(能量驱动 pacing)【M】
- `computeEmotionCurve(shots)` → 每镜目标时长权重:**情绪峰值/抒情镜拉长(慢)、动作/高张力镜压缩快切(快)**(BeatSync「calm holds / energy cuts」)。在拍点吸附之前先做时长重分配,总时长守恒。
- 纯函数 `lib/edit-rhythm.ts`(可单测):输入逐镜 emotion/tension/duration → 输出重分配后的目标时长。

### v12.0.2 — 侧重/强调(emphasis)【M】
- 复用 pacing-audit(反转镜)+ hook-audit(开场钩子/集尾悬念镜)标「关键镜」→ 关键镜给更长 hold + 强调转场(push-in/定格);过场弱镜(冲突分低)压缩或快切过。
- 「侧重性」= 不再均匀分配注意力,把时长/转场预算倾斜给叙事关键镜。

### v12.0.3 — 转场审美(aesthetic transitions)【S】
- 按相邻镜关系自动选转场:同场景内 match-cut/硬切、场景切 J-cut/L-cut(composer 已有 j/l-cut adelay 链路,补「自动选择」)、情绪转折叠化。转场落点对齐拍点。

### v12.0.4(可选 BYO)— 一句指令调剪辑风格【M】✅ 已交付(commit ddb704e)
- CutClaw 式:用户一句话(「快节奏燃向」/「慢叙抒情」)→ 风格参数(`compressionBias` 压缩力度 + `cutBias` 转场软硬),喂给 v12.0.1–.3 的确定性管线。无 key 时用默认风格。
- 落地:`lib/edit-style.ts` 两层——规则层 `resolveEditStyleRule`(关键词字典,零配置可跑)+ LLM 层 `resolveEditStyle`(配 key 把自由文本映射成参数,白名单 sanitize 夹紧,失败/无 key/MOCK 回退规则层)。
- 调制点:`applyEmotionPacing` 加 `compressionBias`(只缩放压缩量,满长镜恒不动);`selectTransitions` 加 `cutBias`(硬切池/柔池 + 张力→cut 阈值,显式硬切保留)。端到端:create 页预设 chip + 自由文本框 → create-stream → CreatePipelineInput.editStyle → orchestrator.setEditStyle → composeVideo。
- **阶段二十 A 智能剪辑收官**(卡点/情绪/侧重/转场/调风格 五刀全交付)。

---

## 四、阶段二十 B · 预览音频(v12.1.x)

### v12.1.0 — 成片音频保障 + 体检自愈【S】
- 合成后 `ffprobe` 校验成片含音频流;缺失 → 至少补 BGM 重 mux(不让成片静音);final_video 资产记 `hasAudio` 标记。
- UI 成片区音频徽章(有声/静音 + 原因),静音成片一键「补音频重合成」。

### v12.1.1 — 片段预览音频【M】
- 路径一:生成模型支持原生音频时(Veo 3.1 native audio)请求 `generate_audio` → 片段自带声。
- 路径二(兜底):片段预览叠播该镜 TTS 配音资产(shot-audio),`<video>` + 同步 `<audio>` 对齐;无配音的镜明确标「片段无独立音轨,成片含配乐+配音」。

### v12.1.2 — 预览体验【S】✅ 已交付(commit 22e57b4)
- 视频 tab 每镜「带声试听」开关(静音/恢复该镜音频,aria-pressed 受控,仅有可听声源时显示);三态就绪度徽章。
- 诚实落地:per-clip 无「配乐」(BGM 仅成片级)→ 三态按片段真实落为 **带配音(TTS 叠层)/ 原生音轨(裸片自带,探测到才标)/ 片段无独立音轨(成片含配乐+配音)**。原生音只在有正向证据(webkitAudioDecodedByteCount/mozHasAudio/audioTracks)时上调,不臆断。
- `components/project/clip-with-audio.tsx`:三 effect 状态机(原生探测 / 叠播同步 / 试听开关→声源切换)。对抗式三镜评审 + 逐条 refute 后定稿。
- **阶段二十 B 预览音频收官**(片段叠播 → 成片体检自愈 → 预览体验)。

---

## 五、风险与非目标

- **非目标**:不自研音乐生成/分离;不引 madmom/PySceneDetect 等 Python 重依赖(PORT 算法,不搬运行时)。
- **风险**:卡点吸附改镜头时长 → 须保证总时长守恒、不破坏口型对齐(口型在配音轨,adelay 链路要跟着拍点移)。对策:时长重分配后同步重算 adelay;e2e 验音画不脱节。
- **诚实降级**:无 BGM/无拍点/无情绪数据 → 退回均匀拼接(现状),不假装有节奏。
