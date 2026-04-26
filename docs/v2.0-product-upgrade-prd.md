# AI-Comic-Studio v2.0 产品升级 PRD（OiiOii 同构竞品反击战）

> 文档版本：PRD v1.1 | 编写日期：2026-04-08
> 关联文档：[`competitive-analysis-and-upgrade-plan.md`](./competitive-analysis-and-upgrade-plan.md) v2.1
> 触发事件：2026.04.07 OiiOii 全球首发，与本项目架构高度同构（7 Agent vs 我方 8 Agent）
>
> **v1.1 更新（2026-04-08 决策同步）**：
> - ✅ Seedance 2.0 走 **即梦官方 API**（非 fal.ai）
> - ✅ 风格库缩略图采用 **Midjourney API 批量生图**（复用现有 mj service）
> - ✅ 上线 **Beta 邀请码闸**（Sprint 0 内交付）
> - ✅ **暂不做 4K**；新增分辨率设置选项，**上限 720P**（提供 360P / 480P / 720P 三档）
> - ✅ 5 大创作模式 **全部保留**，按 Sprint 0/1 分阶段交付

---

## 〇、文档导读

| 章节 | 内容 |
|------|------|
| 一 | 现状基线 vs OiiOii 差距盘点 |
| 二 | 可植入功能识别（原子级映射表） |
| 三 | UI / 交互升级方案（含线框） |
| 四 | 详细 PRD —— 按模块拆解 |
| 五 | 数据模型变更 |
| 六 | 后续开发计划与里程碑（Sprint 0/1/2/3） |
| 七 | 验收标准与度量指标 |
| 八 | 风险与回滚预案 |

---

## 一、现状基线 vs OiiOii 差距盘点

### 1.1 当前 ai-comic-studio 前端基线

| 模块 | 现状 | 实现位置 |
|------|------|---------|
| 路由结构 | `/`, `/create`, `/dashboard/*`, `/projects/[id]`, `/studio`, `/cases`, `/pricing` | `app/**/page.tsx` |
| 创作入口 | 单一大 textarea + 引擎选择三按钮 | `app/dashboard/create/page.tsx` |
| Agent 工作台 | 8 个 Agent 的 React Flow 管线 + 左侧 Chat + 底部时间线 | `components/creation-workspace.tsx`, `pipeline-canvas.tsx`, `agent-chat.tsx` |
| 角色管理 | 增删改查 + 头像 + 视觉锚点 | `components/character-manager.tsx`, `app/dashboard/characters/page.tsx` |
| 风格库 | ❌ 不存在 UI；只有 `lib/story-templates.ts` 几个故事模板 | — |
| 创作模式 | ❌ 单一漫剧模式 | — |
| 全局资产记忆库 | ❌ 不存在；角色仅项目内 | — |
| 输入分辨率 | 仅 720P 单档（无可选） | `services/hybrid-orchestrator.ts` |
| 引擎 | Minimax / Vidu(旧) / 可灵 v1 / Veo 旧 | `services/{minimax,vidu,kling,veo}.service.ts` |
| 数据持久化 | 自研 `lib/db.ts`，无 Prisma | `lib/db.ts` |
| 状态管理 | Zustand（`useAgentStore`, `useProjectWorkspaceStore`） | `lib/store.ts` |
| UI 框架 | shadcn/ui + Tailwind + React Flow（@xyflow/react） | `components/ui/*` |

### 1.2 OiiOii 已具备而我方缺失的能力

| 能力 | OiiOii 实现 | 我方现状 | 差距等级 |
|------|------------|---------|:---:|
| **创作模式入口** | 5 大模式卡片（剧情短片/MV/快剪/漫转视频/IP 衍生） | 单模式 | 🔴 |
| **风格库** | 161 种艺术风格，可搜索/分类 | 无 UI | 🔴 |
| **托管 vs 对话双模式** | 模式切换器 | 仅"AI 主导"流程 | 🟠 |
| **全局资产记忆库** | 高维特征向量，跨项目复用 | 项目内角色 | 🔴 |
| **Seedance 2.0 引擎** | 已直集成 | ❌ | 🔴 |
| **快速出片** | 5–15 分钟 → 1080P 短片 | 8–12 分钟 → 720P | 🟠 |
| **多分辨率设置选项** | 720P/1080P/4K | 仅 720P 无选项 | 🟡 (本期降级为 360P/480P/720P 三档) |
| **首页 Hero + 模式卡片** | 视觉化营销首屏 | 简单登陆页 | 🟡 |
| **响应式 / 移动端** | Web + 平板 + 手机 | 桌面优先 | 🟡 |

### 1.3 我方独有 OiiOii 没有的护城河（不能丢）

| 能力 | 价值 |
|------|------|
| **8 Agent + Gate 门控介入** | 每个 Agent 节点用户可暂停/重写/重试 |
| **McKee 三幕叙事引擎** | 200 字 → 角色弧光 + 三幕结构 + 情绪曲线 |
| **制片人审核闭环** | LLM 100 分制评分 + 自动返工指令 |
| **多引擎智能路由** | 按镜头类型/台词/角色数动态选最优引擎 |
| **React Flow 可视化管线** | OiiOii 是黑盒，我们是"白盒可视化" |

> **核心策略**：把 OiiOii 已验证的"基础设施"快速追平，但**用我方独有的"专业可控"能力包装升级**，避免变成低配版 OiiOii。

---

## 二、可植入功能识别（原子级映射表）

> 评分维度：用户价值（1-10）× 实现成本（1-10，越低越易做）× OiiOii 反制权重（×1.0–×1.3）

### 2.1 必做（v2.0-α，第 1 周 Sprint 0）

| 功能 | 价值 | 成本 | 权重 | 综合 | 植入方式 | 涉及文件 |
|------|:---:|:---:|:---:|:---:|---------|---------|
| **创作模式入口（5 卡片）** | 9 | 8 | 1.3 | **94** | 重做 `/create` 首屏；模式 → 路由参数驱动 orchestrator | `app/create/page.tsx`（新建）, `app/dashboard/create/page.tsx`（重构） |
| **风格库 v1（60 种 + MJ 批量生图）** | 9 | 7 | 1.3 | **82** | 新建风格选择面板组件；风格 → 注入到 prompt + 引擎参数；缩略图复用 `services/midjourney.service.ts` 批量生成 | `components/style-picker.tsx`（新建）, `lib/style-presets.ts`（新建）, `scripts/generate-style-thumbnails.ts`（新建） |
| **全局资产记忆库 v1** | 10 | 7 | 1.3 | **91** | 新数据模型 `GlobalAsset` + 跨项目复用 API；角色卡片栅格 UI | `lib/db.ts`, `types/agents.ts`, `app/dashboard/assets/page.tsx`（重构） |
| **Seedance 2.0 引擎接入（即梦官方 API）** | 10 | 7 | 1.3 | **91** | 新建 `services/seedance.service.ts`；走 **即梦官方** REST API；接入路由 v2 | `services/seedance.service.ts`（新建）, `services/hybrid-orchestrator.ts` |
| **首页 Hero + 模式卡片** | 8 | 9 | 1.2 | **86** | 新设计的 landing page，模式卡片 + 案例瀑布流 | `app/page.tsx`（重构） |
| **Beta 邀请码闸** | 7 | 9 | 1.0 | **63** | 注册时校验邀请码；不通过则进入 waitlist；管理员后台批量发码 | `app/auth/*`, `lib/db.ts`（invite_codes 表）, `app/admin/invites/page.tsx`（新建） |
| **分辨率设置选项（360/480/720P）** | 6 | 9 | 1.0 | **54** | 工作台导出按钮升级为下拉；orchestrator 接收 resolution 参数透传引擎 | `services/video-composer.ts`, `components/resolution-selector.tsx`（新建） |

