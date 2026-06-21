# Wind Comic 🌬️ · 中文营销文案合集

> 给社媒 / 公众号 / 小红书 / 知乎 / 即刻 / B 站 / 视频号 / 抖音 评论区 / 模型站 (ModelScope, HuggingFace) 直接复制粘贴.
> 不同平台不同长度, 一篇拿一篇用.

---

## 🔥 一句话 (1 line)

> **一句话, 出完整短剧 — 不是 5 秒 demo, 是上头 30 秒漫剧.**
> Wind Comic — 开源多 Agent AI 流水线, 比 Sora 多 6 个 agent, 比 Kling 多一个时间线编辑器, 比 Higgsfield 开源.

---

## 🔥 微博 / 小红书 短文案 (140 字)

> 🌬️ **Wind Comic** 来了 — 一句话进, 整片短剧出.
> ✅ 多 Agent 不是黑盒大模型
> ✅ 锁脸三件套 + Vision 审计
> ✅ 真 BGM 波形 + Logic Pro 风时间线
> ✅ 实时多人协作 (Yjs)
> ✅ 中文字幕真烧入 (告别鬼画符)
> ✅ 接你自己的 LLM (3 行 env, 0 改代码)
> ⭐ 开源 MIT, GitHub: ChrisChen667788/wind-comic

---

## 🔥 知乎 / 即刻 中长文案 (500 字)

**"我用一句话生成了一部完整的短剧, 然后跟 Sora 对了一遍 — 它给了 5 秒, 我们给了 30 秒 + 字幕 + BGM + 配音 + 真人嘴型对齐."**

