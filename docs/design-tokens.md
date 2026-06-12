# 设计 token 边界清单:cinema / default 双体系(v11.0 收口)

> v11.0 全仓扫描产物。两套设计语言:**Cinema 工作台**(`.cinema-page` 容器 + `--cinema-*` token,
> 暖金影院风,用于创作/项目页)与 **Default**(`--surface/--border/--primary`,用于 dashboard 数据页与营销页)。
> 本文档是边界规则 + 全部越界条目的处置台账。

**v11.0 已修(P0/P1)**:
- ✅ P0 `components/locale-switcher.tsx` — 共享组件改 Default 系(原 cinema-card-hi 在营销页/dashboard 上下文变量未定义 → 下拉背景透明,真渲染破损)
- ✅ P1 `app/dashboard/usage/page.tsx` — 根容器补 `cinema-page`(页面通体 cinema-* 类)
- ✅ P1 `app/cameo-market/page.tsx` — 根容器补 `cinema-page`
- ✅ P1 `app/workflow-studio/page.tsx` — 根容器补 `cinema-page`

**v11.0.2 已修(P2 批量替换)**:
- ✅ P2 #1 `app/projects/[id]/page.tsx` — 9 处 Default token → cinema 等效值
- ✅ P2 #2 `components/project/distribution-panel.tsx` — 7 处
- ✅ P2 #4 `app/dashboard/projects/page.tsx` — `project-card` ×2 → `cinema-card`
- ✅ P2 #6 `app/dashboard/short-video/page.tsx` — 47 处(--primary/--border/--muted/--surface/--accent-green 全清)

**v11.0.3 已修/复核(P3)**:
- ✅ P3 #5 `app/dashboard/master-prompt/page.tsx` — 10 处 Default token → cinema 等效值
- ✅ P3 #3 复核:`app/dashboard/create/page.tsx` 及三个子组件(camera-language-picker / character-lock-section / style-lora-library)经 v10.5.x 系列重构后已零 Default token 残留,无需改动

豁免项附原因(见下文处置表)。

---

## 一、Token 与工具类清单

### 1.1 Default 系（`/app/globals.css`）

#### CSS Custom Properties

| 分类 | 变量名 |
|------|--------|
| 背景 | `--background` `--background-elevated` `--foreground` |
| 表面 | `--surface` `--surface-strong` `--surface-hover` |
| 主色 | `--primary` `--primary-hover` `--primary-muted` `--primary-glow` |
| 次色 | `--secondary` `--accent` `--accent-green` |
| 文字 | `--text` `--muted` `--soft` |
| 边框 | `--border` `--border-hover` |
| 技术监看 | `--monitor-blue` `--monitor-blue-muted` `--scope-green` `--scope-green-muted` |
| 字体 | `--font-sans` `--font-mono-stack` |
| 圆角 | `--radius-xs` `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-2xl` `--radius`（别名）|
| 阴影 | `--shadow-sm` `--shadow-md` `--shadow-card` `--shadow-card-hi` `--shadow-glow` `--shadow-inset` `--shadow`（别名）|
| 缓动 | `--ease-spring` `--ease-out-quart` |

#### 工具类（globals.css 内定义）

`film-grain` · `glass-card` + hover/before · `bezel-shell` + `bezel-core` · `btn-primary` · `cta` / `cta--gold` / `cta--ghost` / `cta__island` · `btn-ghost` · `btn-icon` · `brand-gradient` · `gradient-text-pink` · `stat-pill` · `chip` · `badge-completed` / `badge-active` / `badge-draft` · `sidebar-nav-item` · `project-card` · `animate-fade-up` / `animate-fade-in` / `animate-zoom-in` / `animate-float` / `animate-shimmer` / `animate-pulse-glow` / `animate-gradient` · `stagger` · `page-glow` · `cosmic-bg` · `art-shelf` · `story-timeline-shot` · `node-shell` · `skeleton` · `focus-ring` · `scroll-area` · `text-gradient-gold` · `ambient-glow` · `custom-scrollbar`

---

### 1.2 Cinema 系（`/app/cinema-theme.css`）

#### CSS Custom Properties（作用域：`.cinema-page { ... }`）

