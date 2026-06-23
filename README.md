<p align="center">
  <img src="assets/banner.png" alt="Wind Comic — One line of text. One finished short drama." width="100%" />
</p>

<h1 align="center">🌬️ Wind Comic <sub><sup>v12.34</sup></sub></h1>

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
  <img src="https://img.shields.io/badge/Tests-2565%2F2565-2ea44f" alt="2565 tests passing" />
  <img src="https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="docs/MARKETING-en.md">🔥 Pitch</a> · <a href="docs/llm-providers.md">🔌 BYO LLM</a>
</p>

<p align="center">
  <a href="https://github.com/ChrisChen667788/wind-comic/raw/main/assets/promo/wind-comic-promo-en.mp4">
    <img src="assets/promo/wind-comic-promo.gif" alt="Wind Comic — 39-second promo (click to watch with voiceover &amp; sound)" width="100%" />
  </a>
</p>
<p align="center">
  ▶ <a href="https://github.com/ChrisChen667788/wind-comic/raw/main/assets/promo/wind-comic-promo-en.mp4"><b>Watch the full 39-second promo — with voiceover &amp; sound</b></a><br/>
  <sub>Real cinematic footage woven with motion-graphics · 8 distinct art styles · English narration · scored by the platform's own MiniMax music engine.</sub>
</p>

---

## ✨ Why Wind Comic?

Most "AI video" tools give you a 5-second clip from a one-line prompt. **Wind Comic gives you a finished short-form drama** — script, character bible, multi-shot storyboards, voice-acted lines, BGM, lip-synced talking heads, and a final mp4 — from the same single line.

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

<p align="center"><img src="assets/diagrams/architecture.svg" alt="Wind Comic system architecture — Next.js client · orchestration · 8-agent pipeline · LLM gateway · 12+ media engines · quality / data / realtime platform" width="100%" /></p>

<sub>**System architecture** — five layers, top to bottom. The **Director** threads control across all eight agents; the **LLM gateway** falls back DeepSeek → MiniMax with zero code change; **12+ media engines** plug in behind one router; everything lands on a **dual-driver** (SQLite ⇄ PostgreSQL) platform.</sub>

<p align="center"><img src="assets/diagrams/sequence.svg" alt="Sequence diagram — one idea to one finished film, with the Vision-Audit retry loop and multi-engine race" width="100%" /></p>

<sub>**Sequence** — the lifecycle of one *idea → film* request, time flowing down. Two signature beats: the **Vision-Audit retry loop** (auto-regenerate any shot scoring &lt; 70) and the **multi-engine race** (Seedance / Kling / Veo / Vidu — first good clip wins).</sub>

<p align="center"><img src="assets/diagrams/dataflow.svg" alt="Data-flow diagram — the artifact refinery from text to final.mp4, persisted to DbDriver and the asset store" width="100%" /></p>

<sub>**Data flow** — the artifact refinery. One line of text is refined stage-by-stage (`TEXT → JSON → PNG → IMG → MP4`); every artifact is persisted to the dual-driver DB + asset store and is independently reusable, so any stage can be re-run in isolation.</sub>

> 🎞️ Diagrams are **animated SVG, authored as code** in [`assets/diagrams/`](assets/diagrams/) — crisp at any zoom, versioned with the source. *(Animation renders on GitHub; the ModelScope mirror shows static PNG.)*

---

## 🆕 New in v6 → v10 — from *demo* to *production platform*

> v3 shipped the pipeline. **v6 turned it into a production studio; v7–v9 hardened it into a platform; v10 closed the lip-sync, template-market, and cost loops.** Reusable characters, a prompt IDE, novel→season auto-splitting with real voiceover, a 60-style gallery, a director's control room, team credit budgets, an industry-grade script audit (**Polish Pro**, v7.1), a **premium design pass** (v8.3), a **fully-migrated Postgres backend** (v9), a **lip-sync delivery pipeline + template market + cost observability** (v10), and a live API health board — every screen below is a **real capture of the running app**.

