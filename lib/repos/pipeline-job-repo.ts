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

// v11.0.3: 进程内事件序号 —— job 同一时刻只被一个 worker 认领(claim 乐观锁),
// 故 (at, ord) 在该 job 的事件流上是全序;跨进程接力(requeue 后换 worker)由 at 区分。
let eventOrd = 0;

/**
 * 追加进度事件 —— v11.0.3 改 append-only INSERT(pipeline_job_events 表)。
 * 旧实现是 progress_log 列的 SELECT→parse→push→UPDATE 读改写:多副本/PG 下
 * 有 lost update,且 JSON 越长写放大越狠(O(n²),部署文档限位 #2)。
 * INSERT 天然原子,无需调用方串行(worker 的 promise 链仅保「落库完再标完成」)。
 */
export async function appendJobProgress(id: string, ev: { type: string; data: unknown }): Promise<void> {
  await getDbDriver().run(
    `INSERT INTO pipeline_job_events (id, job_id, ord, type, data, at) VALUES (?, ?, ?, ?, ?, ?)`,
    ['pje_' + nanoid(10), id, ++eventOrd, ev.type, JSON.stringify(ev.data ?? {}), nowIso()],
  );
}

/** 回放(最近 MAX_LOG 条,升序)。空结果回退旧 progress_log 列(历史任务兼容)。 */
export async function getJobProgressLog(id: string): Promise<ProgressEvent[]> {
  const drv = getDbDriver();
  const rows = await drv.query<any>(
    `SELECT type, data, at FROM pipeline_job_events WHERE job_id = ? ORDER BY at DESC, ord DESC LIMIT ${MAX_LOG}`,
    [id],
  );
  if (rows.length > 0) {
    return rows.reverse().map((r) => {
      let data: unknown = {};
      try { data = r.data ? JSON.parse(r.data) : {}; } catch { /* ignore */ }
      return { type: r.type, data, at: r.at };
    });
  }
  // 历史任务:v11.0.3 之前的进度存 progress_log 列
  const r = await drv.get<any>('SELECT progress_log FROM pipeline_jobs WHERE id = ?', [id]);
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

/** v10.4.2: 任务列表(死信 UI 消费;按创建时间倒序)。 */
export async function listPipelineJobs(opts?: { state?: PipelineJobState; limit?: number }): Promise<PipelineJobRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = opts?.state
    ? await getDbDriver().query<any>(
        `SELECT * FROM pipeline_jobs WHERE state = ? ORDER BY created_at DESC LIMIT ${limit}`, [opts.state])
    : await getDbDriver().query<any>(
        `SELECT * FROM pipeline_jobs ORDER BY created_at DESC LIMIT ${limit}`);
  return rows.map(rowToJob);
}

/**
 * v10.4.2: 死信重投 —— 仅 failed 可重投(防止把 running 投成双跑)。
 * 保留 attempts(>1 → worker 走续跑断点装载,不重复生成);清 last_error。
 * 每次手动重投给一次新机会:下次失败 attempts 已超限 → 直接回死信。
 */
export async function requeueJob(id: string): Promise<boolean> {
  const r = await getDbDriver().run(
    `UPDATE pipeline_jobs SET state = 'queued', last_error = '', updated_at = ? WHERE id = ? AND state = 'failed'`,
    [nowIso(), id],
  );
  return (r.changes ?? 0) > 0;
}

/** 心跳 15s × 6 次未达 = 判孤儿(留足 ffmpeg 重载下事件循环抖动的余量) */
export const ORPHAN_STALE_MS = 90_000;

/**
 * v11.0.1: 孤儿任务回收 —— 按**心跳超时**判定,开机与运行期周期扫描共用。
 *
 * 取代 v10.4.1 的「开机把所有 running 重置」:多副本下旧做法会把**别的副本
 * 正在执行**的任务踢回 queued 造成双跑(v11.0 部署文档列为最高风险限位)。
 * 心跳法只回收真死的:heartbeat_at 超 staleMs 未更新(运行中的 job 每 15s
 * 心跳一次,活着永远不会过期;空心跳的历史行视为孤儿)。
 *
 * 语义保留:requeue 不动 attempts(→ worker 按 attempt>1 走断点续跑);
 * 超 24h 的 queued/running → failed(过期不再 surprise 续跑)。
 * 多副本并发安全:UPDATE WHERE state='running' 行级互斥,双副本同时扫不双跑。
 * 时钟假设:跨副本比较 ISO 时间戳,要求各副本 NTP 对时(偏差 ≪ 90s)。
 */
export async function recoverOrphanJobs(staleMs: number = ORPHAN_STALE_MS): Promise<{ requeued: number; expired: number }> {
  const drv = getDbDriver();
  const t = nowIso();
  const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // v12.23.0(评审):先抓将被过期的 create 任务的 project_id,过期后把这些项目 status 回写 failed,
  // 否则这些项目(尤其多集剧集)永远卡 active(job 已 failed、孤儿扫描不再处理、面板轮询不停)。
  const toExpire = await drv.query(
    `SELECT project_id FROM pipeline_jobs WHERE state IN ('queued','running') AND created_at < ? AND type = 'create'`,
    [cutoff24h],
  );
  const exp = await drv.run(
    `UPDATE pipeline_jobs SET state = 'failed', last_error = '过期未执行(超 24h)', updated_at = ?
     WHERE state IN ('queued','running') AND created_at < ?`,
    [t, cutoff24h],
  );
  for (const r of (toExpire as any[])) {
    if (!r?.project_id) continue;
    try {
      const { updateProjectById } = await import('./project-repo');
      await updateProjectById(r.project_id, { status: 'failed' });
    } catch { /* 非阻塞 */ }
  }
  // v11.0.3: 顺带清超 24h 任务的进度事件(回放窗口已过,防表无限增长)
  await drv.run(
    `DELETE FROM pipeline_job_events WHERE job_id IN (SELECT id FROM pipeline_jobs WHERE created_at < ?)`,
    [cutoff24h],
  );
  const staleCutoff = new Date(Date.now() - staleMs).toISOString();
  const req = await drv.run(
    `UPDATE pipeline_jobs SET state = 'queued', updated_at = ?
     WHERE state = 'running' AND (heartbeat_at IS NULL OR heartbeat_at = '' OR heartbeat_at < ?)`,
    [t, staleCutoff],
  );
  return { requeued: req.changes ?? 0, expired: exp.changes ?? 0 };
}
