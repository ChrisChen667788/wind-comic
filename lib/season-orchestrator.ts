/**
 * v6.2.3 — N 集并行编排 · 有界并发执行池 (纯逻辑, client-safe, 可单测)
 *
 * v6.2.2 的整季批量是"逐集送入创作工坊"(串行 + localStorage 续跑). 这里补上
 * 真正的并行编排原语: 把 N 个独立 job (每集创作 / 每集解说音轨) 以有界并发跑完,
 * 失败可续跑 (continueOnError) 或快速中止, 带进度回调. runner 注入 → 可单测 + 可复用
 * (解说音轨合成、整季创作都走这一个池).
 */

export interface SettledResult<R> {
  index: number;
  ok: boolean;
  value?: R;
  error?: string;
}

export interface PoolResult<R> {
  results: SettledResult<R>[];
  total: number;
  ok: number;
  failed: number;
  /** continueOnError=false 中止后未执行的数量 */
  skipped: number;
}

export interface RunPoolOpts<R> {
  /** 最大并发, 默认 3, 至少 1. */
  concurrency?: number;
  /** 单 job 失败后是否继续 (默认 true). false → 不再派发新 job (在途的仍会结算). */
  continueOnError?: boolean;
  /** 每个 job 结算时回调 (做进度条). */
  onSettle?: (r: SettledResult<R>) => void;
}

/**
 * 有界并发执行池. 结果按入参顺序 (index) 排列; continueOnError=false 中止后
 * 未执行的 job 不出现在 results 里 (体现在 skipped).
 */
export async function runPool<T, R>(
  items: T[],
  runner: (item: T, index: number) => Promise<R>,
  opts: RunPoolOpts<R> = {},
): Promise<PoolResult<R>> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 3));
  const continueOnError = opts.continueOnError ?? true;
  const slots: Array<SettledResult<R> | undefined> = new Array(items.length);
  let cursor = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (true) {
      if (aborted) return;
      const i = cursor++;
      if (i >= items.length) return;
      let settled: SettledResult<R>;
      try {
        const value = await runner(items[i], i);
        settled = { index: i, ok: true, value };
      } catch (e) {
        settled = { index: i, ok: false, error: e instanceof Error ? e.message : String(e) };
        if (!continueOnError) aborted = true;
      }
      slots[i] = settled;
      opts.onSettle?.(settled);
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));

  const results = slots.filter((s): s is SettledResult<R> => !!s);
  const ok = results.filter((r) => r.ok).length;
  return {
    results,
    total: items.length,
    ok,
    failed: results.length - ok,
    skipped: items.length - results.length,
  };
}

// ── 整季编排 (套在 runPool 上, 给 BatchJob 加回 episode 元信息) ─────────────
import type { BatchJob } from './season-batch';

export interface SeasonRunResult<R> {
  episodeIndex: number;
  title: string;
  ok: boolean;
  error?: string;
  output?: R;
}

export interface SeasonRunReport<R> {
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  results: SeasonRunResult<R>[];
}

/** 把整季批量计划的 jobs 以有界并发跑完, 结果带回 episodeIndex/title. */
export async function orchestrateSeason<R>(
  jobs: BatchJob[],
  runJob: (job: BatchJob, index: number) => Promise<R>,
  opts: RunPoolOpts<R> = {},
): Promise<SeasonRunReport<R>> {
  const pool = await runPool(jobs, runJob, opts);
  const results: SeasonRunResult<R>[] = pool.results.map((r) => ({
    episodeIndex: jobs[r.index].episodeIndex,
    title: jobs[r.index].title,
    ok: r.ok,
    error: r.error,
    output: r.value,
  }));
  return { total: pool.total, ok: pool.ok, failed: pool.failed, skipped: pool.skipped, results };
}
