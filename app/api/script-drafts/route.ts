/**
 * POST /api/script-drafts · v2.15 G9 — 批量剧本草稿对比
 *
 * 用一个 idea 拿到 1-3 个剧本草稿, 用户对比后再选一版走完整 /api/create-stream。
 * 这个端点不持久化任何东西, 不创建 project, 也不进 orchestrator 状态机。
 *
 * 入参:
 *   { idea: string,           // 创意, ≥5 字符
 *     style?: string,         // 画风提示, 可空
 *     count?: 1 | 2 | 3 }     // 草稿数, 默认 2
 *
 * 出参:
 *   200 → { drafts: ScriptDraft[] } (每条含 script 或 errorMessage)
 *   400 → { error } (idea 缺/过短 / 注入 / 越界)
 *   422 → { error } (OPENAI_API_KEY 未配置)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { generateScriptDrafts } from '@/lib/script-drafts';
import { API_CONFIG } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240; // v7.1: 单稿 110s + MiniMax 兜底, 给足并发/限流余量

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const rawIdea = typeof body?.idea === 'string' ? body.idea.trim() : '';
  const style = typeof body?.style === 'string' ? body.style.trim().slice(0, 80) : '';
  const count = body?.count === 1 || body?.count === 3 ? body.count : 2;

  if (!rawIdea) return NextResponse.json({ error: '缺 idea' }, { status: 400 });
  if (rawIdea.length < 5) return NextResponse.json({ error: 'idea 至少 5 个字符' }, { status: 400 });
  if (rawIdea.length > 32000) return NextResponse.json({ error: 'idea 太长 (>32000 字符)' }, { status: 400 });

  // v2.13.4 安全闸门 — 用 creation 任务规则 (拒越界、注入、有害)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawIdea, { task: 'creation' });
  if (!verdict.ok) {
    console.warn(`[script-drafts] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return NextResponse.json(
      { error: verdict.userMessage, category: verdict.category },
      { status: 400 },
    );
  }

  if (!API_CONFIG.openai.apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY 未配置, 无法生成草稿' },
      { status: 422 },
    );
  }

  try {
    const t0 = Date.now();
    const drafts = await generateScriptDrafts({
      idea: verdict.sanitized,
      style,
      count,
    });
    const elapsedMs = Date.now() - t0;
    const okCount = drafts.filter((d) => d.script).length;
    console.log(`[script-drafts] user=${userId} count=${count} ok=${okCount}/${count} ${elapsedMs}ms`);

    return NextResponse.json({
      drafts,
      stats: {
        requested: count,
        succeeded: okCount,
        elapsedMs,
      },
    });
  } catch (e) {
    console.error('[script-drafts] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '草稿生成失败' },
      { status: 422 },
    );
  }
}