| 分类 | 变量名 |
|------|--------|
| 背景 | `--cinema-bg` `--cinema-surface` `--cinema-surface-2` `--cinema-surface-hi` |
| 文字 | `--cinema-text` `--cinema-text-2` `--cinema-text-3` |
| 主调色 | `--cinema-amber` `--cinema-amber-deep` `--cinema-amber-glow` |
| 功能色 | `--cinema-red` `--cinema-green` `--cinema-blue` |
| 边框 | `--cinema-border` `--cinema-border-hi` |
| 阴影 | `--cinema-shadow` |

#### 工具类（cinema-theme.css 内定义）

`cinema-headline` · `cinema-subhead` · `cinema-mono` · `cinema-eyebrow` · `cinema-card` · `cinema-card-hi` · `cinema-divider` · `cinema-filmstrip` · `cinema-btn` · `cinema-btn-primary` · `cinema-btn-ghost` · `cinema-cta-island` · `cinema-chip` / `cinema-chip-amber` / `cinema-chip-red` / `cinema-chip-green` · `cinema-input` · `cinema-textarea` · `cinema-statusbar` / `cinema-statusbar-item` / `cinema-statusbar-dot` · `cinema-meter` / `cinema-meter-fill` / `cinema-meter-fill-red` · `cinema-inline-code` · `cinema-spotlight` · `cinema-fade-up`

> **容器入口**：`.cinema-page` — 所有 `--cinema-*` 变量在此类上定义，并通过继承传给子元素。`cinema-btn` 等工具类因 `v10.3.3` 改造已加字面兜底值（`var(--cinema-surface-2, #1A1715)`），可在非 `.cinema-page` 上下文安全使用但视觉语言与 Default 系不同。

---

### 1.3 组件目录

`components/cinema/primitives.tsx` — `TimecodeChip` / `AspectChip` / `FilmStripDivider` / `TechReadout` / `Eyebrow` / `SlateCard`（全部使用 cinema-* 类）

`components/cinema/effects.tsx` — Cinema 系特效组件

`components/cinema/dataviz.tsx` — Cinema 系数据可视化组件

`components/ui/glass-card.tsx` — Default 系 `GlassCard` 组件（只用 Default token，无 cinema 污染）

`components/ui/bezel-card.tsx` — Default 系 `BezelCard` 组件（只用 Default token，无 cinema 污染）

## 二、路由组使用面扫描

### 2.1 Cinema 系（`app/projects/[id]`）

`/app/projects/[id]/page.tsx` — 根容器 `className="cinema-page min-h-screen"` ✓  
全页使用 cinema-* 工具类及 `--cinema-*` token。其中**混入了少量 Default 系 token**（见第三节越界条目 #1）。

`/app/project-invite/[token]/page.tsx` — 根容器 `className="cinema-page min-h-screen"` ✓  
全页使用 cinema-* 类，无越界。

`/app/template/[token]/template-client.tsx` — 根容器 `className="cinema-page min-h-screen"` ✓  
全页使用 cinema-* 类，无越界。

`components/project/*` — 所有子组件（`cinema-timeline`, `distribution-panel`, `monitor-tab`, `storyboard-regen-modal` 等）均使用 cinema-* 类，但 `distribution-panel.tsx` 和 `monitor-tab.tsx` **混用了 Default 系 token**（见越界 #2）。

---

### 2.2 Default 系（`app/dashboard`）

**纯 Default 系页面**（无 cinema-page 容器，不使用 cinema-* 类）：

- `/app/dashboard/page.tsx` — 用 `GlassCard` / `BezelCard` / `var(--surface)` / `var(--muted)` / `var(--primary)` ✓
- `/app/dashboard/billing/page.tsx` — Default token 体系 ✓
- `/app/dashboard/characters/page.tsx` — Default token 体系 ✓
- `/app/dashboard/assets/page.tsx` — Default token 体系 ✓
- `/app/dashboard/profile/page.tsx` — 用 `GlassCard` ✓
- `/app/dashboard/jobs/page.tsx` — Default token 体系 ✓
- `/app/dashboard/team/page.tsx` — Default token 体系 ✓
- `/app/dashboard/styles/page.tsx` — Default token 体系 ✓
- `/app/dashboard/polish/page.tsx` — Default token 体系 ✓
- `/app/dashboard/u2v/page.tsx` — Default token 体系 ✓
- `/app/dashboard/story-intake/page.tsx` — Default token 体系 ✓

