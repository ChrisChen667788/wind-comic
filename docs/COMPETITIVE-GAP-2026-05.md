# 竞品功能缺口 · 2026-05 增量版

> 基础: [competitive-analysis-and-upgrade-plan.md](./competitive-analysis-and-upgrade-plan.md) (2026-04-08)
> 本文针对用户 2026-05-04 提问 — "对比 Seedance 2.0 / 海螺 / 可灵 / Vidu, 我们目前的创作工坊还缺哪些实用功能".
> 范围: 只列**可以在 v2.14 ~ v2.16 内交付**的功能, 不重复已经在 ROADMAP 落账的项 (Cameo / Polish Pro / Stripe).

---

## 0. 现状速览 (v2.13.5)

我们已有的: Director / Writer / Character / Scene / Director-Review 5 角色多智能体 · 多角色 Cameo 锁脸(Phase 1-3) · cw 三档一致性 · 14 转场词汇 · TTS / BGM / 字幕动效 · U2V 单图视频(Minimax I2V-01) · Polish Studio Pro · Cameo 仪表盘 · 4-档 Stripe.

引擎适配已就位的服务文件 (`services/*.service.ts`): minimax / veo / kling / midjourney / fal-flux / seedance / vidu / xverse / banana / comfyui — **路由**层都接好了, 真正缺的是把它们的特色 API 用起来.

---

## 1. 四大竞品最关键的差异化能力(2026-05 现状)

| 竞品 | 单点最强 | 我们对接情况 | 我们用了多少 |
|---|---|---|---|
| **Seedance 2.0** (字节) | **多模态参考(最多 12 张图 + 字符表)** + 多机位摄影语言 | `services/seedance.service.ts` 已存在 | 只 borrowed 风格命名 (`enhanceCharacterPromptSeedance`), 没真接它的 API |
| **海螺 / Hailuo / MiniMax** | **S2V-01 主体一致性** + 长 6s + 真人化色彩 | `services/minimax.service.ts` 已接 I2V/T2V, S2V 也写了但只在 `subjectReferenceUrl` 显式传时触发 | I2V 生效, S2V 形同虚设 |
| **可灵 / Kling 3.0** (快手) | **Omni One 4K/60fps + Master 自动调色** + 镜头语言指令集 (push-in / dolly-zoom / orbit) | `services/kling.service.ts` 已接 | 只用 T2V/I2V 兜底, 没用它的 master / camera control 参数 |
| **Vidu Q3 Pro** (生数) | **Subject Reference (角色定型)** + 16s 原生音视频一体 + 多角色编排 | `services/vidu.service.ts` 已存在 | 服务类基本是 stub, 路由层尚未实际调用 |

---

## 2. 缺口矩阵 (按用户体感排序)

| # | 缺口 | 用户体感 (一句话) | 与之对应的竞品 | 难度 | 推荐版本 |
|---|---|---|---|---|---|
| G1 | **多图参考** (上传 2-12 张图全部进 prompt, 不只是 1 张主角脸) | "我提供了 8 张街景, 但只有第 1 张被用了" | Seedance 12 文件 / Vidu Subject Ref | 中 | v2.14 |
| G2 | **真正的镜头语言下拉/快捷键** (在 create 页直接选 dolly-in / orbit / whip-pan, 而不是在 prompt 里写) | "我不知道写什么 prompt 才能让镜头摇" | Kling Master / Seedance camera | 低 | v2.14 |
| G3 | **S2V 主体一致性入口** (用户上传一张主角图, 后续每个镜头用同一张脸, 不再靠 cref hack) | "Cameo 锁脸老脸跑偏" — S2V 是 Minimax 自己的解法, 我们却没暴露给用户 | Hailuo S2V-01 | 低 | v2.14 |
| G4 | **6s+ 长镜头模式** (单镜支持 10s/15s, 而不是只 5/6s) | "我想要慢推近 + 转场 + 角色入画 30s 整段, 现在只能 5s" | Vidu 16s / Kling 10s | 中 | v2.14 |
| G5 | **音频一体 (BGM + 对白同步生成)** (而不是先视频后 TTS 后对齐) | "TTS 总是和口型对不上" | Vidu 音视频一体 | 高 | v2.15 |
| G6 | **Lip-sync** (角色口型自动跟生成的对白对) | "角色嘴巴不动 / 嘴动得不对" | Kling lip-sync API | 中 | v2.15 |
| G7 | **首尾帧融合** (用户给首帧 + 尾帧, 系统补中间运动) | "我想从 A 图过渡到 B 图" — Kling/海螺都已支持的"首尾帧" | Kling first-last-frame / Hailuo I2V2 | 低 | v2.14 |
| G8 | **风格 LoRA 库** (用户存 5-10 个自定义画风, 一键切) | "我每次都要重新写 'cinematic, 35mm, soft amber light'" | Vidu / Seedance style refs | 中 | v2.15 |
| G9 | **批量草稿 (一次跑 3 个版本对比)** | "我想看同一个剧本三种风格, 现在要排队 3 次" | Kling Master 出 3 草稿 | 低 | v2.15 |
| G10 | **真 4K 出片** (现在 720p/1080p) | "成片放到电视机就糊" | Kling 3.0 / Vidu Q3 4K | 高 | v2.16 |
| G11 | **协作多人编辑** (评论 + @人 + 版本审批) | "我和我对接的剪辑师只能微信传文件" | Higgsfield Cinema Studio | 高 | v3.0 |
| G12 | **Cinema 指令面板** (Logic Pro 风格的轨道时间线, 拖拽镜头/音轨) | "现在的 timeline 太轻量, 不能像 Premiere 那样调" | Higgsfield 2.5 / Runway Gen-4 | 高 | v3.0 |