最近开源了 [Wind Comic](https://github.com/ChrisChen667788/wind-comic), 一条诚实的多 Agent AI 流水线, 不是"超大模型把全干了". 8 个 agent 各司其职:

1. **编剧 (McKee + 12 种短剧 trope 模板)** — 一句 idea → 6 镜剧本, 第 1 镜必上钩
2. **导演** — 拆角色 / 场景 / 视觉风格
3. **Style Bible Frame** — 渲一张 canonical key art 帧, 锁全片画风
4. **角色师** — 三视图 + Vision LLM 抽 8 维 DNA (眼型/下颌/发型/标志服饰)
5. **场景师** — 概念图作 `--sref` 锚点
6. **分镜师** — 渲染时跑 Cameo Vision 审计 (脸像不像) + Style Audit (画风对得上不), <70 自动重生
7. **视频制片** — 多引擎竞速 (Minimax / Veo / Kling)
8. **剪辑师** — j-cut / l-cut 按情绪节奏切, BGM 按幕分段, **真中文字幕 ffmpeg 烧入**

为什么这套思路赢: 你单走任何一家 (Sora / Kling / Vidu / Runway) 都会卡在"6 镜画风不一致 / 角色变脸 / 中文字幕变鬼画符 / 没节奏感". Wind Comic 给每一个问题都加了一层"显式契约":

- 角色一致性: cref + sref + DNA + Cameo retry 四重锁
- 画风一致性: Style Bible 帧固定首位 sref
- 中文字幕: 不让模型画字, 后期 ffmpeg + PingFang 真烧入
- 节奏感: 每镜冲突分 + 反转密度 audit, 短剧 trope 强约束

还做了 **Logic Pro 风格的多轨道时间线** — 拖拽改片, 真 BGM 波形 (Web Audio API decode), 实时多人协作 (Yjs CRDT + Y.Map 段锁), 邀请协作者三档权限.

最大尊重: **接你自己的 LLM**. 改 3 行 `.env` 就能从 gpt-4o 换 DeepSeek-r1 / Claude (via OpenRouter) / 通义 / Kimi / 本地 Ollama. 不绑定 provider, 不薅你羊毛.

1150 个单测全过 / TypeScript 严格模式 / MIT 开源.

GitHub: https://github.com/ChrisChen667788/wind-comic

---

## 🔥 公众号长文 (1500 字)

# Wind Comic: 我开源了一个"一句话出整片短剧"的 AI 流水线 — 比 Sora 多 6 个 agent

## 缘起

今年初, 短剧 / 漫剧赛道大爆发. 抖音/快手日均上线 300+ 部, 单集 30 秒, 90% 是 AI 半成品 + 人工补救. 现存工具的问题非常痛:

> 阵容核验 2026-06-22:盲投竞技场(Artificial Analysis / llm-stats)文生视频榜首 Kling v3(2031),LTX-2 Fast 次席(开源最强),Seedance 2.0 第三;图生视频榜首易主为 xAI Grok Imagine 1.5。
- **Kling v3(快手)** 现居文生视频榜首、原生故事板多镜 + 跨镜音画同步;**Seedance 2.0(字节)** 音画联合生成、API 已商用(百炼/fal,配 FAL_KEY 可 BYO)— 但都不烧中文字幕、不开源、单段/单流程为主.
- **Grok Imagine 1.5(xAI)** 图生视频盲测登顶(原生音频 + 极速 + 低价,API 已开放可 BYO);**Veo 3.1** 仍是画质/物理一致性王者(4K + 原生对白音轨)— 同样不烧中文字幕、不能自托管、没多人协作时间线.
- **Runway Gen-4.5** 工业级控制面最强(运动笔刷 + GWM-1 世界模型);中文适配弱 + 闭源 + 无字幕烧入.(HappyHorse-1.0 阿里 4 月匿名登顶后退榜、Sora 2 已停服 App 2026-04-26 / API 2026-09-24,均移出对比)
- 共同缺口 (= Wind Comic 的护城河): 真·中文字幕烧入 · 竖屏短剧套路 · 自托管 · 自带 LLM · 开源 · 实时协作 · 节奏审计 · 智能剪辑.

我想要的: **开源 + 多 Agent 协同 + 中文优先 + 自带 LLM + 实时多人协作**. 都没有. 自己造一个.

8 个月, v2.0 → v3.1.3, 1150 个单测, MIT 开源. 这就是 **Wind Comic**.

## 核心架构

不是大模型, 是流水线. 一句 idea 进来, 经过 8 个 agent:

```
编剧 → 导演 → Style Bible → 角色师 → 场景师 → 分镜师 → 视频制片 → 剪辑师
```

每个 agent 是独立专家, 用严格契约交接. 编剧只关心 McKee 三幕 + 短剧 trope, 不操心怎么画图; 角色师只关心三视图 + DNA 抽取, 不操心配音对齐.

## 5 个独有杀手锏

### 1. Style Bible 帧 — 全片画风锁定

竞品做法: 把 styleKeywords 字符串塞到每个 prompt 里. 缺陷: 模型对纯文本风格 hint 不稳定, 6 镜跑下来画风漂移.

我们做法: **导演完事后先渲染一张 canonical "key art" 帧**, 然后所有后续分镜把这张图作为首位 `--sref`. 等于"先定海报, 再拍片". 直接关掉 60% 的画风跳脱.

### 2. Character DNA — 8 维结构化锁脸

竞品做法: cref 参考图 + 自然语言 "same character". 缺陷: 不同表情 / 角度 / 服装 下, MJ 还是会"理解错". 跨 6 镜 face match 平均 65 分.

我们做法: 三视图先过 Vision LLM 抽 8 维结构 (眼型 / 下颌 / 鼻型 / 嘴型 / 发型 / 发色 / 肤色 / 标志服饰), 拼成短描述 `陈淮安 visual DNA: eyes: almond...; jaw: square; hair: long ponytail`. 每个出场镜头自动注入. **模型同时看到参考图 + 自然语言描述**, 双层锁. 实测 face match 平均 82 分.

### 3. 真正能用的中文字幕

如果你试过让任何视频模型 (Sora / Kling / Minimax) 直接在画面里画中文 — 你知道结果有多惨. 全是糊成一团的鬼画符.

我们做法: **从视频 prompt 里彻底剥掉对白文字**, 加狠的负向 prompt (`--no text --no chinese --no captions --no calligraphy --no signage`), 让模型只画"角色在说话"的动作. 然后后期用 ffmpeg `subtitles` filter + libass + 系统 CJK 字体 (PingFang / Noto Sans CJK) **真烧字幕**.

这是行业标准做法 (好莱坞从来不让模型画字), 但前面几家全部没做.

### 4. Logic Pro 风格多轨道时间线 (Cinema Timeline)

3 行轨道: 分镜 / BGM / 字幕. 每段都能:
- 拖中间改时间 (整段平移)
- 拖边沿改时长 (resize-left / resize-right)
- 自动吸附邻居 (0.4s 阈值)
- 硬碰撞自动 clamp 不重叠
- 双击字幕段改文字
- 真 BGM 波形 (Web Audio API decode + slice)

加一层**实时多人协作** (Yjs CRDT):
- 头像下方实时显示对方在哪个 tab
- timeline 上能看到对方鼠标光标 + 名字标
- 一人开始拖某段 → Y.Map 锁住 → 其他人看到 dashed border + "🔒 xxx 编辑中" 不能动
- 30s stale 锁自动释放 (防客户端崩没解锁)
- 邀请链接 viewer / commenter / editor 三档权限

### 5. 接你自己的 LLM

最大尊重: **整个流水线对 LLM provider 无绑定**. 改 3 行 `.env`:

```
OPENAI_API_KEY=<你的 key>
OPENAI_BASE_URL=<provider 端点>
OPENAI_MODEL=<模型名>
```

实测可用 12+ provider: OpenAI / Anthropic (via OpenRouter) / DeepSeek-r1 / 通义 Qwen-Max / 智谱 GLM-4.5 / Moonshot Kimi / Mistral / Groq / Together / **本地 Ollama** / 自部署 vLLM. **0 改代码**.

Reasoning 模型 (DeepSeek-r1, MiniMax-M2, o1/o3 系列) 也无缝支持 — `callLLM` 自动检测 + 拉超时到 420s + 剥 `<think>` 推理块.

## 还有什么

- **18 个项目模板** — 霸总 / 重生 / 战神 / 古装 / 赛博 / 儿童动画 / 纪录片 / 美食 / 音乐 vlog / etc, 每个带 trope hook 模板
- **节奏 / 反转 / Cliffhanger 审计** — 写完剧本立刻得分, 低于阈值给改进建议
- **单镜重生** — 某镜不满意改 prompt + 上传参考图重生, 不重跑整片
- **Lipsync** — Kling / Sync.so / Hailuo 三家自动 fallback
- **真 4K 出片** — 经 plan-gate, Pro 档及以上
- **项目分享 + OG 图** — 模板可分享, 含 og:image
- **评论 + @ 提及 + 通知** — 项目级 + 镜头级嵌套评论
- **API 配额告警** — 任何 provider 余额耗尽自动 banner

## 数据

- 8 个月 21 个 sprint
- v2.0 → v3.1.3
- **1150 个单测全过**
- **TypeScript 严格模式, 0 错误**
- **MIT 开源**
- **0 强制依赖外部 API key** (没配 Minimax 也能跑, 自动 fallback)

## 链接

- GitHub: https://github.com/ChrisChen667788/wind-comic
- ModelScope: https://www.modelscope.cn/profile/haozi667788
- 跑起来: `git clone && npm install && npm run dev`

⭐ 觉得有用请 Star, 等你来 PR.

---

## 🔥 视频号 / 抖音 评论区 短钩子

> 别再用 Sora 拍 5 秒了. 我用开源工具一句话出 30 秒短剧, 还能多人协作改片. GitHub 搜 wind-comic.

> 漫剧创作者必看: 锁脸 + 中文字幕 + BGM + 实时协作 + 接你自己的 LLM. 全是开源的. 链接 GitHub: ChrisChen667788/wind-comic.

> 你 AI 短剧的中文字幕是不是全是鬼画符? 试试 wind-comic, ffmpeg + PingFang 真烧字幕, 终结鬼画符.

---

## 🔥 Twitter / 即刻 短贴

> 🌬️ Wind Comic v3.1.3 来了
>
> · 一句 idea → 整部短剧
> · 8 agent 流水线
> · Style Bible 锁画风 / DNA 锁脸 / ffmpeg 烧中文字幕
> · Logic Pro 风时间线 + 实时多人协作 (Yjs)
> · 接你自己的 LLM (12+ provider, 0 改代码)
> · 1150 测试全过 / MIT 开源
>
> github.com/ChrisChen667788/wind-comic

---

## 🔥 ModelScope 个人主页文案

复制到 [modelscope.cn/profile/haozi667788](https://www.modelscope.cn/profile/haozi667788) 的简介区:

> **Wind Comic 🌬️ — 开源多 Agent AI 漫剧/短剧流水线**
>
> 一句 idea, 8 个 agent, 一部完整短剧. 锁脸 / 锁画风 / 中文字幕真烧入 / 实时多人协作 / 接你自己的 LLM. MIT 开源.
>
> GitHub: github.com/ChrisChen667788/wind-comic
> v3.1.3 · 1150 单测全过 · 0 API key 强制依赖.

详细全文 → 看 [`docs/modelscope-profile.md`](modelscope-profile.md).

---

## 🔥 ProductHunt 标语

> Wind Comic — One sentence in, a finished short drama out.
> Multi-agent AI pipeline. Real-time collab timeline. BYO LLM. Open source.

---

## 🔥 V2EX / Hacker News 标题

> Show HN: Wind Comic – open-source multi-agent pipeline turns 1 sentence into a finished short drama
>
> github.com/ChrisChen667788/wind-comic

---

## 🔥 Reddit r/aivideo r/ArtificialInteligence

> [Open Source] Wind Comic - 8-agent pipeline that turns one sentence into a finished short drama with character consistency, locked visual style, real CJK subtitles, and a multiplayer timeline. MIT licensed, BYO LLM (12+ providers, 3 env vars).

---

## 🔥 GitHub 简介 (about)

> One sentence → finished short drama. Multi-agent AI pipeline · cinematic storyboards · real-time collab timeline · BYO LLM · open source · 1150 tests passing.

---

## 🔥 GitHub topics tags

`ai` `agents` `video-generation` `text-to-video` `multi-agent` `pipeline` `next-js` `typescript` `cinema` `storyboard` `yjs` `crdt` `realtime-collaboration` `chinese-ai` `short-drama` `comic-generation` `midjourney` `minimax` `kling` `veo` `sora` `llm-agnostic` `byo-llm`