### 2.2 应做（v2.0-β，第 2-3 周 Sprint 1）

| 功能 | 价值 | 成本 | 权重 | 综合 | 植入方式 |
|------|:---:|:---:|:---:|:---:|---------|
| **托管 / 对话双模式切换** | 8 | 7 | 1.2 | **67** | 创作页顶部 Tab；托管 = 全自动跑完，对话 = 现有 Gate 模式 |
| **风格库扩至 120+** | 7 | 7 | 1.2 | **59** | 持续填充 + 用户上传参考图风格（v2.1 再扩到 160） |
| **可灵 3.0 引擎接入** | 9 | 7 | 1.0 | **63** | `services/kling.service.ts` 升级到 v3 API |
| **Vidu Q3 Pro 引擎接入** | 7 | 7 | 1.0 | **49** | 新建 `services/vidu-q3.service.ts` |
| **5 模式向导补全（MV/快剪/漫转视频/IP衍生）** | 8 | 6 | 1.2 | **58** | Sprint 0 只交付剧情短片，本期补齐 4 模式 |

### 2.3 选做（v2.1，第 4-6 周 Sprint 2）

| 功能 | 价值 | 成本 | 权重 | 综合 |
|------|:---:|:---:|:---:|:---:|
| 时间轴微调编辑器 | 7 | 5 | 1.0 | 35 |
| 移动端 PWA | 6 | 5 | 1.1 | 33 |
| 案例瀑布流社区 | 6 | 6 | 1.0 | 36 |
| 风格库扩至 160+ | 7 | 6 | 1.0 | 42 |
| 1080P 输出（条件: 引擎成本接受） | 7 | 6 | 1.0 | 42 |
| 4K 输出 | 5 | 4 | 1.0 | 20 （v3.0 再考虑） |

### 2.4 不做（明确放弃）

| 功能 | 不做的原因 |
|------|----------|
| 跟着 OiiOii 做"60 秒出片"营销卖点 | 与我方"专业可控"定位冲突 |
| 完全自动化黑盒模式 | 丢失 Gate 门控护城河 |
| 自建 LoRA 训练管线 | 引擎进化更快，成本不划算 |

---

## 三、UI / 交互升级方案

### 3.1 信息架构变更

```
旧 IA:
  /                       (登陆页)
  /create                 (单一表单 → 全屏 Agent)
  /dashboard/*            (项目管理)
  /projects/[id]          (工作台)

新 IA:
  /                       (Hero + 5 模式卡片 + 案例 + 风格预览)
  /create                 (模式选择路由聚合页)
    /create/episodic        (剧情短片向导)
    /create/mv              (音乐 MV 向导)
    /create/quick           (快剪向导)
    /create/comic-to-video  (漫转视频向导)
    /create/ip-derivative   (IP 衍生向导)
  /dashboard/assets         (重构: 全局资产记忆库 - 角色/场景/风格卡片栅格)
  /dashboard/styles         (新建: 风格库浏览页)
  /projects/[id]            (工作台 - 顶部新增"托管/对话"切换 Tab)
  /pricing /help /examples  (沿用)
```

### 3.2 关键页面线框（ASCII Mock）

#### 3.2.1 新首页 `/` (借鉴 OiiOii 的"模式入口"理念)

```
┌─────────────────────────────────────────────────────────────┐
│ 🎬 AI Comic Studio        作品  风格库  案例  定价  登录   │ ← Header
├─────────────────────────────────────────────────────────────┤
│                                                              │
│      你的故事，由 8 位 AI 专家联手拍成片                    │ ← Hero
│      McKee 叙事 · 多引擎路由 · 全程可介入                    │
│                                                              │
│              [立即创作 →]   [看案例]                         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  选择创作模式                                                │ ← 5 模式卡片
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│  │ 📺  │ │ 🎵  │ │ ⚡  │ │ 📖  │ │ 🎨  │              │
│  │剧情  │ │ MV  │ │ 快剪 │ │漫转  │ │IP衍 │              │
│  │短片  │ │     │ │     │ │视频  │ │生设 │              │
│  │      │ │     │ │     │ │     │ │计   │              │
│  │5-15分│ │1分钟│ │30秒 │ │1-3分│ │变体 │              │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘              │
├─────────────────────────────────────────────────────────────┤
│  风格库（60+ 种）                            [浏览全部 →]   │ ← 风格预览
│  [赛博朋克] [水墨] [日漫] [写实] [低多边形] [像素] [..]    │
│  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐         │
│  │  ││  ││  ││  ││  ││  ││  ││  ││  ││  ││  ││  │ ← 缩略图  │
│  └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘         │
├─────────────────────────────────────────────────────────────┤
│  优秀案例                                    [更多 →]       │
│  [案例瀑布流]                                                │
└─────────────────────────────────────────────────────────────┘
```

**视觉规范**：
- 配色：保留现有黑色主题（与 OiiOii 浅色形成区隔），主色 `#7C3AED`（Purple-600）
- 字体：保留现有 Inter / 思源黑体
- 卡片：圆角 16px，hover 上浮 4px + 投影
- 模式卡片：每张 200×260px，含 emoji icon + 标题 + 时长说明 + "开始 →"

#### 3.2.2 创作模式向导页 `/create/episodic`（剧情短片为例）

