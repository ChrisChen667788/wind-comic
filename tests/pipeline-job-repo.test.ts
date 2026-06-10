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
  recoverJobsAtBoot,
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

describe('v10.4.1 · 开机恢复', () => {
  it('running → queued(孤儿续跑);超 24h 的 → failed(过期)', async () => {
    const fresh = await enqueuePipelineJob({ type: 'create', projectId: 'p7', payload: {} });
    await claimNextJob(); // fresh → running(模拟 kill -9 时正在跑)
    const stale = await enqueuePipelineJob({ type: 'create', projectId: 'p8', payload: {} });
    db.prepare('UPDATE pipeline_jobs SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', stale.id);

    const { requeued, expired } = await recoverJobsAtBoot();
    expect(requeued).toBe(1);
    expect(expired).toBe(1);
    expect((await getPipelineJob(fresh.id))!.state).toBe('queued');
    const s = (await getPipelineJob(stale.id))!;
    expect(s.state).toBe('failed');
    expect(s.lastError).toContain('过期');
  });
});
