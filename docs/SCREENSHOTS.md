# 📸 Screenshot Manifest · 实机截图清单

> **v3.1.3 自动化**: 跑 `node scripts/capture-screenshots.mjs` 一键 capture 9 张主要截图到 `assets/screenshot-*-v3.1.3.png`.
> 前置: dev server 在 :3000 (`npm run dev`), demo 用户已 seed (`demo@qfmanju.ai / Qfmanju123`).
> 自动化覆盖: home / dashboard / create / projects / assets / storyboard / cinema-timeline / pacing / comments / workshop (10 张).
> **不在自动化里的**: 协作场景 (双窗口对照) / 邀请 popover / Notification bell dropdown — 这些需要人工拍 (双浏览器 + 弹层交互).
>
> 下文是 v3.1.3+ 仍需要人工拍的部分, 以及历史完整清单.

---

## 1️⃣ 拍摄环境约定

- **机器**: Mac 高分屏 (Retina 2x), 暗色模式
- **窗口尺寸**: 1440 × 900 (营销标准), 重要 modal 用 1200 × 800
- **数据**: 用 demo 项目 (`灵眸·短篇漫剧` 或新建一个"霸总当街拆穿"短剧)
- **协作场景**: 双浏览器并排 (一窗口主用户 = "你", 另一窗口 = "alice", 头像不同色)
- **统一 idea 文本**: "重生归来的霸总当街拆穿前未婚妻的婚礼骗局" (跨所有截图)
- **格式**: PNG, ≤ 800KB per image, 优化用 `tinypng.com` 或 `oxipng`
- **文件名**: `screenshot-<module>-v3.1.3.png` (覆盖旧的)
- **存放**: `assets/`

---

## 2️⃣ 必拍清单 (按 README 顺序)

### 📷 1. Dashboard 创作总览
- **路径**: `/dashboard`
- **元素**:
  - 顶部 API 配额告警 banner (如果 Minimax 还鉴权失败保留, 演示效果)
  - 通知 bell (有未读红点更好)
  - 项目计数 / 最近创作 feed
- **文件**: `screenshot-dashboard-v3.1.3.png`

### 📷 2. 创作工坊
- **路径**: `/dashboard/create`
- **元素**:
  - 顶部 SlateCard + 试拍按钮
  - Idea 输入框 (粘统一 idea 文本)
  - 故事模板库 expanded (18 内置 + 若干个人)
  - Engine selector / Camera language picker / Duration / Aspect
  - 右下角 "🎬 试拍 1 镜" + ROLL 按钮
- **文件**: `screenshot-create-v3.1.3.png`

### 📷 3. Polish Studio Pro
- **路径**: `/dashboard/polish` (或剧本润色入口)
- **元素**: Basic vs Pro 切换 + McKee/Field/Seger 框架 + 多维审核 + before/after diff
- **文件**: `screenshot-polish-v3.1.3.png`

### 📷 4. 素材库
- **路径**: `/dashboard/assets`
- **元素**: 多类别 tab (角色 / 场景 / 模板) + 搜索 + 缩略图网格
- **文件**: `screenshot-assets-v3.1.3.png`

### 📷 5. 我的项目
- **路径**: `/dashboard/projects`
- **元素**: 项目卡片网格, 自动封面 + ScoreDonut 质量徽章 + Sparkline 趋势
- **文件**: `screenshot-projects-v3.1.3.png`

### 📷 6. 分镜详情 (storyboard tab)
- **路径**: `/projects/<id>` → 分镜 tab
- **元素**:
  - 多个 storyboard 卡, 显示 Cameo retry score + Style Audit dims popover
  - 至少 1 个有 "✓ 已重渲" 角标
  - Hover 显示评分气泡
- **文件**: `screenshot-storyboard-v3.1.3.png`

---

## 3️⃣ 🆕 v3.0+ 新模块 (必拍)

### 📷 7. Cinema Timeline (多轨道 + 协作)
- **路径**: `/projects/<id>` → 时间线 tab
- **元素 (重要!)**:
  - 3 行清晰可见: 分镜缩略卡 / BGM 段 (带波形) / 字幕段
  - **至少 1 段 BGM 显示真波形** (项目跑完成片后才有, 提前 `npm run dev` + 跑完 1 个项目)
  - 至少 1 段处于 "已编辑" 状态 (amber ring)
  - **协作模式拍法**: 用第 2 浏览器登 alice 同步打开, 让 alice 在 timeline 上 hover → 主截图能看到 alice 的彩色光标 + "alice" 名字标
  - 段锁演示: alice 点击某 BGM 段开始拖动, 主截图能看到 dashed border + "🔒 alice 编辑中" 角标
- **文件**: `screenshot-cinema-timeline-v3.1.3.png`
- **可选附加 GIF**: `screenshot-timeline-collab.gif` (5s 演示拖动 + snap 闪光 + lock 标显)