```
┌─────────────────────────────────────────────────────────────┐
│  ← 返回   📺 剧情短片创作               [托管模式 ▼]        │ ← Tab: 托管/对话
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│ 1️⃣ 故事     │  讲一个故事...                              │
│ 2️⃣ 风格     │  ┌─────────────────────────────────────┐   │
│ 3️⃣ 角色     │  │ [200-50000 字 textarea]              │   │
│ 4️⃣ 引擎     │  │                                      │   │
│ 5️⃣ 输出     │  │                                      │   │
│              │  └─────────────────────────────────────┘   │
│ [步骤侧栏]   │     字符: 234 / 50000                       │
│              │                                              │
│              │  💡 灵感: [赛博朋克侦探] [魔法学院] [..]   │
│              │                                              │
│              │                          [下一步 →]         │
└──────────────┴──────────────────────────────────────────────┘

步骤 2 - 风格选择面板:
┌─────────────────────────────────────────────────────────────┐
│  选择视觉风格              [搜索...]   [全部 ▼ 分类]        │
├─────────────────────────────────────────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                │
│  │ 🌃 │ │ 🖌 │ │ ✨ │ │ 📷 │ │ 🔷 │ │ 🎮 │                │
│  │赛博│ │水墨│ │日漫│ │写实│ │低多│ │像素│                │
│  │朋克│ │    │ │    │ │    │ │边形│ │    │                │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                │
│  [...60+ 风格]                                              │
│                                                              │
│  ✓ 已选: 赛博朋克  | 上传参考图微调 [+]                    │
│                                          [上一步] [下一步→] │
└─────────────────────────────────────────────────────────────┘

步骤 3 - 角色（接入全局资产记忆库）:
┌─────────────────────────────────────────────────────────────┐
│  角色设置                                                    │
├─────────────────────────────────────────────────────────────┤
│  从我的资产库选择:                                           │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ [+ 新建]                             │
│  │👤│ │👤│ │👤│ │👤│                                       │
│  │张│ │李│ │王│ │陈│                                       │
│  └──┘ └──┘ └──┘ └──┘                                       │
│                                                              │
│  本剧角色（AI 自动从故事提取）:                              │
│  • 主角"陈砚" - [使用资产库 ▼]  [新建为资产]              │
│  • 女主"林晚" - [新建为资产]                                │
│                                          [上一步] [下一步→] │
└─────────────────────────────────────────────────────────────┘
```

#### 3.2.3 工作台 `/projects/[id]` 升级（保留现有 + 顶部 Tab）

```
┌─────────────────────────────────────────────────────────────┐
│ ← 我的项目  /  星际物语  💫    [托管 | 对话●]   分享  ⋯   │ ← 新增模式 Tab
├──────────────┬─────────────────────────────────┬───────────┤
│              │                                  │           │
│  AgentChat   │     PipelineCanvas (React Flow)  │ 资产面板  │ ← 新增右侧
│  (现有)      │     (现有，每节点可介入)         │ (新增)    │
│              │                                  │           │
│  💬 messages │     [Director] → [Writer] → ... │ 角色:     │
│              │     ↓                            │ ┌─┐ ┌─┐  │
│              │     [可灵 3.0 / Seedance 2.0]   │ │👤│ │👤│ │
│              │                                  │ └─┘ └─┘  │
│              │                                  │ 场景:     │
│              │                                  │ ┌─┐ ┌─┐  │
├──────────────┴─────────────────────────────────┤ └─┘ └─┘  │
│ Timeline: [shot1][shot2][shot3]... [▶ 播放]    │ 风格: 赛 │
│           [+ 加镜头]  [导出 720P/1080P/4K ▼]   │ 博朋克    │
└─────────────────────────────────────────────────┴───────────┘
```

**关键交互变化**：
1. **顶部新增"托管 / 对话"切换器**
   - 托管：全流程自动跑完，仅在 producer 审核失败时才暂停
   - 对话：现有的 Gate 模式（每个 Agent 节点都可介入）
2. **右侧新增"资产面板"**（默认折叠）
   - 角色卡片栅格（来自全局资产记忆库）
   - 场景缩略图
   - 当前风格 + "更换"按钮
3. **底部 Timeline 导出按钮升级**
   - 分辨率下拉：720P / 1080P / 4K
   - 加水印开关 / 字幕烧录开关 / 片头片尾开关

#### 3.2.4 全局资产记忆库 `/dashboard/assets` 重构

```
┌─────────────────────────────────────────────────────────────┐
│  我的资产库                              [+ 新建资产]       │
├──────────────┬──────────────────────────────────────────────┤
│              │  [角色 (12)] [场景 (8)] [风格 (3)] [道具 (5)]│ ← 类型 Tab
│ 筛选         ├──────────────────────────────────────────────┤
│ ──────       │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ □ 男性       │  │ 头像 │ │ 头像 │ │ 头像 │ │ 头像 │        │
│ □ 女性       │  │      │ │      │ │      │ │      │        │
│ □ 动物       │  │ 陈砚 │ │ 林晚 │ │ 苏白 │ │ 老周 │        │
│ □ 异形       │  │ 30岁 │ │ 25岁 │ │ 28岁 │ │ 60岁 │        │
│              │  │ 律师 │ │ 医生 │ │ 警探 │ │ 教授 │        │
│ 风格         │  │      │ │      │ │      │ │      │        │
│ ──────       │  │用于2 │ │用于5 │ │用于1 │ │用于3 │        │
│ ☑ 写实       │  │个项目│ │个项目│ │个项目│ │个项目│        │
│ □ 日漫       │  └──────┘ └──────┘ └──────┘ └──────┘        │
│ □ 赛博       │                                              │
│              │  [...12 个角色]                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘

点击单个角色 → 详情抽屉:
┌─────────────────────────────────────────┐
│  陈砚                              [编辑]│
├─────────────────────────────────────────┤
│  ┌─────┐                                │
│  │ 大头│  外貌: 黑发短发, 锐利眼神,    │
│  │ 像  │       中等身材, 常着深色西装  │
│  └─────┘                                │
│                                          │
│  视觉锚点 (用于一致性):                  │
│  • 黑色风衣                              │
│  • 银色怀表                              │
│  • 左眉疤痕                              │
│                                          │
│  特征向量: [768 维 embedding]            │
│  历史项目: 星际物语, 黑色档案, ...      │
│                                          │
│  [复用到当前项目]  [导出 JSON]  [删除]  │
└─────────────────────────────────────────┘
```

### 3.3 设计系统增量

新增的 design tokens（写入 `app/globals.css` / Tailwind config）：

```css
/* 模式卡片色 */
--mode-episodic: #7C3AED;    /* 紫 - 剧情 */
--mode-mv: #EC4899;           /* 粉 - MV */
--mode-quick: #F59E0B;        /* 橙 - 快剪 */
--mode-comic: #10B981;        /* 绿 - 漫转视频 */
--mode-ip: #3B82F6;           /* 蓝 - IP 衍生 */

/* 风格卡片缩略图标准尺寸 */
--style-thumb-w: 160px;
--style-thumb-h: 200px;

/* 资产卡片标准尺寸 */
--asset-card-w: 180px;
--asset-card-h: 240px;
```

新增 shadcn/ui 组件需求：
- `ModeCard`（自建，基于现有 Card）
- `StylePicker`（自建，含搜索/分类筛选）
- `AssetGrid`（自建，资产卡片栅格）
- `ResolutionSelector`（基于 Select）
- `ModeSwitch`（基于 Tabs，托管/对话）

---

## 四、详细 PRD —— 按模块拆解

### M1. 创作模式入口（v2.0-α P0）

**用户故事**
> 作为新用户，进入首页时我想立刻看到"我能做哪几种东西"，而不是被一个空白 textarea 吓到不知道写什么。

**功能描述**
1. 首页 Hero 下方展示 5 张创作模式卡片
2. 每张卡片含：emoji icon、模式名、典型时长、一句话说明、"开始 →" 按钮
3. 点击卡片 → 路由到 `/create/<mode>`，向导式创作流程
4. 不同模式的 orchestrator 行为差异化（见 M2）

**5 大模式定义**