**越界混用页面**（有 cinema-page 容器但所属 dashboard，或无容器却大量用 cinema-* 类）：

- `/app/dashboard/create/page.tsx` — cinema-page 容器 ✓，但内嵌 Default 系组件（见越界 #3）
- `/app/dashboard/projects/page.tsx` — cinema-page 容器 ✓，但用 `project-card`（Default 系）（见越界 #4）
- `/app/dashboard/master-prompt/page.tsx` — cinema-page 容器 ✓，混用 `var(--primary)` 图标色（见越界 #5）
- `/app/dashboard/short-video/page.tsx` — cinema-page 容器 ✓，混用 `var(--primary)` / `var(--border)` token（见越界 #6）
- `/app/dashboard/usage/page.tsx` — **无 cinema-page 容器**，但大量使用 cinema-headline / cinema-eyebrow / cinema-mono / cinema-card / cinema-chip（见越界 #7）
- `/app/dashboard/templates/page.tsx` — **无 cinema-page 容器**，但使用 cinema-btn（见越界 #8）
- `/app/dashboard/health/page.tsx` — **无 cinema-page 容器**，使用 cinema-mono（见越界 #9）

---

### 2.3 营销页（`app/page.tsx`, `app/pricing`, `app/cases`, `app/help`, `app/examples`）

全部使用 Default 系 token 和工具类（`btn-primary` / `GlassCard` / `var(--surface)` / `var(--border)` / `var(--primary)`），无 cinema-* 污染 ✓。

---

### 2.4 共享 / 跨路由组件

`components/collab/*` — `comment-thread.tsx` / `notification-bell.tsx` / `mention-textarea.tsx` / `presence-avatars.tsx` 全部使用 cinema-* 类，但这些组件同时被挂载在 `/projects/[id]`（cinema 上下文 ✓）和可能被 dashboard 侧边栏复用（见越界 #10）。

`components/locale-switcher.tsx` — 使用 `cinema-btn` 和 `cinema-card-hi`，被以下上下文引用：`site-header`（营销页）、`dashboard/page.tsx`（Default 上下文）、`create/page.tsx`（旧版 create，无 cinema-page 容器）（见越界 #11）。

`components/CameoPanel.tsx` — 已做双模适配（使用 `[.cinema-page_&]:` 条件类），豁免。

`components/cameo/CameoStoryboardWidgets.tsx` — 同上，豁免。

## 三、越界条目逐条清单

### 越界 #1 — `app/projects/[id]/page.tsx`（Cinema 页内混用 Default token）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/projects/[id]/page.tsx`

**表现**：在 `.cinema-page` 容器内出现以下 Default 系 token：
- 第 197 行：`text-[var(--muted)]`（加载占位文字）
- 第 203 行：`text-[var(--muted)]`（项目不存在提示）
- 第 317 行：`text-[var(--muted)]`（简介文本）
- 第 320 行：`text-[var(--primary)]`（主题标签）
- 第 323 行：`border-[var(--border)]`（侧栏分割线）
- 第 646 行：`border-[var(--border)]` / `hover:border-[var(--primary)]`（镜头语言按钮边框）

**处置建议**：改为对应 cinema token（`--cinema-text-3` 替换 `--muted`；`--cinema-amber` 替换 `--primary`；`--cinema-border` 替换 `--border`）。属于遗留默认值，应改。

---

### 越界 #2 — `components/project/distribution-panel.tsx`（Cinema 组件混用 Default token）

**文件**：`/Users/chenhaorui/ai-comic-studio/components/project/distribution-panel.tsx`

**表现**：
- 第 74 行：`text-[var(--primary)]` 图标色
- 第 80 行：`border-[var(--primary)]` / `bg-[var(--primary-muted)]` / `text-[var(--primary)]` 平台切换按钮
- 第 117 行：`border-[var(--border)]` 列表分割线

**处置建议**：该组件专属于 `/projects/[id]`（Cinema 体系），应将 `--primary` 改为 `--cinema-amber`、`--primary-muted` 改为 `--cinema-amber-glow`、`--border` 改为 `--cinema-border`。

---

### 越界 #3 — `app/dashboard/create/page.tsx`（Cinema 容器内混用 Default 组件）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/create/page.tsx`

