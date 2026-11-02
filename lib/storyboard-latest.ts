/**
 * lib/storyboard-latest.ts — 同一镜有多行分镜资产时,取哪一行(v13.10)。
 *
 * ── 病象:一镜多行,读的地方各取各的 ─────────────────────────────────────
 * 分镜资产(project_assets.type='storyboard')一镜可以有好几行:重新生成分镜图(regenerate-storyboard)
 * 和九宫格选定(candidates/pick)都是**插入新行**、保留旧行。本机库 243 镜里 53 镜有多行(多出 67 行),
 * 这 53 镜的最新行都是重生 / 选定行。而读取方的选行口径三种都有:
 *   · 取最新:项目级单镜重生、4K 重渲、续跑断点、自愈 —— 对的;
 *   · 取第一行(其实是旧行):全局单镜重生、批量补渲、片段重拍、EDL / AAF 导出、mp4 片头封面、
 *     模板预览、shot-spec / param-sync 写回;口型渲染按 version DESC,53 镜一镜都取不到新行 ——
 *     用户重生 / 选定的分镜图被忽略,首帧和文字都用旧的;
 *   · 全取:整阶段重做视频(每行各出一次付费视频,最后谁赢看运气)、视觉质检(每行一次付费视觉调用)、
 *     跑偏检测(每行一次嵌入)、导演审核、Cameo 重画的 sref 链、项目页把同镜多行都列成卡片、
 *     导演台「SHOTS」数的是行数、导出前的示意图审计把已被替换的旧行也算进去。
 *
 * ── 修法:一处判定 ─────────────────────────────────────────────────────
 * 每镜取**最后插入**的那行:created_at 新的优先,再比 updated_at,再比 id(全相同时输入里靠后的赢 ——
 * 结果只由输入决定,同一批数据跑两次判决一样)。
 * 不以 updated_at 为主键:upsert 按镜号把一镜所有行刷成同一时刻(并列),param-sync 之类逐行写 data
 * 也会刷新旧行的 updated_at —— 改了旧行的一个字段,不该让旧图翻身成「当前」。
 * 本机库 53 个多行镜头上,created_at 与 updated_at 两种排序选中的都是同一行(重生 / 选定行)。
 *
 * ── 镜头级字段沿用旧行 ────────────────────────────────────────────────
 * 重生 / 选定行只写 { prompt, regenerated|picked, … },不带 planData / duration / cameraSpec 这些
 * **描述这一镜、不描述这张图**的字段。最新行缺它们时,从较新的旧行补上(返回新对象,不改输入),
 * 否则取了最新行反而丢了机位规划(runVideoProducer 读 planData.cameraAngle / lighting)、时长退回默认值、
 * shot-spec 编辑器里的机位规格清空。图本身的字段(文字 description / prompt、cameo* 评分)**不**沿用 ——
 * 那是旧图的,v13.9 的 storyboardText 只在同一行里判 description / prompt。
 *
 * 纯函数,前后端共用(项目页、导演台、创建页节点图也走它);服务端按项目取行用 lib/repos/asset-repo 的
 * listLatestStoryboards / getLatestStoryboard。门禁:gate:consumer 的 storyboard-row-must-use-latest。
 */

export interface StoryboardRowLike {
  id?: string | null;
  type?: string | null;
  project_id?: string | null;
  projectId?: string | null;
  shot_number?: number | null;
  shotNumber?: number | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  data?: unknown;
}

const STORYBOARD = 'storyboard';

/** 描述「这一镜」而非「这张图」的字段:最新行没有时沿用旧行的 */
export const SHOT_LEVEL_KEYS = ['planData', 'duration', 'cameraSpec', 'dialogue', 'cameraMovement'] as const;

