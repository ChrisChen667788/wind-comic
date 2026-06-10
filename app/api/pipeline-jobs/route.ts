/**
 * GET /api/pipeline-jobs (v10.4.2) — 流水线任务列表(死信 UI 消费)。
 * ?state=failed|queued|running|done 过滤;默认最近 50 条全状态。
 * 鉴权:登录即可(create-stream 自身不分租户 —— 单租户演示语义,与 userId 解析一致)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { listPipelineJobs, type PipelineJobState } from '@/lib/repos/pipeline-job-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATES: PipelineJobState[] = ['queued', 'running', 'done', 'failed'];

export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  const raw = request.nextUrl.searchParams.get('state') || '';
  const state = (STATES as string[]).includes(raw) ? (raw as PipelineJobState) : undefined;
  const jobs = await listPipelineJobs({ state, limit: 50 });
  // payload 体积大(完整创意输入)且对列表无用 → 只回标题摘要
  const slim = jobs.map((j) => ({
    id: j.id, type: j.type, projectId: j.projectId, state: j.state, step: j.step,
    attempts: j.attempts, lastError: j.lastError, heartbeatAt: j.heartbeatAt,
    createdAt: j.createdAt, updatedAt: j.updatedAt,
    ideaPreview: typeof j.payload?.idea === 'string' ? j.payload.idea.slice(0, 60) : '',
  }));
  return NextResponse.json({ jobs: slim, workerActive: process.env.PIPELINE_QUEUE === '1' });
}