**表现**：页面以 `cinema-page` 为根容器（第 617 行），但引用了 Default 系组件 `CameraLanguagePicker` / `CharacterLockSection` / `StyleLoraLibrary`（这些子组件内部可能有 Default token）；同时第 175 行的时长切换按钮使用 `border-[var(--border)]` / `text-[var(--muted)]` / `hover:border-[var(--border-hover)]`（Default 系 token）。

**处置建议**：时长切换按钮改为 `cinema-btn` 体系；子组件如确实全为 Cinema 上下文专用，在组件内把 Default token 替换为 cinema 对应值，或在各组件加 `[.cinema-page_&]:` 双模兜底（参照 `CameoPanel` 模式）。

---

### 越界 #4 — `app/dashboard/projects/page.tsx`（Cinema 容器内用 Default 工具类 `project-card`）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/projects/page.tsx`

**表现**：页面以 `cinema-page` 为根容器（第 64 行），但同时使用 Default 系工具类：
- 第 109 行：`project-card animate-shimmer`（skeleton placeholder）
- 第 150 行：`project-card animate-fade-up group`（实际项目卡片）

`project-card` 在 globals.css 内定义，使用 `var(--surface)` / `var(--border)`；在 cinema-page 内这两个变量值正常（因为 cinema-page 只覆盖了 --cinema-* 不覆盖 --surface），所以视觉上可能可用，但语义层面是跨体系引用。

**处置建议**：将 `project-card` 替换为 `cinema-card`（圆角 4px / 影院风格），同时将 hover 阴影改为 cinema-amber 染色。属于真实越界，应改。

---

### 越界 #5 — `app/dashboard/master-prompt/page.tsx`（Cinema 容器内混用 Default token）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/master-prompt/page.tsx`

**表现**：
- 第 116 行：`text-[var(--primary)]` 图标色（Clapperboard 图标）
- 第 119 行：`text-[var(--accent-green)]` 代码高亮
- 第 135 行：`text-[var(--primary)]` 术语高亮

**处置建议**：`--primary` → `--cinema-amber`；`--accent-green` 可保留（与 cinema-green 视觉相近）或改为 `--cinema-green`。轻微越界，建议改。

---

### 越界 #6 — `app/dashboard/short-video/page.tsx`（Cinema 容器内混用 Default token）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/short-video/page.tsx`

**表现**：大量出现 Default 系 token 与 cinema 工具类混用：
- 第 175 行：`border-[var(--border)]` / `text-[var(--muted)]` / `hover:border-[var(--border-hover)]`（时长选择）
- 第 292 行：`border-[var(--primary)]` / `bg-[var(--primary-muted)]` / `text-[var(--primary)]`（镜头尺寸选择）
- 第 309 行：`text-[var(--accent-green)]` / `bg-[var(--surface)]`（AI prompt 展示区）
- 第 359 行 / 368 行 / 381 行 / 384 行：多处 `var(--primary)` / `var(--border)` / `var(--muted)` / `var(--accent-green)` 等

**处置建议**：属于系统性遗留问题，统一批量替换：`--primary` → `--cinema-amber`；`--border` → `--cinema-border`；`--muted` → `--cinema-text-3`；`--surface` → `--cinema-surface`；`--accent-green` → `--cinema-green`。

---

### 越界 #7 — `app/dashboard/usage/page.tsx`（无 cinema-page 容器，大量使用 cinema-* 类）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/usage/page.tsx`

**表现**：页面根容器为 `<div className="max-w-5xl mx-auto flex flex-col gap-5">`（第 101 行），无 `cinema-page` 类，但大量使用：
- `cinema-eyebrow`（第 105 行、130 行、168 行、172 行、183 行等）
- `cinema-headline`（第 106 行、155 行）
- `cinema-mono`（第 109 行、134 行、163 行、169 行、170 行等多处）
- `cinema-card`（第 122 行、123 行、129 行、146 行、155 行、174 行、182 行、200 行）
- `cinema-chip` / `cinema-chip-amber`（第 135 行、165 行）
- `cinema-btn` 系列（第 116 行、118 行、149 行）

因为 `cinema-btn` 等已加字面兜底值（v10.3.3），渲染不会完全失效，但 `cinema-headline` / `cinema-eyebrow`（定义了 `font-family: Source Han Serif`）和 `cinema-card`（定义了 `border-radius: 4px`，依赖 `var(--cinema-surface)` / `var(--cinema-border)`）在非 `.cinema-page` 上下文中会因变量未定义退回 `initial` 值，导致外观异常。

