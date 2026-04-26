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
  }
}
