/**
 * POST /api/upload/comment-attachment · v3.x E.1
 *
 * 评论附件上传 — multipart/form-data, 字段 file. 单文件 ≤10MB, image/video/file.
 * 返回稳定 http URL (走 persistAsset 落 data/storage).
 *
 * 与 character-face 上传的差别: 这里允许 video/* + 通用 file 类型,
 * 不强制 image-only; 文件类型 inferred from MIME.
 */

import { NextRequest, NextResponse } from 'next/server';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_PREFIXES = ['image/', 'video/'];

function inferType(mime: string): 'image' | 'video' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

export async function POST(request: NextRequest) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (!ct.startsWith('multipart/form-data')) {
      return NextResponse.json({ error: 'multipart/form-data only' }, { status: 400 });
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'missing file field' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: `file too large (max ${MAX_SIZE / 1024 / 1024}MB)` }, { status: 413 });
    }
    const mime = file.type || 'application/octet-stream';
    // 安全: 只允许 image/* 和 video/* — 防上传 .sh / .js
    if (!ALLOWED_PREFIXES.some((p) => mime.startsWith(p))) {
      return NextResponse.json({ error: `unsupported mime ${mime}, only image/* and video/*` }, { status: 415 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
    const persisted = await persistAsset(dataUri, { contentType: mime });
    if (!persisted?.url) {
      return NextResponse.json({ error: '持久化失败' }, { status: 500 });
    }
    const filename = (file as any).name || 'upload';
    return NextResponse.json({
      url: persisted.url,
      type: inferType(mime),
      size: file.size,
      filename,
    });
  } catch (e) {
    console.error('[upload/comment-attachment] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
