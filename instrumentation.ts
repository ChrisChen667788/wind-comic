/**
 * Next.js 官方 instrumentation hook。
 * 仅在 Node.js runtime 跑一次 — 用来初始化遥测。
 *
 * 启用: next.config 里打开 `experimental.instrumentationHook: true` (若未默认开启)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentry } = await import('@/lib/telemetry');
    await initSentry();

    // v10.4.1: PIPELINE_QUEUE=1 时开机即启 worker —— kill -9 重启后无需等请求进来,
    // 立刻恢复孤儿任务(running → queued)续跑。
    if (process.env.PIPELINE_QUEUE === '1') {
      const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
      ensurePipelineWorker();
    }
  }
}
