/**
 * POST /api/master-prompt/refine · v7.7 — 用 LLM 优化 master prompt
 *
 * 入参: { prompt: string }  (compileMasterPrompt 产出的结构化 prompt)
 * 出参: 200 { refined, model } / 400 / 413 / 422 / 502
 */

import { NextRequest } from 'next/server';
import { API_CONFIG } from '@/lib/config';
import { callLLMWithFallback } from '@/lib/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 10) return Response.json({ error: 'prompt 太短' }, { status: 400 });
  if (prompt.length > 8000) return Response.json({ error: 'prompt 过长 (>8000 字符)' }, { status: 413 });

  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const v = checkAndSanitize(prompt, { task: 'polish-req' });
  if (!v.ok) return Response.json({ error: v.userMessage, category: v.category }, { status: 400 });

  if (!API_CONFIG.openai.apiKey && !(API_CONFIG.openai as any).creativeApiKey) {
    return Response.json({ error: 'LLM 未配置, 无法优化' }, { status: 422 });
  }

  const res = await callLLMWithFallback({
    system:
      '你是顶级广告导演兼提示词工程专家。把用户给的 master prompt 打磨得更精确、更有画面感、更可执行:\n' +
      '保留其 Markdown 结构 (# Role / # Task / ## Core Concept / ## Execution Parameters),\n' +
      '用专业摄影术语强化每条执行参数 (镜头/光影/色彩/运镜/构图), 补足缺失的执行细节。\n' +
      '只输出优化后的 prompt 本身, 不要额外解释或代码围栏。',
    user: v.sanitized,
    useCreative: true,
    fast: true,
    maxTokens: 2000,
    timeoutMs: 90_000,
  });
  if (!res.ok || !res.content) return Response.json({ error: res.error || '优化失败' }, { status: 502 });

  return Response.json({ refined: res.content, model: res.model });
}