---

## 3. 推荐 v2.14 - v2.16 三 Sprint 计划

### v2.14 · "已有引擎用满" Sprint (2-3 周)
**主题**: 把已经接进来但只用了 30% 的服务挖到底, 不引新依赖.

- **G3 · S2V 主体一致性入口** (1 天):
  - `app/dashboard/create` 角色锁脸区域已经有上传 — 把 `lockedCharacters[0].imageUrl` 在 orchestrator runVideo 时显式传成 `MinimaxService.generateVideo(_, _, { subjectReferenceUrl: ... })`. 这能立刻把 Cameo 锁脸的下游链路从"猜测 cref"升到"S2V 真主体".
- **G1 · 多图参考** (3 天):
  - `MinimaxService.subjectReferences` (S2V 多主体) 已经在代码里, 没有 UI. create 页加"多角色 + 多场景参考库"上传组件 (复用现有 character-lock-section), 后端把数组拼到 `referenceImages` 字段透到 flux.1-kontext-pro / Seedance.
- **G2 · 镜头语言面板** (2 天):
  - 新组件 `components/create/camera-language-picker.tsx` — 12 个常用镜头 (push-in / pull-out / orbit / dolly-zoom / whip-pan / crash-zoom / handheld / locked-tripod / crane-up / tilt-down / tracking / arc) chip 选择器. 选中后自动注入 prompt-templates `enhanceU2VMotionPrompt` 的 Camera 段, 也注入 Writer prompt 的 cameraWork 字段. 现有 `lib/prompt-templates.ts` 已有 enhanceU2VMotionPrompt 框架, 加 12 个常量 + chip 即可.
- **G7 · 首尾帧融合** (2 天):
  - U2V 页加第二张 "尾帧" 上传位. Kling 已有 first-last-frame API, 调 `KlingService.generateFirstLastFrame(first, last, prompt, duration)`. 新增 `app/api/u2v-flf/route.ts` 端点, 路由 chips 加 "首尾帧融合".
- **G4 · 长镜头模式** (1 天):
  - duration 选项加 10s / 15s. 路由层根据 duration 选模型: 5/6s → 现在的 I2V-01; 10s → Kling Master; 15s → Vidu Q3 Pro. 客户端只看到统一选项.

**v2.14 预期: +4 个 user-facing 功能, 0 新依赖, 复用现有 3 个 service**

### v2.15 · "音视频一体 + 创作效率" Sprint (3-4 周)
- **G6 · Lip-sync** (5 天): 接 Kling lip-sync API. 后端 worker: 视频生成完成后, 取 shot.dialogue → TTS audio → Kling lip-sync → 替换原视频. 加 fallback 阈值, 失败保留原视频 + audioWarning.
- **G9 · 批量草稿对比** (3 天): create 页加 "一次跑 N 版" toggle (1 / 2 / 3). 后端并行启 N 个 orchestrator (限 1 用户 1 排队), UI 出 3 列对比 + "采用此版" 按钮.
- **G8 · 风格 LoRA 库** (4 天): 用户存自定义"风格指纹"(prompt 片段 + 参考图 1-3 张), 创作时一键应用. 数据库新表 `user_style_lora`. 复用现有 global_assets 的 character / scene 库的存储逻辑.
- **G5 · 音频一体 (实验性)** (5 天): 接 Vidu Q3 Pro 的原生音视频一体 API, 替代 "先视频后 TTS 后混" 的 3 步链路. 仅在用户选 "Cinema 模式" 时启用, 老链路保持兜底.

### v2.16 · "成片质量 + 4K" Sprint (2-3 周)
- **G10 · 4K 出片** (3 天): export 路由加分辨率选项 (720 / 1080 / 2160). 2K/4K 用 Kling 3.0 (`MasterModel`) 重渲. 时长上限按计费档位 (Pro 用户最多 30s 4K, Enterprise 60s).
- **优化 G2 G7**: 把 v2.14 的镜头语言面板 + 首尾帧融合做成可复用的"镜头工坊" tab, 集成到项目页

### v3.0 · "协作 + 真专业剪辑" (6-8 周)
- G11 / G12 — 多人协作 + Logic Pro 风格时间线. 这是另一个数量级的工作, 留给独立大版本.

---

## 4. 不建议追的(战略放弃)

- **训练自己的视频模型**: 不在我们的 0.5x 投入下能赢. 继续用调度者定位.
- **真人化数字分身 (Soul Cast / Higgsfield AI 演员)**: Cameo + Character Bible + Locked Faces 已经覆盖中文短剧 80% 用例; 数字演员是好莱坞场景, 我们不抢.
- **3D / 体素生成 (Sora 风)**: 同上, 算力 + 模型成本与目标用户(短剧创作者)价值不成正比.

---

## 5. v2.14 Sprint 启动清单

如果决定按本文 v2.14 推进, 立即可做的"5 分钟 PR":

1. `services/minimax.service.ts` — `generateVideo` 函数加可选的 `subjectReferenceUrl` 透传到 S2V 路径 (代码已存在, 仅需 route 层暴露)
2. `app/dashboard/create/page.tsx` — `lockedCharacters[0]` 在调 `/api/create-stream` body 里加 `enableSubjectReference: true`
3. `lib/prompt-templates.ts` 加 `CAMERA_LANGUAGE_PRESETS` 常量数组 (12 镜头)
4. `services/kling.service.ts` 检查是否已有 `generateFirstLastFrame` 方法; 没有就加一个 stub + TODO 标记

如果决定整体 sprint 排期, 我可以拆成具体 P0 / P1 / P2 任务清单, 直接进 ROADMAP.md.

---

**作者**: Claude Opus 4.7 · **生成日期**: 2026-05-04
