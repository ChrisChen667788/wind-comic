/**
 * /api/projects/[id]/voice-retake (v10.6.4) — 配音 retake 工作流。
 *
 *   GET  逐对白镜状态:活动版 + take 历史(版本对比试听的数据源)
 *   POST 单句 {shotNumber, emotion?, emotionTemperature?} → 同步重录(秒级)
 *        批量 {shots:[{shotNumber, emotion?}...]} → PIPELINE_QUEUE=1 入队
 *        (pipeline_jobs type='voice-retake');不开队列时同步顺序执行(上限 30)
 *   PUT  {takeId} 采用该 take → 换入活动行(其余镜零接触)+ 该镜 video 置 stale
 *
 * 读免鉴权(与 shot-audio GET 一致);写需登录。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listRetakeState, synthesizeRetake, adoptTake, type VoiceRetakeJobPayload } from '@/lib/voice-retake';
import { getOwnedProject } from '@/lib/repos/project-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shots = await listRetakeState(id);
  return NextResponse.json({ count: shots.length, shots });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  // 项目归属校验 —— 写他人项目的配音资产是越权
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));

  // 单句:同步重录(TTS 单句秒级,直接等结果做 A/B)
  if (typeof body?.shotNumber === 'number') {
    const r = await synthesizeRetake({
      projectId: id, shotNumber: body.shotNumber,
      emotion: typeof body.emotion === 'string' ? body.emotion : undefined,
      emotionTemperature: typeof body.emotionTemperature === 'number' ? body.emotionTemperature : undefined,
      userId: payload.sub,
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 422 });
  }

  // 批量:重录队列
  const shots = Array.isArray(body?.shots)
    ? body.shots.filter((s: any) => typeof s?.shotNumber === 'number').slice(0, 30)
    : [];
  if (!shots.length) return NextResponse.json({ message: '缺 shotNumber 或 shots' }, { status: 400 });

  const jobPayload: VoiceRetakeJobPayload = { projectId: id, shots, userId: payload.sub };
  if (process.env.PIPELINE_QUEUE === '1') {
    const { enqueuePipelineJob } = await import('@/lib/repos/pipeline-job-repo');
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    ensurePipelineWorker();
    const job = await enqueuePipelineJob({ type: 'voice-retake', projectId: id, userId: payload.sub, payload: jobPayload });
    return NextResponse.json({ queued: true, jobId: job.id, total: shots.length });
  }

  // 不开队列 → 同步顺序执行
  const results: unknown[] = [];
  const { runVoiceRetakeJob } = await import('@/lib/voice-retake');
  await runVoiceRetakeJob(jobPayload, (type, data) => {
    if (type === 'retakeDone') results.push(data);
  });
  return NextResponse.json({ queued: false, done: results[0] ?? { ok: 0, total: shots.length } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const takeId = typeof body?.takeId === 'string' ? body.takeId : '';
  if (!takeId) return NextResponse.json({ message: '缺 takeId' }, { status: 400 });
  const r = await adoptTake(id, takeId);
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
