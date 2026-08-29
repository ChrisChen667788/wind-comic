<!-- 由 scripts/gen-modelscope-intro.mjs 从 README.md 自动生成: 图片→raw、相对链→blob 绝对化, 其余逐字不变. 全选复制粘贴到 ModelScope 项目「介绍」区即与 GitHub 主页一致. 勿手改本文件, 改 README.md 后重跑脚本. -->

<p align="center">
  <img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/banner.jpg" alt="Wind Comic — One line of text. One finished short drama." width="100%" />
</p>

<h1 align="center">🌬️ Wind Comic <sub><sup>v12.370.1</sup></sub></h1>

<p align="center">
  <b>One sentence in. A finished short-form drama out — script, cast, storyboards, voiceover, timeline, mp4.</b><br/>
  Multi-agent AI studio · reusable characters · novel→season splitting · director's control room · real-time collab · bring-your-own LLM.
</p>
<p align="center">
  <b>一句话进,整片短剧出 —— 剧本 · 角色 · 分镜 · 配音 · 时间线 · mp4 一条龙。</b><br/>
  多 Agent AI 创作工作室 · 可复用角色 · 长篇小说→自动分集 · 导演级控片台 · 实时协作 · 自带 LLM。
</p>

<p align="center">
  <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/ChrisChen667788/wind-comic/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ChrisChen667788/wind-comic/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers"><img src="https://img.shields.io/github/stars/ChrisChen667788/wind-comic?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/Tests-4849%2F4849-2ea44f"  alt="4849 tests passing" />
  <img src="https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
</p>

<p align="center">
  <b>English</b> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/README.zh-CN.md">简体中文</a> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-en.md">🔥 Pitch</a> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md">🔌 BYO LLM</a>
</p>

<p align="center">
  <a href="https://github.com/ChrisChen667788/wind-comic/raw/main/assets/promo/wind-comic-promo-en.mp4">
    <img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/promo/wind-comic-promo.gif" alt="Wind Comic — the full 39-second promo, condensed into a silent 15-second loop (click to watch with voiceover &amp; sound)" width="100%" />
  </a>
</p>
<p align="center">
  ▶ <a href="https://github.com/ChrisChen667788/wind-comic/raw/main/assets/promo/wind-comic-promo-en.mp4"><b>Watch the full 39-second promo — with voiceover &amp; sound</b></a><br/>
  <sub>Real cinematic footage woven with motion-graphics · 8 distinct art styles · English narration · scored by the platform's own MiniMax music engine.</sub>
</p>

---

## ✨ Why Wind Comic?

Most "AI video" tools give you a 5-second clip from a one-line prompt. **Wind Comic gives you a finished short-form drama** — script, character bible, multi-shot storyboards, voice-acted lines, BGM, mouth-synced characters (indicative 2D lip bar out of the box; photorealistic face-level lip-sync via BYO wav2lip/SadTalker/MuseTalk or Kling), and a final mp4 — from the same single line.

It works because it doesn't try to be one giant model. It's an **honest multi-agent pipeline** where each role (Writer, Director, Producer, Character Designer, Storyboard Artist, Cameo Locker, Lipsync, Editor) is a specialist that hands off with strict consistency contracts. Plus a **real-time multiplayer timeline** to edit with your team like Figma for film.

```
   "A reborn CEO confronts his cheating ex-fiancée at her wedding."
                                       │
                                       ▼
   Writer ▶ Director ▶ Style Bible ▶ Char Designer ▶ Scene Designer ▶
   ▶ Storyboard (vision-audited) ▶ Video (multi-engine race) ▶
   ▶ TTS (per-character voice) ▶ Lipsync (Kling/Sync.so/Hailuo) ▶
   ▶ Editor (j-cut/l-cut + BGM per act + CJK subtitles) ▶ final.mp4

   + Real-time collab timeline (Yjs CRDT)
   + Bring-your-own LLM (3 env vars, 0 code change)
   + Plug-in image/video providers (12+ supported)
   + Lip-sync pipeline: viseme track → align score → drift auto-correct → engine render → back into timeline   (v10)
   + Template market: save a hit project → rate / favorite / one-click remix (with its voices)               (v10)
   + Per-project cost attribution + budget guard, four-dimension publish gate                                 (v10)
```

---

## 🏗 Architecture

Three views of the same engine. **Open on GitHub to watch them animate** — flowing dashes trace live data &amp; control paths, traveling dots are data packets moving through the pipeline.

<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/diagrams/architecture.png" alt="Wind Comic system architecture — Next.js client · orchestration · 8-agent pipeline · LLM gateway · 12+ media engines · quality / data / realtime platform" width="100%" /></p>

<sub>**System architecture** — five layers, top to bottom. The **Director** threads control across the seven pipeline agents (eight roles including the Director); the **LLM gateway** falls back DeepSeek → MiniMax with zero code change; **12+ media engines** plug in behind one router; everything lands on a **dual-driver** (SQLite ⇄ PostgreSQL) platform.</sub>

<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/diagrams/sequence.png" alt="Sequence diagram — one idea to one finished film, with the Vision-Audit retry loop and multi-engine race" width="100%" /></p>

<sub>**Sequence** — the lifecycle of one *idea → film* request, time flowing down. Two signature beats: the **Vision-Audit retry loop** (auto-regenerate any shot scoring &lt; 70) and the **multi-engine race** (Seedance / Kling / Veo / Vidu — first good clip wins).</sub>

<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/diagrams/dataflow.png" alt="Data-flow diagram — the artifact refinery from text to final.mp4, persisted to DbDriver and the asset store" width="100%" /></p>

<sub>**Data flow** — the artifact refinery. One line of text is refined stage-by-stage (`TEXT → JSON → PNG → IMG → MP4`); every artifact is persisted to the dual-driver DB + asset store and is independently reusable, so any stage can be re-run in isolation.</sub>

> 🎞️ Diagrams are **animated SVG, authored as code** in [`assets/diagrams/`](https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/diagrams/) — crisp at any zoom, versioned with the source. *(Animation renders on GitHub; the ModelScope mirror shows static PNG.)*

---

## 🆕 New in v12.315 – v12.330 — direct the shot, don't re-roll the dice

Every tool can generate a clip. These three let you **direct** one — and they compose into a single loop: *inspect → locate → retake only what's broken*.

**Director's console** *(v12.316–318)* — place the actors and the camera on a top-down stage; the exact blocking becomes two things a model can actually use: a **precise staging directive** appended to the prompt (`"Lin Wan at frame left in full shot; Lu Chen right of center in wide shot"`), and a **layout sketch** fed through the existing `[STORYBOARD LOCK]` channel (layout only — style still comes from the prompt). Shot size and camera angle are **derived from the geometry**, not typed in by hand, so lens/framing and the written spec can't disagree. A deterministic composition audit reports *who is out of frame, who is occluding whom, whether the camera clips an actor* — **before you spend a cent generating**.

**Segment retake** *(v12.315)* — hate two seconds of an eight-second shot? Retake **those two**. The other six are **byte-copied** (`-c copy`), not re-encoded, so the part you liked doesn't lose a generation. Shot duration is unchanged by construction, which means the compressed timeline, voice-over delays, subtitle starts and EDL record-ins **need no recomputation**. Takes are versioned like voice retakes — adopt or roll back.

**Frame-by-frame inspection** *(v12.328–330)* — step through a finished shot frame by frame, box the broken stretch, and hand that exact range to segment retake. Frames are extracted with **accurate seek** (`-ss` after `-i`, not the fast keyframe-only seek), and the timestamp under each frame uses the **same frame-snapping** as the retake planner — so the frame you picked is the frame it cuts at. When the strip is thinned to stay responsive, it says so; frames that fail to decode are reported, not silently skipped.

Also in this range: fonts are **self-hosted** so builds no longer depend on a network fetch; the director paths finally receive the **target language** (non-Chinese projects used to get Chinese scripts and rely on a costly after-the-fact re-translation); the in-process rate limiter **bounds and evicts** its bucket table (the key contained an attacker-supplied email — an unbounded memory vector), and eviction never releases an active block; collaborative comments arriving over Yjs are **validated and field-whitelisted**, so a peer can no longer overwrite another author's name or text.