| 模式 | 路由 | 输入 | 输出 | 调用 Agent |
|------|------|------|------|-----------|
| 📺 剧情短片 | `/create/episodic` | 200-50000 字故事 | 5-15 分钟 1080P | 全 8 Agent |
| 🎵 MV | `/create/mv` | 歌词/音频 + 情绪 | 1-3 分钟 1080P + BGM 同步 | 7 Agent（无 Producer） |
| ⚡ 快剪 | `/create/quick` | 1-2 句话 | 15-30 秒 1080P | 4 Agent（Director/Writer/Storyboard/Video）|
| 📖 漫转视频 | `/create/comic-to-video` | 上传漫画图片序列 | 1-3 分钟动态化 | 5 Agent（无 Writer/CharDesigner/SceneDesigner）|
| 🎨 IP 衍生 | `/create/ip-derivative` | 角色 + 风格 | 多种变体（海报/短片/壁纸） | 3 Agent（CharDesigner/SceneDesigner/Editor）|

**接受标准**
- ✅ 首页能看到 5 张卡片，hover 有效果
- ✅ 每个 `/create/<mode>` 路由可达
- ✅ 不同模式调用 orchestrator 的 `mode` 参数生效
- ✅ 无 mode 路由（旧 `/create`）兼容重定向到 `/create/episodic`

**涉及变更**
- 新建 `app/page.tsx`（重构首页）
- 新建 `app/create/page.tsx`（模式选择聚合）
- 新建 `app/create/[mode]/page.tsx`（向导壳）
- 新建 `components/mode-card.tsx`
- `services/hybrid-orchestrator.ts` 增加 `mode: CreationMode` 参数

---

### M2. 创作向导（v2.0-α P0）

**用户故事**
> 作为创作者，我希望像填表一样按步骤完成创作，每一步都有清晰提示，而不是"一个 prompt 走天下"。

**5 步向导**（剧情短片为例）

| 步骤 | 内容 | 必填 | 默认值 |
|------|------|:---:|-------|
| 1️⃣ 故事 | 200-50000 字 textarea + 灵感按钮 | ✅ | 空 |
| 2️⃣ 风格 | StylePicker（60 种选 1） | ✅ | 写实 |
| 3️⃣ 角色 | 从资产库选 / AI 自动提取 / 新建 | ⚠️ 可空 | AI 自动 |
| 4️⃣ 引擎 | 智能路由 / 手动指定 | ⚠️ 可空 | 智能 |
| 5️⃣ 输出 | 时长 / 分辨率 / 横/竖屏 | ✅ | 1080P 横屏 |

**步骤侧栏**：左侧固定，显示当前在第几步，已完成步骤打 ✓

**校验规则**
- 故事 < 50 字 → 警告"故事太短，AI 可能脑洞失控"
- 故事 > 30000 字 → 警告"建议拆分成多集"
- 任一步骤可点击侧栏返回修改

**接受标准**
- ✅ 5 个步骤可前进/后退/跳转
- ✅ 校验规则触发正确
- ✅ 完成第 5 步后跳转到 `/projects/[id]` 工作台
- ✅ Wizard 状态在浏览器刷新后不丢失（localStorage）

**涉及变更**
- 新建 `components/wizard/wizard-shell.tsx`
- 新建 `components/wizard/step-story.tsx`
- 新建 `components/wizard/step-style.tsx`
- 新建 `components/wizard/step-characters.tsx`
- 新建 `components/wizard/step-engine.tsx`
- 新建 `components/wizard/step-output.tsx`
- 新建 `lib/wizard-store.ts`（Zustand）

---

### M3. 风格库 v1（v2.0-α P0）

**用户故事**
> 我希望像挑滤镜一样挑视觉风格，看到缩略图就知道效果，而不是猜 prompt 怎么写。

**功能描述**
1. 60 种预设风格，每种含：
   - `id`, `name`, `category`, `thumbnail`, `prompt_fragment`, `negative_prompt`
   - `recommended_engine`（如水墨风推荐 Vidu，赛博朋克推荐 Seedance）
2. 分类：写实 / 动漫 / 艺术 / 复古 / 实验
3. 搜索 + 分类筛选 + 多选预览（暂不支持多风格混合，v2.1 再说）
4. 用户上传参考图微调（v2.0-β）
5. 选中风格 → 注入到所有图片/视频 prompt 末尾

**60 种风格初始清单**（部分）

| 类别 | 风格示例 |
|------|---------|
| 写实 | 电影感、纪录片、新闻摄影、自然光人像、HDR 风景 |
| 动漫 | 日漫现代、宫崎骏、新海诚、京阿尼、京都动画、赛璐璐 |
| 艺术 | 水墨、油画、水彩、铅笔素描、版画、波普 |
| 复古 | 80s VHS、90s 港片、胶片颗粒、黑白老电影、超 8 |
| 实验 | 赛博朋克、低多边形、像素艺术、故障艺术、迷幻 |

**数据结构**

```typescript
// lib/style-presets.ts
export interface StylePreset {
  id: string;
  name: string;
  nameEn: string;
  category: 'realistic' | 'anime' | 'artistic' | 'retro' | 'experimental';
  thumbnail: string;        // /styles/cyberpunk.jpg
  promptFragment: string;   // "cyberpunk, neon lights, rain, holographic..."
  negativePrompt?: string;
  recommendedEngine?: 'kling3' | 'seedance2' | 'viduq3' | 'minimax';
  popularity: number;
}

export const STYLE_PRESETS: StylePreset[] = [
  // 60 个...
];
```

**接受标准**
- ✅ 风格库页面 `/dashboard/styles` 可访问
- ✅ 60 种风格全部有缩略图（先用 placeholder + 后续补真实图）
- ✅ 选中风格在向导步骤 2 持久化
- ✅ 风格 prompt fragment 在 orchestrator 中正确注入

**涉及变更**
- 新建 `lib/style-presets.ts`（60 条数据）
- 新建 `public/styles/*.jpg`（60 张缩略图，先 placeholder）
- 新建 `components/style-picker.tsx`
- 新建 `app/dashboard/styles/page.tsx`
- `services/hybrid-orchestrator.ts` 接收 `styleId` 参数
- `services/midjourney.service.ts`, `services/seedance.service.ts` 支持 prompt 拼接

---

### M4. 全局资产记忆库 v1（v2.0-α P0）

**用户故事**
> 我在 A 项目里设计的角色"陈砚"，下次做 B 项目时不用从头再来，可以直接复用。

**功能描述**
1. 资产类型：角色 / 场景 / 风格 / 道具
2. 每个资产含：
   - 基本信息：name, description, tags, thumbnail
   - 视觉锚点：3-5 个关键视觉特征（用于一致性 prompt 注入）
   - 特征向量：768 维 embedding（先存占位，v2.1 接入真实 embedding）
   - 引用关系：被哪些项目使用
3. 资产库页面：
   - Tab：角色 / 场景 / 风格 / 道具
   - 栅格布局（4 列，响应式 2-6 列）
   - 筛选侧栏：性别 / 年龄段 / 风格 / 标签
   - 点击 → 详情抽屉
