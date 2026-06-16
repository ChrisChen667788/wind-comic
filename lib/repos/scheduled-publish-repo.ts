/**
 * lib/repos/scheduled-publish-repo (v12.3.3) — 定时发布仓库(阶段二十二)。
 * 到点由 worker tick(lib/publish-scheduler)认领并经适配器发布。SQLite/PG 双驱动。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export type ScheduledStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

export interface ScheduledPublish {
  id: string;
  projectId: string;
  platform: string;
  scheduledAt: string;
  status: ScheduledStatus;
  attempts: number;
  lastError: string | null;
  publishRecordId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string; project_id: string; platform: string; scheduled_at: string;
  status: string; attempts: number; last_error: string | null;
  publish_record_id: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}

function toRecord(r: Row): ScheduledPublish {
  return {
    id: r.id, projectId: r.project_id, platform: r.platform, scheduledAt: r.scheduled_at,
    status: r.status as ScheduledStatus, attempts: Number(r.attempts) || 0, lastError: r.last_error,
    publishRecordId: r.publish_record_id, createdBy: r.created_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 排定一条定时发布。 */
export async function schedulePublish(input: {
  projectId: string;
  platform: string;
  scheduledAt: string;
  createdBy?: string | null;
}): Promise<ScheduledPublish> {
  const id = 'sch_' + nanoid(12);
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO scheduled_publishes (id, project_id, platform, scheduled_at, status, attempts, last_error, publish_record_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, ?)`,
    [id, input.projectId, input.platform, input.scheduledAt, input.createdBy ?? null, ts, ts],
  );
  const row = await getDbDriver().get<Row>('SELECT * FROM scheduled_publishes WHERE id = ?', [id]);
  if (!row) throw new Error('schedulePublish: 插入后读取失败');
  return toRecord(row);
}

/** 列项目的定时发布(新到旧)。 */
export async function listScheduledPublishes(projectId: string): Promise<ScheduledPublish[]> {
  const rows = await getDbDriver().query<Row>(
    'SELECT * FROM scheduled_publishes WHERE project_id = ? ORDER BY created_at DESC',
    [projectId],
  );
  return rows.map(toRecord);
}

/**
 * 原子认领到点(scheduled_at <= now)且 pending 的条目 → 置 running、attempts+1。
 * 事务内逐条 CAS(UPDATE ... WHERE id=? AND status='pending'),只返回真抢到的,防并发 worker 重复发。
 */
export async function claimDuePublishes(nowIso: string, limit = 20): Promise<ScheduledPublish[]> {
  return getDbDriver().transaction(async (tx) => {
    const due = await tx.query<Row>(
      `SELECT * FROM scheduled_publishes WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC LIMIT ?`,
      [nowIso, limit],
    );
    const claimed: ScheduledPublish[] = [];
    for (const r of due) {
      const res = await tx.run(
        `UPDATE scheduled_publishes SET status = 'running', attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [nowIso, r.id],
      );
      if (res.changes > 0) claimed.push(toRecord({ ...r, status: 'running', attempts: Number(r.attempts) + 1, updated_at: nowIso }));
    }
    return claimed;
  });
}

/** 标记定时发布的终态(done/failed)+ 关联 publish_records.id / 错误。 */
export async function markScheduled(id: string, patch: {
  status: ScheduledStatus;
  lastError?: string | null;
  publishRecordId?: string | null;
}): Promise<void> {
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `UPDATE scheduled_publishes SET status = ?, last_error = ?, publish_record_id = COALESCE(?, publish_record_id), updated_at = ?
     WHERE id = ?`,
    [patch.status, patch.lastError ?? null, patch.publishRecordId ?? null, ts, id],
  );
}

/** 取消一条 pending 定时发布(属主守卫:userId 给定且不匹配 → 不取消,返回 false)。 */
export async function cancelScheduledPublish(id: string, userId?: string): Promise<boolean> {
  const ts = new Date().toISOString();
  const sql = userId
    ? `UPDATE scheduled_publishes SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'pending' AND created_by = ?`
    : `UPDATE scheduled_publishes SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'pending'`;
  const args = userId ? [ts, id, userId] : [ts, id];
  const res = await getDbDriver().run(sql, args);
  return res.changes > 0;
}
