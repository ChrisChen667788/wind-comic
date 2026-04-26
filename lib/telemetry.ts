/**
 * 轻量级遥测封装 —— 包装 Sentry(可选) + console.
 *
 * 设计目标:
 *  - 当未安装 @sentry/nextjs 或未配置 SENTRY_DSN 时,降级到 console,不抛错
 *  - 业务代码只依赖 `captureException(err, ctx)` 和 `captureMessage(msg, level)`
 *  - 初始化仅在 Node.js runtime 首次 import 时跑一次 (idempotent)
 *
 * 启用方式:
 *   1. npm i @sentry/nextjs
 *   2. 在 .env.local 设置 SENTRY_DSN=https://...
 *   3. (可选) 添加 instrumentation.ts 里调用 `initSentry()`
 */

type Level = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

let sentryLoaded = false;
let sentryEnabled = false;
let sentryMod: any = null;

async function loadSentry() {
  if (sentryLoaded) return;
  sentryLoaded = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // @ts-ignore — 可选依赖,tsconfig 不强制
    sentryMod = await import('@sentry/nextjs').catch(() => null);
    if (sentryMod && typeof sentryMod.init === 'function') {
      sentryMod.init({
        dsn,
        environment: process.env.NODE_ENV,
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
        release: process.env.NEXT_PUBLIC_APP_VERSION,
      });
      sentryEnabled = true;
      console.log('[telemetry] Sentry initialized');
    }
  } catch (e) {
    console.warn('[telemetry] Sentry load failed, falling back to console:', e);
  }
}

/**
 * 主动初始化 Sentry。在 instrumentation.ts 里调用:
 *   export async function register() { await initSentry(); }
 */
export async function initSentry() {
  await loadSentry();
}

/** 记录异常 */
export function captureException(err: unknown, context?: Record<string, unknown>) {
  // 启动加载(不阻塞)
  if (!sentryLoaded) void loadSentry();
  if (sentryEnabled && sentryMod?.captureException) {
    try {
      if (context) sentryMod.setContext('app', context);
      sentryMod.captureException(err);
    } catch {}
  }
  console.error('[telemetry:exception]', err instanceof Error ? err.message : err, context ?? '');
}

/** 记录自定义消息 */
export function captureMessage(msg: string, level: Level = 'info', context?: Record<string, unknown>) {
  if (!sentryLoaded) void loadSentry();
  if (sentryEnabled && sentryMod?.captureMessage) {
    try {
      if (context) sentryMod.setContext('app', context);
      sentryMod.captureMessage(msg, level);
    } catch {}
  }
  const logger =
    level === 'error' || level === 'fatal' ? console.error :
    level === 'warning' ? console.warn : console.log;
  logger(`[telemetry:${level}]`, msg, context ?? '');
}

/**
 * 包装异步函数,出错时上报后 rethrow。适合 API handler:
 *   export const POST = withTelemetry(async (req) => { ... });
 */
export function withTelemetry<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  name?: string,
): (...args: Args) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      captureException(e, { name });
      throw e;
    }
  };
}
