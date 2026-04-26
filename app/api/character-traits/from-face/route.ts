/**
 * POST /api/character-traits/from-face · Sprint A.2 反向抽取端点
 *
 * 接收一个图像 URL (任意格式: http(s) / data: / /api/serve-file?key=xxx),
 * 走 GPT-4o Vision 反向抽取出一份 CharacterTraits, 让前端可以在 character manager
 * 模态框里点"自动识别"瞬间填好 6-8 个字段。
 *
 * 入参:
 *   { imageUrl: string, defaultName?: string }
 *
 * 出参:
 *   200 → CharacterTraits (含 confident 字段, false 时前端应该提示用户检查)
 *   400 → { error } (缺 imageUrl)
 *   422 → { error } (Vision 识别失败 / OpenAI key 缺)
 *
 * 成本: 每次 ≈ $0.005, 是用户主动触发的, 不会被批量滥用。
 */

import { NextRequest, NextResponse } from 'next/server';
import { traitsFromFace } from '@/lib/character-traits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const defaultName = typeof body?.defaultName === 'string' ? body.defaultName.slice(0, 30) : undefined;

  if (!imageUrl) {
    return NextResponse.json({ error: '缺 imageUrl 字段' }, { status: 400 });
  }

  const traits = await traitsFromFace(imageUrl, { defaultName });
  if (!traits) {
    return NextResponse.json(
      { error: 'Vision 识别失败, 请换一张更清晰的人脸照片或检查 OPENAI_API_KEY 配置' },
      { status: 422 },
    );
  }

  return NextResponse.json(traits);
}
