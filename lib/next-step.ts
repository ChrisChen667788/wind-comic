/**
 * lib/next-step (v10.5.4) — 「继续创作」卡的纯函数核心(可单测)。
 * 从项目列表挑「最该继续的一部」+ 按状态给下一步建议。
 */
export interface ProjectLike {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  updated_at?: string;
  scriptData?: { shots?: unknown[] } | null;
}

export interface NextStep {
  /** CTA 文案 */
  label: string;
  /** 一句话建议 */
  hint: string;
}

function updatedAt(p: ProjectLike): string {
  return p.updatedAt || p.updated_at || '';
}

/**
 * 挑选优先级:创作中(active)> 草稿(draft)> 最近更新的任意一部。
 * 直觉:有未完成的活先续上;都完成了就回到最近那部做导出/审计。
 */
export function pickContinueProject<T extends ProjectLike>(list: T[]): T | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => (updatedAt(b) > updatedAt(a) ? 1 : -1));
  return (
    sorted.find((p) => p.status === 'active') ||
    sorted.find((p) => p.status === 'draft') ||
    sorted[0]
  );
}

export function suggestNextStep(p: ProjectLike): NextStep {
  const shots = p.scriptData?.shots?.length ?? 0;
  switch (p.status) {
    case 'draft':
      return shots > 0
        ? { label: '回到工坊,开机 ROLL', hint: '剧本草稿已就绪,还没跑完整流水线' }
        : { label: '补全设定,开机 ROLL', hint: '这部还停在创意阶段 —— 30 字创意即可开拍' };
    case 'active':
      return { label: '查看创作进度', hint: '流水线进行中;阶段细节可在「任务队列」查看' };
    case 'completed':
      return { label: '看成片 · 跑审计 · 导出', hint: '试试节奏审计与 EDL/AAF 导出,弱镜可单镜 4K 重渲' };
    default:
      return { label: '打开项目', hint: '从上次停下的地方继续' };
  }
}