---

## 🆕 New in v12 — the quality loop era

**Sketch-Lock storyboarding** — every shot first renders a B/W composition sketch, then the final frame is generated *locked to that composition* (toggle at creation time, or per-shot in the Shot Workshop). Camera language finally survives the diffusion lottery.

**Emotion-driven camera** — shots missing camera movement get one derived from story beats (hook→push-in, chase→handheld, reveal→zoom-in, farewell→pull-out, emotion temperature → push/orbit/crane). Even the Ken Burns degradation follows the intended move.

**Engine matrix, honestly** — Veo · MiniMax (Hailuo) · Kling (official Beijing API) · **HappyHorse 1.1 (Alibaba, v12.272 — joint video+audio in one pass)** with a one-line env priority (`VIDEO_ENGINE_ORDER=kling,minimax,veo,happyhorse`), base64 first-frame channel for local assets, and an *honest* fallback chain: a failed shot becomes a labeled animatic, never a still image masquerading as video.

**The quality loop** — ffprobe-powered film health report (aspect/duration/fps/bitrate/audio/degraded shots) per project *and* per series; batch re-render of degraded shots (2-way concurrent); a season-export health gate so no broken episode sneaks into the compilation; an engine weather bar so you know *before* you hit generate.

**Round-trip storyboards** — export the pull sheet as CSV / Markdown / print-ready PDF (with character sheet + health appendix), edit in Excel, import it back — changed visual fields offer one-click re-render of exactly the affected shots.

**Writer resilience** — truncated or quote-mangled LLM scripts are salvaged (bracket-stack completion + content-quote escaping) instead of being silently replaced by a template. The real 23KB incident dump lives in the test fixtures.

## 🆕 Earlier: v6 → v10 — from *demo* to *production platform*

> v3 shipped the pipeline. **v6 turned it into a production studio; v7–v9 hardened it into a platform; v10 closed the lip-sync, template-market, and cost loops.** Reusable characters, a prompt IDE, novel→season auto-splitting with real voiceover, a 60-style gallery, a director's control room, team credit budgets, an industry-grade script audit (**Polish Pro**, v7.1), a **premium design pass** (v8.3), a **fully-migrated Postgres backend** (v9), a **lip-sync delivery pipeline + template market + cost observability** (v10), and a live API health board — every screen below is a **real capture of the running app**.

<p align="center">
  <img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/landing.jpg" alt="Wind Comic landing — 青枫漫剧 AI Animation Agent Studio, 8 agents · 7 engines · 3 consistency guards, looping cinematic hero" width="100%" />
  <br/><sub>v10 landing — looping cinematic hero, 8 collaborating agents · 7 media engines · 3 consistency guards.</sub>
</p>

### 🎙️ v10 — Lip-sync delivery · Template market · Cost guard *(Stage 16)*

- **🎙️ Voice & lip-sync, end-to-end** — per-character voice routing (auto by name + manual pick/audition) → TTS → **viseme keyframe track** → measured **mouth-vs-audio alignment score** (Web-Audio) → **drift auto-correct** → pluggable engine render (wav2lip / SadTalker / MuseTalk, BYO `LIPSYNC_API_URL`) → written back into the timeline. One-click **whole-film lip-sync** with a Vision **QC self-heal loop** (weak shots auto re-render).
- **🧩 Template market** — turn a hit project into a reusable template (style + multi-ref elements + pacing + **voices**), with a **preview clip**, **★ ratings & ♥ favorites**, quality score, and **one-click remix** that prefills a new project.
- **💴 Cost observability + budget guard** — per-project cost attribution by stage (LLM / image / video / TTS / lip-sync), saving hints, and an **ok/warn/over budget guard**. The **publish-readiness gate** is now four-dimensional: picture-vs-script · consistency · lip-sync alignability · **measured mouth-vs-audio**.

<table>
<tr>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/create.jpg" /><br/><sub><b>创作工坊</b> — one line → film: style presets · multi-ref element shelf · character lock · live preview · gold-neon genre gallery</sub></td>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/templates.jpg" /><br/><sub><b>模板市场</b> — preview clips · ★ ratings / ♥ favorites · quality score · one-click remix (carries voices)</sub></td>
</tr>
<tr>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/qc.jpg" /><br/><sub><b>成片质检 + 配音口型</b> — four-dimension publish gate · consistency trend · viseme track (animated mouth + measured alignment) · per-shot Vision scores</sub></td>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/cost.jpg" /><br/><sub><b>技术监看 · 成本归因</b> — per-stage cost share (video / image / LLM / TTS / lip-sync) + saving hints</sub></td>
</tr>
</table>

> Every screen above is a **real capture of the running v10 app**. Design language (v8.3 *Taste* pass — Plus Jakarta Sans + Phosphor icons, gold machined-bezel cards, spring motion, AI gold-neon genre emblems) carries across all of them.

> Notes are consolidated **per major version** — the full minor-by-minor changelog lives in [`VERSIONS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/VERSIONS.md) / [`ROADMAP.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/ROADMAP.md).

| Major version | What landed |
|---|---|
| **v6 · Production studio** | **Character Studio** (reusable cast, multi-view turnaround + 8-field **DNA identity lock**, cross-project **Cameo IP**) · **Prompt Workbench** (`@`-mention assets + compile-preview + readiness score) · **Long-form Intake** (novel → chapter-aware episodes, **real TTS narration** + burned SRT, N-episode parallel) · 60-look **Style Gallery** · **Director Console** (4-stage pipeline, stale-detection, single-stage rerun) · **Team Workspace** (credit pool + RBAC + real invite links) · **API Health Board** (live gateway status + balance) · top-tier model repointing (`veo3.1-pro`) + supplement gateway backfilling TTS / Midjourney / Kling. |
| **v7 · Platform hardening** | Writer/Director on DeepSeek **`deepseek-v4-pro`** with a **universal MiniMax fallback** on any error / out-of-credits / timeout (3-tier LLM health board) · tiered models (**`deepseek-v4-flash`** for speed) that cured the reasoning-token instability · **Polish Studio Pro** — industry script audit: AIGC-readiness score, Save-the-Cat 3-act beat-gap detection, on-the-nose dialogue flags, per-character identity anchors. |
| **v8 · AI director station + premium design** | Per-shot **cinematography console** (景别/机位/镜头/运镜/焦点) + **continuity & seed lock** + emotion/rhythm curves + JSON↔visual **parameter linkage**, all converging into an **11-tab director station** · **Taste design pass**: Plus Jakarta Sans + Phosphor icons, gold machined-bezel cards, spring motion, an asymmetric **bento dashboard**, 60 AI-rendered **style thumbnails**, and AI **gold-neon genre icons** (18 templates + 5 modes + 8 looks). |
| **v9 · Postgres platform + monetization** | Full SQLite↔Postgres **dual-driver** cutover — **17 core tables/clusters** migrated to async repos, verified end-to-end on Postgres with **transaction commit + rollback** atomicity (default stays SQLite, same file, **zero split-brain**; `DB_DRIVER=pg` is opt-in) · multi-platform **distribution-pack** generator (抖音 / 快手 / 视频号 / 小红书 / YouTube Shorts / B站) · **real binary AAF export** (MS-CFB container, for Avid) alongside EDL / FCPXML · plus **quality & consistency depth** (publish-readiness gate, rebirth loop, consistency report) and the **Kling-style multi-reference + one-click film** fusion. |
| **v10 · Lip-sync delivery · template market · cost** *(Stage 16)* | **Voice & lip-sync end-to-end** — per-character voice routing (auto + manual audition), viseme keyframe track, measured **mouth-vs-audio alignment** + **drift auto-correct**, pluggable engine render (wav2lip/SadTalker/MuseTalk) **plus a zero-config built-in 2D engine that works out of the box (no BYO key)**, written **back into the timeline**, one-click whole-film with a Vision **QC self-heal** loop · **Template market** — save→rate/favorite→one-click remix (carries voices), preview clips, quality score · **Cost observability** — per-project stage attribution + **budget guard**, and a **four-dimension publish gate** (picture · consistency · lip-sync · measured alignment). **2135 tests** green on both drivers. |