<p align="center">
  <img src="assets/v10/landing.png" alt="Wind Comic landing — 青枫漫剧 AI Animation Agent Studio, 8 agents · 7 engines · 3 consistency guards, looping cinematic hero" width="100%" />
  <br/><sub>v10 landing — looping cinematic hero, 8 collaborating agents · 7 media engines · 3 consistency guards.</sub>
</p>

### 🎙️ v10 — Lip-sync delivery · Template market · Cost guard *(Stage 16)*

- **🎙️ Voice & lip-sync, end-to-end** — per-character voice routing (auto by name + manual pick/audition) → TTS → **viseme keyframe track** → measured **mouth-vs-audio alignment score** (Web-Audio) → **drift auto-correct** → pluggable engine render (wav2lip / SadTalker / MuseTalk, BYO `LIPSYNC_API_URL`) → written back into the timeline. One-click **whole-film lip-sync** with a Vision **QC self-heal loop** (weak shots auto re-render).
- **🧩 Template market** — turn a hit project into a reusable template (style + multi-ref elements + pacing + **voices**), with a **preview clip**, **★ ratings & ♥ favorites**, quality score, and **one-click remix** that prefills a new project.
- **💴 Cost observability + budget guard** — per-project cost attribution by stage (LLM / image / video / TTS / lip-sync), saving hints, and an **ok/warn/over budget guard**. The **publish-readiness gate** is now four-dimensional: picture-vs-script · consistency · lip-sync alignability · **measured mouth-vs-audio**.

<table>
<tr>
<td width="50%"><img src="assets/v10/create.png" /><br/><sub><b>创作工坊</b> — one line → film: style presets · multi-ref element shelf · character lock · live preview · gold-neon genre gallery</sub></td>
<td width="50%"><img src="assets/v10/templates.png" /><br/><sub><b>模板市场</b> — preview clips · ★ ratings / ♥ favorites · quality score · one-click remix (carries voices)</sub></td>
</tr>
<tr>
<td width="50%"><img src="assets/v10/qc.png" /><br/><sub><b>成片质检 + 配音口型</b> — four-dimension publish gate · consistency trend · viseme track (animated mouth + measured alignment) · per-shot Vision scores</sub></td>
<td width="50%"><img src="assets/v10/cost.png" /><br/><sub><b>技术监看 · 成本归因</b> — per-stage cost share (video / image / LLM / TTS / lip-sync) + saving hints</sub></td>
</tr>
</table>

> Every screen above is a **real capture of the running v10 app**. Design language (v8.3 *Taste* pass — Plus Jakarta Sans + Phosphor icons, gold machined-bezel cards, spring motion, AI gold-neon genre emblems) carries across all of them.

> Notes are consolidated **per major version** — the full minor-by-minor changelog lives in [`VERSIONS.md`](VERSIONS.md) / [`ROADMAP.md`](ROADMAP.md).

