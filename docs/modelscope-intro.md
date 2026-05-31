<!-- 由 scripts/gen-modelscope-intro.mjs 从 README.md 自动生成: 图片→raw、相对链→blob 绝对化, 其余逐字不变. 全选复制粘贴到 ModelScope 项目「介绍」区即与 GitHub 主页一致. 勿手改本文件, 改 README.md 后重跑脚本. -->

<p align="center">
  <img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/banner.png" alt="Wind Comic — One line of text. One finished short drama." width="100%" />
</p>

<h1 align="center">🌬️ Wind Comic <sub><sup>v9.0.2b</sup></sub></h1>

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
  <img src="https://img.shields.io/badge/Tests-1857%2F1857-2ea44f" alt="1857 tests passing" />
  <img src="https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
</p>

<p align="center">
  <b>English</b> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/README.zh-CN.md">简体中文</a> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-en.md">🔥 Pitch</a> · <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md">🔌 BYO LLM</a>
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
```

---

## 🆕 New in v6 → v9 — from *demo* to *production platform*

> v3 shipped the pipeline. **v6 turned it into a production studio; v7–v9 hardened it into a platform.** Reusable characters, a prompt IDE, novel→season auto-splitting with real voiceover, a 60-style gallery, a director's control room, team credit budgets, an industry-grade script audit (**Polish Pro**, v7.1), a **premium design pass** (v8.3), a **fully-migrated Postgres backend** (v9), and a live API health board — every screen below is a **real capture of the running app**.

<p align="center">
  <img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/wind-comic-v6-tour.gif" alt="Wind Comic v6 tour — API health · director console · novel splitting · style gallery · cinema timeline" width="100%" />
</p>

### 🎨 v8.3 — Premium design pass *(Taste Skill)*

Plus Jakarta Sans + Phosphor icons, gold-tinted machined-bezel cards, spring motion, an asymmetric **bento dashboard**, a 60-thumbnail **style gallery**, and AI-generated gold-neon **genre icons** replacing every default emoji.

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/dashboard-bento.png" /><br/><sub>Asymmetric bento dashboard — tall create-hero + machined-bezel cards</sub></td>
<td width="50%"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/style-gallery.png" /><br/><sub>60-style gallery, every thumbnail AI-rendered (same subject × each look)</sub></td>
</tr>
</table>
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/template-icons.png" width="100%" /><br/><sub>Story-template gallery — 18 cohesive AI gold-neon genre emblems (no more default emoji)</sub></p>

| Version | What landed |
|---|---|
| **v6.0 · Character Studio** | Reusable cast assets — multi-view turnaround sheets (front / ¾ / profile / back) with an 8-field DNA identity lock, auto-bound voice timbre, deterministic bio. Reuse any character across projects via the Cameo IP economy. |
| **v6.1 · Prompt Workbench** | `@`-mention any asset right in your prompt, live autocomplete, a compile-preview that expands every reference, and a pre-generation readiness score. |
| **v6.2 · Long-form Intake** | Paste a whole novel → auto-split into episodes (chapter-aware) → choose a narration mode (dialogue / first-person / narrator). **v6.2.3** renders narration to **real TTS** with N-episode parallel orchestration; **v6.2.4** persists the audio + burns **SRT subtitles into the timeline**. |
| **v6.3 · Style Gallery** | 60 cinematic presets across 5 categories, instant search, one-click **apply-to-workshop**. |
| **v6.4 · Director Console** | The whole pipeline as 4 stages (script → assets → storyboard → final) with ready / **stale** detection, one-click **single-stage rerun**, and downstream-impact analysis. |
| **v6.5 · Team Workspace** | Owner-managed credit pool, per-member allocations + RBAC, **real multi-user invites** (token links), per-member consumption metering. |
| **v6.6 · Postgres-ready** | Full SQLite→Postgres cutover path, **verified end-to-end on a local Postgres** (schema bootstrap + async-repo round-trip, idempotent migrate). |
| **v6.7 · API Health Board** | One screen to see which gateway is healthy / **out-of-credits** / misconfigured — with live balance read-out, so you never hit a dead generation mid-flow again. |
| **v6.8 · Strongest models** | Primary LLM/video/image repointed to top-tier models (`veo3.1-pro`, etc.) and fixed a video-stage `429 upstream-saturated` error by rerouting the gateway. |
| **v6.9 · Gateway gap-fill** | A supplement gateway backfills TTS / Midjourney / Kling; real voiceover via `gpt-4o-mini-tts`; per-gateway **usage + balance** on the health board. |
| **v7.0 · DeepSeek + universal fallback** | Writer/Director run on DeepSeek's strongest **`deepseek-v4-pro`**; every LLM call auto-falls back to **MiniMax** on any error / out-of-credits / timeout. 3-tier LLM health on the board. |
| **v7.1 · Polish Studio Pro** | Paste a draft, hit **Pro**: `deepseek-v4-pro` returns a polished script **plus a full industry audit** — AIGC-readiness score, Save-the-Cat 3-act beat-gap detection, on-the-nose dialogue flags, per-character Cameo/Seedance identity anchors. Tiered models (flash for speed, pro for depth) fixed the reasoning-token instability. |
| **v7.2–v8.0 · AI director console** *(阶段九)* | Per-shot **cinematography console** (景别/机位/镜头/运镜/焦点), **continuity + seed lock**, project-format bar, emotion/rhythm curves, JSON↔visual **parameter linkage** — all converging into one **11-tab director station** per project. |
| **v8.1–v8.3 · Premium design pass** *(Taste Skill)* | Plus Jakarta Sans + Phosphor icons, gold machined-bezel cards, spring motion, an asymmetric **bento dashboard**, 60 AI-rendered **style thumbnails**, and AI **gold-neon genre icons** replacing every default emoji (18 templates + 5 modes + 8 looks). |
| **v9.0–v9.0.2b · Postgres full cutover** | SQLite↔Postgres **dual-driver**; every write path migrated to async repos — `project_assets` · `projects` · `users` · `notifications` · `comments` all cleared — **verified end-to-end on a local Postgres** with transaction commit + rollback atomicity. Default stays SQLite (same file, zero split-brain); `DB_DRIVER=pg` is opt-in. **1857 tests** green on both drivers. |

### 🎬 Director Console — the whole film as one control room *(v6.4)*
Every stage at a glance — what's ready, what's gone stale because you changed something upstream, and a one-click rerun that knows exactly which downstream stages it invalidates.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/director-console.png" width="100%" /></p>

### 📖 Novel → season, with real voiceover *(v6.2)*
Paste a full novel; Wind Comic splits it into episodes by chapter markers (or by target length), picks a narration mode, and can render a real narration track + burnable subtitles for the whole season in parallel.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/story-intake.png" width="100%" /></p>

### 🎨 Style Gallery — 60 cinematic looks, one click *(v6.3)*
Lock a consistent visual identity before you generate. Search, filter by category, and apply any preset straight into the creation workshop.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/styles.png" width="100%" /></p>

### 🩺 API Health Board — never get surprised by a dead key *(v6.7)*
Live status for every model and gateway: 正常 / 额度用尽 / 配置缺失 / 不可达, with real balance read-out and a "去充值 / 补配置" hint. Keys are never stored or returned.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/health.png" width="100%" /></p>

### 🩺 Polish Studio — Pro industry audit *(v7.1)*
Paste a draft, hit **Pro**: deepseek-v4-pro returns a polished script **plus a full industry diagnostic** — AIGC-pipeline readiness score (e.g. 85/100), style profile, first-3-second hook strength, Save-the-Cat 3-act breakdown with missing beats called out, on-the-nose dialogue lines flagged, and per-character Cameo/Seedance identity anchors so every shot stays on-model.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/polish-pro-audit.png" width="100%" /></p>

### 👤 Character Studio + Cameo IP turnaround *(v6.0 / v7.x)*
Every character gets a real 3-view turnaround sheet (front / three-quarter / back) with a locked structured "DNA prompt" — face geometry, skin tone, signature props, color palette, silhouette identity, full body pose — so the same actor reads identically across all 6 shots. The Cameo IP economy lets the same character travel between projects.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/character-studio.png" width="100%" /></p>

### 🎬 Finished film + 11-tab director station *(v8.0)*
One project, eleven tabs of cockpit-grade control: 导演台 · 剧本 · 角色 · 场景 · 分镜 · 连贯性 · 视频 · 镜头工坊 · Cinema 时间线 · 节奏分析 · 成片质检 · 技术监看 · 参数联动 · 评论协作 · 完整播放. The finished film plays right in the workspace with a 90/100 audit badge and one-click `mp4` / platform export.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/final-film-control.png" width="100%" /></p>

### 👥 Team Workspace *(v6.5)*  ·  🎞️ Cinema Timeline + narration track *(v6.2.4)*
<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/team.png" /><br/><sub>Credit pool + per-member allocations, RBAC, real invite links.</sub></td>
<td width="50%"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v6/cinema-timeline.png" /><br/><sub>Multi-track timeline; narration audio + subtitles burned in.</sub></td>
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
Every text-LLM call (Director / Writer / Vision / Audit) goes through one OpenAI-compatible `chat/completions` endpoint. Want to swap to DeepSeek-r1 / GPT-4o / Claude (via OpenRouter) / Qwen-Max / local Ollama? **Edit 3 lines in `.env`. Zero code change.** See [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md) for the full matrix.

### 10. **1857 tests, TypeScript strict, no fake "coming soon"s**
Every feature listed above is in `main`, type-checked, unit-tested, and visible at `/projects/[id]` if you `npm install && npm run dev` right now.

---

## 🥊 vs. competitors

| Capability | Sora 2 | Kling 2.0 | Vidu Q3 | Runway Gen-4 | Higgsfield | **Wind Comic** |
|---|---|---|---|---|---|---|
| Multi-shot story from one prompt | ⚠️ (one continuous clip) | ❌ | ❌ | ⚠️ | ⚠️ | ✅ multi-agent |
| Character consistency across shots | ✅ | cref/sref hack | subject-ref | scene memory | ✅ | **✅ cref + sref + 8-dim DNA + vision retry** |
| Style coherence locked | ⚠️ | ❌ | ⚠️ | ✅ | ✅ | **✅ Style Bible Frame** |
| Real CJK subtitles | ❌ | ⚠️ | ⚠️ | ❌ | ❌ | **✅ libass + PingFang burn** |
| Vertical drama tropes | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 12 templates + 9:16 default** |
| Real-time multiplayer timeline | ❌ | ❌ | ❌ | ❌ | ⚠️ (proprietary) | **✅ Yjs CRDT + Y.Map locks + cursors** |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Next.js + SQLite + Web Audio** |
| BYO LLM (OpenAI / Claude / DeepSeek / local) | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ 12+ providers via .env** |
| Open source | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ MIT** |
| Per-shot regenerate with custom prompt | ⚠️ | ⚠️ | ⚠️ | ✅ | ✅ | **✅ + reference image upload** |
| Pacing / conflict audit | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ shot-level score + reversal detection** |

> Cells marked ⚠️ = the feature exists but in a limited / locked-down form (e.g. "you can only do this on a paid Pro tier through a UI panel").

---

## 🎬 Screenshots

Below is the **foundational v3 pipeline** (the v6 studio screens are in the [New in v6](#-new-in-v6--from-demo-to-studio) section above). Every panel is **a real puppeteer capture of the running app** (run `node scripts/capture-screenshots.mjs` / `node scripts/capture-v6.mjs` to refresh).

### Workspace overview
The 创作总览 dashboard: 99 projects + 4 case studies + recent activity feed + system status (engines in use, model versions).
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-dashboard-v3.1.3.png" width="100%" /></p>

### Asset library
Cross-project reusable: 角色 / 场景 / 视频 / 音乐 / 字幕 / 模板 — 1467 assets in this demo project.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-assets-v3.1.3.png" width="100%" /></p>

### Project library
Every short film with auto-generated cinematic covers + status badges + quality donut.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-projects-v3.1.3.png" width="100%" /></p>

### Creation workspace — live multi-agent canvas
The whole pipeline as a live agent flow: Writer / Character Designer / Scene Designer / Storyboard Artist / Video Producer / Editor nodes wired together with progress streaming per node, plus a chat side-rail showing every agent message in real time.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/creation-canvas.png" width="100%" /></p>

### Per-project script + shot list with beats
The 剧本 tab: every shot with duration, emotion tag (警觉 / 凝重 / 惊恐 / 暴风的沉着 / 镇定的专注…) and a one-line **beat note** (从表面到深层警觉 / 从无知到悉知威胁 / 从警戒到遭受袭击 …) so the rhythm of the cut is legible at a glance.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/v8/script-shotlist.png" width="100%" /></p>

### 🆕 Cinema Timeline (v3.1.1–v3.1.3 — multi-track + collab)
3-track layout (SHOTS / BGM / SUBTITLE), drag-to-retime, double-click subtitles to rewrite, drag edges to resize, **real BGM waveform** (Web Audio decode), live other-user cursors with name labels, segment lock indicators.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-cinema-timeline-v3.1.3.png" width="100%" /></p>

### 🆕 Pacing Analysis (v2.21 P1.4)
KPI: 平均冲突分 / 反转数 / 通过状态. Per-shot conflict-score bar chart with reversal arrows + emotional polarity icons. Color-coded green (≥7) / amber (4-6) / red (<4). Below: actionable warnings + suggestions.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-pacing-v3.1.3.png" width="100%" /></p>

### 🆕 Comments + @mentions (v3.0 P0.1)
Project-level + per-shot threaded comments with @-autocomplete and notification bell. Each shot collapses for context.
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-comments-v3.1.3.png" width="100%" /></p>

### 🆕 Shot Workshop (v2.16 P1.4 + v2.23 P0.2)
Per-shot "改 prompt 重生" (regenerate image with custom prompt + reference image upload) and "4K 重渲" (Kling Master 4K re-render, plan-gated).
<p align="center"><img src="https://raw.githubusercontent.com/ChrisChen667788/wind-comic/main/assets/screenshot-workshop-v3.1.3.png" width="100%" /></p>

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

## 🔀 Gateway routing (v6.8 / v6.9)

Every model call is provider-pluggable (priority chain + automatic fallback). The current default routing splits a **primary** gateway from a **supplement** gateway, with MiniMax always last as the safety net:

| Capability | Primary (strongest) | Supplement | Fallback (unchanged) |
|---|---|---|---|
| **LLM** (writer / director / vision-audit) | `claude-opus-4-7` · `claude-sonnet-4-6` | — | MiniMax / XVERSE |
| **Video** | `veo3.1-pro` (Veo 3.1 Pro) | Kling | **MiniMax Hailuo** |
| **Image** | `flux-2-pro` (`IMAGE_MODEL`) | Midjourney (`mj_imagine`) | **MiniMax image-01** |
| **TTS / voiceover** | `gpt-4o-mini-tts` | — | MiniMax T2A |
| **Music / BGM** | MiniMax music | (Suno when gateway channel available) | — |

- **Why split**: the primary gateway carries the newest top-tier models; the supplement gateway backfills capabilities (TTS / MJ / Kling) and catches overflow when the primary runs out of credits.
- **v6.8** — repointed primary LLM/video/image to the funded gateway with the strongest models, fixing a video-stage `429 upstream-saturated` error on the old gateway.
- **v6.9** — added a dedicated TTS provider (`lib/tts-providers/vectorengine-tts.ts`) so voiceover works without per-vendor group-id config; enabled Midjourney as an image fallback; surfaced **per-gateway usage + balance** on the [API Health Board](#-new-in-v6--from-demo-to-studio).
- **Swap any of it** in `.env.local` (`OPENAI_*` / `VEO_*` / `IMAGE_MODEL` / `MINIMAX_*`) — zero code change. See [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md).

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
- `SYNCSO_API_KEY` / `HAILUO_API_KEY` — alternative lip-sync providers

---

## 🤝 Contributing

We're open to PRs. Two things matter most:
1. **Don't break the multi-agent contracts.** Each agent has explicit input/output shapes — see `types/agents.ts`.
2. **Tests gate everything.** Vitest 1857/1857 must stay green. Add tests for new lib/service files.

See [`CLAUDE.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/CLAUDE.md) for the repo's "house style" + agent design notes.

---

## 📚 Docs

- [`docs/llm-providers.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/llm-providers.md) — Swap LLM provider in 3 env vars
- [`docs/SCREENSHOTS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/SCREENSHOTS.md) — Module-by-module screenshot manifest
- [`docs/MARKETING-en.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-en.md) · [`docs/MARKETING-zh.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/MARKETING-zh.md) — Pitch deck copy
- [`ROADMAP.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/ROADMAP.md) — Full sprint-by-sprint changelog (v2.10 → v9.0.2b) · [`VERSIONS.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/VERSIONS.md) — version history table
- [`docs/COMPETITIVE-GAP-2026-05.md`](https://github.com/ChrisChen667788/wind-comic/blob/main/docs/COMPETITIVE-GAP-2026-05.md) — Honest analysis vs Sora/Kling/Vidu/Higgsfield

---

## 📄 License

MIT. Use it, fork it, build a startup on it. We just ask: if you ship a feature on top, send a PR back.

---

<p align="center">
  Built with ❤️ by people who believe AI-generated drama should feel like a show, not a tech demo.<br/>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers">⭐ Star us</a> if Wind Comic saved you a week.
</p>