| **v12.49–v12.80 · Commercial Ad Factory** *(Stage 22)* | **电商/品牌广告工厂全链** — 一句 brief(或**贴商品 URL 自动出 brief**)→ 竖屏成片:现代写实+photoreal **双硬锚**(Director 跑偏古装/3D 的实测病根双修 + plan 确定性净化保险)· **结构化 Hook/CTA 文字卡**(ffmpeg drawtext 零乱码,Hook 公式化选句:问句>感叹,**批量 Hook 变体 A/B**,品牌色可配)· **karaoke 词级扫光字幕**(对齐 TTS 真实时长,抖音/小红书**安全区避让**)· **BGM sidechain 自动闪避** · **《广告法》合规净化**(绝对化用语/医疗红线,全入口覆盖)· **质量三防线+账本**(逐镜 VLM 门禁 photoreal/烤字/畸变→定向重生 · 视频瞬时错误同引擎重试 · 坏 mp4 完整性拦截 · **失败镜 Ken Burns 兜底保时长** · quality_report 健康分)· **发布预检**(三平台硬指标)· rembg 商用安全抠图(产品跨镜一致)+ Kling Elements 打通 · LLM 网关 429/503 **健康感知自动降级**。**2712 tests** green。 |
| **v12.82–v12.120 · Ad Factory 深化 + 供给链扩容** | **视频通道扩容**(qyt-vidu(Vidu Q3 via 网关 `/ent/v2`)入链 pri=75 · minimax 轮询超时可调 · Seedream 4.5 图像尾梯队(720x1280 原生竖屏,实测 14s/张))· **素材质量闭环**(Pexels B-roll 双层兜底 + 人设感知检索 + 烤字/字幕 VLM 抽查(B-roll 与 AI 镜双向)+ 结果缓存 LRU)· **响度归一 -14 LUFS**(实测 -13.62/-1.42 dBTP 命中平台标准)· **成片抽帧封面精选**(VLM 打分,零 T2I 额度)+ 发布包封面链(chosen>AnyText>候选)· **karaoke 长台词折行+行内缩字**(libass 实渲验证)· **英文广告链**(语言感知 CTA + 6 条英文合规红线)· 合规词表可扩展(env+JSON)· 导演/编剧自检修正轮入账 + 导演台 HEALTH KPI + 包装车间结构化结果面板 · LLM 健康缓存全端点对齐(拥堵实测:fable-5 断粮 403 → opus→sonnet→OpenRouter→MiniMax 五级无感降级)。**2780 tests** green。 |

### 📂 More modules — earlier (v6–v8) captures

> Features that still ship. **Director console · novel→season · finished-film station · team workspace · Cinema timeline are refreshed to v10** (live demo data). The **style gallery, API health board, Polish Pro audit, and character turnaround** are kept as earlier (v6–v8) captures because they show fuller sample output (the full style grid / live balances / a complete Pro audit / a 3-view turnaround sheet).

### 🎬 Director Console — the whole film as one control room *(v6.4)*
Every stage at a glance — what's ready, what's gone stale because you changed something upstream, and a one-click rerun that knows exactly which downstream stages it invalidates.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/director-console.png" width="100%" /></p>

### 📖 Novel → season, with real voiceover *(v6.2)*
Paste a full novel; Wind Comic splits it into episodes by chapter markers (or by target length), picks a narration mode, and can render a real narration track + burnable subtitles for the whole season in parallel.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/story-intake.jpg" width="100%" /></p>

### 🎨 Style Gallery — 60 cinematic looks, one click *(v6.3)*
Lock a consistent visual identity before you generate. Search, filter by category, and apply any preset straight into the creation workshop.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v6/styles.jpg" width="100%" /></p>

### 🩺 API Health Board — never get surprised by a dead key *(v6.7)*
Live status for every model and gateway: 正常 / 额度用尽 / 配置缺失 / 不可达, with real balance read-out and a "去充值 / 补配置" hint. Keys are never stored or returned.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v6/health.jpg" width="100%" /></p>

### 🩺 Polish Studio — Pro industry audit *(v7.1)*
Paste a draft, hit **Pro**: deepseek-v4-pro returns a polished script **plus a full industry diagnostic** — AIGC-pipeline readiness score (e.g. 85/100), style profile, first-3-second hook strength, Save-the-Cat 3-act breakdown with missing beats called out, on-the-nose dialogue lines flagged, and per-character Cameo/Seedance identity anchors so every shot stays on-model.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v8/polish-pro-audit.jpg" width="100%" /></p>

### 👤 Character Studio + Cameo IP turnaround *(v6.0 / v7.x)*
Every character gets a real 3-view turnaround sheet (front / three-quarter / back) with a locked structured "DNA prompt" — face geometry, skin tone, signature props, color palette, silhouette identity, full body pose — so the same actor reads identically across all 6 shots. The Cameo IP economy lets the same character travel between projects.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v8/character-studio.jpg" width="100%" /></p>

### 🎬 Finished film + 11-tab director station *(v8.0)*
One project, eleven tabs of cockpit-grade control: 导演台 · 剧本 · 角色 · 场景 · 分镜 · 连贯性 · 视频 · 镜头工坊 · Cinema 时间线 · 节奏分析 · 成片质检 · 技术监看 · 参数联动 · 评论协作 · 完整播放. The finished film plays right in the workspace with a 90/100 audit badge and one-click `mp4` / platform export.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/final-film.jpg" width="100%" /></p>

### 👥 Team Workspace *(v6.5)*  ·  🎞️ Cinema Timeline + narration track *(v6.2.4)*
<table>
<tr>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/team.jpg" /><br/><sub>Credit pool + per-member allocations, RBAC, real invite links.</sub></td>
<td width="50%"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v10/cinema-timeline.png" /><br/><sub>Multi-track timeline; narration audio + subtitles burned in.</sub></td>
</tr>
</table>

---

## 🎯 Who is this for?

| You are... | What Wind Comic gives you |
|---|---|
| **Vertical short-drama creator** (霸总 / 重生 / 战神 / 古装) | Trope-aware Writer, hook-first shot 1, reversal density audit, cliffhanger detection, 9:16 default |
| **Content marketing team** | 1 idea → 30-second polished ad with consistent characters across cuts, real Chinese subtitles burnt in, brand-safe negative prompts |
| **Indie filmmaker / video artist** | Style Bible locks the visual identity across all shots, McKee-structured story beats, Logic-Pro-style multi-track timeline, real BGM waveform editor |
| **Comic / manhua adaptation studio** | Script → storyboards in your chosen art style, character consistency via cref+sref+DNA, drag-rearrange shots, regenerate single shots |
| **Educator / explainer** | Pacing audit warns when content is too flat, conflict-score per shot, suggestions for hooks |
| **Open-source builder** | Swap any LLM with 3 env vars (OpenAI / Anthropic / DeepSeek / Qwen / Kimi / OpenRouter / Ollama local — all work) |

---

## 🚀 Highlights · The features competitors don't have

### 1. **Multi-agent pipeline, not one black-box model**
Director plans the story → Writer drafts dialogue under McKee structure → Style Bible Frame locks the look → Character Designer extracts an 8-dimension **DNA signature** of each character → Storyboard renders with Vision Audit (auto-regen on <70 score) → Video producer races multiple engines (Minimax / Veo / Kling) → Editor cuts j/l-cut on emotional beats and burns CJK subtitles.

### 2. **The visual coherence trick — Style Bible Frame** (v2.20)
We render **one canonical "key art" frame from the Director's plan**, then pass it as the first `--sref` of every subsequent storyboard render. Net effect: all 6 shots feel like they came from the same show, not 6 random Midjourney runs. (Most competitors only carry a 2-frame rolling chain — shot 6 doesn't know what shot 1 looked like.)

### 3. **9:16 by default + 12 short-drama trope templates** (v2.20 P0.2)
Writer prompt detects 短剧/漫剧 genres and switches to vertical canvas + injects proven hook patterns (重生回到 N 年前 · 当街掌掴 + 秘密身份 · 系统提示音突响 · etc). McKee 3-act still backs it; tropes are the surface.