| Major version | What landed |
|---|---|
| **v6 · Production studio** | **Character Studio** (reusable cast, multi-view turnaround + 8-field **DNA identity lock**, cross-project **Cameo IP**) · **Prompt Workbench** (`@`-mention assets + compile-preview + readiness score) · **Long-form Intake** (novel → chapter-aware episodes, **real TTS narration** + burned SRT, N-episode parallel) · 60-look **Style Gallery** · **Director Console** (4-stage pipeline, stale-detection, single-stage rerun) · **Team Workspace** (credit pool + RBAC + real invite links) · **API Health Board** (live gateway status + balance) · top-tier model repointing (`veo3.1-pro`) + supplement gateway backfilling TTS / Midjourney / Kling. |
| **v7 · Platform hardening** | Writer/Director on DeepSeek **`deepseek-v4-pro`** with a **universal MiniMax fallback** on any error / out-of-credits / timeout (3-tier LLM health board) · tiered models (**`deepseek-v4-flash`** for speed) that cured the reasoning-token instability · **Polish Studio Pro** — industry script audit: AIGC-readiness score, Save-the-Cat 3-act beat-gap detection, on-the-nose dialogue flags, per-character identity anchors. |
| **v8 · AI director station + premium design** | Per-shot **cinematography console** (景别/机位/镜头/运镜/焦点) + **continuity & seed lock** + emotion/rhythm curves + JSON↔visual **parameter linkage**, all converging into an **11-tab director station** · **Taste design pass**: Plus Jakarta Sans + Phosphor icons, gold machined-bezel cards, spring motion, an asymmetric **bento dashboard**, 60 AI-rendered **style thumbnails**, and AI **gold-neon genre icons** (18 templates + 5 modes + 8 looks). |
| **v9 · Postgres platform + monetization** | Full SQLite↔Postgres **dual-driver** cutover — **17 core tables/clusters** migrated to async repos, verified end-to-end on Postgres with **transaction commit + rollback** atomicity (default stays SQLite, same file, **zero split-brain**; `DB_DRIVER=pg` is opt-in) · multi-platform **distribution-pack** generator (抖音 / 快手 / 视频号 / 小红书 / YouTube Shorts / B站) · **real binary AAF export** (MS-CFB container, for Avid) alongside EDL / FCPXML · plus **quality & consistency depth** (publish-readiness gate, rebirth loop, consistency report) and the **Kling-style multi-reference + one-click film** fusion. |
| **v10 · Lip-sync delivery · template market · cost** *(Stage 16)* | **Voice & lip-sync end-to-end** — per-character voice routing (auto + manual audition), viseme keyframe track, measured **mouth-vs-audio alignment** + **drift auto-correct**, pluggable engine render (wav2lip/SadTalker/MuseTalk) **plus a zero-config built-in 2D engine that works out of the box (no BYO key)**, written **back into the timeline**, one-click whole-film with a Vision **QC self-heal** loop · **Template market** — save→rate/favorite→one-click remix (carries voices), preview clips, quality score · **Cost observability** — per-project stage attribution + **budget guard**, and a **four-dimension publish gate** (picture · consistency · lip-sync · measured alignment). **2135 tests** green on both drivers. |

### 📂 More modules — earlier (v6–v8) captures

> Features that still ship. **Director console · novel→season · finished-film station · team workspace · Cinema timeline are refreshed to v10** (live demo data). The **style gallery, API health board, Polish Pro audit, and character turnaround** are kept as earlier (v6–v8) captures because they show fuller sample output (the full style grid / live balances / a complete Pro audit / a 3-view turnaround sheet).

### 🎬 Director Console — the whole film as one control room *(v6.4)*
Every stage at a glance — what's ready, what's gone stale because you changed something upstream, and a one-click rerun that knows exactly which downstream stages it invalidates.
<p align="center"><img src="assets/v10/director-console.png" width="100%" /></p>

### 📖 Novel → season, with real voiceover *(v6.2)*
Paste a full novel; Wind Comic splits it into episodes by chapter markers (or by target length), picks a narration mode, and can render a real narration track + burnable subtitles for the whole season in parallel.
<p align="center"><img src="assets/v10/story-intake.png" width="100%" /></p>

### 🎨 Style Gallery — 60 cinematic looks, one click *(v6.3)*
Lock a consistent visual identity before you generate. Search, filter by category, and apply any preset straight into the creation workshop.
<p align="center"><img src="assets/v6/styles.png" width="100%" /></p>

### 🩺 API Health Board — never get surprised by a dead key *(v6.7)*
Live status for every model and gateway: 正常 / 额度用尽 / 配置缺失 / 不可达, with real balance read-out and a "去充值 / 补配置" hint. Keys are never stored or returned.
<p align="center"><img src="assets/v6/health.png" width="100%" /></p>

### 🩺 Polish Studio — Pro industry audit *(v7.1)*
Paste a draft, hit **Pro**: deepseek-v4-pro returns a polished script **plus a full industry diagnostic** — AIGC-pipeline readiness score (e.g. 85/100), style profile, first-3-second hook strength, Save-the-Cat 3-act breakdown with missing beats called out, on-the-nose dialogue lines flagged, and per-character Cameo/Seedance identity anchors so every shot stays on-model.
<p align="center"><img src="assets/v8/polish-pro-audit.png" width="100%" /></p>