4. 跨项目复用：在创作向导 step 3 / 工作台资产面板中"从资产库选择"

**数据模型**（见第五节）

**接受标准**
- ✅ `/dashboard/assets` 页面展示全局资产
- ✅ 可从角色管理新建 → 自动入库
- ✅ 可在新项目向导中复用既有角色
- ✅ 资产关联的项目数实时更新

**涉及变更**
- 新建数据模型 `GlobalAsset`（写入 `lib/db.ts` + `types/agents.ts`）
- 新建 API 路由 `app/api/assets/route.ts`、`app/api/assets/[id]/route.ts`
- 重构 `app/dashboard/assets/page.tsx`
- 新建 `components/asset-grid.tsx`、`components/asset-card.tsx`、`components/asset-detail-drawer.tsx`
- `components/character-manager.tsx` 增加"保存到资产库"按钮

---

### M5. Seedance 2.0 引擎接入（即梦官方 API）（v2.0-α P0）

**用户故事**
> 我希望生成的视频自带音效和对白，且角色一致性达到 90%+。

**功能描述**
1. 新建 `services/seedance.service.ts`，封装 **即梦官方** REST API（jimeng.jianying.com / volcengine 火山引擎接口）
2. 支持 12 文件多模态参考（9 图 + 3 视频 + 3 音频 + 文本）
3. 支持原生音视频一体生成
4. 支持角色替换 / 内容增删 / 视频续写（2026.03 新能力）
5. 路由 v2 在以下场景优先选 Seedance 2.0：
   - 多角色同画面（@提及系统）
   - 有台词镜头
   - 需要原生音效
   - 镜头时长 ≥ 8 秒
6. **本期分辨率上限 720P**（即梦支持 720P/1080P/4K，但本项目本期只暴露 720P 选项）

**API 接口设计**

```typescript
// services/seedance.service.ts
export interface SeedanceV2Options {
  prompt: string;
  duration: 4 | 5 | 8 | 10 | 15;
  resolution: '360p' | '480p' | '720p';   // 本期上限 720P
  referenceImages?: string[];     // 最多 9
  referenceVideos?: string[];     // 最多 3
  referenceAudios?: string[];     // 最多 3
  nativeAudio?: boolean;
  cameraMotion?: CameraMotion;
  // 新增编辑能力
  editMode?: {
    type: 'replace_character' | 'add_content' | 'delete_content' | 'extend' | 'concat';
    sourceVideo: string;
    target?: string;
  };
}

export async function generateVideoSeedance2(opts: SeedanceV2Options): Promise<{
  videoUrl: string;
  audioIncluded: boolean;
  duration: number;
  cost: number;
}>;
```

**即梦官方 API 接入要点**
- **入口**：`https://visual.volcengine.com/api/visual/v1/`（火山引擎视觉服务）
- **鉴权**：AK/SK 签名（HMAC-SHA256），非简单 Bearer Token
- **任务模式**：异步任务（提交 → 轮询 → 拉取结果），不是同步返回
- **轮询策略**：复用现有 `services/midjourney.service.ts` 的指数退避轮询模板
- **超时**：单镜头最长 5 分钟超时，超时后兜底 Minimax/可灵
- **成本**：约 ¥0.30–0.60 元/秒（720P）；本期需在 `lib/db.ts` 增加 `cost_log` 表追踪

**接受标准**
- ✅ `services/seedance.service.ts` 实现并通过单测
- ✅ 即梦 AK/SK 签名生成器单测通过
- ✅ 至少接通一次真实 API 调用，返回有效视频
- ✅ 智能路由 v2 在创作流程中正确选用 Seedance
- ✅ 成本在 `cost_log` 表中正确记录

**涉及变更**
- 新建 `services/seedance.service.ts`
- 新建 `services/jimeng-signer.ts`（火山引擎签名工具）
- `services/hybrid-orchestrator.ts` 升级 `routeVideoEngine` 函数
- 新增 env：`JIMENG_AK`, `JIMENG_SK`, `JIMENG_REGION`（默认 `cn-north-1`）
- 新建 `services/__tests__/seedance.test.ts`
- 新建 `services/__tests__/jimeng-signer.test.ts`

---

### M6. 托管 / 对话双模式（v2.0-β P1）

**用户故事**
> 新手希望"一键全自动"，老手希望"每一步都能介入"。

**功能描述**
1. 工作台顶部新增 Tab 切换器：`托管模式` / `对话模式`
2. **托管模式**：
   - 全流程跑完，期间不弹任何 Gate
   - 仅在 Producer 审核失败时暂停（默认满分阈值 80）
   - 进度通过 SSE 实时推送
3. **对话模式**（现有）：
   - 每个 Agent 节点可暂停/重写/重试
   - 用户可在 Agent Chat 中追加指令
4. 模式切换时保留当前进度

**接受标准**
- ✅ 新建项目默认对话模式，新手引导提示"试试托管模式"
- ✅ 模式切换不丢失项目状态
- ✅ 托管模式下 Producer 审核失败时正确暂停

**涉及变更**
- `components/creation-workspace.tsx` 顶部新增 Tabs
- `services/hybrid-orchestrator.ts` 接收 `executionMode: 'managed' | 'dialogue'`
- `app/api/create-stream/route.ts` 透传模式参数

---

### M7. 分辨率设置选项（360P / 480P / 720P）（v2.0-α P1）

**用户故事**
> 我希望根据用途自由选择清晰度：草稿快速预览时用 360P 省钱省时，正式出片用 720P。

**功能描述**
- 工作台底部 Timeline 的"导出"按钮升级为带分辨率下拉的复合按钮
- 选项：**360P / 480P / 720P**（本期上限 720P，4K 留待 v3.0）
- 创作向导步骤 5"输出"中也提供分辨率选择，默认 720P
- FFmpeg 输出参数化（`-vf scale=...`）
- 各引擎调用时透传分辨率到引擎参数（即梦/可灵/Vidu/Minimax 都原生支持降采样）
- 草稿模式（360P）作为"成本优化"卖点，标注预估成本

**分辨率档位说明**

| 档位 | 分辨率 | 用途 | 单镜头预估成本 | 默认推荐场景 |
|------|--------|------|----------------|--------------|
| 草稿 | 360P (640×360) | 快速预览、迭代 | ¥0.05/镜 | 创作初期试错 |
| 标准 | 480P (854×480) | 内部分享、社媒草稿 | ¥0.15/镜 | 默认 |
| 高清 | 720P (1280×720) | 正式发布 | ¥0.30/镜 | 成片导出 |

**接受标准**
- ✅ 三种分辨率均可生成与导出成功
- ✅ 各引擎参数透传正确（即梦/可灵/Vidu/Minimax）
- ✅ 分辨率切换不丢失项目状态
- ✅ 分辨率与预估成本在 UI 中实时联动显示

