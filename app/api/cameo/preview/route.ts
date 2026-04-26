/**
 * POST /api/cameo/preview  (v2.11 #2)
 *
 * Cameo 试穿预览 —— 用户上传脸的那一瞬间就告诉他/她:
 *   "这张图 82 分,不错,正面照 + 光线均匀。可惜背景太乱,建议裸背景重拍。"
 *
 * 为什么单独开端点而不塞进上传接口:
 *   - 上传接口要保证快速成功(用户等不了 vision LLM 3-5s)
 *   - 预览可以在上传前(本地 File → dataURI 直传这里打分)或上传后(拿 persistent URL 二次调用)
 *   - 失败不影响锁脸 —— 纯建议型服务
 *
 * 接受两种请求:
 *   1) multipart/form-data { file: File }  —— 未上传前试穿
 *   2) JSON { imageUrl: string }           —— 已持久化的 URL(http / /api/serve-file / data:)
 *
 * 返回:
 *   200 { score, verdict, dimensions, suggestions, warnings, summary }
 *   400 / 500 { error }
 */

import { NextRequest, NextResponse } from 'next/server';
import { scoreCameoImage } from '@/lib/cameo-vision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;  // vision 调用通常 2-5s,预留 30s

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let imageUrl: string | null = null;

    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'missing file field' }, { status: 400 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'file too large (max 10MB)' }, { status: 413 });
      }
      // 直接转成 data URI 喂给 vision,不落盘(预览是临时判断,不需要持久化)
      const buffer = Buffer.from(await file.arrayBuffer());
      const mime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
      imageUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    } else {
      const body = await request.json().catch(() => null);
      if (!body?.imageUrl || typeof body.imageUrl !== 'string') {
        return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
      }
      imageUrl = body.imageUrl;
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'invalid image' }, { status: 400 });
    }

    const result = await scoreCameoImage(imageUrl);
    if (!result) {
      // vision LLM 不可用/失败:返回 503 让前端选择跳过评分(不影响上传主流程)
      return NextResponse.json(
        { error: 'vision scoring unavailable', fallback: true },
        { status: 503 },
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error('[CameoPreview] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'preview failed' },
      { status: 500 },
    );
  }
}
