# Design Audit · 阶段十 (v8.3) — Taste Skill 全量 review

> 用 `redesign-existing-projects` + `high-end-visual-design` skill 的审计清单跑一遍现状,
> 记录 **P1–P6 已修** 与 **剩余债务**。基线:暖墨黑 × 金 cinema 设计系统 (品牌资产, 不动)。

## ✅ 已修 (v8.3 P1–P6)

| 审计项 (Taste Skill) | 修复 | 版本 |
|---|---|---|
| Inter / 浏览器默认字体 | → **Plus Jakarta Sans** (next/font 自托管) + JetBrains Mono | P1 |
| 统一 border-radius | → `--radius-xs/sm/md/lg/xl/2xl` 阶梯 + concentric calc | P1 |
| 纯黑 generic box-shadow | → 金色染色 `--shadow-card/-hi/-glow/-inset` (与 --primary 同源) | P1 |
| 全平面无纹理 | → 全局 `.film-grain` 噪点遮罩 (SVG turbulence) | P1 |
| Lucide 默认图标 (高曝光区) | sidebar(18) + dashboard(8) → **Phosphor Light/Duotone** | P1 |
| 卡片平铺无层次 | → Double-Bezel (`.bezel-shell`/`.bezel-core` + 机加工 inset) | P2 |
| 裸露的 CTA 箭头 | → nested CTA `.cta__island` (button-in-button) | P2 |
| `ease` / instant 动效 | → spring `--ease-spring` + `.stagger` 交错入场 + reduced-motion | P3 |
| 三等宽卡片 (AI 标志布局) | → dashboard 12 列 Asymmetric Bento (7×2 hero + 不等高右栏) | P4 |
| 缺 focus ring | → 全局 `:where(...):focus-visible` 金色 2px ring | P5 |
| object-cover 裁切素材 | → 素材库 `object-contain` 完整显示 | P5 |
| 风格画廊空缺 | → 60 张 MiniMax 真实缩略图 | P5 |
| 默认 emoji 图标 (故事模板) | → 18 枚 AI 金色霓虹 emblem (统一母题图标) | P6 |

## ⚠️ 剩余债务 (按影响 × 工作量排序)

| # | 审计项 | 量级 | 计划 |
|---|---|---|---|
| 1 | ~~Lucide → Phosphor 全量迁移~~ | ~~89 文件~~ | ✅ P6.1 已完成 (alias codemod + IconContext light, tsc 0) |
| 2 | `transition-all` → transform/opacity 显式过渡 | 130 处 | P6.2 (GPU 友好 + 避免意外重排; 批量替换风险中等) |
| 3 | 散落装饰 emoji (🎬 ▶ ✨ 🔥 …) | ~20 处按钮/标签 | P6.2 (改 Phosphor 图标或去除) |
| 4 | 纯 `#000` / `bg-black` | 157 处 | P6.3 (多为图片占位底色, 真正该换的少; 低优先) |
| 5 | 全部标题 sentence case (英文) | 全站 | 选做 (中文为主, 收益有限) |
| 6 | AI cliche 文案 scrub | README/marketing | 选做 |

## 结论
阶段十主线 (P1–P6) 把"设计系统层"(字体/圆角/阴影/动效/布局/图标体系) 系统升级到了精品级,
最大的剩余项是 **lucide→Phosphor 的 78 文件长尾迁移** (P6.1) —— 这是 "不要用默认图标" 的彻底落实,
建议作为独立分批任务推进, 不与功能改动混在一起。