**涉及变更**
- `services/video-composer.ts`（FFmpeg 封装）参数化
- `services/seedance.service.ts`、`services/kling.service.ts` 等所有 video service 接收 `resolution` 参数
- 新建 `components/resolution-selector.tsx`
- `components/timeline.tsx` 集成 ResolutionSelector
- `components/wizard/step-output.tsx` 集成
- `types/agents.ts` 中 `Project.outputConfig.resolution` 类型限定为 `'360p' | '480p' | '720p'`

---

### M8. 首页 Hero + 营销页 Polish（v2.0-α P1）

**功能描述**
1. 重构 `app/page.tsx`
2. Hero 文案：「**你的故事，由 8 位 AI 专家联手拍成片**」
3. 子标题：McKee 叙事 · 多引擎路由 · 全程可介入
4. CTA：「立即创作」「看案例」（未登录或无邀请码时跳 waitlist 表单）
5. 5 模式卡片
6. 风格预览（横向滚动 12 张 MJ 生成的缩略图）
7. 优秀案例瀑布流（3 列）
8. 底部 Footer
9. **Beta 状态条**：顶部窄条提示「Beta 内测中，[申请邀请码 →]」

**接受标准**
- ✅ 桌面 / 平板 / 手机三种宽度下布局正确
- ✅ Hero CTA 点击跳转 `/create`（已登录）或 `/auth/waitlist`（未登录）
- ✅ Lighthouse 性能分 ≥ 85

---

### M9. Beta 邀请码闸（v2.0-α P0）

**用户故事**
> 我希望产品在 v2.0 灰度上线时只对申请通过的内测用户开放，保证出片质量和反馈密度。

**功能描述**
1. **注册流程改造**：注册时强制要求填写邀请码，校验通过才能创建账号
2. **Waitlist 表单**：未持有邀请码的用户可填写 waitlist（邮箱 + 用途说明），管理员审批后批量发码
3. **管理员后台**：
   - 批量生成邀请码（CSV 导出）
   - 查看 waitlist 申请并审批
   - 单个用户邀请码失效
4. **邀请码规则**：
   - 8 位大写字母+数字（如 `BETA8X3K`）
   - 单次使用（绑定首个使用的账号后失效）
   - 可设置过期时间（默认 30 天）
   - 可批量绑定一个邀请来源 `source`（用于追踪渠道）

**数据模型**

```typescript
// types/agents.ts
export interface InviteCode {
  code: string;             // BETA8X3K (PK)
  source?: string;          // 渠道追踪："twitter" / "weixin" / "internal"
  status: 'unused' | 'used' | 'expired' | 'revoked';
  usedByUserId?: string;
  usedAt?: string;
  expiresAt?: string;
  createdBy: string;        // admin user id
  createdAt: string;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  purpose: string;          // 申请用途
  source?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedAt?: string;
  inviteCode?: string;      // 审批后绑定的码
  createdAt: string;
}
```

**接受标准**
- ✅ 注册无邀请码 → 自动跳 waitlist
- ✅ 输入有效码 → 注册成功 + 码标记为 used
- ✅ 输入失效码 → 友好错误提示
- ✅ 管理员后台可批量生成 100 个码并 CSV 导出
- ✅ 管理员后台可审批 waitlist 并自动发码
- ✅ 已注册老用户**不受影响**（feature flag 仅作用于新注册流程）

**涉及变更**
- `lib/db.ts`：新增 `invite_codes` / `waitlist` 两张表
- `app/auth/register/page.tsx`：注册表单加邀请码字段
- `app/auth/waitlist/page.tsx`（新建）：waitlist 申请页
- `app/admin/invites/page.tsx`（新建）：管理员后台
- `app/api/auth/register/route.ts`：服务端校验邀请码
- `app/api/admin/invites/route.ts`：批量生成 / 列表
- `app/api/admin/waitlist/route.ts`：审批接口
- `lib/invite-code.ts`：码生成与校验工具
- `middleware.ts`：管理员路由 `/admin/*` 鉴权

---

## 五、数据模型变更

### 5.1 新增类型定义 `types/agents.ts`

```typescript
// 创作模式
export type CreationMode = 'episodic' | 'mv' | 'quick' | 'comic-to-video' | 'ip-derivative';

// 执行模式
export type ExecutionMode = 'managed' | 'dialogue';

// 全局资产
export type GlobalAssetType = 'character' | 'scene' | 'style' | 'prop';

export interface GlobalAsset {
  id: string;
  userId: string;
  type: GlobalAssetType;
  name: string;
  description: string;
  tags: string[];
  thumbnail: string;
  visualAnchors: string[];        // 3-5 个关键视觉特征
  embedding?: number[];            // 768 维特征向量（v2.1 接入）
  metadata: Record<string, any>;
  // 引用追踪
  referencedByProjects: string[];  // 项目 ID 列表
  createdAt: string;
  updatedAt: string;
}

// 风格预设
export interface StylePreset {
  id: string;
  name: string;
  nameEn: string;
  category: 'realistic' | 'anime' | 'artistic' | 'retro' | 'experimental';
  thumbnail: string;
  promptFragment: string;
  negativePrompt?: string;
  recommendedEngine?: VideoEngine;
  popularity: number;
}

// 项目类型扩展
export interface Project {
  // 现有字段...
  mode: CreationMode;              // 新增
  executionMode: ExecutionMode;    // 新增
  styleId?: string;                // 新增：选中的风格
  globalAssetIds: string[];        // 新增：复用的全局资产
  outputConfig: {                  // 新增
    resolution: '360p' | '480p' | '720p';   // 本期上限 720P
    aspectRatio: '16:9' | '9:16' | '1:1';
    targetDuration?: number;
  };
}
```

### 5.2 lib/db.ts 新增表/集合

| 表名 | 字段 | 索引 |
|------|------|------|
| `global_assets` | id, userId, type, ... (见上) | (userId, type), (userId, name) |
| `style_presets` | （静态数据，不入库） | — |
| `projects.mode` | 新增字段 | — |
| `projects.styleId` | 新增字段 | — |
| `projects.globalAssetIds` | 新增字段（JSON 数组） | — |
| `invite_codes` | code, source, status, usedByUserId, expiresAt, ... | (status), (source) |
| `waitlist` | id, email, purpose, status, ... | (status), (email) |
| `cost_log` | id, userId, projectId, engine, resolution, durationSec, costCNY, createdAt | (userId), (projectId), (createdAt) |

