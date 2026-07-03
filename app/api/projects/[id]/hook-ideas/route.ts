import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { buildHookIdeasPrompt, parseHookIdeas } from '@/lib/publish-copy';
import { callLLMWithFallback } from '@/lib/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.86.0 — Hook 创意生成:POST → 5 条开场 Hook 文案(公式约束 + 合规净化 + 长度校验),
 * 输出可直接投 recompose 的 hookVariants 做 A/B。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const parse = (s: string | null): any => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const [plans, scripts] = await Promise.all([listAssetsByType(id, 'plan'), listAssetsByType(id, 'script')]);
  const plan = parse(plans[0]?.data);
  const script = parse(scripts[0]?.data);
  if (!plan.genre && !script.synopsis) return NextResponse.json({ message: '项目缺 plan/script' }, { status: 422 });

  const { system, user } = buildHookIdeasPrompt({ idea: script.title || plan.title, genre: plan.genre, synopsis: script.synopsis });
  const r = await callLLMWithFallback({ system, user, useCreative: false, jsonMode: true, maxTokens: 300, timeoutMs: 60_000 });
  if (!r.ok || !r.content) return NextResponse.json({ message: `LLM 失败: ${(r.error || '').slice(0, 120)}` }, { status: 502 });

  const hooks = parseHookIdeas(r.content);
  if (!hooks) return NextResponse.json({ message: 'LLM 输出无合规 hook' }, { status: 502 });
  return NextResponse.json({ ok: true, hooks, model: r.model, hint: '可直接作 recompose 的 hookVariants:[{title}] 投 A/B' });
}
