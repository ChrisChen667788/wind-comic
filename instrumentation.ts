/**
 * Next.js 官方 instrumentation hook。
 * 仅在 Node.js runtime 跑一次 — 用来初始化遥测。
 *
 * 启用: next.config 里打开 `experimental.instrumentationHook: true` (若未默认开启)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // v12.357:**最先做** —— 后面所有初始化(遥测/模型雷达/队列 worker)都可能发请求。
    // Node 的 fetch 默认不认 HTTPS_PROXY,本机经 ClashX 才能到达的网关会全部超时。
    try {
      const { installServerProxy } = await import('@/lib/server-proxy');
      const p = await installServerProxy();
      if (p) console.log(`[proxy] 服务端已挂系统代理 ${p}(否则只走代理的网关会全部超时)`);
    } catch { /* 装不上就直连,不该让服务起不来 */ }

    const { initSentry } = await import('@/lib/telemetry');
    await initSentry();

    // v10.6.3: 模型雷达覆盖重放 —— 扫描采用过的模型 ID 写回 process.env,
    // config.ts 的模型 getter 即读到(DB 覆盖优先于 .env 默认,它是用户显式动作)。
    try {
      const { loadModelOverridesIntoEnv } = await import('@/lib/model-overrides');
      const n = await loadModelOverridesIntoEnv();
      if (n) console.log(`[ModelRadar] ${n} model override(s) restored`);
    } catch { /* 首次建库时序 — 静默 */ }

    // v10.4.1: PIPELINE_QUEUE=1 时开机即启 worker —— kill -9 重启后无需等请求进来,
    // 立刻恢复孤儿任务(running → queued)续跑。
    if (process.env.PIPELINE_QUEUE === '1') {
      const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
      ensurePipelineWorker();
    }
  }
}