### 4. **Real CJK subtitle burning** (v2.22)
The garbled-Chinese-text-in-AI-video problem solved properly: we **strip dialogue text** from the video prompt (so the model doesn't try to draw garbled glyphs) + add aggressive negatives (`--no text --no chinese --no captions`) + post-bake real subtitles with ffmpeg `subtitles` filter using a system CJK font (PingFang / Noto Sans CJK).

### 5. **Character consistency = cref + sref + 8-dim DNA + Cameo Vision Retry** (v2.21 P1.2)
Beyond reference image hacks, we run each character's turnaround sheet through Vision LLM to extract structured features (eye shape / jaw angle / hair style / signature outfit etc.), then inject as natural-language anchor into every shot prompt. Combined with cameo-vision-retry: if a shot's character match scores <75, we auto-regen with boosted cw.

### 6. **Logic-Pro-style multi-track timeline with real-time collab** (v3.1.1–v3.1.3)
- 3 tracks: shots / BGM / subtitle
- **Real BGM waveform** decoded via Web Audio API (not procedural)
- **Drag-to-retime + edge handles** to resize duration
- **Auto-snap to neighbors** within 0.4s threshold + hard-clamp on overlap
- **Real-time multiplayer**: Yjs awareness paints other users' cursors live, presence avatars show which tab each collaborator is in, Y.Map locks prevent two people editing the same segment
- **Project invites** with viewer/commenter/editor role gating

### 7. **Lipsync that actually works** (zh / en; needs a public video URL + audio ≥ 2s)
Kling lip-sync API for talking heads, with Sync.so and Hailuo as auto-fallback. The pipeline strips dialogue from the prompt so the model only generates lip *motion*; we then sync the lips to the TTS audio in post. **Real-machine limits:** dialogue audio must be ≥ 2 seconds and the source video must be reachable at a public URL; ja/ko/ru currently degrade to no lip-sync (honest skip, surfaced in the engine-weather panel).

### 8. **Conflict / reversal / cliffhanger pacing audit — v2** (v2.21 P1.1 → v12.275)
After Writer finishes, we score each shot 0-10 on a Chinese-conflict-word dictionary + detect emotional polarity reversals + cliffhanger keywords.

**v12.275 turned scoring into diagnosis.** An average score hides the difference between a story that *builds* and one that peaks in shot 1 — `[1,2,4,9]` and `[9,4,2,1]` both average 4. So v2 adds four things the average cannot see:

- **Conflict-curve shape** — least-squares slope + peak position + peak prominence, classified as `escalating` / `flat` / `front-loaded` / `no-climax`.
- **Drag-segment localisation** — names the exact shot range (e.g. "shots 3–5") where conflict flatlines, instead of reporting one global number.
- **Opening density** — the first third is audited separately, because completion rate is decided there.
- **Duration rhythm** — v1 never looked at `duration`; v2 flags both uniform-length monotony and long-take pile-ups.

Every finding points at the shots to change. All pure functions over existing fields — **no extra LLM calls, no added cost**.

### 9. **Bring Your Own LLM** (v3.1.3)
Every text-LLM call (Director / Writer / Vision / Audit) goes through one OpenAI-compatible `chat/completions` endpoint. Want to swap to DeepSeek-r1 / GPT-4o / Claude (via OpenRouter) / Qwen-Max / local Ollama? **Edit 3 lines in `.env`. Zero code change.** See [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md) for the full matrix.

### 10. **4849 tests, TypeScript strict, no fake "coming soon"s**
Every feature listed above is in `main`, type-checked, unit-tested, and visible at `/projects/[id]` if you `npm install && npm run dev` right now.

---

## 🥊 vs. competitors

> 阵容核验 **2026-08-07**(Artificial Analysis 盲投竞技场,榜单数值经独立二次检索复核):**两周内又出两个重量级新品**。**① MiniMax H3(Hailuo 3.0)**:7-31 发布、**8-03 开放权重**(HuggingFace;授权排除美/欧/英/韩),33B 全模态单次生成、2K/24fps、原生立体声,**空降 T2V 带音频榜次席(Elo 1238)、I2V 第三(1190),并拿下「视频编辑(带音频)」榜首**。**② 字节 Seedance 2.5**:7-31 公开发布,**单次原生 30 秒**(当前最长)、原生 4K 10bit、最多 **50 个参考输入**、支持区域编辑。
> **当前榜单** —— 带音频文生视频:Gemini Omni Flash(1244)→ **MiniMax H3(1238)** → Seedance 2.0 720p(1224)→ Wan 2.7(1161)→ HappyHorse-1.1(1148);带音频图生视频:**Seedance 2.0 720p(1198)** → Gemini Omni Flash(1191)→ MiniMax H3(1190)→ Grok Imagine 1.5(1114)→ HappyHorse-1.1(1111)。**Veo 3.1** 仍是画质/物理的企业安全牌(2025-10-15 公开预览,2026-01-13 更新加 4K 与原生 9:16 竖版;8s/次、可链式拼至 ~148s;$0.40/s 720p–1080p、4K $0.60/s、Fast $0.15/s);**Kling 3.0** 是短剧综合首选 —— **原生最高 4K / 最高 60fps / 最长 15s、最多 6 个连贯镜头,且自带原生音频**(中/英/日/韩/西 多语对白 + 口型同步),API 约 $0.084–0.112/s;**Wan 2.7** 是最便宜的带音频 API($0.10/s)。**⚠️ Sora 2 距 API 停服仅剩约 6 周(2026-09-24,消费端已于 4-26 下线),仍在其上开发的项目须立即迁移。**
>
> <sub>*本段 8 条高风险数值经独立二次检索复核,**4 条被推翻并已按订正值写入**(Kling 3.0 曾被误记为「1080p/10s/无原生音频」、Veo 3.1 发布日、Runway Gen-4.5 发布日、Gemini Omni Flash 定价)。榜单 Elo 为 2026-08-07 快照,随投票持续变动。*</sub>
> **⭐ BYO 架构再次接住这波**:榜上模型基本都开放 API,填 key 即成为本管线可调度的引擎 —— **竞品越强,本管线越强**。

> **🔴 首个同构开源竞品出现,「开源」不再是差异点本身。** 港大 **ViMax**(MIT,5.6k★,12 个专职 Agent:编剧/分镜师/角色提取/参考图选择 → 端到端出片)已覆盖「剧本→分镜→角色→视频」主干;另有 **OpenMontage**(24k★,MIT)以 Agent 技能包形式覆盖研究→脚本→资产→剪辑,但**无独立 UI**(依附 Claude Code/Cursor 等编程环境)。**诚实结论:差异化必须从「开源」下沉到「开源 + 制作层纵深」** —— 经逐项核对,ViMax **无配音/TTS、无节奏审计、无 EDL/AAF 剪辑线导出、无团队协作**;OpenMontage 无产品 UI、无原生角色一致性。**截至 2026-08,全部已查竞品(含闭源 SaaS)中,没有任何一个同时具备「节奏审计 + EDL/AAF 剪辑线导出 + 开源自托管」三项** —— 这才是当下真实的护城河边界。
> **v12.214→244 双线推进**。**产品层**:GPT Image / Nano Banana(Gemini)接入插件式图像 provider 链(issue #11,社区 @flobo3 提议,`OPENAI_IMAGE_ENABLED` / `GEMINI_API_KEY` 门控、原生 i2i 接角色一致性契约);**多集连续生成补上「剧情记忆」**(第 N 集 Writer 注入前几集前情提要 + 承接纪律,对标红果/阅文的 60~100 集连续,此前各集独立成篇)。**平台/工程层**:六轮独立对抗复检把安全洞从 CRITICAL 到 LOW 全清(SSRF 逐跳重验重定向 + IPv6 全隧道变体 / serve-file 签名能力 URL / WebSocket 鉴权 / 预算护栏),并把反复踩的「改了守卫却没跟到消费方」这个病**固化成 CI 入库门禁**(`npm run gate:consumer`,零容忍,上线即抓到 2 个人肉复检漏掉的真 SSRF)。
> 结论不变:**生成层已是红海(竞品在出片/多镜/音频都第一梯队),Wind Comic 护城河收窄到「制作/平台层」**——节奏审计、智能剪辑、字幕烧入、协作、自托管、开源、BYO。

| Capability | Veo 3.1 | Kling 3.0 | Seedance 2.5 | Gemini Omni Flash | MiniMax H3 | ViMax (open-source) | **Wind Comic** |
|---|---|---|---|---|---|---|---|
| Multi-shot story from one prompt | ⚠️ | ✅ storyboard mode | ✅ multi-shot native, 30s single take | ⚠️(单段生成,多镜叙事非强项) | ⚠️ (4~15s single take) | ✅ 12-agent script→video | **✅ 8-agent script→edit pipeline** |
| Character consistency across shots | ✅ | ✅ | ✅ up to 50 reference inputs | ✅ 多模态统一 | ✅ reference-to-video | ✅ character extractor agent | **✅ cref + sref + 8-dim DNA + vision retry** |
| Style coherence locked | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | **✅ Style Bible Frame** |
| Native dialogue + SFX audio | ✅ | ✅ 多语对白+口型 | ✅ | ✅ 4 模态原生一体 | ✅ 原生立体声 | ❌ 无配音模块 | **✅ per-character TTS + lip-sync** |
| Real CJK subtitles (burned-in) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ libass + open-license CJK font burn** |
| Vertical drama tropes | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 12 templates + 9:16 default** |
| Real-time multiplayer timeline | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Yjs CRDT + Y.Map locks + cursors** |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ⚠️ 权重开放(排除美/欧/英/韩) | ✅ 本地部署 | **✅ Next.js + SQLite/Postgres** |
| BYO LLM (OpenAI / Claude / DeepSeek / local) | ❌ | ❌ | ❌ | ❌(它自己就是模型) | ❌ | ⚠️ 需改代码 | **✅ 12+ providers via .env** |
| Open source | ❌ | ❌ | ❌ | ❌ | ⚠️ 权重部分开放 | ✅ MIT | **✅ MIT** |
| Per-shot regenerate with custom prompt | ⚠️ | ✅ | ⚠️ | ✅ motion brush | ✅ 对话式迭代编辑(招牌能力) | ✅ video-edit 端点 | **✅ + reference image upload** |
| Pacing / conflict audit | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ v2 (v12.275): shot score + reversal detection **plus** conflict-curve shape (escalating / flat / front-loaded / no-climax), drag-segment localisation to exact shot ranges, opening-density check, and duration-rhythm analysis — every finding names the shots to fix** |
| Smart editing (beat-snap + emotion pacing + one-instruction style) | ❌ | ❌ | ❌ | ❌ | ⚠️(对话式改片,非结构化卡点/情绪剪辑) | ❌ | **✅ beat-snap · emotion pacing · emphasis · transition aesthetics · "fast & hype/slow & lyrical" in one line (BYO LLM)** |
| First+last frame lock (image_tail cut-to-cut coherence) | ❌ | ✅ | ✅ | ⚠️ | ✅ (I2V) | ❌ | **✅ Kling FLF wired into main pipeline, per-shot tail-frame picker** |
| Multi-character face cast library (post-build editable) | ❌ | ✅ 主体库 | ✅ 角色管理 | ⚠️ | ⚠️ | ❌ | **✅ 3-slot cast + cross-shot subject_reference injection** |
| One-click localization (script + re-voice) | ❌ | ⚠️ dub only | ❌ | ❌ | ❌ | ❌ | **✅ 8-lang translate → apply → re-TTS, honest degradation** |
| Royalty-free AI BGM per story | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ MiniMax music-2.6, style-prompt → project BGM** |
| Per-shot auditable decision log (engine/cost/consistency) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ decision log + cost drill-down + quality score** |
| Emotion-aware TTS (mapped to native enum) | ⚠️ | ⚠️ | ⚠️ | ❌ | ⚠️ | ❌ | **✅ CN emotion → MiniMax speech-2.8-hd enum, live A/B verified** |
| Lip-sync wired into pipeline (auto per dialogue shot) | ✅ | ✅ | ⚠️ | ⚠️ | ✅ 原生 | ❌ | **⚠️ Kling lip-sync — zh/en only (needs public video URL + audio ≥2s); ja/ko/ru degrade to none; honest skip on non-face** |
| Full-app i18n (zh/en/ja/ko/ru, all UI) | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌(是模型不是 app) | ❌ | **✅ 5-language core UI, ~400 keys (component-level string cleanup ongoing)** |

> Cells marked ⚠️ = the feature exists but in a limited / locked-down form (e.g. "you can only do this on a paid Pro tier through a UI panel").

---

## 💰 市场与商业价值(核验 2026-08-07)

> 本节数据全部来自联网检索(艾媒、DataEye、克劳锐、前瞻、新华网、广电总局公开文件等),**含对本项目不利的事实**。我们认为写清楚赛道的真实经济结构,比堆一个漂亮的 TAM 更有用。

### 赛道体量

| 指标 | 数值 | 口径 |
|---|---|---|
| 中国微短剧市场 | **2025 年破 1000 亿元**(2024 为 504 亿,+35%) | 全年产值 |
| 2026 预测 | 约 **1200 亿元**,月活维持 7.18 亿量级 | 多家机构一致预测 |
| **AI 漫剧细分** | **2025 年 189.8 亿元,同比 +276%**;2030E 破 850 亿 | 艾媒咨询 |
| AI 渗透率 | **2026 Q1 新上线 12.8 万部中约 12.2 万部有 AI 参与(>95%)** | AI 已是默认生产方式 |
| 出海 | 2025 产值约 **$40 亿**,海外 App 双端内购 **$20.3 亿(+115%)**;中国玩家占全球约 80% | ReelShort $4.32 亿 / DramaBox 约 $3.7 亿 |

### 降本:本管线对标的传统成本

| | 传统真人微短剧 | AI 管线 |
|---|---|---|
| 单部成本 | **30–150 万元**(精品 150–300 万) | **2–30 万元**(纯 AI 漫剧 2–10 万) |
| 周期 | 15–30 天 | 1–30 天 |
| 团队 | 40 人以上剧组 | 3–10 人 |
| 每分钟成本 | 约 1 万元 | **100–4000 元** |

**综合降本 80–90%。** 极端案例《安徽小木匠》制作成本 2900 元、收益约 50 万元(ROI ≈ 170 倍)。

### ⚠️ 但必须说清楚的三件事(这决定了本项目该卖什么)

**① 制作只占总成本 7.5%,投流占 70–85%。** 前瞻网口径:平台广告投放 82.5%、制作 7.5%、演员 5%、剧本 1.5%。**这意味着「把制作成本再砍一半」对项目盈亏几乎无影响** —— 任何以「更便宜地出片」为唯一卖点的工具,价值天花板极低。

**② 单位经济已经很薄。** CPM 从 2025 下半年约 60 元/千次跌到 **2026 年 15–30 元**;标准 ROI 仅 **1.03–1.07**(东南亚出海较优,1.2–1.5)。**约 90% 的 AI 短剧公司处于亏损**,AI 漫剧爆款率不足 **0.1%**,头部 5% 项目吞掉 70% 行业利润。

**③ 平台正在给「纯 AI 生成」降权。** 2026 年抖音/爱奇艺/腾讯视频推出分级分账新政,**削减无真人出镜的全 AI 短剧保底资源**,转而扶持「真人 + AI 协作」。

### 于是,本项目的价值主张必须是这三条(而不是「省钱」)

1. **拉高成品率与质量下限,去够那 <0.1% 的爆款率。** 节奏/冲突审计、逐镜 Vision 质检与自动重生、角色一致性(DNA + 嵌入余弦)、发布预检 —— 都是在**减少废片**,而废片率才是这门生意的真实杀手。
2. **能交付进专业剪辑线,支撑平台正在扶持的「真人+AI 协作」。** EDL / FCPXML / **真二进制 AAF**(MS-CFB,给 Avid)导出 —— AI 出的素材可以进人类剪辑师的工程,而不是只能整片直出。**这是当前全部已查竞品的共同空白。**
3. **自托管 + 开源 + BYO key,服务 B 端代工与品牌定制。** 行业正从 C 端投流转向文旅/品牌定制 B 单(客单价数十万至百万级),这类客户对**数据不出私域**与**成本可控**有硬要求 —— 闭源 SaaS 天然做不到。

### 🚨 合规:2026-09-01 起的硬门槛(距今不足 1 个月)

广电总局《微短剧发展管理办法》**2026 年 9 月 1 日施行**:

- AI 生成/辅助制作的微短剧,须在**每集显著位置**标注「AI创作」或「AI辅助制作」,**字体不得模糊缩小**;
- 视频**元数据须嵌入 AI 生成溯源信息**;
- **三级分类备案** —— 一/二级须播出前取得省级及以上审核许可,无备案不得发行、不得参评。

> **本项目当前状态(诚实披露)**:该办法约束的是**内容播出/发行方**,不是开源工具本身;本项目不运营内容,故不直接适用。工具侧已提供的手段:v12.222 的抖音直发强标 `aigc_info` + 出海打包结构化 AI 声明(未确认即 422)+ 成片角标(`AI_WATERMARK=1` 开启,文本可用 `AI_WATERMARK_TEXT` 覆盖为「AI创作」)。**尚未提供**:视频元数据溯源字段写入。**若你要把成片投放到中国大陆平台,请自行开启角标并按平台要求完成备案与标识** —— 合规责任在运营者一侧。

---

## 🆕 New in v11 → v12 — pull-replicate, smart editing & management

Real puppeteer captures of the running app (`node scripts/capture-v12.mjs`). 核心迭代:

- **阶段十九 AI 拉片复刻(v11.1.x)**:拉片五栏真值表(出厂参数,非 AI 看图猜)· 外部视频 ffmpeg 拆条 + BYO Vision 打标 · 替换工作台(「全员换猫」级全局替换)+ 复刻起片(保原片镜头结构/时长)· 复刻保真度对照 · 存为私有模板。
- **项目/资产管理(v11.2.0)**:我的项目 / 我的资产 删除 + 下架(级联清理 + 属主守卫)。
- **模型雷达(v10.6.3)**:一键扫描各 API 最新模型 + 同家族自动升级(四护栏 + 回滚)。
- **钩子审计三指标(v10.6.2)**:开场 3 秒钩子 / 集尾悬念 / BGM 卡点对齐率。
- **阶段二十 A 智能剪辑(v12.0.x,五刀全交付)**:卡点剪辑(切点吸附音乐拍点)· 情绪节奏曲线(峰值镜 breathe / 动作镜快切)· 侧重强调(关键镜不压 + 沉稳转场)· 转场审美(按镜头关系选转场)· **一句指令调风格(v12.0.4,BYO)**——「快节奏燃向」/「慢叙抒情」一句话调 pacing 力度 + 转场软硬,无 key 走规则、配 key LLM 解析自由文本。
- **阶段二十 B 预览音频(v12.1.x)**:片段预览叠播配音(静音裸片 + 同步配音轨)+ 成片音频体检自愈(ffprobe 缺流补轨)。
- **阶段二十一 角色/资产一致性升级 · 全局资产记忆库 v2(v12.2.x,五刀全交付)**:对标同构竞品 OiiOii「角色高维特征向量 + 跨场景一致性」——名称归一修 DNA 漏注入 · DNA/场景锚落库(rerun/重启复用、早镜不漏) · **给 `global_assets.embedding` 死列通电**(BYO 文本嵌入 + 内存余弦检索) · 建角色入口「相似角色」推荐一键复用(防重复建/跨集漂移) · **身份漂移检测**(逐镜视觉 embedding 余弦距离标 outlier 漂移镜)。全程**无 key 走确定性地板(精确名+文本匹配),有 key 向量增强**,诚实降级。
- **安全加固(v11.1.4)**:JWT 公开兜底密钥根除(进程级随机密钥,旧泄露值作废)。

| 我的项目 · 删除/下架管理 | 拉片表 + 复刻工作台 |
|---|---|
| ![我的项目](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/01-my-projects-manage.jpg) | ![拉片](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/04-pull-sheet-replicate.jpg) |

| 素材库 · 资产管理 | API 健康 · 模型雷达 |
|---|---|
| ![素材库](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/02-my-assets-manage.jpg) | ![模型雷达](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/03-api-health-model-radar.jpg) |

| 钩子审计三指标 | 一句指令调剪辑风格(v12.0.4) |
|---|---|
| ![钩子审计](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/05-pacing-hook-audit.jpg) | ![剪辑风格](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/06-edit-style-instruction.jpg) |

| 片段预览音频:三态徽章 + 带声试听(v12.1.2) | |
|---|---|
| ![片段音频预览](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/screenshots/v12/07-clip-audio-preview.jpg) | 左:带配音(TTS 叠层)+ 带声试听开关 · 右:片段无独立音轨(成片含配乐+配音) |

完整逐版本核心迭代见 [`VERSIONS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/VERSIONS.md);阶段计划见 `docs/stage18`–`docs/stage20`。

---

## 🎬 Screenshots

Below is the **foundational v3 pipeline** (the v6 studio screens are in the [New in v6](#-new-in-v6--from-demo-to-studio) section above). Every panel is **a real puppeteer capture of the running app** (run `node scripts/capture-screenshots.mjs` / `node scripts/capture-v6.mjs` to refresh).

### Workspace overview
The 创作总览 dashboard: 99 projects + 4 case studies + recent activity feed + system status (engines in use, model versions).
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-dashboard-v3.1.3.jpg" width="100%" /></p>

### Asset library
Cross-project reusable: 角色 / 场景 / 视频 / 音乐 / 字幕 / 模板 — 1467 assets in this demo project.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-assets-v3.1.3.jpg" width="100%" /></p>

### Project library
Every short film with auto-generated cinematic covers + status badges + quality donut.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-projects-v3.1.3.jpg" width="100%" /></p>

### Creation workspace — live multi-agent canvas
The whole pipeline as a live agent flow: Writer / Character Designer / Scene Designer / Storyboard Artist / Video Producer / Editor nodes wired together with progress streaming per node, plus a chat side-rail showing every agent message in real time.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v8/creation-canvas.jpg" width="100%" /></p>

### Per-project script + shot list with beats
The 剧本 tab: every shot with duration, emotion tag (警觉 / 凝重 / 惊恐 / 暴风的沉着 / 镇定的专注…) and a one-line **beat note** (从表面到深层警觉 / 从无知到悉知威胁 / 从警戒到遭受袭击 …) so the rhythm of the cut is legible at a glance.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/v8/script-shotlist.jpg" width="100%" /></p>

### 🆕 Cinema Timeline (v3.1.1–v3.1.3 — multi-track + collab)
3-track layout (SHOTS / BGM / SUBTITLE), drag-to-retime, double-click subtitles to rewrite, drag edges to resize, **real BGM waveform** (Web Audio decode), live other-user cursors with name labels, segment lock indicators.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-cinema-timeline-v3.1.3.jpg" width="100%" /></p>

### 🆕 Pacing Analysis (v2.21 P1.4)
KPI: 平均冲突分 / 反转数 / 通过状态. Per-shot conflict-score bar chart with reversal arrows + emotional polarity icons. Color-coded green (≥7) / amber (4-6) / red (<4). Below: actionable warnings + suggestions.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-pacing-v3.1.3.jpg" width="100%" /></p>

### 🆕 Comments + @mentions (v3.0 P0.1)
Project-level + per-shot threaded comments with @-autocomplete and notification bell. Each shot collapses for context.
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-comments-v3.1.3.jpg" width="100%" /></p>

### 🆕 Shot Workshop (v2.16 P1.4 + v2.23 P0.2)
Per-shot "改 prompt 重生" (regenerate image with custom prompt + reference image upload) and "4K 重渲" (Kling Master 4K re-render, plan-gated).
<p align="center"><img src="https://modelscope.cn/models/haozi667788/wind-comic/resolve/master/assets/screenshot-workshop-v3.1.3.jpg" width="100%" /></p>

---

## 🛠️ What's in the box

| | What it does | Where it lives |
|---|---|---|
| **Multi-agent pipeline** | Director / Writer / Char Designer / Storyboard / Editor — 8 agents | `services/hybrid-orchestrator.ts` |
| **Style Bible Frame** | One canonical key-art frame locks visual identity across all shots | `lib/style-bible.ts` |
| **Character DNA** | 8-dim vision-extracted character signature + per-shot prompt injection | `lib/character-dna.ts` |
| **Style Vision Audit** | Auto-regen any shot scoring <70 on palette/lighting/colorTemp/texture | `lib/style-audit.ts` |
| **Cameo Vision Retry** | Auto-regen any shot scoring <75 on character resemblance | `services/cameo-retry.ts` |
| **Pacing Audit** | Conflict-score / reversal-detect / cliffhanger per Chinese drama tropes | `lib/pacing-audit.ts` |
| **Drama Tropes** | 12 vertical-drama hook templates + 9:16 default + reversal density rules | `lib/drama-tropes.ts` |
| **CJK Subtitle Burner** | ffmpeg libass with system CJK font discovery | `lib/text-control.ts` + `services/video-composer.ts` |
| **Multi-track Timeline** | 3 tracks, drag/resize/snap/auto-collide, BGM waveform | `components/project/cinema-timeline.tsx` + `lib/timeline-tracks.ts` |
| **Real-time collab** | Yjs CRDT + WS server + presence + cursors + segment locks | `scripts/ws-server.mjs` + `hooks/use-yjs.ts` + `hooks/use-segment-locks.ts` |
| **Project invites** | viewer/commenter/editor role + token expiry + revoke | `lib/project-share.ts` |
| **Comments + @mentions** | Threaded comments, @-autocomplete, mention notifications | `lib/comments.ts` + `lib/notifications.ts` |
| **Lipsync** | Kling / Sync.so / Hailuo auto-select, fail-safe fallback | `services/lipsync.service.ts` |
| **Plan-gate billing** | Per-engine plan checks (Vidu Q3 = enterprise, etc.) | `lib/plan-gate.ts` |
| **API quota tracker** | Per-provider failure tracking + dashboard banner | `lib/api-usage-tracker.ts` |
| **18 project templates** | 霸总/重生/穿越/古装/科幻/儿童/纪实/恐怖/喜剧 etc. | `lib/story-templates.ts` |
| **BYO LLM docs** | 12-provider config matrix, 0-code swap | `docs/llm-providers.md` |
| 🆕 **Character Studio** | Multi-view turnaround + DNA lock + auto-bound voice + bio | `lib/character-studio.ts` |
| 🆕 **Prompt Workbench** | `@`-mention assets, autocomplete, compile-preview, readiness score | `lib/prompt-ide.ts` + `components/prompt-editor.tsx` |
| 🆕 **Long-form Intake** | Novel→episodes + narration modes + real TTS + season parallel | `lib/story-intake.ts` + `lib/narration-synth.ts` + `lib/season-orchestrator.ts` |
| 🆕 **Style Gallery** | 60 presets, 5 categories, one-click apply | `lib/style-presets.ts` + `app/dashboard/styles` |
| 🆕 **Director Console** | 4-stage pipeline model + stale detection + single-stage rerun | `lib/pipeline-stages.ts` + `components/director-console.tsx` |
| 🆕 **Team Workspace** | Credit pool + per-member allocations + RBAC + real invites | `lib/team-credits.ts` + `lib/team-invite.ts` |
| 🆕 **Postgres cutover (v9)** | SQLite↔PG dual-driver; **all write paths on async repos** (project_assets/projects/users/notifications/comments cleared), tx commit+rollback verified, `DB_DRIVER=pg` opt-in | `lib/db-driver.ts` + `lib/repos/*` + `scripts/pg-migrate.ts` |
| 🆕 **API Health Board** | Live model/gateway status + balance + out-of-credits detection | `lib/provider-health.ts` + `app/dashboard/health` |

---

## 🔀 Gateway routing — default model map *(matches current `lib/config.ts`)*

Every model call is provider-pluggable (priority chain + automatic fallback). Creative and high-frequency LLM traffic are split across two model tiers, and **MiniMax is always the last-resort fallback** on any error / out-of-credits / timeout:

| Capability | Default model (env override) | Supplement / fallback |
|---|---|---|
| **Creative LLM** (writer / director) | `deepseek-v4-pro` (`OPENAI_CREATIVE_MODEL`) + `deepseek-v4-flash` fast tier for drafts/polish | `MiniMax-M2.7` (`LLM_FALLBACK_MODEL`) |
| **General LLM** (planning / validation / Vision-Audit) | `claude-sonnet-4-6` (`OPENAI_MODEL`) | `MiniMax-M2.7` |
| **Video** | `veo3.1-pro` (`VEO_MODEL`) | `veo3.1` · Kling → **MiniMax Hailuo** (Sora-2 retired — API EOL 2026-09-24) |
| **Image** | `flux.1-kontext-pro` (`IMAGE_MODEL`) | Midjourney (`mj_imagine`) · fal FLUX Kontext · local ComfyUI → **MiniMax image** |
| **TTS / voiceover** | `gpt-4o-mini-tts` (`VE_TTS_MODEL`) | MiniMax T2A (`speech-02-hd`) |
| **Music / BGM** | MiniMax music | (Suno when gateway channel available) |

- **Why two LLM tiers**: the creative tier (DeepSeek `-pro`, a reasoning model) carries writer/director quality work; the general tier (Claude `sonnet-4-6`) handles high-frequency planning / validation / Vision-Audit; the `-flash` tier keeps draft-compare & basic polish at sub-second latency.
- **MiniMax safety net**: any primary LLM / video / image failure auto-routes to MiniMax (OpenAI-compatible) — surfaced live on the **API Health Board** (正常 / 额度用尽 / 配置缺失 / 不可达).
- **Swap anything** in `.env.local` (`OPENAI_*` / `OPENAI_CREATIVE_*` / `VEO_*` / `IMAGE_MODEL` / `VE_TTS_MODEL` / `MINIMAX_*`) — zero code change. See [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md).

---

## 🏁 Quick start

```bash
# 1. clone + install
git clone https://github.com/ChrisChen667788/wind-comic.git
cd wind-comic
npm install

# 2. configure (3 mandatory lines, see docs/llm-providers.md for swaps)
cp .env.example .env.local
# Edit .env.local:
#   OPENAI_API_KEY=sk-...
#   OPENAI_BASE_URL=https://api.openai.com/v1     # or any compat provider
#   OPENAI_MODEL=gpt-4o                            # or claude-opus-4 via OpenRouter, etc.

# 3. run
npm run dev                # Next.js on :3000
# Optional second terminal for real-time collab:
npm run dev:ws             # Yjs WebSocket server on :1234

# 4. open http://localhost:3000 and create your first short film
```

**Minimum LLM**: any model ≥24B parameters that responds in JSON. We've tested gpt-4o, Claude Opus 4, DeepSeek-r1, Qwen-Max, MiniMax-M2, GLM-4.5, Kimi-K2.

**Optional engines** (graceful fallback when missing):
- `MINIMAX_API_KEY` — image-01 / Hailuo-2.3 video / speech-2.8-hd TTS / music-2.6 BGM
- `KELING_API_KEY` — Kling Master 4K + first-last-frame fusion + lip-sync
- `HAPPYHORSE_API_KEY` (or reuse `VECTORENGINE_API_KEY`) — **HappyHorse 1.1** (Alibaba). Joint video+audio in a single pass; top-5 on both Artificial Analysis boards. Enable by listing it in `VIDEO_ENGINE_ORDER` (it is **not** in the default chain, so adding the key alone changes nothing for existing users). Live-verified 2026-08-07: 1080p h264 + aac, ~170s for a 3s clip. **Fixed in v12.295 — we had been sending a field that does not exist.** From v12.272 we passed `size: '9:16'`; the upstream has **no `size` parameter at all**, and it silently ignores fields it does not recognise, so every clip came back in the default 16:9. (A deliberately bogus `size` still returns HTTP 200 and creates a task — that is how the silent-fallback was proven.) Per Alibaba's own [HappyHorse text-to-video reference](https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference), the real fields are `ratio` (`16:9` default, `9:16`, `1:1`, `4:3`, `3:4`, `4:5`, `5:4`, `9:21`, `21:9`), `resolution` (`480P`/`720P`/`1080P`), `duration`, `watermark` and `seed`. The `usage` block the API returns — `{"SR": 1080, "ratio": "16:9"}` — is simply an echo of those two, which had been in plain sight all along. **Also fixed:** `watermark` defaults to **true** upstream, so every HappyHorse clip carried a bottom-right "Happy Horse" watermark; it is now off by default (`HAPPYHORSE_WATERMARK=1` restores it). Vertical is no longer gated off, but every finished task still cross-checks `usage.ratio`, and a mismatch disables that ratio for the rest of the run instead of burning shot after shot. Tune with `HAPPYHORSE_RESOLUTION` / `HAPPYHORSE_SEED`; `HAPPYHORSE_SIZE` is deprecated and ignored.
- `VIDU_API_KEY` — Vidu Q3 (long-form 16s clips)
- `VEO_API_KEY` — Veo 3.1-fast video fallback
- `GROK_API_KEY` — xAI Grok Imagine 1.5 (T2V/I2V, native audio; BYO — 2026-06 image-to-video #1; auto-preferred when set)
- `JIMENG_AK` / `JIMENG_SK` — ByteDance Seedance 2.0 (火山引擎 CV; multi-ref + native A/V; 2026-06 text-to-video #3; BYO)
- `LTX_API_KEY` (or `FAL_KEY`) — LTX-2.3 (Lightricks open-weight #2 text-to-video; **self-hostable** via `LTX_BASE_URL`; BYO)
- `GEN_CONCURRENCY` / `GEN_CONCURRENCY_VIDEO` · `_STORYBOARD` · `_SCENE` — per-stage generation concurrency (default 2, max 8). ⚠️ Higher *video* concurrency is faster but weakens keyframe-chain continuity (shot N pulls shot N-1's last frame) — keep low (1–2) when cross-shot 衔接 matters.
- `SYNCSO_API_KEY` / `HAILUO_API_KEY` — alternative lip-sync providers

---

## 🤝 Contributing

We're open to PRs. Two things matter most:
1. **Don't break the multi-agent contracts.** Each agent has explicit input/output shapes — see `types/agents.ts`.
2. **Tests gate everything.** Vitest 4849/4849 must stay green. Add tests for new lib/service files.

See [`CONTRIBUTING.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/CONTRIBUTING.md) for the repo's contribution guide.

---

## 📚 Docs

- [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md) — Swap LLM provider in 3 env vars
- [`docs/SCREENSHOTS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/SCREENSHOTS.md) — Module-by-module screenshot manifest
- [`docs/MARKETING-en.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-en.md) · [`docs/MARKETING-zh.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-zh.md) — Pitch deck copy
- [`ROADMAP.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/ROADMAP.md) — Full sprint-by-sprint changelog (v2.10 → v9.2.0) · [`VERSIONS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/VERSIONS.md) — version history table
- [`docs/COMPETITIVE-GAP-2026-05.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/COMPETITIVE-GAP-2026-05.md) — Honest analysis vs Sora/Kling/Vidu/Higgsfield

---

## 📄 License

MIT. Use it, fork it, build a startup on it. We just ask: if you ship a feature on top, send a PR back.

### ⚠️ Redistribution notice — bundled binaries are not all MIT

**Wind Comic's own source is MIT.** But three npm dependencies ship pre-built binaries under copyleft licenses. This does **not** affect the MIT status of this repository, and it does not affect you if you simply run or fork the source. It **does** matter the moment you redistribute a bundle that embeds those binaries (a Docker image, a desktop build, a hosted appliance you hand to a customer):

| Dependency | License | What you must do when redistributing a bundle |
|---|---|---|
| `ffmpeg-static` | **GPL-3.0-or-later** | **Strongest constraint.** Ship the GPL-3 text and a written offer for the corresponding FFmpeg source — or drop the dependency and point `FFMPEG_PATH` at a system ffmpeg you obtained separately. |
| `lightningcss` (+ platform binaries) | MPL-2.0 | File-level weak copyleft. Unmodified use/redistribution carries no extra duty; only if you modify its MPL-licensed files must you publish those files. |
| `@img/sharp-libvips-*` | LGPL-3.0-or-later | Dynamic linking does not infect your code. On redistribution you must let end users replace/relink the library and point them to its source. |

CI enforces this: [`scripts/license-check.mjs`](https://github.com/ChrisChen667788/wind-comic/blob/main/scripts/license-check.mjs) scans the **production** dependency tree every run and **fails the build** if a copyleft dependency appears that is not registered in the table above — so a new GPL dependency can never slip in unnoticed.

---

## 🙏 Acknowledgements

Wind Comic stands on a lot of excellent open-source work:

- **App & UI** — [Next.js](https://nextjs.org) (App Router + Turbopack) · [React 19](https://react.dev) · [Tailwind CSS v4](https://tailwindcss.com) · [Radix UI](https://www.radix-ui.com) · [Phosphor Icons](https://phosphoricons.com) + [Lucide](https://lucide.dev) · [Framer Motion](https://www.framer.com/motion/) · [React Flow](https://reactflow.dev) for the agent-workflow DAG
- **Realtime & data** — [Yjs](https://github.com/yjs/yjs) + [y-websocket](https://github.com/yjs/y-websocket) for **CRDT** real-time collaboration · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [node-postgres](https://node-postgres.com) for the dual-driver persistence layer
- **Media & export** — [FFmpeg](https://ffmpeg.org) via [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) (CJK subtitle burn / audio mux) · pro NLE interchange through CMX3600 **EDL** · FCP7 **XML** · **AAF** (a from-scratch MS-CFB Compound File Binary writer, no third-party lib)
- **Methods & algorithms** — Robert McKee story structure + Save-the-Cat 3-act beat analysis · **CRDT** (conflict-free replicated data types) for collaborative editing · `cref` / `sref` + 8-dimension character **DNA** for cross-shot identity consistency
- **Tooling** — [TypeScript](https://www.typescriptlang.org) (strict) · [Vitest](https://vitest.dev) · [Stripe](https://stripe.com) — and every creator whose real-world feedback shaped the pipeline.

### Community contributors

Features that exist because someone outside the team took the time to file a good report:

- **[@flobo3](https://github.com/flobo3)** — [#11](https://github.com/ChrisChen667788/wind-comic/issues/11): proposed **GPT Image** (`gpt-image-1`) and **Nano Banana** (Gemini Image) as first-class image providers, including the endpoints, the env-var naming, the "reuse the already-configured `OPENAI_API_KEY` to lower the barrier" idea, and the observation that Nano Banana's native i2i fits the existing character-consistency contract. Shipped in v12.247–v12.247 essentially as designed.
- **[@MikhailNikolaev44](https://github.com/MikhailNikolaev44)** — [#2](https://github.com/ChrisChen667788/wind-comic/issues/2): reported that selected characters were being ignored on shot regeneration, which uncovered **three** separate bugs in the reference-image path (v12.132–v12.134), plus the script-language selector request.
- **[@JSap0914](https://github.com/JSap0914)** — [#1](https://github.com/ChrisChen667788/wind-comic/pull/1): fixed broken README links.

Found something? Issues and PRs are genuinely read — several of the pipeline's sharpest fixes started as an outside bug report.

---

## ⭐ Star History

If Wind Comic saved you time, a star helps other creators find it.

<a href="https://github.com/ChrisChen667788/wind-comic/stargazers">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/star-history-dark.svg" />
    <img alt="Star history of ChrisChen667788/wind-comic" src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/star-history-light.svg" width="800" />
  </picture>
</a>

<sub>Self-collected — GitHub [restricted the stargazers API](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views) to repo admins and collaborators on 2026-06-30, which broke every third-party star-history service. This chart is generated by [`scripts/gen-star-history.mjs`](https://github.com/ChrisChen667788/wind-comic/blob/main/scripts/gen-star-history.mjs) from this repo's own token and committed daily, so it depends on no outside service. Raw series: [`assets/star-history.json`](https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/star-history.json).</sub>

---

<p align="center">
  Built with ❤️ by people who believe AI-generated drama should feel like a show, not a tech demo.<br/>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers">⭐ Star us</a> if Wind Comic saved you a week.
</p>