**处置建议**：在页面根容器添加 `cinema-page` 类（此页是创作者经济数据面板，语义上属于 Cinema 工作台），或将所有 cinema-* 类改为 Default 系等效类（`glass-card` / 标准 Tailwind 字体工具类）。推荐前者。

---

### 越界 #8 — `app/dashboard/templates/page.tsx`（无 cinema-page 容器，使用 cinema-btn）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/templates/page.tsx`

**表现**：
- 第 89 行：`cinema-btn !px-3 !py-2 !text-xs`（搜索按钮）
- 第 92 行：`cinema-btn !px-3 !py-2 !text-xs`（收藏过滤按钮）
- 第 160 行：`cinema-btn cinema-btn-primary !px-3 !py-1.5 !text-[11px]`（使用模板按钮）

因 `cinema-btn` 有字面兜底值，渲染正常，但这是语义越界——模板市场属于 dashboard 默认体系。

**处置建议**：豁免，原因：`cinema-btn` 因 `v10.3.3` 已加兜底值且视觉上无破损，改动成本高于收益；模板市场与创作流程强关联，此处是「过渡区」组件。若后续统一体系，改为 `btn-ghost` / `btn-primary` Default 系类。

---

### 越界 #9 — `app/dashboard/health/page.tsx`（无 cinema-page 容器，使用 cinema-mono）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/dashboard/health/page.tsx`

**表现**：
- 第 199 行：`cinema-mono text-white/60`（模型扫描当前值）
- 第 218 行：`cinema-mono`（环境变量展示）

**处置建议**：豁免，原因：`cinema-mono` 仅定义字体族（JetBrains Mono，系统已加载），无 CSS 变量依赖，在任何上下文中视觉行为一致；用于技术监看代码显示是合理的语义。等价替换为 `font-mono` Tailwind 工具类，但收益不显著。

---

### 越界 #10 — `components/collab/*`（cinema-* 类用于共享协作组件）

**文件**：  
`/Users/chenhaorui/ai-comic-studio/components/collab/comment-thread.tsx`  
`/Users/chenhaorui/ai-comic-studio/components/collab/notification-bell.tsx`  
`/Users/chenhaorui/ai-comic-studio/components/collab/mention-textarea.tsx`  
`/Users/chenhaorui/ai-comic-studio/components/collab/presence-avatars.tsx`

**表现**：全部使用 `cinema-card-hi` / `cinema-mono` / `cinema-eyebrow` / `cinema-btn` / `var(--cinema-amber)` / `var(--cinema-border)` 等，且这些组件当前只挂载在 `projects/[id]` 页面（cinema 上下文）。若未来将协作面板引入 Default 上下文（如 dashboard 侧边栏），`--cinema-*` 变量将失效。

**处置建议**：豁免（当前使用范围），但需在组件头部加注释说明：这些组件为 cinema-page 上下文专属，若迁移至 Default 上下文需按 `CameoPanel` 模式做双模适配。

---

### 越界 #11 — `components/locale-switcher.tsx`（cinema-btn / cinema-card-hi 用于营销/dashboard 上下文）

**文件**：`/Users/chenhaorui/ai-comic-studio/components/locale-switcher.tsx`

**表现**：
- 第 22 行：`cinema-btn !px-2.5 !py-1.5 !text-[11px]`（语言切换触发按钮）
- 第 32 行：`cinema-card-hi p-1 shadow-xl`（下拉菜单容器）

被以下上下文调用：
- `components/site-header.tsx`（营销页 header，无 cinema-page）
- `app/dashboard/page.tsx`（Dashboard 首页，无 cinema-page）
- `app/create/page.tsx`（旧版 create，无 cinema-page）

`cinema-card-hi` 使用 `var(--cinema-surface-2)` / `var(--cinema-border-hi)`，在非 cinema-page 上下文这两个值为 `initial`，导致下拉背景透明、边框消失。

**处置建议**：应改。将 `cinema-btn` 改为 `btn-ghost`（Default 系），`cinema-card-hi` 改为 `glass-card` 或明确的 Tailwind 背景色（如 `bg-[var(--background-elevated)] border border-[var(--border)] rounded-md`）。是破坏性越界，优先级高。

---

### 越界 #12 — `app/error.tsx` / `app/loading.tsx`（根级页面硬编码 --cinema-amber）

