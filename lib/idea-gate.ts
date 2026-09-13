/**
 * 创作页「开机」按钮的就绪门槛 —— 唯一定义(v12.436)。
 *
 * 修前这个 10 只写在 create/page.tsx 里。案例库的「用这个创作」会带着一句创意跳过来,
 * 而那句创意此前就是案例标题(「月华藏境」,4 个字)—— 跳过去按钮是灰的,点不动。
 * 门槛和「会往这里送创意的入口」必须读同一个数,否则门槛一改,入口就悄悄变回断头路。
 */
export const IDEA_MIN_CHARS = 10;

export function ideaReady(idea: string | null | undefined): boolean {
  return String(idea ?? '').trim().length >= IDEA_MIN_CHARS;
}