### 👤 Character Studio + Cameo IP turnaround *(v6.0 / v7.x)*
Every character gets a real 3-view turnaround sheet (front / three-quarter / back) with a locked structured "DNA prompt" — face geometry, skin tone, signature props, color palette, silhouette identity, full body pose — so the same actor reads identically across all 6 shots. The Cameo IP economy lets the same character travel between projects.
<p align="center"><img src="assets/v8/character-studio.png" width="100%" /></p>

### 🎬 Finished film + 11-tab director station *(v8.0)*
One project, eleven tabs of cockpit-grade control: 导演台 · 剧本 · 角色 · 场景 · 分镜 · 连贯性 · 视频 · 镜头工坊 · Cinema 时间线 · 节奏分析 · 成片质检 · 技术监看 · 参数联动 · 评论协作 · 完整播放. The finished film plays right in the workspace with a 90/100 audit badge and one-click `mp4` / platform export.
<p align="center"><img src="assets/v10/final-film.png" width="100%" /></p>

### 👥 Team Workspace *(v6.5)*  ·  🎞️ Cinema Timeline + narration track *(v6.2.4)*
<table>
<tr>
<td width="50%"><img src="assets/v10/team.png" /><br/><sub>Credit pool + per-member allocations, RBAC, real invite links.</sub></td>
<td width="50%"><img src="assets/v10/cinema-timeline.png" /><br/><sub>Multi-track timeline; narration audio + subtitles burned in.</sub></td>
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

### 7. **Lipsync that actually works**
Kling lip-sync API for talking heads, with Sync.so and Hailuo as auto-fallback. The pipeline strips dialogue from the prompt so the model only generates lip *motion*; we then sync the lips to the TTS audio in post.

### 8. **Conflict / reversal / cliffhanger pacing audit** (v2.21 P1.1)
After Writer finishes, we score each shot 0-10 on a Chinese-conflict-word dictionary + detect emotional polarity reversals + cliffhanger keywords. If a vertical drama has <2 reversals or shot-1 conflict <5, you see a warning in the dedicated Pacing tab with actionable suggestions.

### 9. **Bring Your Own LLM** (v3.1.3)
Every text-LLM call (Director / Writer / Vision / Audit) goes through one OpenAI-compatible `chat/completions` endpoint. Want to swap to DeepSeek-r1 / GPT-4o / Claude (via OpenRouter) / Qwen-Max / local Ollama? **Edit 3 lines in `.env`. Zero code change.** See [`docs/llm-providers.md`](docs/llm-providers.md) for the full matrix.

### 10. **1894 tests, TypeScript strict, no fake "coming soon"s**
Every feature listed above is in `main`, type-checked, unit-tested, and visible at `/projects/[id]` if you `npm install && npm run dev` right now.

---

## 🥊 vs. competitors

> 阵容核验 2026-06-22:Artificial Analysis / llm-stats 盲投竞技场 —— **文生视频榜首 Kling v3(2031 分)**,LTX-2 Fast 次席(1920,开源权重最强),**Seedance 2.0** 第三(1851)。**图生视频榜首易主为 xAI Grok Imagine 1.5**(原生音频 + 极速出片,盲测压过 Veo 3.1 / Kling / Seedance)。**Veo 3.1** 仍是画质与物理一致性王者(4K + 原生对白音轨);**Runway Gen-4.5** 控制面最强(motion brush + GWM-1 世界模型)。**HappyHorse-1.0**(阿里 Taotian)4 月匿名登顶后已退出可见榜首、**Sora 2** 已停服(App 2026-04-26 下线、API 2026-09-24 关停),两者移出对比。在产竞品均为生产可用第一梯队 + 公开 BYO API。
> 结论不变:**生成层已是红海(竞品在出片/多镜/音频都第一梯队),Wind Comic 护城河收窄到「制作/平台层」**——节奏审计、智能剪辑、字幕烧入、协作、自托管、开源、BYO。