**文件**：
- `/Users/chenhaorui/ai-comic-studio/app/error.tsx`（第 17 行）
- `/Users/chenhaorui/ai-comic-studio/app/loading.tsx`（第 8 行）

**表现**：直接使用 `var(--cinema-amber, #E8C547)` 作为图标/spinner 颜色，字面兜底 `#E8C547` 使渲染正常。

**处置建议**：豁免，原因：字面兜底值 `#E8C547` 与 Default 系 `--primary: #E8C547` 完全一致，视觉无差异，功能无破损。若后续修改 cinema 主色时需同步检查此处。

---

### 越界 #13 — `app/cameo-market/page.tsx`（无 cinema-page 容器，使用 cinema-btn）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/cameo-market/page.tsx`

**表现**：
- 第 123 行：`cinema-btn cinema-btn-primary`
- 第 132 行：`cinema-btn`

页面根容器 `<div className="min-h-screen bg-[var(--cinema-bg,#0a0a0f)] ...">`，使用 `--cinema-bg` 作背景但无 `.cinema-page` 类，`--cinema-*` 变量因此未定义。

**处置建议**：给根容器添加 `cinema-page` 类（只缺这一步），Cameo 市场属于 cinema 体系产品面。

---

### 越界 #14 — `app/workflow-studio/page.tsx`（无 cinema-page 容器，大量使用 cinema-* 类）

**文件**：`/Users/chenhaorui/ai-comic-studio/app/workflow-studio/page.tsx`

**表现**：根容器 `<div className="min-h-screen bg-[var(--cinema-bg,#0a0a0f)] ...">` 使用 `--cinema-bg` 背景，但无 `.cinema-page` 类；同时使用 `cinema-btn` / `cinema-btn-primary` / `cinema-input` / `cinema-eyebrow` 等多个 cinema 工具类（`--cinema-*` 变量在此上下文均未定义）。

**处置建议**：给根容器添加 `cinema-page` 类，同 cameo-market。

## 四、边界规则建议与越界处置汇总

### 4.1 边界规则（一句话/组）

| 路由组 | 边界规则 |
|--------|----------|
| **Cinema 工作台**（`/projects/*` / `/project-invite/*` / `/template/*` / `/cameo-market` / `/workflow-studio`）| 所有 UI 类和 token 必须来自 `.cinema-page` 上下文；根容器必须携带 `cinema-page` 类；禁止引入 `glass-card` / `btn-primary` / `stat-pill` / `project-card` 等 Default 系工具类；禁用 `--primary` / `--surface` / `--border` / `--muted`（改用对应 `--cinema-*`）。 |
| **Default Dashboard**（`/dashboard/*`，无 cinema-page 容器的子页）| 只使用 Default 系 token 和工具类（`glass-card` / `btn-primary` / `var(--surface)` 等）；不得引入 `cinema-card` / `cinema-headline` / `cinema-eyebrow`（字体不同）；如需单行等宽数字展示，用 Tailwind `font-mono` 代替 `cinema-mono`。 |
| **Dashboard 中的 Cinema 子页**（`/dashboard/create` / `/dashboard/projects` / `/dashboard/master-prompt` / `/dashboard/short-video`）| 根容器加 `cinema-page`，内部只用 cinema-* 类和 `--cinema-*` token；禁止在 cinema 容器内混用 Default 系 `--primary` / `--border` / `--surface`（需全部替换为 cinema 对应值）。 |
| **营销页**（`/` / `/pricing` / `/cases` / `/help` / `/examples`）| 只使用 Default 系 token 和工具类；禁止任何 cinema-* 类。 |
| **共享组件**（`components/collab/*` / `components/locale-switcher` / `CameoPanel` 等）| 若仅在 cinema 上下文使用，可用 cinema-* 类，需在组件 JSDoc 注明「cinema-page 上下文专属」；若在 Default 上下文也使用，必须按 `CameoPanel` 模式（`[.cinema-page_&]:` 条件类）做双模适配，或改用 Default 系类。 |

---

### 4.2 越界处置优先级

