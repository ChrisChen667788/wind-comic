/**
 * POST /api/demo-project (v10.5.0) — 一键导入演示工程《雨夜信号》。
 * GET  /api/demo-project — 查询是否已导入(前端按钮态用)。
 * 幂等(重复 POST = 刷新还原);鉴权:登录即可。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { importDemoProject, DEMO_PROJECT_ID } from '@/lib/demo-project';
import { getProject } from '@/lib/repos/project-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const existing = await getProject(DEMO_PROJECT_ID);
  return NextResponse.json({ imported: !!existing, projectId: existing ? DEMO_PROJECT_ID : null });
}

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const result = await importDemoProject(payload.sub);
  return NextResponse.json(result, { status: result.refreshed ? 200 : 201 });
}