| Capability | Veo 3.1 | Kling 3.0 | Seedance 2.0 | Runway Gen-4.5 | Grok Imagine 1.5 | **Wind Comic** |
|---|---|---|---|---|---|---|
| Multi-shot story from one prompt | ⚠️ | ✅ storyboard mode | ✅ multi-shot native | ⚠️ | ⚠️ (one clip) | **✅ 8-agent script→edit pipeline** |
| Character consistency across shots | ✅ | ✅ | ✅ | ✅ reference | ✅ | **✅ cref + sref + 8-dim DNA + vision retry** |
| Style coherence locked | ✅ | ✅ | ✅ | ✅ | ⚠️ | **✅ Style Bible Frame** |
| Native dialogue + SFX audio | ✅ | ✅ | ✅ | ⚠️ | ✅ | **✅ per-character TTS + lip-sync** |
| Real CJK subtitles (burned-in) | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ libass + PingFang burn** |
| Vertical drama tropes | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 12 templates + 9:16 default** |
| Real-time multiplayer timeline | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Yjs CRDT + Y.Map locks + cursors** |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Next.js + SQLite + Web Audio** |
| BYO LLM (OpenAI / Claude / DeepSeek / local) | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 12+ providers via .env** |
| Open source | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ MIT** |
| Per-shot regenerate with custom prompt | ⚠️ | ✅ | ⚠️ | ✅ motion brush | ⚠️ | **✅ + reference image upload** |
| Pacing / conflict audit | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ shot-level score + reversal detection** |
| Smart editing (beat-snap + emotion pacing + one-instruction style) | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ beat-snap · emotion pacing · emphasis · transition aesthetics · "fast & hype/slow & lyrical" in one line (BYO LLM)** |

> Cells marked ⚠️ = the feature exists but in a limited / locked-down form (e.g. "you can only do this on a paid Pro tier through a UI panel").

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
| ![我的项目](docs/screenshots/v12/01-my-projects-manage.png) | ![拉片](docs/screenshots/v12/04-pull-sheet-replicate.png) |

| 素材库 · 资产管理 | API 健康 · 模型雷达 |
|---|---|
| ![素材库](docs/screenshots/v12/02-my-assets-manage.png) | ![模型雷达](docs/screenshots/v12/03-api-health-model-radar.png) |

| 钩子审计三指标 | 一句指令调剪辑风格(v12.0.4) |
|---|---|
| ![钩子审计](docs/screenshots/v12/05-pacing-hook-audit.png) | ![剪辑风格](docs/screenshots/v12/06-edit-style-instruction.png) |

| 片段预览音频:三态徽章 + 带声试听(v12.1.2) | |
|---|---|
| ![片段音频预览](docs/screenshots/v12/07-clip-audio-preview.png) | 左:带配音(TTS 叠层)+ 带声试听开关 · 右:片段无独立音轨(成片含配乐+配音) |

完整逐版本核心迭代见 [`VERSIONS.md`](VERSIONS.md);阶段计划见 `docs/stage18`–`docs/stage20`。

---

## 🎬 Screenshots