| 优先级 | 条目 | 处置 | 原因 |
|--------|------|------|------|
| P0（破坏渲染）| #11 `locale-switcher`（在营销/dashboard 上下文用 cinema-card-hi）| **改**：`cinema-btn` → `btn-ghost`；`cinema-card-hi` → `bg-[var(--background-elevated)] border border-[var(--border)] rounded-md` | `--cinema-surface-2` 变量未定义，下拉背景透明 |
| P1（语义错误 + 潜在渲染问题）| #7 `dashboard/usage/page.tsx`（无 cinema-page 容器）| **改**：根容器加 `cinema-page` 类 | `cinema-headline` 字体依赖变量 |
| P1 | #13 `cameo-market/page.tsx`（无 cinema-page 容器）| **改**：根容器加 `cinema-page` 类 | 一行改动，代价最低 |
| P1 | #14 `workflow-studio/page.tsx`（无 cinema-page 容器）| **改**：根容器加 `cinema-page` 类 | 同上 |
| P2（语义越界）| #4 `dashboard/projects/page.tsx`（cinema 容器用 `project-card`）| **改**：`project-card` → `cinema-card`，调整 hover 阴影 | 圆角/阴影风格冲突 |
| P2 | #1 `projects/[id]/page.tsx`（cinema 页内零散 Default token）| **改**：批量替换 `--muted`/`--primary`/`--border` 为 cinema 等效值 | 零散但系统性 |
| P2 | #2 `distribution-panel.tsx`（cinema 组件用 Default token）| **改**：同上 | Cinema 体系专属组件 |
| P2 | #6 `dashboard/short-video/page.tsx`（cinema 容器内大量 Default token）| **改**：批量替换 | 同 #1 |
| P3（轻微）| #3 `dashboard/create/page.tsx`（cinema 容器内子组件零散 Default token）| **改**（低优先级）：子组件内替换或加双模兜底 | 改动面广，分批进行 |
| P3 | #5 `dashboard/master-prompt/page.tsx`（几处 `--primary` 图标色）| **改**（低优先级）：`--primary` → `--cinema-amber` | 影响小 |
| 豁免 | #8 `dashboard/templates/page.tsx`（cinema-btn 有兜底值）| 豁免 | 兜底值正常，过渡区页面 |
| 豁免 | #9 `dashboard/health/page.tsx`（cinema-mono 无变量依赖）| 豁免 | 仅字体栈，无变量依赖，功能完整 |
| 豁免 | #10 `components/collab/*`（cinema 专属上下文）| 豁免（加注释）| 当前仅在 cinema 上下文使用 |
| 豁免 | #12 `error.tsx` / `loading.tsx`（字面兜底值一致）| 豁免 | 兜底值与 `--primary` 相同 |

## 盘点备注

1. `cinema-btn` 系列从 v10.3.3 起已加字面兜底值（如 `var(--cinema-surface-2, #1A1715)`），所以在非 `.cinema-page` 上下文不会完全失效，但 `cinema-card` / `cinema-card-hi` / `cinema-headline` / `cinema-eyebrow` / `cinema-input` / `cinema-textarea` 仍然依赖未定义的 `--cinema-*` 变量，在无 `.cinema-page` 容器时会出现背景透明、字体回退等渲染问题。

2. `.cinema-page` 类只覆盖 `--cinema-*` 变量，不覆盖 `--surface` / `--border` / `--primary` 等 Default 系变量。因此在 cinema-page 内使用 Default 系 token 在技术上可行（变量有值），但语义上是越界——两套颜色值来源不同（暖金 #E8C547 vs 琥珀 #C9A35E；--border #242220 vs --cinema-border rgba(245,241,234,0.08)），混用会造成细微但可见的颜色不一致。

3. `CameoPanel.tsx` 和 `CameoStoryboardWidgets.tsx` 使用了 `[.cinema-page_&]:` 条件类做双模适配，是正确的共享组件跨系统模式，其他需要跨两个体系的组件应参照此模式。

4. `--monitor-blue` 和 `--scope-green` 是 Default 系中为「技术监看」专设的功能色（v9.2.3 P4.1），在 monitor-tab.tsx 中混用这两个 Default 系 token 与 cinema-* 类属于有意为之（技术监看功能色不分体系），是正当使用，不算越界。

5. `project-card`（globals.css）的 hover 阴影颜色使用了 `rgba(232, 197, 71, 0.1)`，与 `cinema-amber #C9A35E` 色调不同（亮金 vs 深琥珀），在 cinema-page 内使用 project-card 会产生可见的 hover 色调冲突。
