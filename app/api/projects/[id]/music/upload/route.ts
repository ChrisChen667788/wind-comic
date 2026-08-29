import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../../auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { upsertAsset } from '@/lib/repos/asset-repo';
import { persistAsset } from '@/lib/asset-storage';
import { assertOutboundUrlSafe } from '@/lib/ssrf-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/:id/music/upload —— 自备 BGM。
 *
 * v12.379:v12.376 查出 MiniMax Music API 对本账号已永久停用
 * (HTTP 410 / status_code 2153「no longer available to new users」),
 * 而 AI 作曲是这个项目唯一的配乐来源 —— 于是**没有任何办法给片子配乐**。
 *
 * 其实后端早就留了口子:recompose 认 `body.bgmUrl`(customBgm),
 * 优先级还在 music 资产之上。但全仓搜下来 **前端零消费方** ——
 * 又一次「能力做好了、入口没接」,只是这次因为 AI 作曲一直能用,没人发现。
 * 现在 AI 作曲塌了,这条口子成了唯一通路。
 *
 * 落成 `music` 资产而不是只返回 URL:那样 recompose 无需任何参数就能自动读到
 * (`musicAssets[0]`),和原来 AI 作曲的产物走**同一条路** —— 不引入第二套语义。
 *
 * 安全沿用 upload/character-face 那套:先登录 + 校验项目归属,
 * 外链过 ssrf-guard,大小设上限。
 */
const MAX_BYTES = 20 * 1024 * 1024; // BGM 比头像大得多,20MB 够放一首无损片段
const ALLOWED_AUDIO = /^audio\/(mpeg|mp3|wav|x-wav|aac|ogg|flac|mp4|x-m4a)$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  try {
    const ct = request.headers.get('content-type') || '';
    let persisted = null;
    let sourceName = '';

    if (ct.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) return NextResponse.json({ message: '缺少 file 字段' }, { status: 400 });
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ message: `文件过大(上限 ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 });
      }
      const fileType = (file as File).type || '';
      // 类型校验按**声明的 MIME**,拿不到就放行给 persistAsset 去认 ——
      // 这里挡的是「误传了一个视频/文档」,不是安全边界(安全边界是登录 + 归属校验)
      if (fileType && !ALLOWED_AUDIO.test(fileType)) {
        return NextResponse.json({ message: `不支持的音频类型:${fileType}` }, { status: 415 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = fileType || 'audio/mpeg';
      persisted = await persistAsset(`data:${mime};base64,${buf.toString('base64')}`, { contentType: mime });
      sourceName = (file as File).name || '';
    } else {
      const body = await request.json().catch(() => null);
      const url = typeof body?.audioUrl === 'string' ? body.audioUrl.trim() : '';
      if (!url) return NextResponse.json({ message: '需要 audioUrl 或 multipart 的 file 字段' }, { status: 400 });
      if (!/^(https?:|data:audio\/)/i.test(url)) {
        return NextResponse.json({ message: '只接受 http(s) 链接或 data:audio/ URI' }, { status: 400 });
      }
      if (/^https?:/i.test(url)) {
        const verdict = await assertOutboundUrlSafe(url);
        if (!verdict.ok) {
          console.warn(`[music/upload] SSRF 拦截 user=${payload.sub} 原因=${verdict.reason}`);
          return NextResponse.json({ message: `已拦截:${verdict.reason}` }, { status: 403 });
        }
      }
      persisted = await persistAsset(url, { contentType: 'audio/mpeg', ext: '.mp3' });
      sourceName = url.slice(0, 120);
    }

    if (!persisted?.url) {
      return NextResponse.json({ message: '音频落盘失败 —— 未写入任何资产' }, { status: 500 });
    }

    await upsertAsset({
      projectId: id, type: 'music', name: '背景配乐(自备)',
      data: { source: 'upload', originalName: sourceName, uploadedAt: new Date().toISOString() },
      mediaUrls: [persisted.url], persistentUrl: persisted.url,
    });

    return NextResponse.json({ ok: true, musicUrl: persisted.url, size: persisted.size, contentType: persisted.contentType });
  } catch (e) {
    console.error('[music/upload] failed:', e);
    return NextResponse.json({ message: e instanceof Error ? e.message : '上传失败' }, { status: 500 });
  }
}
