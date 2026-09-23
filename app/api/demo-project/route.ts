/**
 * POST /api/demo-project (v10.5.0) — 一键导入演示工程《雨夜信号》。
 * GET  /api/demo-project — 查询是否已导入(前端按钮态用)。
 * 幂等(重复 POST = 刷新还原**自己那份**);鉴权:登录即可。
 * v12.451:每人一份 —— GET 也按登录用户答(修前全站一个答案:别人导入过,你的按钮就显示「已导入」,点进去却无权访问)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { importDemoProject, resolveDemoProjectId } from '@/lib/demo-project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ imported: false, projectId: null });
  const { id, owned } = await resolveDemoProjectId(payload.sub);
  return NextResponse.json({ imported: owned, projectId: owned ? id : null });
}

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const result = await importDemoProject(payload.sub);
  return NextResponse.json(result, { status: result.refreshed ? 200 : 201 });
}
