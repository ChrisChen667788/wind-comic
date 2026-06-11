/**
 * v10.5.3 — ui_events 轻量埋点仓库(async,双驱动)。
 * 首跑引导完成率等产品指标的最小落点:completed/shown 两数相除即完成率。
 * 记账失败绝不阻断 UI(调用方 fire-and-forget)。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

const EVENT_RE = /^[a-z0-9_:-]{1,60}$/;

export async function recordUiEvent(input: {
  event: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<boolean> {
  if (!EVENT_RE.test(input.event)) return false;
  try {
    await getDbDriver().run(
      `INSERT INTO ui_events (id, event, user_id, meta, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['ue_' + nanoid(12), input.event, input.userId ?? null, JSON.stringify(input.meta ?? {}), new Date().toISOString()],
    );
    return true;
  } catch {
    return false;
  }
}

/** 事件计数(完成率 = count(completed) / count(shown))。 */
export async function countUiEvents(event: string): Promise<number> {
  const r = await getDbDriver().get<{ c: number }>(
    `SELECT count(*) c FROM ui_events WHERE event = ?`, [event],
  );
  return r?.c ?? 0;
}
