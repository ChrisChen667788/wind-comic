/**
 * lib/pipeline-worker (v10.4.1) — 进程内流水线 worker(globalThis 单例)。
 *
 * tick 循环认领 pipeline_jobs 里的 queued 任务,在 HTTP 请求之外执行
 * runCreatePipeline:客户端断开不再杀流水线;kill -9 重启后开机恢复
 * (running → queued)续跑。emit 三路分发:事件总线(SSE 实时)+
 * progress_log(回放)+ step 标记(任务表,v10.4.2 幂等续跑消费)。
 *
 * 取舍:单进程、并发 2(剪辑段 ffmpeg 可达分钟级,单并发会饿死后续任务)
 * — 与 event-bus 同款单实例假设;多实例部署待阶段十八 A 的 Redis 适配(v10.4.5)。
 * 仅 PIPELINE_QUEUE=1 时由 instrumentation / create-stream 路由唤起。
 */
import { runCreatePipeline, type CreatePipelineInput } from './create-pipeline';
import {
  claimNextJob,
  heartbeatJob,
  setJobStep,
  appendJobProgress,
  completeJob,
  failJob,
} from './repos/pipeline-job-repo';
import { emitPipeline, pipelineChannel } from './event-bus';

export { pipelineChannel };

const TICK_MS = 1500;
const HEARTBEAT_MS = 15_000;
// 并发 2:剪辑段(ffmpeg 成片合成)单 job 可达 1-2 分钟,单并发会让后续任务排队
// 到「客户端以为没反应」;2 路在本地 dev / 单机部署是安全的(媒体生成本身有限流)。
const MAX_ACTIVE = 2;

// 高频/纯瞬时事件不入回放日志(逐句 agentTalk、心跳、进度百分比……):
// progress_log 是读改写整个 JSON,逐事件落这些会把落库拖成 O(n²);
// 它们对重连回放也无价值 —— 回放需要的是「状态承载」事件(plan/script/storyboards/…)。
const SKIP_PERSIST = new Set(['agentTalk', 'heartbeat', 'mjProgress', 'videoProgress', 'agents', 'retakeProgress', 'pullSheetProgress']);

const g = globalThis as unknown as { __qfmjPipelineWorker?: { timer: ReturnType<typeof setInterval> } };

let active = 0;

// v12.21.0:终态失败回写 —— create 类任务耗尽重试仍失败 → 把项目标 'failed'
// (否则多集批量里失败的集会永远停在 'active';单集创作同样受益)。仅 state='failed' 才回写。
async function markProjectFailedIfTerminal(job: { type: string; projectId: string }, state: string): Promise<void> {
  if (state !== 'failed' || job.type !== 'create' || !job.projectId) return;
  try {
    const { updateProjectById } = await import('./repos/project-repo');
    await updateProjectById(job.projectId, { status: 'failed' });
    console.log(`[PipelineWorker] project ${job.projectId} → status=failed(终态失败)`);
  } catch (e) {
    console.warn('[PipelineWorker] 回写 failed 状态失败:', e);
  }
}

// v11.0.1: 周期孤儿扫描间隔 —— 心跳超时(90s)的 running 重新入队。
// 多副本安全(行级互斥);单机快速重启后本进程的孤儿也由此路径在 ~90s 内复活。
const ORPHAN_SWEEP_MS = 30_000;
let lastOrphanSweep = 0;

