/**
 * v10.4.1 — pipeline_jobs 任务仓库单测(SQLite driver,真 DB)。
 * 覆盖:enqueue/claim 状态机、attempts 递增、进度回放截断、失败重试→死信、开机恢复。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  enqueuePipelineJob,
  getPipelineJob,
  getLatestJobByProject,
  claimNextJob,
  heartbeatJob,
  setJobStep,
  appendJobProgress,
  getJobProgressLog,
  completeJob,
  failJob,
  recoverOrphanJobs,
  listPipelineJobs,
  requeueJob,
} from '@/lib/repos/pipeline-job-repo';

beforeEach(() => {
  db.prepare('DELETE FROM pipeline_jobs').run();
});

describe('v10.4.1 · enqueue / get / claim 状态机', () => {
  it('enqueue → queued,payload JSON round-trip', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p1', payload: { idea: '雨夜', aspect: '9:16' } });
    expect(job.state).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.payload).toEqual({ idea: '雨夜', aspect: '9:16' });
    expect((await getPipelineJob(job.id))!.projectId).toBe('p1');
  });

  it('claim 取最老的 queued → running 且 attempts+1;空队列返回 null', async () => {
    expect(await claimNextJob()).toBeNull();
    const a = await enqueuePipelineJob({ type: 'create', projectId: 'pa', payload: {} });
    // 保证次序(created_at 同毫秒时按插入序不稳定 → 手动错开)
    db.prepare('UPDATE pipeline_jobs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', a.id);
    await enqueuePipelineJob({ type: 'create', projectId: 'pb', payload: {} });
    const claimed = await claimNextJob();
    expect(claimed!.id).toBe(a.id);
    expect(claimed!.state).toBe('running');
    expect(claimed!.attempts).toBe(1);
    // 同一条不会被再次认领
    const second = await claimNextJob();
    expect(second!.projectId).toBe('pb');
    expect(await claimNextJob()).toBeNull();
  });

  it('getLatestJobByProject 取该项目最新一条', async () => {
    const j1 = await enqueuePipelineJob({ type: 'create', projectId: 'px', payload: {} });
    db.prepare('UPDATE pipeline_jobs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', j1.id);
    const j2 = await enqueuePipelineJob({ type: 'create', projectId: 'px', payload: {} });
    expect((await getLatestJobByProject('px'))!.id).toBe(j2.id);
  });
});

describe('v10.4.1 · 进度 / 阶段 / 心跳', () => {
  it('v11.0.3:并发追加零丢失(append-only INSERT,旧读改写会丢)', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p-conc', payload: {} });
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      appendJobProgress(job.id, { type: 'status', data: { i } })));
    const log = await getJobProgressLog(job.id);
    expect(log.length).toBe(25); // 读改写实现下并发会 lost update
    expect(new Set(log.map((e: any) => e.data.i)).size).toBe(25);
  });

  it('v11.0.3:历史任务回退旧 progress_log 列', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p-legacy', payload: {} });
    db.prepare('UPDATE pipeline_jobs SET progress_log = ? WHERE id = ?')
      .run(JSON.stringify([{ type: 'plan', data: { ok: 1 }, at: '2026-01-01T00:00:00.000Z' }]), job.id);
    const log = await getJobProgressLog(job.id);
    expect(log.length).toBe(1);
    expect(log[0].type).toBe('plan');
  });

  it('appendJobProgress 顺序累积,getJobProgressLog 回放', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p2', payload: {} });
    await appendJobProgress(job.id, { type: 'status', data: { message: 'A' } });
    await appendJobProgress(job.id, { type: 'step', data: { step: 'writer' } });
    const log = await getJobProgressLog(job.id);
    expect(log.map((e) => e.type)).toEqual(['status', 'step']);
    expect(log[1].data).toEqual({ step: 'writer' });
    expect(log[0].at).toBeTruthy();
  });

  it('进度日志截断保最近 400 条', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p3', payload: {} });
    for (let i = 0; i < 405; i++) await appendJobProgress(job.id, { type: 'status', data: i });
    const log = await getJobProgressLog(job.id);
    expect(log.length).toBe(400);
    expect(log[log.length - 1].data).toBe(404); // 尾部最新
  });

  it('setJobStep / heartbeatJob 落库', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p4', payload: {} });
    await setJobStep(job.id, 'video');
    await heartbeatJob(job.id);
    const j = (await getPipelineJob(job.id))!;
    expect(j.step).toBe('video');
    expect(j.heartbeatAt).toBeTruthy();
  });
});

describe('v10.4.1 · 完成 / 失败重试 / 死信', () => {
  it('completeJob → done', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p5', payload: {} });
    await claimNextJob();
    await completeJob(job.id);
    expect((await getPipelineJob(job.id))!.state).toBe('done');
  });

  it('failJob:attempts 未耗尽 → 重新 queued;3 次后 → failed(死信)', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'p6', payload: {} });
    await claimNextJob(); // attempts=1
    expect(await failJob(job.id, 'boom1')).toBe('queued');
    await claimNextJob(); // attempts=2
    expect(await failJob(job.id, 'boom2')).toBe('queued');
    await claimNextJob(); // attempts=3
    expect(await failJob(job.id, 'boom3')).toBe('failed');
    const j = (await getPipelineJob(job.id))!;
    expect(j.state).toBe('failed');
    expect(j.lastError).toBe('boom3');
  });
});

describe('v10.4.2 · 死信列表 / 重投', () => {
  it('listPipelineJobs:倒序 + state 过滤', async () => {
    const a = await enqueuePipelineJob({ type: 'create', projectId: 'la', payload: {} });
    db.prepare('UPDATE pipeline_jobs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', a.id);
    const b = await enqueuePipelineJob({ type: 'create', projectId: 'lb', payload: {} });
    await claimNextJob(); // a → running
    const all = await listPipelineJobs();
    expect(all.map((j) => j.id)).toEqual([b.id, a.id]); // 倒序
    const queued = await listPipelineJobs({ state: 'queued' });
    expect(queued.map((j) => j.id)).toEqual([b.id]);
  });

  it('requeueJob:仅 failed 可重投;attempts 保留(→续跑)、last_error 清空', async () => {
    const job = await enqueuePipelineJob({ type: 'create', projectId: 'rq', payload: {} });
    expect(await requeueJob(job.id)).toBe(false); // queued 不可重投
    await claimNextJob();
    expect(await requeueJob(job.id)).toBe(false); // running 不可重投(防双跑)
    // 烧满 3 次 → failed
    await failJob(job.id, 'e1'); await claimNextJob();
    await failJob(job.id, 'e2'); await claimNextJob();
    await failJob(job.id, 'e3');
    expect((await getPipelineJob(job.id))!.state).toBe('failed');
    expect(await requeueJob(job.id)).toBe(true);
    const j = (await getPipelineJob(job.id))!;
    expect(j.state).toBe('queued');
    expect(j.attempts).toBe(3); // 保留 → resume 生效
    expect(j.lastError).toBe('');
  });
});

describe('v11.0.1 · 孤儿回收(心跳判定,取代开机全清)', () => {
  it('心跳新鲜的 running 不被动(多副本下可能是别的副本在跑);心跳超时/空心跳 → 重新入队;超 24h → failed', async () => {
    // alive:刚认领,heartbeat_at = now → 必须保留 running(旧逻辑会误踢造成双跑)
    const alive = await enqueuePipelineJob({ type: 'create', projectId: 'p7', payload: {} });
    await claimNextJob();
    // dead:认领后心跳停了 2 分钟(进程死了)
    const dead = await enqueuePipelineJob({ type: 'create', projectId: 'p7b', payload: {} });
    await claimNextJob();
    db.prepare('UPDATE pipeline_jobs SET heartbeat_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 120_000).toISOString(), dead.id);
    // legacy:running 但心跳为空(历史行)→ 视为孤儿
    const legacy = await enqueuePipelineJob({ type: 'create', projectId: 'p7c', payload: {} });
    await claimNextJob();
    db.prepare("UPDATE pipeline_jobs SET heartbeat_at = '' WHERE id = ?").run(legacy.id);
    // expired:超 24h
    const stale = await enqueuePipelineJob({ type: 'create', projectId: 'p8', payload: {} });
    db.prepare('UPDATE pipeline_jobs SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', stale.id);

    const { requeued, expired } = await recoverOrphanJobs();
    expect(requeued).toBe(2); // dead + legacy
    expect(expired).toBe(1);
    expect((await getPipelineJob(alive.id))!.state).toBe('running');  // 多副本安全核心断言
    const d = (await getPipelineJob(dead.id))!;
    expect(d.state).toBe('queued');
    expect(d.attempts).toBe(1); // requeue 不动 attempts → resume 生效
    expect((await getPipelineJob(legacy.id))!.state).toBe('queued');
    const s = (await getPipelineJob(stale.id))!;
    expect(s.state).toBe('failed');
    expect(s.lastError).toContain('过期');
  });

  it('双副本同时扫描幂等:第二次扫无新回收', async () => {
    const r2 = await recoverOrphanJobs();
    expect(r2.requeued).toBe(0);
    expect(r2.expired).toBe(0);
  });
});
