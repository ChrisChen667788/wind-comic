/**
 * POST /api/invite-codes/validate
 *
 * 注册页 "验证邀请码" 按钮使用。只做校验不占用。
 * body: { code: string }
 */
import { NextResponse } from 'next/server';
import { validateInviteCode } from '@/lib/invite-codes';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const result = validateInviteCode(body.code || '');
  return NextResponse.json(
    {
      ok: result.ok,
      error: result.error,
      // 不返回整个 invite 对象（避免暴露 createdBy 等）
      source: result.invite?.source,
    },
    { status: result.ok ? 200 : 400 },
  );
}
