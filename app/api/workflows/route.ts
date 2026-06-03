/**
 * /api/workflows  · v4.1
 *
 * GET  当前用户的工作流列表 (?template=1 额外返回默认模板)
 * POST 新建/更新工作流 (body: WorkflowGraph) — 校验不过返 400
 *
 * Auth: 需登录.
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { listWorkflows, saveWorkflow, defaultWorkflow, validateWorkflow } from '@/lib/agent-workflow';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const out: any = { workflows: await listWorkflows(payload.sub) };
  if (url.searchParams.get('template') === '1') out.template = defaultWorkflow();
  return NextResponse.json(out);
}

export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await request.json(); } catch {}
  if (!body || typeof body !== 'object' || !body.id) {
    return NextResponse.json({ error: '需要合法的 WorkflowGraph (含 id)' }, { status: 400 });
  }
  const v = validateWorkflow(body);
  if (!v.valid) return NextResponse.json({ error: '校验失败', errors: v.errors }, { status: 400 });

  try {
    const saved = await saveWorkflow(payload.sub, body);
    return NextResponse.json({ workflow: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'save failed' }, { status: 400 });
  }
}
