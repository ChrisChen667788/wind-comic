# 待办积压清单 · 2026-05-04

> 这是一份**已写出但本会话内没动**的 TODO 清单, 防止"不做不报错也没人记得"。
> 每条带:背景 / 验收方式 / 预计工作量 / 优先级。

---

## 1. staging 真打 Kling FLF API ⚠️ 阻塞 P0.3 真上线

- **背景**: v2.14 P0.3 (commit `580e4bf`) 加了 `KlingService.generateFirstLastFrame()` + `/api/u2v-flf` 路由, 本地用 mock 验证了 11 个 case 都通过(`tests/v2-14-u2v-flf-integration.test.ts`)。但**没在真 Kling API 上跑过 happy path**, 我们对以下细节只是按 docs 推测:
  - request body 用 `image_tail` 字段名 (Kling docs 的 first/last-frame API 字段)
  - 模型名 `kling-v1` 是否支持 FLF, 还是要用 `kling-v1-5` / `kling-v1-6`
  - mode `'professional'` 是否对 FLF 必须
  - poll 间隔与超时 (现在 5s × 120 = 10min) 是否够用
- **验收**: 在 staging (有真 `KELING_API_KEY`) 跑一次 /api/u2v-flf, 提交 2 张图 + "镜头从左推到右", 拿到真 mp4 url。如果失败, 看 `[Kling-FLF]` console 日志判断是字段名不对还是模型名不对。
- **工作量**: 验证 0.5 天;若有字段问题修起来 0.5 天, 总 1 天。
- **优先级**: P1 (功能本身可用, 但首尾帧融合是 Kling 强项, 不验等于这功能没真上线)
- **联系点**: `services/kling.service.ts:96-150` (FLF 方法), `app/api/u2v-flf/route.ts`

---

## 2. create 页镜头语言 chip picker 视觉整合

- **背景**: v2.14 P1.1 (commit `537c489`) 把 `<CameraLanguagePicker>` 平铺在 Engine 选择器下方。现在视觉是裸 chip + heading row, 跟周围的 cinema-card-hi 卡片化布局不太一致, 在 dense info layout 里有点散。
- **建议方案**:
  - 包到 `cinema-card-hi p-3` 内 (匹配 Readout 卡)
  - 加个 `Eyebrow` 小标 + 当前选择 chip 的 EN tag 突出显示
  - 或直接做成 popover (用 v2.13.5 新加的 shadcn Popover) — 主屏只看一行 "CAMERA: ORBIT", 点击展开 12 chip 选择面板
- **工作量**: 0.5 天
- **优先级**: P3 (视觉细节, 不影响功能)
- **联系点**: `app/dashboard/create/page.tsx:715` (插入位置)

---

## 3. BGM 按幕(Act 1/2/3)切换风格

- **背景**: v2.14 P1.2 (commit `537c489`) 修了 BGM 长度同步, 现在 90s+ 长视频可以正确播放完整。但**全程一段 BGM 循环**, 听久会腻 — McKee 三幕结构里第 2 幕通常情绪密度最大, 应当配更紧凑的音乐。
- **建议方案**:
  - 在 `services/hybrid-orchestrator.ts` 的 BGM 生成阶段, 按 script.shots 的 act 字段切 3 段
  - 每段独立调 `MinimaxService.generateMusic` (并行), 用三种不同情绪 prompt
  - 在 composer 里把 3 段 BGM 接力(用 `concat` filter 而不是 `aloop`)
- **工作量**: 1.5 天 (orchestrator 0.5, composer 1)
- **优先级**: P2 (15s × 6 镜以上长视频才有感, 短视频不用)
- **联系点**: `services/hybrid-orchestrator.ts:3287` (BGM 生成), `services/video-composer.ts:514/628` (混音)

---

## 4. v2.14 P0.4 路由层缺额度/计费 gate

- **背景**: 10s/15s 长镜头分别走 Kling Master 和 Vidu Q3 Pro, 这两家**比 Minimax 贵很多**(Vidu ¥0.3/秒, Kling ¥0.2/秒, Minimax ¥0.1/秒)。当前任何用户挑 15s 都直接发起 Vidu 调用, 没过付费 plan gate。
- **风险**: 免费用户挑 15s × 6 镜 = 90s × ¥0.3 = ¥27 一次, 跑 100 次就 ¥2700 真金白银烧出去。
- **建议方案**:
  - `app/api/u2v/route.ts` 的 `routeVideoByDuration` 之前加 plan gate: `await checkPlan(req, duration === 5 || duration === 6 ? 'free' : duration === 10 ? 'pro' : 'enterprise')`
  - 失败时返回 402 + 明确升级提示 ("15s 长镜头需 Enterprise 计划")
- **工作量**: 0.5 天
- **优先级**: P1 (商业化必做; 上线前一定要堵)
- **联系点**: `app/api/u2v/route.ts:31-92` (新增的 routeVideoByDuration), `lib/plan-gate.ts` (已有 helper)

---

## 5. 推送到远程 origin/main 共 10 个 commit 待推

截至 2026-05-04 本会话结束, 本地 main 比 origin 多 10 个 commit:

```
537c489 feat(v2.14 P1): create-page camera default + BGM length sync + FLF integration tests
182362b docs: ROADMAP v2.14 P0 marked shipped + P1 follow-ups noted
580e4bf feat(v2.14 P0): "已有引擎用满" — S2V multi-subject + camera language + first-last-frame + 5/6/10/15s router
ba4d774 docs: v2.13.5 — competitive gap analysis vs Seedance 2.0 / Hailuo / Kling / Vidu
d09a4e6 feat(ui): v2.13.5 — shadcn-style Tabs / Tooltip / Popover on Radix (Phase 4)
6bf814e fix: v2.13.5 — three pipeline bugs (script→agents / composer fallback / U2V reference image)
397aa4a feat(dataviz): v2.13.4 — ScoreDonut on project cards + Sparkline trend in PolishHistory
d8bb3fa feat(ui): v2.13.4 — Aceternity-style MovingBorder + TextGenerate + Spotlight
61c8067 feat(safety): v2.13.4 — prompt guardrails + scope-aware enhancement on every user-input route
9c0769f docs: ROADMAP — record v2.14 P1 commit hash
```

**用户要扫一遍 `git log -p origin/main..HEAD` 后再 `git push origin main`**。

---

## 6. v2.15 后续(本次部分交付,余下下次跟)

| Sprint 项 | 状态 | 备注 |
|---|---|---|
| G9 · 批量草稿 | 见 ROADMAP §4.6 | 本次会做 |
| G8 · 风格 LoRA 库 | 见 ROADMAP §4.6 | 本次会做 |
| G6 · Lip-sync (Kling) | TODO | 等 Kling key 到位 + FLF 验证完再上 |
| G5 · 音视频一体 (Vidu Q3) | TODO | 需真 Vidu key, 实验性, 排到 v2.16 |

---

**作者**: Claude Opus 4.7 · **生成日期**: 2026-05-04 · **每个 sprint 收尾扫一遍此文件清账**
