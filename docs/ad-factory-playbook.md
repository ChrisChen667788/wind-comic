# 说明:本文件是 `.claude/skills/ad-factory/SKILL.md` 的仓库镜像(.claude 被 gitignore)。两处同步改。

# 广告工厂(Ad Factory)— 实测最佳链路

榨汁杯广告实测沉淀(v12.49–v12.93)。一句 brief → 竖屏成片 + A/B 变体 + 发布素材全链。

## 第 1 步:写 brief(决定 80% 效果)

模板(实测出片质量最高的写法):
```
电商广告片:<产品名>,主打"<一句卖点>"。真人实拍风格,<人群>在<场景1>、<场景2>,
<产品动作特写,如:水果放入、一键启动、果汁旋涡特写、畅饮满足>。
竖屏适配抖音小红书,<色调>真人实拍质感,产品特写与真实使用场景,结尾CTA。
全片锁定同一位真人女主角。30秒。
```
要点:
- **必带「电商广告片/广告片」**——触发商业链路全套(现代锚+photoreal 锚+Hook/CTA+karaoke+合规)
- **必带「真人实拍」**——配合 v12.58 锚点防 3D 塑料感
- **必带「全片锁定同一位真人女主角」**——压角色漂移
- 有商品页就先 `POST /api/tools/url-to-brief {url}` 自动出 brief

## 第 2 步:生成

```
POST /api/create-stream
{ "idea": <brief>, "projectId": "ad-<slug>", "videoProvider": "minimax-video", "aspect": "9:16", "duration": 30 }
```
- inline 模式断连不死;进度看 `GET /api/projects/<id>`(assets 增长)而非 SSE
- 自动生效:现代/photoreal 双硬锚、plan 净化、逐镜 VLM 门禁(跨网关视觉兜底)、
  广告法合规、CTA 保障、台词-镜长适配、Ken Burns 兜底、质检报告+发布预检

## 第 3 步:包装车间(一键后期)

```
POST /api/projects/<id>/ad-workshop
{ "platform": "douyin", "aspect": "9:16", "regenVoiceover": false,
  "endCard": { "title": "<CTA问句>", "slogan": "<产品线>", "accentColor": "#00C2FF" } }
```
串起:hook-ideas(5 条弹药)→ recompose(karaoke+安全区+Hook/CTA 卡+3 变体)→ publish-copy → publish-package。
单步失败不连累,返回逐步结果。

手动散件(需要精细控制时):
- `POST .../hook-ideas` → 5 条合规 Hook
- `POST .../recompose` → { aspect, captionStyle:"karaoke", platform, keepShots/dropShots, regenVoiceover, hookCard, endCard, hookVariants }
- `POST .../ab-variant/choose {variant:N}` → 胜者转正
- `POST .../publish-copy` / `GET .../publish-package?platform=douyin`

## 第 4 步:验收清单

1. `GET /api/projects/<id>` → quality_report:**healthScore ≥70 且无 missing-video**(缺镜=供给侧翻车)
2. preflight 三平台 pass
3. ffprobe 成片:竖屏 720×1280、时长≈设计、有音轨
4. 抽帧肉眼验:无 3D 塑料感 / 无古装 / 无烤字乱码 / 角色跨镜一致 / Hook 卡+CTA 卡渲染正确

## 供给侧排障(实测坑)

| 症状 | 根因 | 处置 |
|---|---|---|
| 分镜全占位、成片残片 | MJ 通道 parameter error | 等通道恢复/换图像 provider;质检报告会标 missing-video |
| 视频只成 3/12 镜 | minimax 1008 余额不足 | 充值 minimax(视频主力) |
| Director 慢/超时 | opus-4-8 被 429 | 已切 sonnet-4;确认 OPENAI_CREATIVE_MODEL |
| 门禁不打分 | qingyuntop vision 429 | 自动走 MiniMax abab7 兜底;或配 VISION_FALLBACK_* |
| 成片 3D 感/古装 | 锚点被无视(旧版本) | 确认 ≥v12.58;plan 净化 v12.64 兜底 |
| Kling/Elements 想用但 404 | vectorengine 网关无 Kling 视频端点(实测 POST /v1/videos/image2video 404) | 需原生 api.klingai.com key 或支持 Kling 视频路由的网关;在那之前 KLING_ELEMENTS 别开(开了也 404,白耗一档) |
| 分镜全占位想救 | MJ 挂 + 未配跨网关图像档 | 配 OPENROUTER_API_KEY(v12.96 图像档)+ PEXELS_API_KEY(v12.95 B-roll) |

## 关键 env
`OPENAI_MODEL/OPENAI_CREATIVE_MODEL`(sonnet-4)· `MINIMAX_API_KEY`(视频+TTS+视觉兜底)·
`SHOT_GATE_*`(门禁阈值)· `KLING_ELEMENTS=1`(多参考图一致性,可选)· `STORAGE_DRIVER=s3`(抠图公网化,可选)
