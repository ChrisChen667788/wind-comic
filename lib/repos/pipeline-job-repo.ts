/**
 * v10.4.1 — pipeline_jobs 任务仓库(async,双驱动)。
 *
 * 流水线任务的全生命周期:enqueue(queued)→ claim(running,attempts+1)→
 * done / failed(attempts 耗尽)/ 重新 queued(可重试失败)。
 * progress_log 存 SSE 事件用于回放(截断保最近 MAX_LOG 条);step 记最近阶段标记
 * (v10.4.2 幂等续跑消费)。单进程 worker 假设(与 event-bus 同款取舍,多实例待 Redis)。
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export type PipelineJobState = 'queued' | 'running' | 'done' | 'failed';

export interface PipelineJobRow {
  id: string;
  type: string;
  projectId: string;
  userId: string | null;
  state: PipelineJobState;
  step: string;
  payload: any;
  attempts: number;
  lastError: string;
  heartbeatAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEvent {
  type: string;
  data: unknown;
  at: string;
}

const MAX_LOG = 400;     // 回放日志上限(条)
const MAX_ATTEMPTS = 3;  // 重试上限,耗尽 → failed(v10.4.2 升级为死信 UI)

const nowIso = () => new Date().toISOString();

function rowToJob(r: any): PipelineJobRow {
  let payload: any = {};
  try { payload = r.payload ? JSON.parse(r.payload) : {}; } catch { /* ignore */ }
  return {
    id: r.id, type: r.type, projectId: r.project_id, userId: r.user_id ?? null,
    state: r.state, step: r.step ?? '', payload,
    attempts: Number(r.attempts) || 0, lastError: r.last_error ?? '',
    heartbeatAt: r.heartbeat_at ?? '', createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function enqueuePipelineJob(input: {
  type: string;
  projectId: string;
  userId?: string | null;
  payload: unknown;
}): Promise<PipelineJobRow> {
  const id = 'pj_' + nanoid(12);
  const t = nowIso();
  await getDbDriver().run(
    `INSERT INTO pipeline_jobs (id, type, project_id, user_id, state, step, payload, progress_log, attempts, last_error, heartbeat_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', '', ?, '[]', 0, '', '', ?, ?)`,
    [id, input.type, input.projectId, input.userId ?? null, JSON.stringify(input.payload ?? {}), t, t],
  );
  return (await getPipelineJob(id))!;
}

export async function getPipelineJob(id: string): Promise<PipelineJobRow | null> {
  const r = await getDbDriver().get<any>('SELECT * FROM pipeline_jobs WHERE id = ?', [id]);
  return r ? rowToJob(r) : null;
}

/** 最近一条该项目的任务(项目页/重连场景查询入口)。 */
export async function getLatestJobByProject(projectId: string): Promise<PipelineJobRow | null> {
  const r = await getDbDriver().get<any>(
    'SELECT * FROM pipeline_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
    [projectId],
  );
  return r ? rowToJob(r) : null;
}

/**
 * 认领最老的 queued 任务。乐观更新(WHERE state='queued')防双拿;
 * 没有可认领的返回 null。
 */
export async function claimNextJob(): Promise<PipelineJobRow | null> {
  const drv = getDbDriver();
  const cand = await drv.get<any>(
    `SELECT id FROM pipeline_jobs WHERE state = 'queued' ORDER BY created_at ASC LIMIT 1`,
  );
  if (!cand) return null;
  const t = nowIso();
  const r = await drv.run(
    `UPDATE pipeline_jobs SET state = 'running', attempts = attempts + 1, heartbeat_at = ?, updated_at = ?
     WHERE id = ? AND state = 'queued'`,
    [t, t, cand.id],
  );
  if (!r.changes) return null; // 被并发拿走(理论上单 worker 不会)
  return getPipelineJob(cand.id);
}

export async function heartbeatJob(id: string): Promise<void> {
  const t = nowIso();
  await getDbDriver().run('UPDATE pipeline_jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?', [t, t, id]);
}

export async function setJobStep(id: string, step: string): Promise<void> {
  await getDbDriver().run('UPDATE pipeline_jobs SET step = ?, updated_at = ? WHERE id = ?', [String(step).slice(0, 60), nowIso(), id]);
}

/** 追加进度事件(读改写;调用方负责串行 —— worker 用 promise 链保证)。 */
export async function appendJobProgress(id: string, ev: { type: string; data: unknown }): Promise<void> {
  const drv = getDbDriver();
  const r = await drv.get<any>('SELECT progress_log FROM pipeline_jobs WHERE id = ?', [id]);
  if (!r) return;
  let log: ProgressEvent[] = [];
  try { log = r.progress_log ? JSON.parse(r.progress_log) : []; } catch { /* ignore */ }
  log.push({ type: ev.type, data: ev.data, at: nowIso() });
  if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
  await drv.run('UPDATE pipeline_jobs SET progress_log = ?, updated_at = ? WHERE id = ?', [JSON.stringify(log), nowIso(), id]);
}

export async function getJobProgressLog(id: string): Promise<ProgressEvent[]> {
  const r = await getDbDriver().get<any>('SELECT progress_log FROM pipeline_jobs WHERE id = ?', [id]);
  if (!r) return [];
  try { return r.progress_log ? JSON.parse(r.progress_log) : []; } catch { return []; }
}

export async function completeJob(id: string): Promise<void> {
  const t = nowIso();
  await getDbDriver().run(`UPDATE pipeline_jobs SET state = 'done', updated_at = ? WHERE id = ?`, [t, id]);
}

/**
 * 失败处理:attempts 未耗尽 → 重新 queued(下个 tick 重试);
 * 耗尽 → failed 落 last_error(死信)。返回最终 state。
 */
export async function failJob(id: string, error: string): Promise<PipelineJobState> {
  const job = await getPipelineJob(id);
  if (!job) return 'failed';
  const terminal = job.attempts >= MAX_ATTEMPTS;
  const state: PipelineJobState = terminal ? 'failed' : 'queued';
  await getDbDriver().run(
    'UPDATE pipeline_jobs SET state = ?, last_error = ?, updated_at = ? WHERE id = ?',
    [state, String(error).slice(0, 500), nowIso(), id],
  );
  return state;
}

/**
 * 开机恢复(单进程 worker 假设):
 *   - running → queued(刚启动,任何 running 必是上一进程的孤儿)
 *   - 超过 24h 的 queued/running → failed(过期不再 surprise 续跑)
 * 返回 { requeued, expired } 计数。
 */
export async function recoverJobsAtBoot(): Promise<{ requeued: number; expired: number }> {
  const drv = getDbDriver();
  const t = nowIso();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const exp = await drv.run(
    `UPDATE pipeline_jobs SET state = 'failed', last_error = '过期未执行(跨进程恢复时超 24h)', updated_at = ?
     WHERE state IN ('queued','running') AND created_at < ?`,
    [t, cutoff],
  );
  const req = await drv.run(
    `UPDATE pipeline_jobs SET state = 'queued', updated_at = ? WHERE state = 'running'`,
    [t],
  );
  return { requeued: req.changes ?? 0, expired: exp.changes ?? 0 };
}
