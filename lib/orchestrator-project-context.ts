/**
 * 项目上下文贯通(v12.132.0,issue #2 Bug B 修复的公共件)。
 *
 * 病根:多个「单镜重生 / 补拍」入口各自 `SELECT style_id` 贯通画风,却都漏了角色参考
 * (`primary_character_ref` / `locked_characters`)—— 于是重生的图/视频拿不到主体参考,
 * 角色 DNA(如「戴紫色棒球帽的毛绒怪物」)丢失。把「解析 + 贯通」抽成一处,各入口统一调用,
 * 杜绝再漏。解析为纯函数可测;应用为薄封装(注入 orchestrator 的三个 setter)。
 */

export interface ProjectContextRow {
  style_id?: string | null;
  primary_character_ref?: string | null;
  locked_characters?: string | null; // JSON 字符串
}

export interface ProjectContext {
  styleId?: string;
  primaryRef?: string;
  lockedCharacters: Array<{ name: string; role: string; cw: number; imageUrl: string; traits?: unknown; refs?: Array<{ role: string; url: string }> }>;
}

/** 供各重生入口统一取列的 SELECT(列名与 projects 表一致)。 */
export const PROJECT_CONTEXT_COLUMNS = 'style_id, primary_character_ref, locked_characters';

/** 纯函数:projects 行 → 上下文;locked_characters 容错解析(非法 JSON → 空数组)。 */
export function parseProjectContext(row: ProjectContextRow | undefined | null): ProjectContext {
  const out: ProjectContext = { lockedCharacters: [] };
  if (!row) return out;
  if (row.style_id) out.styleId = row.style_id;
  if (row.primary_character_ref) out.primaryRef = row.primary_character_ref;
  if (row.locked_characters) {
    try {
      const l = JSON.parse(row.locked_characters);
      if (Array.isArray(l)) out.lockedCharacters = l;
    } catch { /* 非法 JSON → 保持空数组 */ }
  }
  return out;
}

/** 最小 orchestrator 接口(只需三个贯通 setter),避免引入重型依赖/循环引用。 */
export interface OrchestratorContextSink {
  setUserStyle(style: string): void;
  setPrimaryCharacterRef(url: string): void;
  setLockedCharacters(arr: ProjectContext['lockedCharacters']): void;
}

/** 把项目上下文(画风 + 角色参考)贯通进 orchestrator。返回实际贯通了哪些(便于日志)。 */
export function applyProjectContext(orchestrator: OrchestratorContextSink, ctx: ProjectContext): { style: boolean; primaryRef: boolean; locked: number } {
  const applied = { style: false, primaryRef: false, locked: 0 };
  if (ctx.styleId) { orchestrator.setUserStyle(ctx.styleId); applied.style = true; }
  if (ctx.primaryRef) { orchestrator.setPrimaryCharacterRef(ctx.primaryRef); applied.primaryRef = true; }
  if (ctx.lockedCharacters.length > 0) { orchestrator.setLockedCharacters(ctx.lockedCharacters); applied.locked = ctx.lockedCharacters.length; }
  return applied;
}
