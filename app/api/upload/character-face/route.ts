import { NextRequest, NextResponse } from 'next/server';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/upload/character-face
 *
 * v2.12 Phase 1 — 创作工坊"角色锁脸"上传端点。
 *
 * 与 /api/projects/:id/cameo 的区别:
 *   - cameo 路由是项目级:必须先有 project,上传后写 projects.primary_character_ref
 *   - 本路由是项目无关:只 persistAsset 落盘并返回稳定 URL,
 *     给 /dashboard/create 页面在创建项目"之前"就能上传角色脸
 *   - 创建项目时,前端把这些 URL 一起 POST 到 /api/create-stream,
 *     由 create-stream 写进 projects.locked_characters 列
 *
 * 请求体支持两种:
 *   1) multipart/form-data,字段名 file
 *   2) JSON { imageUrl: "https://..." | "data:..." }
 *
 * 返回: { url: string, size?: number, contentType?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let buffer: Buffer | null = null;
    let externalUrl: string | null = null;

    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'missing file field' }, { status: 400 });
      }
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'file too large (max 10MB)' }, { status: 413 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await request.json().catch(() => null);
      if (!body?.imageUrl || typeof body.imageUrl !== 'string') {
        return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
      }
      // 安全:仅允许 http(s) / data: URI,挡掉 file:/// 之类的本地协议
      if (!/^(https?:|data:)/i.test(body.imageUrl)) {
        return NextResponse.json({ error: 'invalid imageUrl protocol' }, { status: 400 });
      }
      externalUrl = body.imageUrl;
    }

    let persisted;
    if (buffer) {
      const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      persisted = await persistAsset(dataUri, { contentType: 'image/png' });
    } else if (externalUrl) {
      persisted = await persistAsset(externalUrl);
    }

    if (!persisted) {
      return NextResponse.json({ error: 'failed to persist image' }, { status: 500 });
    }

    return NextResponse.json({
      url: persisted.url,
      size: persisted.size,
      contentType: persisted.contentType,
    });
  } catch (e) {
    console.error('[upload/character-face] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'upload failed' },
      { status: 500 },
    );
  }
}
