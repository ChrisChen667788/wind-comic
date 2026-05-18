<p align="center">
  <img src="assets/banner.png" alt="Wind Comic — One line of text. One finished short drama." width="100%" />
</p>

<h1 align="center">🌬️ Wind Comic <sub><sup>v3.1.3</sup></sub></h1>

<p align="center">
  <b>One sentence in. Full short-form drama out.</b><br/>
  Multi-agent AI pipeline · cinematic storyboards · video output · real-time collaboration · bring-your-own LLM.
</p>

<p align="center">
  <a href="https://github.com/ChrisChen667788/wind-comic/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/ChrisChen667788/wind-comic/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ChrisChen667788/wind-comic/ci.yml?branch=main&label=CI&logo=github" alt="CI" /></a>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers"><img src="https://img.shields.io/github/stars/ChrisChen667788/wind-comic?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/Tests-1150%2F1150-2ea44f" alt="1150 tests passing" />
  <img src="https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
</p>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="docs/MARKETING-en.md">🔥 Pitch</a> · <a href="docs/llm-providers.md">🔌 BYO LLM</a>
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

### 10. **1150 tests, TypeScript strict, no fake "coming soon"s**
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

A real walk-through of the **v3.1.3** build — every panel below is **a real puppeteer capture of the running app** (run `node scripts/capture-screenshots.mjs` to refresh yourself).

### Workspace overview
The 创作总览 dashboard: 99 projects + 4 case studies + recent activity feed + system status (engines in use, model versions).
<p align="center"><img src="assets/screenshot-dashboard-v3.1.3.png" width="100%" /></p>

### Asset library
Cross-project reusable: 角色 / 场景 / 视频 / 音乐 / 字幕 / 模板 — 1467 assets in this demo project.
<p align="center"><img src="assets/screenshot-assets-v3.1.3.png" width="100%" /></p>

### Project library
Every short film with auto-generated cinematic covers + status badges + quality donut.
<p align="center"><img src="assets/screenshot-projects-v3.1.3.png" width="100%" /></p>

### Creation workspace
Paste an idea, pick a story template (18 built-in: 霸总/重生/赛博/古装/儿童/纪实/科幻/恐怖 etc.), hit go. Story templates auto-fill duration / aspect ratio / camera-language defaults.
<p align="center"><img src="assets/screenshot-create-v3.1.3.png" width="100%" /></p>

### Per-project storyboard
The original storyboard tab — every shot's script line, character lock state, Cameo retry score, Style Audit dimensions.
<p align="center"><img src="assets/screenshot-storyboard-v3.1.3.png" width="100%" /></p>

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
2. **Tests gate everything.** Vitest 1150/1150 must stay green. Add tests for new lib/service files.

See [`CLAUDE.md`](CLAUDE.md) for the repo's "house style" + agent design notes.

---

## 📚 Docs

- [`docs/llm-providers.md`](docs/llm-providers.md) — Swap LLM provider in 3 env vars
- [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) — Module-by-module screenshot manifest
- [`docs/MARKETING-en.md`](docs/MARKETING-en.md) · [`docs/MARKETING-zh.md`](docs/MARKETING-zh.md) — Pitch deck copy
- [`ROADMAP.md`](ROADMAP.md) — Full sprint-by-sprint changelog (v2.10 → v3.1.3)
- [`docs/COMPETITIVE-GAP-2026-05.md`](docs/COMPETITIVE-GAP-2026-05.md) — Honest analysis vs Sora/Kling/Vidu/Higgsfield

---

## 📄 License

MIT. Use it, fork it, build a startup on it. We just ask: if you ship a feature on top, send a PR back.

---

<p align="center">
  Built with ❤️ by people who believe AI-generated drama should feel like a show, not a tech demo.<br/>
  <a href="https://github.com/ChrisChen667788/wind-comic/stargazers">⭐ Star us</a> if Wind Comic saved you a week.
</p>