### 5.3 API 路由新增

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/assets` | GET | 列出当前用户全局资产 |
| `/api/assets` | POST | 新建全局资产 |
| `/api/assets/[id]` | GET / PATCH / DELETE | 单个资产操作 |
| `/api/assets/[id]/use` | POST | 关联到项目 |
| `/api/styles` | GET | 列出风格预设（静态） |
| `/api/create-stream` | POST | 现有，扩展接收 `mode`, `executionMode`, `styleId`, `globalAssetIds`, `outputConfig` |
| `/api/auth/register` | POST | 现有，扩展校验 `inviteCode` |
| `/api/auth/waitlist` | POST | 提交 waitlist 申请 |
| `/api/admin/invites` | GET / POST | 管理员：列表 / 批量生成 |
| `/api/admin/waitlist` | GET / PATCH | 管理员：审批 |

---

## 六、后续开发计划与里程碑

### 6.1 Sprint 总览

| Sprint | 时间 | 主题 | 关键交付 |
|--------|------|------|---------|
| **Sprint 0** | 第 1 周 | OiiOii 反击战基础设施 | 创作模式入口 + 风格库 v1 + 资产记忆库 v1 + Seedance 2.0 + 新首页 |
| **Sprint 1** | 第 2-3 周 | 模式深化 + 引擎扩展 | 5 模式向导完成 + 可灵 3.0 + Vidu Q3 Pro + 双模式切换 + 多分辨率 |
| **Sprint 2** | 第 4-5 周 | UI 打磨 + 移动端 | 时间轴编辑器 + 移动端 PWA + 案例瀑布流 + 风格库扩至 160+ |
| **Sprint 3** | 第 6 周 | 验收与迭代 | Bug fix + 性能优化 + 用户测试 + 灰度上线 |

### 6.2 Sprint 0 详细任务清单（第 1 周，最关键）

> **本期范围调整**：基于决策"上限 720P + Beta 邀请码 + MJ 生缩略图 + 即梦官方 API"，Sprint 0 任务量增加，按 8 天排期（D1-D8）。

| Day | 任务 | 负责模块 | 验收 |
|:---:|------|---------|------|
| D1 上午 | 数据模型变更（GlobalAsset / Project 扩展 / InviteCode / Waitlist / cost_log） | M4, M5, M9 | 类型定义完成 + db.ts 通过 |
| D1 下午 | 风格预设清单（60 条 prompt + 元数据） | M3 | `lib/style-presets.ts` 完成 |
| D2 上午 | **MJ 批量生缩略图脚本**（60 张，并发 4，跑约 30-40 分钟） | M3 | `scripts/generate-style-thumbnails.ts` 跑通；`public/styles/*.jpg` 完整 |
| D2 下午 | **即梦签名工具 `jimeng-signer.ts` + 单测** | M5 | AK/SK 签名生成正确 |
| D3 全天 | **Seedance 2.0 service 实现**（即梦官方 REST + 异步轮询 + 720P 上限） | M5 | 真实 API 调用通过，返回 720P 视频 |
| D4 上午 | 全局资产 API + db（4 个路由） | M4 | API 单测通过 |
| D4 下午 | **Beta 邀请码 lib + db + register API 改造** | M9 | 单测通过 |
| D5 上午 | StylePicker 组件 + 风格库页 `/dashboard/styles` | M3 | UI 可点击选择，缩略图加载 |
| D5 下午 | AssetGrid + AssetCard + AssetDetailDrawer | M4 | 资产库页面渲染 |
| D6 上午 | 创作模式入口卡片 + 首页 Hero 重构 | M1, M8 | 首页 5 卡片可点击 |
| D6 下午 | **Waitlist 页 + 管理员后台 `/admin/invites`** | M9 | 邀请码批量生成 + 审批通 |
| D7 上午 | Wizard Shell + 5 步骨架（剧情短片完整版） | M2 | 路由可达，步骤可前后切 |
| D7 下午 | **ResolutionSelector 组件** + orchestrator 接入 mode/styleId/globalAssetIds/resolution | M1, M3, M4, M7 | 端到端跑通剧情短片，分辨率三档可选 |
| D8 上午 | 全链路联调 + Bug fix | 全部 | 用户从首页 → 注册（含邀请码）→ 创作 → 出片完整流程通 |
| D8 下午 | Demo + 自测 + 内部分发 100 个邀请码 | 全部 | 内部 Demo + Beta 启动 |

### 6.3 Sprint 1 详细任务清单（第 2-3 周）

| 任务 | 工时 | 优先级 |
|------|:---:|:---:|
| 可灵 3.0 service 升级（注意 720P 上限透传） | 2d | P0 |
| Vidu Q3 Pro service 新建（注意 720P 上限） | 2d | P0 |
| Veo 3.1 Lite service 升级 | 1d | P0 |
| 5 模式向导补全（MV / 快剪 / 漫转视频 / IP 衍生 4 个） | 4d | P0 |
| 托管 / 对话双模式切换 UI | 2d | P0 |
| orchestrator 双模式分支逻辑 | 2d | P0 |
| 工作台右侧资产面板 | 2d | P1 |
| 风格库扩展（60 → 120） + MJ 二批生图 | 3d | P1 |
| 用户上传参考图微调风格 | 2d | P1 |
| 草稿模式（360P）成本展示 + 推荐文案 | 1d | P1 |
| Beta 用户反馈收集面板（管理员后台） | 2d | P1 |

### 6.4 Sprint 2 详细任务清单（第 4-5 周）

| 任务 | 工时 | 优先级 |
|------|:---:|:---:|
| 时间轴编辑器 v1（拖拽 / 调序 / 变速） | 5d | P1 |
| 移动端响应式 + PWA 配置 | 4d | P1 |
| 案例瀑布流 + 标签筛选 | 3d | P1 |
| 风格库扩展（120 → 160） + MJ 三批生图 | 3d | P1 |
| 资产 embedding 接入（OpenAI text-embedding-3-large） | 3d | P2 |
| 1080P 输出可行性评估 + 灰度（依赖引擎成本） | 2d | P2 |

### 6.5 Sprint 3 详细任务清单（第 6 周）

| 任务 | 工时 |
|------|:---:|
| 内测 5 名用户使用反馈收集 | 2d |
| 性能优化（首屏 LCP < 2.5s, 视频出片 < 5min） | 2d |
| Bug fix + 兼容性测试 | 2d |
| 灰度发布 10% 用户 | 1d |

---

## 七、验收标准与度量指标

### 7.1 功能验收（v2.0 整体）

| 指标 | 当前 v1.x | v2.0 目标 | OiiOii 对照 |
|------|:---:|:---:|:---:|
| 创作模式数 | 1 | **5** | 5 |
| 风格预设数 | 0 | **60+** (Sprint 0) → 120 (Sprint 1) → 160 (Sprint 2) | 161 |
| 全局资产记忆库 | ❌ | **✅ v1** | ✅ |
| 视频引擎数 | 4 | **7** | 1 |
| 单镜头最大时长 | 8s | **15s** | 15s |
| **分辨率档位** | 仅 720P 单档 | **360P/480P/720P 三档可选** | 1080P |
| 原生音视频一体 | ❌ | **✅** | ✅ |
| 双模式（托管/对话） | ❌ | **✅** | ✅ |
| 移动端可用 | ❌ | **✅ PWA**（Sprint 2） | ✅ |
| **Beta 邀请码闸** | ❌ | **✅** | ✅（邀请制） |
| **McKee 叙事引擎**（独有） | ✅ | **✅✅ 可视化** | ❌ |
| **制片人审核闭环**（独有） | ✅ | **✅✅ UI 化** | ❌ |
| **Gate 门控**（独有） | ✅ | **✅✅** | ❌ |

### 7.2 质量指标

| 指标 | 目标 |
|------|:---:|
| 首屏 LCP | < 2.5s |
| 创作向导完成率 | > 70% |
| 单项目首段视频出片时间 | < 5 分钟 |
| 720P 导出成功率 | > 95% |
| 360P 草稿成本 | < ¥0.10/镜 |
| 角色一致性（用户打分） | > 8/10 |
| Lighthouse 性能分 | ≥ 85 |
| 移动端可用性 | ≥ 80% 功能可用 |

### 7.3 业务指标（上线后 30 天）

| 指标 | 目标 |
|------|:---:|
| 新用户注册 → 完成首部作品转化率 | > 40% |
| 全局资产记忆库使用率 | > 30% |
| 5 模式分布合理性（无单模式 > 70%） | ✅ |
| 用户 NPS | > 40 |

---

## 八、风险与回滚预案

| 风险 | 概率 | 影响 | 缓解措施 | 回滚预案 |
|------|:---:|:---:|---------|---------|
| **即梦官方 API 申请/审核不下来** | 中 | 高 | D1-D2 立即提交火山引擎申请；并行准备 Volcengine SDK 备用 | 兜底 fal.ai 通道（备用 service） |
| **MJ API 配额不足以生 60 张缩略图** | 中 | 中 | 提前确认 MJ 账号配额；分批跑（一次 20 张），失败重试 | 对失败的风格用 SD-XL 兜底 |
| 即梦签名 AK/SK 调试卡住 | 中 | 中 | D2 单独抽出半天专门调试签名 + 单测覆盖 | 暂用 Vidu Q3 Pro 占位 |
| 全局资产记忆库数据迁移失败 | 低 | 高 | 新表独立，不动旧 character 表 | feature flag 关闭即可 |
| 5 模式向导工时超期 | 中 | 中 | Sprint 0 只交付剧情短片完整流程，其余 4 模式 Sprint 1 补 | 仅暴露剧情短片入口 |
| **Beta 邀请码影响老用户登录** | 低 | 高 | feature flag 仅作用于新注册；老用户走 bypass 通道 | 一键关闭邀请码闸 |
| OiiOii 在我方上线前再发新能力 | 中 | 中 | 本 PRD 留出 20% buffer 应对新增需求 | 评估后插入 Sprint 2 |
| 旧 `/create` 路径用户访问中断 | 低 | 中 | 重定向 `/create` → `/create/episodic` | 保留旧 page.tsx 做兼容 |
| **720P 用户觉得清晰度不够** | 中 | 中 | 在文案中强调"Beta 阶段控制成本，正式版升级 1080P" | Sprint 2 评估 1080P 灰度可行性 |

---

## 九、附录

### 9.1 与竞品分析文档的关联

本 PRD 是 [`competitive-analysis-and-upgrade-plan.md`](./competitive-analysis-and-upgrade-plan.md) v2.1 中"v2.0-α / v2.0-β"阶段的产品落地版。两份文档关系：

- **竞品分析文档**：回答"为什么要做、做什么"
- **本 PRD**：回答"具体怎么做、谁来做、什么时候做"

### 9.2 决策记录

| # | 决策 | 时间 | 理由 |
|:---:|------|------|------|
| 1 | 不做 OiiOii 的"60 秒出片"卖点 | 2026-04-08 | 与"专业可控"定位冲突 |
| 2 | 默认对话模式而非托管模式 | 2026-04-08 | 保留 Gate 门控护城河 |
| 3 | 风格库 v1 只做 60 种 | 2026-04-08 | Sprint 0 周期紧张，先打通 |
| 4 | 全局资产 embedding v2.1 再做 | 2026-04-08 | v1 用 visualAnchors 文字描述足够 |
| 5 | 不做 Prisma 迁移 | 2026-04-08 | 保持现有 lib/db.ts 架构，降低风险 |
| 6 | **Seedance 2.0 走即梦官方 API**（非 fal.ai） | 2026-04-08 | 中文支持/合规友好；火山引擎稳定；fal.ai 仅作兜底 |
| 7 | **风格库缩略图用 Midjourney API 批量生成** | 2026-04-08 | 复用现有 mj service；质量统一；可控可重生 |
| 8 | **Sprint 0 同步上线 Beta 邀请码闸** | 2026-04-08 | 控制初期用户量与反馈密度；保护成本 |
| 9 | **本期暂不做 4K，分辨率上限 720P；提供 360P/480P/720P 三档选项** | 2026-04-08 | 降本控成本；草稿模式（360P）作为新卖点；4K 留待 v3.0 |
| 10 | **5 大创作模式全部保留**，按 Sprint 0/1 分阶段交付（Sprint 0 只剧情短片，Sprint 1 补 4 个） | 2026-04-08 | 保持产品广度与 OiiOii 持平 |

### 9.3 已确认事项追加细则

#### 9.3.1 即梦官方 API 接入清单
- 申请火山引擎账号 → 开通"视觉智能"服务
- 在火山引擎控制台获取 AK/SK
- 测试地域：`cn-north-1`
- env 配置：`JIMENG_AK`, `JIMENG_SK`, `JIMENG_REGION=cn-north-1`
- 申请文档：https://www.volcengine.com/docs/6791
- **D1 立即提交申请**（审核约 1-3 个工作日）

#### 9.3.2 MJ 风格缩略图生产规范
- 复用 `services/midjourney.service.ts`
- 每个风格固定 prompt 模板：`"a young woman in a city, cinematic, [style_prompt_fragment] --ar 4:5 --v 6"`（保证人物+场景统一对照）
- 输出 `public/styles/<style_id>.jpg`，分辨率 640×800
- 批量脚本：`scripts/generate-style-thumbnails.ts`
  - 并发 4，失败自动重试 3 次
  - 跳过已存在文件（断点续跑）
  - 完整生成预估耗时 30-40 分钟
- D2 上午执行，验证产出数量与质量

#### 9.3.3 Beta 邀请码发码计划
- 内测目标：**首批 50 人**（亲友 + Twitter 同行 + 小红书种子用户）
- 预生成 100 个码（留 50 备用）
- 命名规则：`BETA + 5位字母数字`（如 `BETAX3K9P`）
- 单码默认 30 天有效期
- 渠道追踪：`source` 字段记录来源，便于 ROI 分析
- 管理员后台（`/admin/invites`）支持：
  - 批量生成 + CSV 导出
  - 列表查看（按状态/来源筛选）
  - 单码失效
- D8 内部 Demo 后开始分发

#### 9.3.4 分辨率档位与成本表

| 档位 | 用途 | 即梦成本 | 可灵成本 | 推荐场景 |
|------|------|---------|---------|---------|
| 360P 草稿 | 快速预览 | ¥0.05/镜 | ¥0.05/镜 | 创作初期试错（~10 倍便宜） |
| 480P 标准 | 内部分享 | ¥0.15/镜 | ¥0.15/镜 | 默认 |
| 720P 高清 | 正式发布 | ¥0.30/镜 | ¥0.35/镜 | 成片导出 |

> 注：成本数据为预估，需 Sprint 0 D3 即梦实接后校准。

---

*文档结束 — AI-Comic-Studio v2.0 产品升级 PRD*
*版本：v1.1 | 编写：2026-04-08（决策同步版）*
