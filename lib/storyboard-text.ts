/**
 * lib/storyboard-text.ts — 分镜资产的「这一镜画的是什么」文字(v13.9)。
 *
 * ── 病象:同一件事存在两个字段里,读的地方只认一个 ─────────────────────
 * 分镜资产(project_assets.type='storyboard')的文字有两种写法:
 *   · 创建页 / 主管线落库 → `data.description`(app/dashboard/create/page.tsx、lib/create-pipeline.ts)
 *   · 重新生成分镜图(regenerate-storyboard)、九宫格选定(candidates/pick)→ `data.prompt`
 * 后两条是**插入新行**,于是用户重生过分镜图或选定过候选之后,这一镜最新的那行只有 `prompt`。
 * 而读分镜文字的地方几乎全都只认 `description`:项目页单镜重生的「改一镜」合并、续跑管线的
 * 分镜断点(读空串后还会把空串回写进这一镜所有分镜行)、Cameo 重画分镜图(MJ 收到「Shot 3」)、
 * 视觉质检、导演审核、项目页卡片 —— 读到空串。
 * 4K 重渲更直接:取的是资产名(「镜头 3」),注释却写着「不传则用现有 storyboard prompt」。
 * 本机库 243 个镜头里 53 个的最新分镜行只有 `prompt`(这 53 镜的第一行都还有 `description`)。
 *
 * ── 修法:一处判定 ─────────────────────────────────────────────────────
 * `description` 优先(创建页写的是剧本的分镜描述,更完整),没有再用 `prompt`。
 * 注意两个字段多半都是给 MJ 出图写的(本机库 233 条 description 带 `--ar` / `--no` 等参数):
 * 交给视频引擎前要过 toPlainPrompt —— 编排器的单镜重生 / runVideoProducer 已经在里面转了,
 * 直调引擎的(4K 重渲)要自己转。
 *
 * 只管「从哪个字段取」,不管「取哪一行」:同一镜有多行时取哪一行由 lib/storyboard-latest 判定(v13.10)。
 */

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 资产 data(JSON 字符串或已解析对象)→ 分镜文字;读不到返回空串 */
export function storyboardText(data: unknown): string {
  let d: unknown = data;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return ''; }
  }
  if (!d || typeof d !== 'object') return '';
  const { description, prompt } = d as { description?: unknown; prompt?: unknown };
  if (nonEmpty(description)) return description;
  if (nonEmpty(prompt)) return prompt;
  return '';
}