### 📷 8. Pacing Analysis (节奏分析)
- **路径**: `/projects/<id>` → 节奏 tab
- **元素**:
  - 3 个 KPI 卡 (平均冲突分 / 反转数 / 通过/待改)
  - 主柱状图: 每镜冲突分柱 (绿/琥珀/红) + 极性 icon (▲▼ — ) + 反转 arrow
  - 底部 warnings 列表 + suggestions 列表 (至少 3 条)
- **文件**: `screenshot-pacing-v3.1.3.png`

### 📷 9. Invite Collaborators (邀请协作者)
- **路径**: `/projects/<id>` → nav 上的 UserPlus button popover 展开
- **元素**:
  - 当前协作者列表 (至少 1 个真人头像 + 角色 select)
  - 创建邀请部分: role select + expires 选择 + 生成按钮
  - 已发链接列表 (至少 1 个)
- **文件**: `screenshot-invite-v3.1.3.png`

### 📷 10. /project-invite/[token] 公开邀请页
- **路径**: 接收方视角的接受邀请页
- **元素**: 项目预览卡 (cover + title) + 角色权限说明 + "接受邀请" CTA
- **文件**: `screenshot-invite-landing-v3.1.3.png`

### 📷 11. 评论 + @ 提及
- **路径**: `/projects/<id>` → 评论 tab
- **元素**:
  - 项目级 CommentThread (至少 3 条 + 1 个 reply)
  - 1 条带 @-mention (高亮琥珀)
  - 下方 per-shot 折叠 details (至少 1 个展开)
  - 输入框显 @ autocomplete dropdown (打开状态)
- **文件**: `screenshot-comments-v3.1.3.png`

### 📷 12. NotificationBell 通知中心
- **路径**: dashboard 右上角 bell 点开
- **元素**: 通知 popover, 至少 3 条 (mention/reply 各几条), 未读红点
- **文件**: `screenshot-notifications-v3.1.3.png`

### 📷 13. 单镜重生 modal (Storyboard Regen Modal)
- **路径**: 镜头工坊 tab → 任意 shot → "改 prompt 重生" 弹 modal
- **元素**: 当前图 + prompt 编辑框 + Style Bible / cref toggle + aspect 选 + (v2.24 B) 上传参考图区域
- **文件**: `screenshot-regen-modal-v3.1.3.png`

### 📷 14. 镜头工坊 tab
- **路径**: `/projects/<id>` → 镜头工坊 tab
- **元素**: per-shot 行列表, "改 prompt 重生" + "4K 重渲" 按钮; 已重渲的镜带绿色 ✓ 标
- **文件**: `screenshot-workshop-v3.1.3.png`

### 📷 15. 模板分享公开页 (OG card 预览)
- **路径**: `/template/<token>` 公开页
- **元素**: icon + name + desc + tags + 克隆按钮 + view/clone 计数
- **文件**: `screenshot-template-share-v3.1.3.png`
- **可选**: `screenshot-template-og-card.png` — 在 og:image 自动生成的 1200×630 卡片 (浏览器开 inspect 看 `<meta og:image>` 直接下)

---

## 4️⃣ 营销专用 (可选, 提升档次)

### 📷 16. Hero / banner shot
- 项目页 + 时间线 + 协作光标 + 通知 + 邀请 全开的 "wow" 截图. 用作 README banner 替换.
- **文件**: `banner-v3.1.3.png`

### 📷 17. Side-by-side 对比 GIF
- 一边: Sora-风 prompt 只出 5 秒粗糙片段
- 另一边: Wind Comic 出 30 秒带字幕带配音的精修
- **文件**: `comparison-vs-sora.gif`

### 📷 18. Pipeline 流程动画
- 8 agent 名字逐个亮起, 每个 1s, 配进度条
- **文件**: `pipeline-flow.gif`

### 📷 19. 多人协作演示
- 双浏览器并排 timeline, 两个光标实时同步, 段锁切换
- **文件**: `realtime-collab-demo.gif` (≤15s)

### 📷 20. BGM 波形 + drag 演示
- BGM 段拖到不同位置 + 自动 snap 到邻居 + 真波形随段移动
- **文件**: `bgm-waveform-snap.gif` (≤10s)

---

## 5️⃣ 完成后

- 把所有新截图放进 `assets/`, **保留旧文件名** (覆盖) 让 README 链接自动指过去
- 如需重命名, 也同步改 `README.md` + `README.zh-CN.md` 的 src 路径
- 可选: 用 imagemagick 批量加阴影 + 微圆角让视觉更精致:
  ```bash
  for f in screenshot-*.png; do
    magick "$f" \( +clone -background black -shadow 30x10+0+5 \) +swap -background none -layers merge +repage "shadow-$f"
  done
  ```

---

## 6️⃣ 谁来拍

候选:
- 用户本人 (你)
- 团队设计师 (推荐 Figma / Sketch 用户)
- 社区 contributor (在 GitHub Issue 发 "good first issue: refresh screenshots", 标 v3.1.3)

时间: 一个晚上 (约 2 小时) 就够全套.

---

*生成于 2026-05-18 (v3.1.3 release).*
