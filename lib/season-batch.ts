/**
 * v6.2.2 — 整季批量创作 · 纯逻辑 (client-safe, 可单测)
 *
 * 把 story-intake 拆出的多集打成一个"批量作业计划": 每集一个 job (带注入叙事 directive 的
 * seed), 可持久化到 localStorage 跨页面续跑 (送一集去创作工坊 → 标记 → 回来续下一集).
 */

import { getNarrationMode } from './story-intake';
import type { Episode } from './story-intake';

export type JobStatus = 'pending' | 'sent' | 'done';

export interface BatchJob {
  episodeIndex: number;
  title: string;
  charCount: number;
  /** 送入创作工坊的 seed: 叙事 directive + 本集正文 */
  seed: string;
  status: JobStatus;
}

export interface SeasonBatchPlan {
  totalEpisodes: number;
  mode: string;
  modeLabel: string;
  totalChars: number;
  jobs: BatchJob[];
}

/** 由分集 + 叙事模式构建批量计划. */
export function buildSeasonBatch(episodes: Episode[], opts: { mode?: string } = {}): SeasonBatchPlan {
  const nm = getNarrationMode(opts.mode);
  const jobs: BatchJob[] = episodes.map((ep) => ({
    episodeIndex: ep.index,
    title: ep.title,
    charCount: ep.charCount,
    seed: `【叙事模式:${nm.label}】${nm.directive}\n\n${ep.title}\n${ep.text}`,
    status: 'pending',
  }));
  return {
    totalEpisodes: jobs.length,
    mode: nm.id,
    modeLabel: nm.label,
    totalChars: jobs.reduce((s, j) => s + j.charCount, 0),
    jobs,
  };
}

/** 下一个待创作的 job (没有则 null). */
export function nextPending(jobs: BatchJob[]): BatchJob | null {
  return jobs.find((j) => j.status === 'pending') ?? null;
}

/** 不可变地更新某集状态. */
export function markJob(jobs: BatchJob[], episodeIndex: number, status: JobStatus): BatchJob[] {
  return jobs.map((j) => (j.episodeIndex === episodeIndex ? { ...j, status } : j));
}

/** 批量进度. */
export function batchProgress(jobs: BatchJob[]): { done: number; sent: number; total: number; pct: number } {
  const done = jobs.filter((j) => j.status === 'done').length;
  const sent = jobs.filter((j) => j.status === 'sent').length;
  const total = jobs.length;
  return { done, sent, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
