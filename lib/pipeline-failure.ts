/**
 * lib/pipeline-failure — 出片流程失败时,把失败**留在界面上**。v12.454。
 *
 * 病象:开机请求非 200(实测 401;v12.448 新加的归属守卫会产生 403;还有 402 预算、429、500、断网)
 * 或 SSE 推来 error 事件时,创作工坊**只弹一个几秒就消失的浮层**;浮层一没,界面仍是
 * 「创作中」、各节点「等待编剧完成…」—— 与「跑得慢」完全无法区分,用户会一直干等。
 * v12.433 修过后端「不许把失败标成完成」,这是它的前端孪生。
 *
 * 失败之后:① 顶部标识变「已中断」并给出原因;② 正在跑的节点转 error(没轮到的保持 pending,
 * 它们确实没跑);③ 对话流里留一条**不会消失**的系统消息。
 */
export interface FailableStore {
  nodes: Array<{ id: string; data: { status?: string } }>;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  addChatMessage: (role: any, message: any) => void;
  setPipelineError: (e: { message: string; at: string } | null) => void;
}

/** 把一次失败落到界面状态上。reason 已是给人看的话(不要把内部报错原文直接传进来) */
export function markPipelineFailed(
  store: FailableStore,
  opts: { projectId: string; agentRole: any; reason: string; at?: string },
): void {
  const at = opts.at || new Date().toISOString();
  store.setPipelineError({ message: opts.reason, at });
  // 只有「正在跑」的那个节点算失败;pending 的确实还没跑,标红会谎报范围
  for (const n of store.nodes) {
    if (n.data?.status === 'running') store.updateNodeData(n.id, { status: 'error' });
  }
  store.addChatMessage(opts.agentRole, {
    id: `msg-fail-${at}`,
    projectId: opts.projectId,
    agentRole: opts.agentRole,
    role: 'assistant',
    content: `⚠️ 创作中断：${opts.reason}`,
    createdAt: at,
  });
}

/** 非 200 响应 → 给人看的话。服务端的 message 可能带内部细节,只取它给的 userMsg/message,并截断 */
export function failureReasonFromResponse(status: number, body?: unknown): string {
  const b = body as { userMsg?: unknown; message?: unknown; error?: unknown } | null | undefined;
  const raw = [b?.userMsg, b?.message, b?.error].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (status === 401) return '登录已失效,请重新登录后再开机';
  if (status === 403) return raw?.trim() ? raw.trim().slice(0, 120) : '没有在该项目上创作的权限';
  if (status === 402) return raw?.trim() ? raw.trim().slice(0, 120) : '余额或预算不足,已停在开机前';
  if (status === 429) return '请求太频繁,稍后再开机';
  if (raw?.trim()) return raw.trim().slice(0, 120);
  return `开机失败(HTTP ${status})`;
}
