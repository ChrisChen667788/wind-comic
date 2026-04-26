# Changelog

All notable changes to Wind Comic are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Multi-character face lock — Phase 1** (`/dashboard/create`) — upload 1-3 main character faces (主角 A / B / C) at creation time with name + role preset (lead 125 / antagonist 125 / supporting 100 / cameo 80) → cw. Files via local upload **or** image URL. Persisted in new `projects.locked_characters` JSON column; first character is also synced into the existing `primary_character_ref` for backward-compat with the v2.9 single-face orchestrator path. Project page shows a colored badge with all locked characters.
  - New endpoint: `POST /api/upload/character-face` (multipart **or** `{imageUrl}` JSON; size cap 10 MB; protocol whitelist `http(s):` / `data:`)
  - New component: `components/create/character-lock-section.tsx`
- **Multi-character face lock — Phase 2** — per-shot character routing now actually works: `pickConsistencyRefs` matches `shot.characters` against `lockedCharacters[].name` (exact normalized + safe-substring fuzzy) and uses the matched character's own `imageUrl` + per-character `cw` instead of always defaulting to the first locked face. When two or three locked characters appear in the same shot, the first match becomes the `--cref` and the rest are passed as `referenceImages` so MJ/Minimax can see all the faces it needs to lock.
  - New `LockedCharacter` type + `matchLockedCharactersInShot()` helper (exported from `lib/consistency-policy.ts`)
  - `ConsistencyPick` extended with `extraCrefs?: string[]` and `reason.matchedLockedName`
  - New cref priority: `matched-locked > user-locked > character-sheet > first-character`
  - New `cwTier`: `matched-locked` (uses the per-character `cw`)
  - `services/hybrid-orchestrator.ts`: new `setLockedCharacters()`, threaded into `renderSingleShot`'s `progressiveRefs` chain
  - `tests/locked-characters-routing.test.ts` — 13 unit tests covering name normalization, single/multi match, false-positive guard (single-char locked names rejected), priority over `primaryCharacterRefLocked`, per-character cw, `extraCrefs` ordering, cw clamping
- **Multi-character face lock — Phase 3** — `services/cameo-retry.ts` now scores each matched locked character independently (parallel `Promise.all`) and gates retry on the **min** score (the weakest character). Backward-compat: when `additionalReferences` is empty/undefined the single-character path is byte-identical to v2.12.0 (existing 17 cameo-retry tests unchanged).
  - `CameoRetryInput` gains `additionalReferences?: Array<{url, name?}>` — each gets its own vision call
  - `CameoRetryOutcome` gains `perCharacterScores?: Array<{name?, score, reasoning}>` — exposes per-character breakdown for future dashboard work; only present in multi-char shots
  - `finalScore` and `firstScore` now report the **min** across all characters in multi-char shots — so "主角 90 / 配角 60" still triggers retry instead of averaging to 75 and silently passing
  - Rollback logic also uses min-comparison: regen rolls back if any character's score drops below the original min
  - Partial vision-null tolerance: if some characters' vision calls fail, the gate uses the min of valid scores (only when ALL fail does it skip retry)
  - Orchestrator wires `refsPick.extraCrefs` into `additionalReferences` with names looked up from `lockedCharacters`
  - `tests/cameo-retry-multi.test.ts` — 8 new tests: backward-compat (empty additionalReferences omits perCharacterScores), all-pass / partial-fail / regen-rollback / partial-vision-null / all-vision-null / threshold-boundary
- **Hailuo-2.3-Fast video fallback** (`MinimaxService.generateVideoFast()`) — wired into the orchestrator's Pass-B T2V chain. New chain order: `Veo-T2V → Hailuo-2.3 → Hailuo-Fast → Kling-T2V → Ken Burns animatic`. Hailuo Fast has its own daily quota independent of standard Hailuo-2.3; placed **before Kling** so the same-account fallback (more predictable cost / response / failure mode) is tried first, with Kling kept as the final real-video attempt before falling through to a still-frame composite. Model name overridable via `MINIMAX_FAST_VIDEO_MODEL` (default `MiniMax-Hailuo-2.3-Fast`).
- **Hailuo-2.3-Fast video fallback** (`MinimaxService.generateVideoFast()`) — wired into the orchestrator's Pass-B T2V chain. New chain order: `Veo-T2V → Hailuo-2.3 → Hailuo-Fast → Kling-T2V → Ken Burns animatic`. Hailuo Fast has its own daily quota independent of standard Hailuo-2.3; placed **before Kling** so the same-account fallback (more predictable cost / response / failure mode) is tried first, with Kling kept as the final real-video attempt before falling through to a still-frame composite. Model name overridable via `MINIMAX_FAST_VIDEO_MODEL` (default `MiniMax-Hailuo-2.3-Fast`).

