/**
 * lib/render-loop (v9.2.1) — 渲染循环模型 (技术监看「渲染循环」面板的纯逻辑核心).
 *
 * 把"项目剧本镜头 + 已落库分镜/视频资产"归约成每镜渲染状态 + 整体进度/ETA,
 * 供 SSE 路由按 tick 推快照、前端面板渲染。纯函数, 不碰 DB, client 可直引 (formatEta)。
 *
 * 进度判定 = 持久化资产的"最佳努力"投影:
 *   有视频媒体 → done · 有分镜媒体但无视频 → video active · 有分镜行无图 → storyboard active · 无 → pending
 *   资产 data 里带 error/failed → failed · attempts 取资产 version (反映重跑次数) · 耗时取 updated-created。
 *
 * 单测: tests/v9-2-1-render-loop.test.ts。
 */

export type RenderStage = 'storyboard' | 'video';
export type RenderStatus = 'pending' | 'active' | 'done' | 'failed';

export interface ShotRenderState {
  shotNumber: number;
  name: string;
  stage: RenderStage; // 当前/最远到达的阶段
  status: RenderStatus;
  attempts: number; // 资产 version (>=1); pending=0
  durationMs?: number; // done 资产 updated_at - created_at
}

export interface RenderLoopSummary {
  total: number;
  done: number;
  failed: number;
  active: number;
  pending: number;
  percent: number; // 0..100 = done/total
  avgShotMs: number | null; // done 镜头平均耗时
  etaMs: number | null; // avgShotMs * 未完成数; 无耗时样本且仍有剩余 → null; 已全完 → 0
}

/** 路由把 DB 行喂进来; 字段全可选, 容忍 snake/camel。 */
export interface AssetLike {
  shot_number?: number | null;
  shotNumber?: number | null;
  version?: number | null;
  media_urls?: string | string[] | null;
  mediaUrls?: string[] | null;
  persistent_url?: string | null;
  persistentUrl?: string | null;
  data?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ShotLike {
  shotNumber?: number;
  emotion?: string;
  name?: string;
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

function hasMedia(a: AssetLike | undefined): boolean {
  if (!a) return false;
  if (a.persistent_url || a.persistentUrl) return true;
  const m = a.media_urls ?? a.mediaUrls;
  if (Array.isArray(m)) return m.some((x) => !!x);
  if (typeof m === 'string') {
    const arr = safeParse(m);
    if (Array.isArray(arr)) return arr.some((x) => !!x);
    return m.trim().length > 2; // 非 '[]' 的裸串
  }
  return false;
}

function shotNumOf(a: AssetLike): number | undefined {
  const v = a.shot_number ?? a.shotNumber;
  return typeof v === 'number' ? v : undefined;
}

function isFailed(a: AssetLike | undefined): boolean {
  if (!a || a.data == null) return false;
  const d = typeof a.data === 'string' ? safeParse(a.data) : a.data;
  return !!(d && (d.error || d.failed || d.status === 'failed'));
}

function durationMs(a: AssetLike | undefined): number | undefined {
  if (!a?.created_at || !a?.updated_at) return undefined;
  const c = Date.parse(a.created_at), u = Date.parse(a.updated_at);
  if (!Number.isFinite(c) || !Number.isFinite(u) || u < c) return undefined;
  return u - c;
}

export interface DeriveInput {
  shots: ShotLike[];
  videoAssets?: AssetLike[];
  storyboardAssets?: AssetLike[];
}

/** 把剧本镜头 + 视频/分镜资产归约成每镜渲染状态。 */
export function deriveShotRenderStates(input: DeriveInput): ShotRenderState[] {
  const videos = new Map<number, AssetLike>();
  for (const a of input.videoAssets ?? []) { const n = shotNumOf(a); if (n != null) videos.set(n, a); }
  const boards = new Map<number, AssetLike>();
  for (const a of input.storyboardAssets ?? []) { const n = shotNumOf(a); if (n != null) boards.set(n, a); }

  return input.shots.map((s, i) => {
    const shotNumber = typeof s.shotNumber === 'number' ? s.shotNumber : i + 1;
    const name = s.name || (s.emotion ? `Shot ${shotNumber} (${s.emotion})` : `Shot ${shotNumber}`);
    const v = videos.get(shotNumber);
    const b = boards.get(shotNumber);

    if (isFailed(v) || isFailed(b)) {
      const failedOn = isFailed(v) ? v : b;
      return { shotNumber, name, stage: v ? 'video' : 'storyboard', status: 'failed' as const, attempts: Math.max(1, failedOn?.version ?? 1) };
    }
    if (hasMedia(v)) {
      return { shotNumber, name, stage: 'video' as const, status: 'done' as const, attempts: Math.max(1, v?.version ?? 1), durationMs: durationMs(v) };
    }
    if (hasMedia(b)) {
      // 分镜已出图, 视频未出 → 视频在渲染
      return { shotNumber, name, stage: 'video' as const, status: 'active' as const, attempts: Math.max(1, b?.version ?? 1) };
    }
    if (b) {
      // 有分镜行但未出图 → 分镜在渲染
      return { shotNumber, name, stage: 'storyboard' as const, status: 'active' as const, attempts: Math.max(1, b.version ?? 1) };
    }
    return { shotNumber, name, stage: 'storyboard' as const, status: 'pending' as const, attempts: 0 };
  });
}

export function summarizeRenderLoop(states: ShotRenderState[]): RenderLoopSummary {
  const total = states.length;
  let done = 0, failed = 0, active = 0, pending = 0;
  const durs: number[] = [];
  for (const s of states) {
    if (s.status === 'done') { done++; if (typeof s.durationMs === 'number') durs.push(s.durationMs); }
    else if (s.status === 'failed') failed++;
    else if (s.status === 'active') active++;
    else pending++;
  }
  const avgShotMs = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null;
  const remaining = active + pending;
  const etaMs = remaining === 0 ? 0 : (avgShotMs != null ? avgShotMs * remaining : null);
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { total, done, failed, active, pending, percent, avgShotMs, etaMs };
}

/** 整体是否已收敛 (无 active/pending) → SSE 可结束。 */
export function isRenderLoopSettled(summary: RenderLoopSummary): boolean {
  return summary.active === 0 && summary.pending === 0;
}

/** 毫秒 → 人类可读 ETA (~2m10s / ~45s / 完成 / —)。 */
export function formatEta(ms: number | null): string {
  if (ms == null) return '—';
  if (ms <= 0) return '完成';
  const s = Math.round(ms / 1000);
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `~${m}m${r}s` : `~${m}m`;
}