async function runJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>): Promise<void> {
  console.log(`[PipelineWorker] claim ${job.id} (project=${job.projectId}, attempt=${job.attempts})`);
  const hb = setInterval(() => { void heartbeatJob(job.id).catch(() => {}); }, HEARTBEAT_MS);
  (hb as { unref?: () => void }).unref?.();

  // emit 必须同步快返回(流水线不等待);落库走 promise 链保证事件顺序
  let appendChain: Promise<void> = Promise.resolve();
  // v10.4.2: 流水线内部致命错误是「发 error 事件后正常返回」(SSE 语义,不抛)——
  // worker 据此判失败,否则空跑/早退任务会被误标 done,死信重投就形同虚设。
  let fatalError = '';
  const emit = (type: string, data: unknown) => {
    emitPipeline(job.id, type, data);
    if (type === 'error') {
      fatalError = String((data as { message?: unknown })?.message ?? 'pipeline error');
    }
    if (type === 'step' && data && typeof (data as { step?: unknown }).step === 'string') {
      void setJobStep(job.id, (data as { step: string }).step).catch(() => {});
    }
    if (SKIP_PERSIST.has(type)) return;
    appendChain = appendChain
      .then(() => appendJobProgress(job.id, { type, data }))
      .catch(() => {});
  };

  try {
    if (job.type === 'voice-retake') {
      // v10.6.4: 重录队列 —— 按 type 派发;重试 = 重跑(单句 TTS 幂等成本低,失败句留面板可单录)
      const { runVoiceRetakeJob } = await import('./voice-retake');
      await runVoiceRetakeJob(job.payload as any, emit);
    } else if (job.type === 'pull-sheet') {
      // v11.1.1: 外部视频拆条 + 拉片(切分确定性,Vision 失败逐镜降级 → 重试 = 重跑)
      const { runPullSheetJob } = await import('./pull-sheet-job');
      await runPullSheetJob(job.payload as any, emit);
    } else {
      // v10.4.2: attempt>1 = 续跑 —— 断点装载,已有产物阶段跳过(不重复生成/计费)
      await runCreatePipeline(job.payload as CreatePipelineInput, emit, { resume: job.attempts > 1 });
    }
    await appendChain; // 进度全部落库后再标完成
    if (fatalError) {
      const state = await failJob(job.id, fatalError);
      await markProjectFailedIfTerminal(job, state);
      console.error(`[PipelineWorker] ${state === 'queued' ? 'retrying' : 'FAILED'} ${job.id} (pipeline error): ${fatalError.slice(0, 120)}`);
    } else {
      await completeJob(job.id);
      console.log(`[PipelineWorker] done ${job.id}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const state = await failJob(job.id, msg);
    await markProjectFailedIfTerminal(job, state);
    emitPipeline(job.id, 'error', { message: `流水线执行失败:${msg.slice(0, 200)}`, retrying: state === 'queued' });
    console.error(`[PipelineWorker] ${state === 'queued' ? 'retrying' : 'FAILED'} ${job.id}:`, msg);
  } finally {
    clearInterval(hb);
    emitPipeline(job.id, '__jobDone', {});
  }
}

async function tick(): Promise<void> {
  if (Date.now() - lastOrphanSweep >= ORPHAN_SWEEP_MS) {
    lastOrphanSweep = Date.now();
    try {
      const { recoverOrphanJobs } = await import('./repos/pipeline-job-repo');
      const { requeued, expired } = await recoverOrphanJobs();
      if (requeued || expired) console.log(`[PipelineWorker] orphan sweep: ${requeued} requeued, ${expired} expired`);
    } catch { /* driver 未就绪 — 下个周期再试 */ }
  }
  while (active < MAX_ACTIVE) {
    const job = await claimNextJob();
    if (!job) return;
    active++;
    void runJob(job)
      .catch((e) => console.error('[PipelineWorker] runJob error:', e))
      .finally(() => { active--; });
  }
}

/** 幂等启动 worker(开机先恢复孤儿任务)。HMR / 多次 import 下保持单例。 */
export function ensurePipelineWorker(): void {
  if (g.__qfmjPipelineWorker) return;
  const timer = setInterval(() => { void tick().catch((e) => console.error('[PipelineWorker] tick error:', e)); }, TICK_MS);
  (timer as { unref?: () => void }).unref?.();
  g.__qfmjPipelineWorker = { timer };
  void (async () => {
    try {
      const { recoverOrphanJobs } = await import('./repos/pipeline-job-repo');
      const { requeued, expired } = await recoverOrphanJobs();
      if (requeued || expired) {
        console.log(`[PipelineWorker] boot recovery (heartbeat-based): ${requeued} requeued, ${expired} expired`);
      }
    } catch (e) {
      console.warn('[PipelineWorker] boot recovery failed:', e);
    }
  })();
  console.log(`[PipelineWorker] started (tick=1.5s, concurrency=${MAX_ACTIVE})`);
}
