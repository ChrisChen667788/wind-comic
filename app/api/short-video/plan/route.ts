/**
 * POST /api/short-video/plan · v7.6 — 15s 短视频极速分镜计划
 *
 * 给一个创意 → 三幕(HOOK/BODY/CLIMAX)结构化分镜计划 (3 镜)。
 * 结构/时长/运镜由 lib/short-video 确定性逻辑掌控, LLM 只产"画面内容 + AI prompt"。
 *
 * 入参: { idea: string(≥5), durationS?: 15|30|60, rhythmId?: string, style?: string }
 * 出参:
 *   200 → { plan: ShortVideoPlan }
 *   400 → { error } (idea 缺/过短 / 注入)
 *   422 → { error } (LLM 未配置)
 *   502 → { error } (LLM 失败)
 */

import { NextRequest } from 'next/server';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';
import { API_CONFIG } from '@/lib/config';
import { callLLMWithFallback } from '@/lib/llm-client';
import { robustJsonParse } from '@/lib/polish-json';
import {
  SHORT_DURATIONS,
  getRhythmTemplate,
  defaultParams,
  buildShortVideoMessages,
  parseShortVideoPlan,
  type ShortDuration,
} from '@/lib/short-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // v12.382:付费端点必须先过守卫(鉴权 + 预算)。此前**完全没有鉴权** ——
  // 裸 curl 就能用 owner 的 key 去调 creative LLM,费用全记在他账上,
  // 而且因为没有登录态,cost-log 连一条记录都写不下,发现时只剩「余额怎么没了」。
  // 同类端点(narration/synthesize、cameo/preview、character-traits/from-face)早就加了,
  // 这几个是漏网的。
  const _paid = await guardPaidEndpoint(request, { pendingCostCny: 0.2 });
  if (!_paid.ok) return _paid.response;
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const rawIdea = typeof body?.idea === 'string' ? body.idea.trim() : '';
  if (!rawIdea) return Response.json({ error: '缺 idea' }, { status: 400 });
  if (rawIdea.length < 5) return Response.json({ error: 'idea 至少 5 个字符' }, { status: 400 });
  if (rawIdea.length > 4000) return Response.json({ error: 'idea 太长 (>4000 字符)' }, { status: 400 });

  const durationS: ShortDuration = (SHORT_DURATIONS as readonly number[]).includes(body?.durationS)
    ? body.durationS
    : 15;
  const rhythm = getRhythmTemplate(typeof body?.rhythmId === 'string' ? body.rhythmId : undefined);
  const style = typeof body?.style === 'string' ? body.style.trim().slice(0, 80) : '';

  // 安全闸门 — 复用 creation 规则 (拒注入/越界/有害)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawIdea, { task: 'creation' });
  if (!verdict.ok) {
    return Response.json({ error: verdict.userMessage, category: verdict.category }, { status: 400 });
  }

  if (!API_CONFIG.openai.apiKey && !(API_CONFIG.openai as any).creativeApiKey) {
    return Response.json({ error: 'LLM 未配置, 无法生成分镜计划' }, { status: 422 });
  }

  // v12.165:制作语言下达(languageDisplayName 转成母语名注入铁律,LLM 对母语名遵从度更高)
  const langParam = typeof body?.language === 'string' && body.language !== 'auto' ? body.language : '';
  let langName = '';
  if (langParam) {
    const { normalizeLanguage, languageDisplayName } = await import('@/lib/language-detect');
    langName = languageDisplayName(normalizeLanguage(langParam, verdict.sanitized));
  }
  const { system, user } = buildShortVideoMessages({ idea: verdict.sanitized, style, durationS, rhythm, language: langName || undefined });

  try {
    const t0 = Date.now();
    // 快档 (deepseek-v4-flash) + MiniMax 全局兜底 + 瞬时错误退避重试 + <think> 剥离
    const res = await callLLMWithFallback({
      system, user,
      useCreative: true,
      fast: true,
      jsonMode: true,
      maxTokens: 2000,
      timeoutMs: 90_000,
    });
    if (!res.ok || !res.content) {
      return Response.json({ error: res.error || 'LLM 返回空' }, { status: 502 });
    }

    const parsed = robustJsonParse(res.content);
    const plan = parseShortVideoPlan(parsed, {
      idea: verdict.sanitized,
      style,
      durationS,
      rhythmId: rhythm.id,
      params: defaultParams(rhythm),
    });

    return Response.json({
      plan,
      stats: { elapsedMs: Date.now() - t0, model: res.model, usedFallback: !!res.usedFallback },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : '分镜计划生成失败' },
      { status: 502 },
    );
  }
}
