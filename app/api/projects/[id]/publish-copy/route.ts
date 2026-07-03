import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { buildPublishCopyPrompt, parsePublishCopy } from '@/lib/publish-copy';
import { callLLMWithFallback } from '@/lib/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.84.0 — 发布文案生成:POST → 从 plan/script 生成 标题×3 + 话题 + 封面题(合规净化),
 * 落 publish_copy 资产(幂等)。LLM 走全链一致的主→MiniMax 兜底。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const parse = (s: string | null): any => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const [plans, scripts, projects] = await Promise.all([
    listAssetsByType(id, 'plan'), listAssetsByType(id, 'script'), listAssetsByType(id, 'quality_report'),
  ]);
  void projects;
  const plan = parse(plans[0]?.data);
  const script = parse(scripts[0]?.data);
  if (!plan.genre && !script.synopsis) return NextResponse.json({ message: '项目缺 plan/script,无法生成文案' }, { status: 422 });

  const { system, user } = buildPublishCopyPrompt({
    idea: script.title || plan.title,
    genre: plan.genre,
    synopsis: script.synopsis,
    dialogues: (script.shots || []).map((s: any) => s.dialogue).filter(Boolean),
  });
  const r = await callLLMWithFallback({ system, user, useCreative: false, jsonMode: true, maxTokens: 600, timeoutMs: 60_000 });
  if (!r.ok || !r.content) return NextResponse.json({ message: `LLM 失败: ${(r.error || '').slice(0, 120)}` }, { status: 502 });

  const copy = parsePublishCopy(r.content);
  if (!copy) return NextResponse.json({ message: 'LLM 输出无法解析为发布文案' }, { status: 502 });

  await upsertAsset({ projectId: id, type: 'publish_copy', name: '发布文案', data: copy });
  return NextResponse.json({ ok: true, copy, model: r.model });
}
