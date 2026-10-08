/**
 * lib/project-format-store (v12.466) — 项目格式的服务端读取 + 出图提示词的色彩注入口。
 *
 * 为什么单独一个文件:`lib/project-format` 被格式条(客户端组件)引用,这里要读库 ——
 * 放在一起的话 webpack 会把 better-sqlite3 打进客户端包(v12.318 导演台踩过,项目页直接 500)。
 *
 * **分镜出图的所有路径都走 `withColorSpace()`,别处不要自己拼色彩段**:
 *   - 整片生成:编排器 `runStoryboardRenderer`(连带其中的 Cameo / 质量门 / 画风审计三种重出,它们在同一句上追加);
 *   - 导演复审后的重出:编排器 `executeReviewFeedback`;
 *   - 整张重生:`/api/projects/[id]/regenerate-storyboard`;
 *   - 九宫格候选:`/api/projects/[id]/candidates`;
 *   - 批量 Cameo 重试:`/api/projects/[id]/cameo-retry-storyboard`。
 * 不接的出图(各有理由,`tests/v12-466-color-space` 的出图入口登记表里逐条登记):角色 / 场景设定图与画风圣经
 * (是参考图,不是成片画面)、构图草图(线稿)、封面、局部重绘(只改一块,其余像素原样保留)。
 */
import { listAssetsByType } from './repos/asset-repo';
import { normalizeProjectFormat, withColorSpaceClause, type ProjectFormat } from './project-format';

/** 项目保存过的格式;没保存过 → null(调用方按默认值处理) */
export async function getProjectFormat(projectId: string): Promise<ProjectFormat | null> {
  const rows = await listAssetsByType(projectId, 'project-format');
  if (!rows.length) return null;
  let data: unknown = {};
  try { data = JSON.parse(rows[0].data || '{}'); } catch { data = {}; }
  return normalizeProjectFormat(data);
}

/**
 * 给一句分镜出图提示词写上项目色彩空间(见 `withColorSpaceClause`)。
 * - 没有项目 id / 没保存过格式 / 选了「不指定」:不加色彩段(已有的旧色彩段照样删掉);
 * - 读库失败:原样返回 —— 色彩是增强项,不能把出图打挂。
 */
export async function withColorSpace(projectId: string | null | undefined, prompt: string): Promise<string> {
  if (!projectId) return prompt;
  try {
    return withColorSpaceClause(prompt, (await getProjectFormat(projectId))?.colorSpaceId);
  } catch {
    return prompt;
  }
}
