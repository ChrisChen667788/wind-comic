/**
 * lib/preview-history (v2.18 P2)
 *
 * 试拍记录 CRUD + 按天 rate-limit 计数.
 *
 * 设计:
 *   - 同一张表既给 rate-limit (countToday), 又给历史列表 (listForUser)
 *   - 不写 user FK, 让 demo / anon 用户也能用
 *   - 按 created_at 的 ISO 日期前缀 (yyyy-mm-dd) 切窗
 */

import { now } from './db';
import { getDbDriver } from './db-driver';
import { nanoid } from 'nanoid';

export interface PreviewHistoryEntry {
  id: string;
  userId: string;
  idea: string;
  style: string;
  aspect: string;
  imageUrl: string | null;
  videoUrl: string | null;
  prompt: string | null;
  elapsedMs: number;
  warnings: string[];
  createdAt: string;
}

interface PreviewHistoryRow {
  id: string;
  user_id: string;
  idea: string;
  style: string;
  aspect: string;
  image_url: string | null;
  video_url: string | null;
  prompt: string | null;
  elapsed_ms: number;
  warnings: string;
  created_at: string;
}

function rowToEntry(row: PreviewHistoryRow): PreviewHistoryEntry {
  let warnings: string[] = [];
  try {
    const parsed = JSON.parse(row.warnings || '[]');
    if (Array.isArray(parsed)) warnings = parsed.filter((w) => typeof w === 'string');
  } catch { /* swallow */ }
  return {
    id: row.id,
    userId: row.user_id,
    idea: row.idea,
    style: row.style,
    aspect: row.aspect,
    imageUrl: row.image_url,
    videoUrl: row.video_url,
    prompt: row.prompt,
    elapsedMs: row.elapsed_ms,
    warnings,
    createdAt: row.created_at,
  };
}

export interface InsertPreviewInput {
  userId: string;
  idea: string;
  style: string;
  aspect: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  prompt?: string | null;
  elapsedMs: number;
  warnings?: string[];
}

export async function insertPreview(input: InsertPreviewInput): Promise<PreviewHistoryEntry> {
  const id = nanoid();
  const createdAt = now();
  const warningsJson = JSON.stringify(input.warnings || []);
  await getDbDriver().run(
    `INSERT INTO preview_history
       (id, user_id, idea, style, aspect, image_url, video_url, prompt, elapsed_ms, warnings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.userId,
      (input.idea || '').slice(0, 500),
      input.style || '',
      input.aspect || '16:9',
      input.imageUrl || null,
      input.videoUrl || null,
      (input.prompt || '').slice(0, 400),
      Math.max(0, Math.round(input.elapsedMs || 0)),
      warningsJson,
      createdAt,
    ],
  );
  return {
    id,
    userId: input.userId,
    idea: (input.idea || '').slice(0, 500),
    style: input.style || '',
    aspect: input.aspect || '16:9',
    imageUrl: input.imageUrl || null,
    videoUrl: input.videoUrl || null,
    prompt: (input.prompt || '').slice(0, 400),
    elapsedMs: Math.max(0, Math.round(input.elapsedMs || 0)),
    warnings: input.warnings || [],
    createdAt,
  };
}

/** 当天 (UTC date) 该 user 已用次数 — 给 rate-limit 用 */
export async function countTodayForUser(userId: string, refDate: Date = new Date()): Promise<number> {
  const dayPrefix = refDate.toISOString().slice(0, 10); // 'yyyy-mm-dd'
  const row = (await getDbDriver().get(
    `SELECT COUNT(*) as c FROM preview_history
       WHERE user_id = ? AND substr(created_at, 1, 10) = ?`,
    [userId, dayPrefix],
  )) as { c: number | string } | undefined;
  return Number(row?.c ?? 0); // PG COUNT 返字符串 → 归一
}

export async function listForUser(userId: string, limit = 30): Promise<PreviewHistoryEntry[]> {
  const rows = (await getDbDriver().query(
    `SELECT * FROM preview_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, Math.min(100, Math.max(1, limit))],
  )) as PreviewHistoryRow[];
  return rows.map(rowToEntry);
}

export async function deletePreview(id: string, userId: string): Promise<boolean> {
  const result = await getDbDriver().run(
    `DELETE FROM preview_history WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return result.changes > 0;
}

// ════════════════════════════════════════════════════════════════════
// Rate-limit 配额表
// ════════════════════════════════════════════════════════════════════

export type Tier = 'free' | 'creator' | 'pro' | 'enterprise';

/** 每个 tier 每天试拍上限. enterprise 仍设 500 防机器人扫. */
export const PREVIEW_DAILY_LIMIT: Record<Tier, number> = {
  free: 5,
  creator: 20,
  pro: 100,
  enterprise: 500,
};

export interface QuotaState {
  tier: Tier;
  used: number;
  limit: number;
  remaining: number;
  blocked: boolean;
}

export async function getQuotaState(userId: string, tier: Tier): Promise<QuotaState> {
  const limit = PREVIEW_DAILY_LIMIT[tier] ?? PREVIEW_DAILY_LIMIT.free;
  const used = await countTodayForUser(userId);
  const remaining = Math.max(0, limit - used);
  return {
    tier,
    used,
    limit,
    remaining,
    blocked: remaining <= 0,
  };
}