- **Sprint A.4 — Cameo dashboard per-character viz** — the storyboard-tab widgets now consume Phase 3's `perCharacterScores`. Each badge popover, when there are 2+ matched characters in the shot, renders an inline horizontal bar chart: `角色名 ▕▇▇▇▇▇░░░ 60`, with the same red/amber/green palette per row. Single-character shots are byte-identical to the v2.12.0 layout (graceful fallback when `cameoPerCharacterScores` is absent or has only 1 entry). Adds `aria-label` to the badge button so the dashboard is accessible.
  - `Storyboard.cameoPerCharacterScores?: Array<{name?, score, reasoning?}>` exposed on the wire; orchestrator pipes `cameoOutcome.perCharacterScores` straight through to the storyboard JSON
  - `tests/cameo-storyboard-widgets.test.tsx` — 16 tests: score → color band (green/amber/red), popover open + reasoning quote + retry summary + final cw, multi-char per-character bars (3 chars / vision-null dash / unnamed fallback), `CameoSummary` stats (avg / lowCount / retried), batch retry button click + disabled-while-retrying

### Tests
- `380/380` vitest passing · `tsc --noEmit` 0 errors

---

## [2.12.0] — 2026-04-26 — Initial public release

First open-source release of Wind Comic. Wraps a year of internal development on a multi-agent AI pipeline that turns a one-line idea into a finished short-form drama.

### Added
- **Cameo Vision Auto-Retry** — character face consistency below score 75 triggers automatic retry with progressive reference boost (`services/cameo-retry.ts`, 17 unit tests)
- **Polish Studio Pro** — McKee/Field/Seger framework, dual-tier polish, industry audit card, LCS diff panel, Word/Markdown export, 10-version history
- **Cinematic agent ensemble** — Writer / Director / Producer / Editor agents with budget plans, voice fingerprints, McKee critic skill
- **6-dimension character extraction** — gender / age / skin / build / wardrobe / personality LLM-driven traits
- **Scene anchoring + 3-tier `cw`** — locked face (125) / lead (100) / supporting (80) consistency policy
- **14 cinematic transition vocabulary** — match-cut / j-cut / l-cut / whip-pan / cross-fade
- **TTS / BGM resilience** — silent mp3 fallback, time-axis preservation on TTS failure, audio warnings
- **Project AIGC readiness badges** on dashboard (red/yellow/green)
- **Agent chat sidebar** with 7 SSE-streamed agents

### Changed
- LLM provider abstracted behind `OPENAI_BASE_URL` — any OpenAI-compatible proxy works
- Image gen routed through unified router: MJ → Minimax `image-01` → flux.1-kontext-pro → fal/ComfyUI
- Video gen routed through: Minimax `MiniMax-Hailuo-2.3` → Veo `veo3.1-fast` (via qingyuntop) → Kling fallback
- Storyboard type extended with `cameoScore / cameoRetried / cameoAttempts / cameoFinalCw / cameoReason` fields
- TTS migrated to Minimax `speech-2.8-hd`, music to `music-2.6`

### Fixed
- `serve-file` Range request crash on large MP4
- TTS hex decoder for byte-encoded responses
- 1026 sensitive-word net for Minimax compliance
- Hydration mismatch on dashboard project list
- Mascot speech bubble overlap with progress bar

### Performance
- 313 → 343 tests passing (added 30 tests for Cameo retry, character traits, polish API)
- TypeScript strict mode: 0 errors
- Single-fork test runner to handle SQLite write contention

### Open roadmap (Sprint A continuation, Sprint B, Sprint C)
- Sprint A.2: User-face → 6-dim traits reverse extraction
- Sprint A.3: Character Bible cross-project persistence
- Sprint A.4: Cameo dashboard embedded in storyboard tab
- Sprint B: j-cut / l-cut audio realization, subtitle animation, beat-driven editing
- Sprint C: Stripe 4-tier subscription, GitHub Actions CI/CD, U2V reference-driven

See [ROADMAP.md](ROADMAP.md) for the full plan.

---

## Pre-release internal development (not publicly distributed)

Wind Comic was developed privately from 2026-03-22 through 2026-04-25 before this open-source release. Major internal milestones (v0.1 → v2.11) are not separately tagged in the public repository — `v2.12.0` is the first version with a public commit history.