function shotOf(r: StoryboardRowLike): number | null {
  const n = r.shot_number ?? r.shotNumber;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** 时间戳比较:都能解析按时刻比,否则按字符串比(库里是 ISO,字符串序 = 时间序) */
function cmpTime(a: unknown, b: unknown): number {
  const sa = typeof a === 'string' ? a : '';
  const sb = typeof b === 'string' ? b : '';
  if (sa === sb) return 0;
  const ta = Date.parse(sa), tb = Date.parse(sb);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb ? 1 : -1;
  return sa > sb ? 1 : -1;
}

/** a 比 b 新为正、旧为负、分不出为 0 */
function cmpRecency(a: StoryboardRowLike, b: StoryboardRowLike): number {
  const ia = String(a.id ?? ''), ib = String(b.id ?? '');
  return cmpTime(a.created_at ?? a.createdAt, b.created_at ?? b.createdAt)
    || cmpTime(a.updated_at ?? a.updatedAt, b.updated_at ?? b.updatedAt)
    // id 只按字符串比(V8 的 Date.parse 很宽松,随机 id 也可能被当成日期)
    || (ia === ib ? 0 : ia > ib ? 1 : -1);
}

function dataObj(d: unknown): Record<string, unknown> {
  if (d && typeof d === 'object') return d as Record<string, unknown>;
  if (typeof d === 'string') {
    try {
      const v = JSON.parse(d);
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  }
  return {};
}

/** 最新行缺的镜头级字段从旧行补(旧行按新到旧找第一个有值的);没补任何东西就原样返回 */
function inheritShotLevel<T extends StoryboardRowLike>(latest: T, olderNewestFirst: T[]): T {
  if (olderNewestFirst.length === 0) return latest;
  const own = dataObj(latest.data);
  const add: Record<string, unknown> = {};
  for (const k of SHOT_LEVEL_KEYS) {
    if (own[k] != null) continue;
    for (const o of olderNewestFirst) {
      const v = dataObj(o.data)[k];
      if (v != null) { add[k] = v; break; }
    }
  }
  if (Object.keys(add).length === 0) return latest;
  const merged = { ...own, ...add };
  // data 原来是字符串(库行)就还给字符串,是对象(前端行)就还给对象 —— 调用方怎么读还怎么读
  return { ...latest, data: typeof latest.data === 'string' ? JSON.stringify(merged) : merged };
}

/**
 * 每镜一行:同镜多行时取最后插入的那行(见文件头),缺的镜头级字段沿用旧行。
 *
 * 传全部资产也行 —— 只看 type 为 'storyboard' 的行(没有 type 字段的行当分镜行)。
 * 不同项目的行按项目分开取。没有镜号的行无从归并,原样保留、排在最后。
 * 返回按镜号升序;不改输入。
 */
export function latestStoryboardByShot<T extends StoryboardRowLike>(rows: readonly T[] | null | undefined): T[] {
  const groups = new Map<string, { shot: number; project: string; rows: T[] }>();
  const loose: T[] = [];
  for (const r of rows ?? []) {
    if (!r) continue;
    if (typeof r.type === 'string' && r.type !== STORYBOARD) continue;
    const shot = shotOf(r);
    if (shot == null) { loose.push(r); continue; }
    const project = String(r.project_id ?? r.projectId ?? '');
    const key = `${project}#${shot}`;
    const g = groups.get(key);
    if (g) g.rows.push(r); else groups.set(key, { shot, project, rows: [r] });
  }
  const out: Array<{ shot: number; project: string; row: T }> = [];
  for (const g of groups.values()) {
    // 稳定排序:新的在前;分不出新旧时输入里靠后的在前
    const ranked = g.rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => cmpRecency(b.row, a.row) || b.i - a.i)
      .map((x) => x.row);
    out.push({ shot: g.shot, project: g.project, row: inheritShotLevel(ranked[0], ranked.slice(1)) });
  }
  out.sort((a, b) => a.shot - b.shot || (a.project < b.project ? -1 : a.project > b.project ? 1 : 0));
  return [...out.map((x) => x.row), ...loose];
}

/** 某一镜当前的分镜行(口径同 latestStoryboardByShot);没有返回 undefined */
export function latestStoryboardForShot<T extends StoryboardRowLike>(
  rows: readonly T[] | null | undefined,
  shotNumber: number,
): T | undefined {
  return latestStoryboardByShot(rows).find((r) => shotOf(r) === shotNumber);
}
