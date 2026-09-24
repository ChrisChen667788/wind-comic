/**
 * lib/canvas-layout — 画布节点位置的唯一真相与校验。v12.454。
 *
 * 病象:流水线画布拖一下节点,位置只写进内存 store(纯 zustand,无持久化)——
 * **刷新即回到默认布局**。八个节点默认是斜着排的,想理顺一次就得每次重排。
 *
 * 节点 id 在这里定义、画布从这里取 —— 保存接口按同一份白名单校验。
 * 两边各写一份的话,画布加了节点而白名单没跟上,新节点的位置会被接口静默拒掉
 * (「改了守卫没跟消费方」是本仓的老毛病,已有门禁;这里用测试把两边钉死)。
 */

/** 画布上的八个节点 —— 画布 buildInitialNodes 的 id 必须与此**完全一致**(有测试钉死) */
export const CANVAS_NODE_IDS = [
  'node-director', 'node-writer', 'node-character', 'node-scene',
  'node-storyboard', 'node-video', 'node-editor', 'node-producer',
] as const;
export type CanvasNodeId = (typeof CANVAS_NODE_IDS)[number];

export type CanvasPositions = Record<string, { x: number; y: number }>;

/** 画布坐标的合理范围:ReactFlow 允许负值(默认布局里导演节点就是 y=-300),但不该是天文数字 */
export const CANVAS_COORD_LIMIT = 100_000;

export type SanitizeResult =
  | { ok: true; positions: CanvasPositions }
  | { ok: false; reason: string };

/**
 * 严格校验:**非法值直接拒**,不静默丢弃 —— 静默丢弃会让「保存成功」和「其实没存」长得一样。
 * 只认白名单里的节点 id、有限数字、合理范围。
 */
export function sanitizeCanvasPositions(input: unknown): SanitizeResult {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'positions 必须是对象' };
  }
  const out: CanvasPositions = {};
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!(CANVAS_NODE_IDS as readonly string[]).includes(id)) {
      return { ok: false, reason: `不认识的节点 id:${id.slice(0, 40)}` };
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: `${id} 的位置必须是 {x,y}` };
    }
    const { x, y } = raw as { x?: unknown; y?: unknown };
    for (const [k, v] of [['x', x], ['y', y]] as const) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `${id}.${k} 必须是有限数字` };
      if (Math.abs(v) > CANVAS_COORD_LIMIT) return { ok: false, reason: `${id}.${k} 超出 ±${CANVAS_COORD_LIMIT}` };
    }
    out[id] = { x: x as number, y: y as number };
  }
  return { ok: true, positions: out };
}

/** 存库的 JSON → 位置表;读不出就当没存过(旧项目该列是 NULL,必须零影响) */
export function parseCanvasPositions(stored: string | null | undefined): CanvasPositions {
  if (!stored) return {};
  try {
    const r = sanitizeCanvasPositions(JSON.parse(stored));
    return r.ok ? r.positions : {};
  } catch {
    return {};
  }
}

/** 把存下来的位置合进默认布局:只覆盖存过的那些,其余保持默认(部分保存也不会把别的节点挪到 0,0) */
export function applyCanvasPositions<T extends { id: string; position: { x: number; y: number } }>(
  nodes: T[], saved: CanvasPositions,
): T[] {
  return nodes.map((n) => (saved[n.id] ? { ...n, position: { ...saved[n.id] } } : n));
}
