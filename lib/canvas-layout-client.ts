/**
 * lib/canvas-layout-client — 浏览器侧的「拖完就存」。v12.454。
 *
 * 从画布组件里抽出来,是为了**能真测**:这条线(拖动 → 防抖 → PATCH)一断,
 * 界面上完全看不出来 —— 拖动照样跟手,只是刷新之后位置没了。本仓最常见的坏法就是
 * 「写了保存却没接上」,而组件层要起 ReactFlow 才能渲染,测不到这一步。
 */
import { getToken } from '@/lib/auth';
import type { CanvasPositions } from '@/lib/canvas-layout';

export type SaveFetch = (url: string, init: RequestInit) => Promise<{ ok?: boolean; status?: number; json?: () => Promise<any> } | unknown>;
export type SaveResult = { ok: true } | { ok: false; reason: string };

/** 坐标取整:ReactFlow 给的是浮点,存库没必要带 12 位小数 */
export function roundPositions(nodes: Array<{ id: string; position: { x: number; y: number } }>): CanvasPositions {
  const out: CanvasPositions = {};
  for (const n of nodes) out[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
  return out;
}

/**
 * 发一次保存。**存不上不抛**:布局是增强项,不能因为它把画布交互打挂;
 * `keepalive` 让「拖完立刻关标签页」那一次也能送出去。
 *
 * 但**不抛 ≠ 不说**:真机验证时把节点拖到极远处,接口按范围校验回了 400,而界面上
 * 一点反馈都没有 —— 拖动照样跟手,刷新才发现没存上。失败必须回给调用方去告诉用户。
 */
export async function saveCanvasLayout(
  projectId: string, positions: CanvasPositions, fetchImpl: SaveFetch = fetch as unknown as SaveFetch,
): Promise<SaveResult> {
  const tok = getToken();
  try {
    const res = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/canvas-layout`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ positions }),
      keepalive: true,
    }) as { ok?: boolean; status?: number; json?: () => Promise<any> } | undefined;
    if (res && res.ok === false) {
      let reason = `保存失败(HTTP ${res.status ?? '?'})`;
      try {
        const body = res.json ? await res.json() : null;
        const msg = body?.error || body?.message;
        if (typeof msg === 'string' && msg.trim()) reason = msg.trim().slice(0, 120);
      } catch { /* 读不出就用状态码那句 */ }
      return { ok: false, reason };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: '网络不通,画布布局没能保存' };
  }
}

/**
 * 防抖保存器:连续拖动只发最后一次。
 * `cancel` 给组件卸载时用 —— 不取消的话,离开页面后还会飞出一个请求。
 */
export function createLayoutSaver(delayMs = 500, fetchImpl?: SaveFetch, onError?: (reason: string) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { projectId: string; positions: CanvasPositions } | null = null;
  return {
    schedule(projectId: string, positions: CanvasPositions) {
      if (timer) clearTimeout(timer);
      pending = { projectId, positions };
      timer = setTimeout(() => {
        timer = null; pending = null;
        void saveCanvasLayout(projectId, positions, fetchImpl).then((r) => { if (!r.ok) onError?.(r.reason); });
      }, delayMs);
    },
    cancel() { if (timer) { clearTimeout(timer); timer = null; } },
    /** 卸载时用:把还在防抖窗口里的那次立刻发出去(keepalive 保证送达),而不是丢掉 */
    flush() {
      if (!timer || !pending) { this.cancel(); return; }
      clearTimeout(timer); timer = null;
      const p = pending; pending = null;
      void saveCanvasLayout(p.projectId, p.positions, fetchImpl).then((r) => { if (!r.ok) onError?.(r.reason); });
    },
  };
}
