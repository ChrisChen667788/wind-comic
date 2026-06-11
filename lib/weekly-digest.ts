/**
 * lib/weekly-digest (v10.5.4) — 周报 digest(懒触发,复用既有通知系统)。
 *
 * 无应用内 cron —— 采用「懒 digest」:用户拉通知(GET /api/notifications)时
 * 顺手检查:距上次周报 ≥7 天且本周有创作活动 → 生成一条 weekly_digest 通知
 * (createNotification 落库 + emitNotification 走 SSE 实时进铃铛)。
 * 零活动不打扰(不发空周报);7 天内幂等(同窗口只发一条)。
 */
import { getDbDriver } from './db-driver';
import { createNotification } from './repos/notification-repo';
import { emitNotification } from './event-bus';

export const DIGEST_TYPE = 'weekly_digest';
const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface DigestStats {
  created: number;
  completed: number;
}

/** 周报文案(纯函数,可单测)。 */
export function digestPreview(stats: DigestStats): string {
  const parts: string[] = [];
  if (stats.created > 0) parts.push(`新建 ${stats.created} 部`);
  if (stats.completed > 0) parts.push(`完成 ${stats.completed} 部`);
  return `本周创作周报:${parts.join(' · ')} — 继续保持,回到工坊接着拍!`;
}

export type DigestResult = 'sent' | 'recent' | 'no-activity';

export async function maybeSendWeeklyDigest(userId: string): Promise<DigestResult> {
  const drv = getDbDriver();
  const cutoff = new Date(Date.now() - WEEK_MS).toISOString();

  // 7 天幂等窗口
  const last = await drv.get<{ created_at: string }>(
    `SELECT created_at FROM notifications WHERE recipient_user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`,
    [userId, DIGEST_TYPE],
  );
  if (last && last.created_at >= cutoff) return 'recent';

  // 本周活动统计(零活动不发,避免空周报骚扰)
  const created = await drv.get<{ c: number }>(
    `SELECT count(*) c FROM projects WHERE user_id = ? AND created_at >= ?`, [userId, cutoff],
  );
  const completed = await drv.get<{ c: number }>(
    `SELECT count(*) c FROM projects WHERE user_id = ? AND status = 'completed' AND updated_at >= ?`, [userId, cutoff],
  );
  const stats: DigestStats = { created: created?.c ?? 0, completed: completed?.c ?? 0 };
  if (stats.created === 0 && stats.completed === 0) return 'no-activity';

  await createNotification({
    recipientUserId: userId,
    type: DIGEST_TYPE,
    sourceUserId: 'system',
    sourceUserName: '青枫周报',
    preview: digestPreview(stats),
  });
  emitNotification(userId, { digest: true });
  return 'sent';
}