Below is the **foundational v3 pipeline** (the v6 studio screens are in the [New in v6](#-new-in-v6--from-demo-to-studio) section above). Every panel is **a real puppeteer capture of the running app** (run `node scripts/capture-screenshots.mjs` / `node scripts/capture-v6.mjs` to refresh).

### Workspace overview
The 创作总览 dashboard: 99 projects + 4 case studies + recent activity feed + system status (engines in use, model versions).
<p align="center"><img src="assets/screenshot-dashboard-v3.1.3.png" width="100%" /></p>

### Asset library
Cross-project reusable: 角色 / 场景 / 视频 / 音乐 / 字幕 / 模板 — 1467 assets in this demo project.
<p align="center"><img src="assets/screenshot-assets-v3.1.3.png" width="100%" /></p>

### Project library
Every short film with auto-generated cinematic covers + status badges + quality donut.
<p align="center"><img src="assets/screenshot-projects-v3.1.3.png" width="100%" /></p>

### Creation workspace — live multi-agent canvas
The whole pipeline as a live agent flow: Writer / Character Designer / Scene Designer / Storyboard Artist / Video Producer / Editor nodes wired together with progress streaming per node, plus a chat side-rail showing every agent message in real time.
<p align="center"><img src="assets/v8/creation-canvas.png" width="100%" /></p>

### Per-project script + shot list with beats
The 剧本 tab: every shot with duration, emotion tag (警觉 / 凝重 / 惊恐 / 暴风的沉着 / 镇定的专注…) and a one-line **beat note** (从表面到深层警觉 / 从无知到悉知威胁 / 从警戒到遭受袭击 …) so the rhythm of the cut is legible at a glance.
<p align="center"><img src="assets/v8/script-shotlist.png" width="100%" /></p>

### 🆕 Cinema Timeline (v3.1.1–v3.1.3 — multi-track + collab)
3-track layout (SHOTS / BGM / SUBTITLE), drag-to-retime, double-click subtitles to rewrite, drag edges to resize, **real BGM waveform** (Web Audio decode), live other-user cursors with name labels, segment lock indicators.
<p align="center"><img src="assets/screenshot-cinema-timeline-v3.1.3.png" width="100%" /></p>

### 🆕 Pacing Analysis (v2.21 P1.4)
KPI: 平均冲突分 / 反转数 / 通过状态. Per-shot conflict-score bar chart with reversal arrows + emotional polarity icons. Color-coded green (≥7) / amber (4-6) / red (<4). Below: actionable warnings + suggestions.
<p align="center"><img src="assets/screenshot-pacing-v3.1.3.png" width="100%" /></p>

### 🆕 Comments + @mentions (v3.0 P0.1)
Project-level + per-shot threaded comments with @-autocomplete and notification bell. Each shot collapses for context.
<p align="center"><img src="assets/screenshot-comments-v3.1.3.png" width="100%" /></p>

### 🆕 Shot Workshop (v2.16 P1.4 + v2.23 P0.2)
Per-shot "改 prompt 重生" (regenerate image with custom prompt + reference image upload) and "4K 重渲" (Kling Master 4K re-render, plan-gated).
<p align="center"><img src="assets/screenshot-workshop-v3.1.3.png" width="100%" /></p>

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
| **Creative LLM** (writer / director) | `deepseek-v4-pro` (`OPENAI_CREATIVE_MODEL`) + `deepseek-v4-flash` fast tier for drafts/polish | `MiniMax-M2.7` (`LLM_FALLBACK_MODEL`) · optional self-hosted **XVERSE-Ent** (A5.7B / A4.2B) |
| **General LLM** (planning / validation / Vision-Audit) | `claude-sonnet-4-6` (`OPENAI_MODEL`) | `MiniMax-M2.7` |
| **Video** | `veo3.1-pro` (`VEO_MODEL`) | `veo3.1` · Kling → **MiniMax Hailuo** (Sora-2 retired — API EOL 2026-09-24) |
| **Image** | `flux.1-kontext-pro` (`IMAGE_MODEL`) | Midjourney (`mj_imagine`) · fal FLUX Kontext · local ComfyUI → **MiniMax image** |
| **TTS / voiceover** | `gpt-4o-mini-tts` (`VE_TTS_MODEL`) | MiniMax T2A (`speech-02-hd`) |
| **Music / BGM** | MiniMax music | (Suno when gateway channel available) |

- **Why two LLM tiers**: the creative tier (DeepSeek `-pro`, a reasoning model) carries writer/director quality work; the general tier (Claude `sonnet-4-6`) handles high-frequency planning / validation / Vision-Audit; the `-flash` tier keeps draft-compare & basic polish at sub-second latency.
- **MiniMax safety net**: any primary LLM / video / image failure auto-routes to MiniMax (OpenAI-compatible) — surfaced live on the **API Health Board** (正常 / 额度用尽 / 配置缺失 / 不可达).
- **XVERSE-Ent** is an **open-source MoE screenwriting model** you can self-host (vLLM / SGLang / ModelScope) and slot in as the writer/director LLM — set `XVERSE_ENABLED=true`.
- **Swap anything** in `.env.local` (`OPENAI_*` / `OPENAI_CREATIVE_*` / `VEO_*` / `IMAGE_MODEL` / `VE_TTS_MODEL` / `MINIMAX_*`) — zero code change. See [`docs/llm-providers.md`](docs/llm-providers.md).

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
2. **Tests gate everything.** Vitest 1894/1894 must stay green. Add tests for new lib/service files.

See [`CLAUDE.md`](CLAUDE.md) for the repo's "house style" + agent design notes.

---

## 📚 Docs

- [`docs/llm-providers.md`](docs/llm-providers.md) — Swap LLM provider in 3 env vars
- [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) — Module-by-module screenshot manifest
- [`docs/MARKETING-en.md`](docs/MARKETING-en.md) · [`docs/MARKETING-zh.md`](docs/MARKETING-zh.md) — Pitch deck copy
- [`ROADMAP.md`](ROADMAP.md) — Full sprint-by-sprint changelog (v2.10 → v9.2.0) · [`VERSIONS.md`](VERSIONS.md) — version history table
- [`docs/COMPETITIVE-GAP-2026-05.md`](docs/COMPETITIVE-GAP-2026-05.md) — Honest analysis vs Sora/Kling/Vidu/Higgsfield

---

## 📄 License

MIT. Use it, fork it, build a startup on it. We just ask: if you ship a feature on top, send a PR back.

---

## 🙏 Acknowledgements

Wind Comic stands on a lot of excellent open-source work:

- **App & UI** — [Next.js](https://nextjs.org) (App Router + Turbopack) · [React 19](https://react.dev) · [Tailwind CSS v4](https://tailwindcss.com) · [Radix UI](https://www.radix-ui.com) · [Phosphor Icons](https://phosphoricons.com) + [Lucide](https://lucide.dev) · [Framer Motion](https://www.framer.com/motion/) · [React Flow](https://reactflow.dev) for the agent-workflow DAG
- **Realtime & data** — [Yjs](https://github.com/yjs/yjs) + [y-websocket](https://github.com/yjs/y-websocket) for **CRDT** real-time collaboration · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [node-postgres](https://node-postgres.com) for the dual-driver persistence layer
- **Media & export** — [FFmpeg](https://ffmpeg.org) via [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) (CJK subtitle burn / audio mux) · pro NLE interchange through CMX3600 **EDL** · FCP7 **XML** · **AAF** (a from-scratch MS-CFB Compound File Binary writer, no third-party lib)
- **Open models & engines** — [XVERSE-Ent](https://github.com/xverse-ai/XVERSE-Ent), an open-source **MoE screenwriting model** (self-hostable via vLLM / SGLang / ModelScope) · [FLUX.1 Kontext](https://blackforestlabs.ai) for image consistency · a provider-pluggable LLM/video chain (DeepSeek · Claude · MiniMax · Veo · Kling · Midjourney) over OpenAI-compatible endpoints
- **Methods & algorithms** — Robert McKee story structure + Save-the-Cat 3-act beat analysis · **CRDT** (conflict-free replicated data types) for collaborative editing · `cref` / `sref` + 8-dimension character **DNA** for cross-shot identity consistency
- **Tooling** — [TypeScript](https://www.typescriptlang.org) (strict) · [Vitest](https://vitest.dev) · [Stripe](https://stripe.com) — and every creator whose real-world feedback shaped the pipeline.

---

## ⭐ Star History

If Wind Comic saved you time, a star helps other creators find it.

[![Star History Chart](https://api.star-history.com/svg?repos=ChrisChen667788/wind-comic&type=Date)](https://star-history.com/#ChrisChen667788/wind-comic&Date)

---

<p align="center">
  Built with ❤️ by people who believe AI-generated drama should feel like a show, not a tech demo.<br/>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers">⭐ Star us</a> if Wind Comic saved you a week.
</p>
